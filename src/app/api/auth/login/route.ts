import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword, hashPassword, setSessionCookie, DUMMY_PASSWORD_HASH, verifySameOrigin } from '@/lib/auth-service';
import { decryptMfaSecret, verifyTOTP, verifyRecoveryCode } from '@/lib/mfa';
import { logAudit } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!verifySameOrigin(req)) {
    return NextResponse.json({ error: 'CSRF検証に失敗しました (不正なオリジン)' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'リクエストボディが正しいJSON形式ではありません' }, { status: 400 });
  }

  try {
    const { email, password, mfaCode } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'メールアドレスとパスワードを入力してください' }, { status: 400 });
    }

    if (typeof email !== 'string' || email.length > 255) {
      return NextResponse.json({ error: 'メールアドレスの形式が不正です（最大255文字）' }, { status: 400 });
    }

    if (typeof password !== 'string' || password.length > 128) {
      return NextResponse.json({ error: 'パスワードの形式が不正です（最大128文字）' }, { status: 400 });
    }

    if (mfaCode !== undefined && mfaCode !== null && (typeof mfaCode !== 'string' || mfaCode.length > 64)) {
      return NextResponse.json({ error: '認証コードの形式が不正です' }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();
    const rawIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '127.0.0.1';
    const ip = rawIp.split(',')[0].trim().slice(0, 45);

    // 多層レートリミット: IP単位 & メールアドレス単位の二重チェック
    const ipRateCheck = checkRateLimit(`login:ip:${ip}`, 40, 60000);
    const emailRateCheck = checkRateLimit(`login:email:${cleanEmail}`, 25, 60000);
    if (!ipRateCheck.success || !emailRateCheck.success) {
      const resetMs = Math.max(ipRateCheck.resetMs, emailRateCheck.resetMs);
      return NextResponse.json(
        { error: 'アクセスが集中しています。しばらく待ってから再度お試しください。' },
        { status: 429, headers: { 'Retry-After': Math.ceil(resetMs / 1000).toString() } }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: cleanEmail },
      include: { profile: true },
    });

    if (!user) {
      // タイミング攻撃防止: ユーザー非存在時も同等の計算を実行してレスポンス時間差を極小化 (ユーザー列挙防止)
      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      // サイドチャネル防御: 存在ユーザー時の SQLite failedLoginAttempts 更新遅延と応答時間を均等化 (ジッター込み)
      const jitterMs = 6 + Math.floor(Math.random() * 6);
      await new Promise((resolve) => setTimeout(resolve, jitterMs));
      return NextResponse.json({ error: 'メールアドレスまたはパスワードが正しくありません' }, { status: 401 });
    }

    // パスワード突合 (Argon2id 検証 & 旧ハッシュ後方互換)
    // ユーザー列挙対策: 停止・招待・ロック判定より前にパスワードを検証し、タイミングおよび情報漏洩を遮断
    const isPasswordValid = await verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      // 原子的インクリメントによる競合安全な失敗回数カウント
      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
      });
      const willLock = updatedUser.failedLoginAttempts >= 5;
      if (willLock) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: 0,
            lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
          },
        });
      }

      await logAudit({
        actorId: user.id,
        action: willLock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
        details: { reason: 'invalid_password' },
      });

      return NextResponse.json({
        error: willLock ? 'ログイン試行回数が超過したため15分間ロックされました' : 'メールアドレスまたはパスワードが正しくありません',
        locked: willLock,
      }, { status: 401 });
    }

    // アカウントロック判定 (5回失敗で15分ロック)
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return NextResponse.json({
        error: 'アカウントがロックされています。15分後に再度お試しください。',
        locked: true,
      }, { status: 423 });
    }

    // 利用停止アカウントのアクセス遮断
    if (user.status === 'suspended') {
      return NextResponse.json({ error: 'このアカウントは利用停止されています。システム管理者にお問い合わせください。' }, { status: 403 });
    }

    // 仮登録（招待中）アカウントの通常ログイン遮断
    if (user.status === 'invited') {
      return NextResponse.json({ error: '本登録が完了していません。招待メールのリンクからパスワードを設定してください。' }, { status: 401 });
    }

    // 旧レガシーハッシュだった場合は安全に最新セキュアハッシュへ自動移行
    if (!user.passwordHash.startsWith('$argon2') && !user.passwordHash.startsWith('$pbkdf2$')) {
      const updatedHash = await hashPassword(password);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: updatedHash },
      });
    }

    // 2FAが有効な場合 (RFC 6238 TOTP または リカバリーコード)
    if (user.mfaEnabled) {
      if (!mfaCode) {
        return NextResponse.json({ requireMfa: true }, { status: 200 });
      }

      const rawCode = String(mfaCode).trim();
      let mfaValid = false;
      let nextLastTotpStep: bigint | null = null;
      let nextRecoveryCodesJson: string | null = null;

      let replayError: string | null = null;

      // 1. 6桁数字の場合は TOTP 検証
      if (/^\d{6}$/.test(rawCode) && user.mfaSecret) {
        try {
          const secretBase32 = decryptMfaSecret(user.mfaSecret);
          const totpResult = verifyTOTP(secretBase32, rawCode, user.lastTotpStep);
          if (totpResult.valid && totpResult.verifiedStep) {
            mfaValid = true;
            nextLastTotpStep = totpResult.verifiedStep;
          } else if (totpResult.error?.includes('リプレイ')) {
            replayError = totpResult.error;
          }
        } catch (err) {
          console.error('MFA decryption or verification failed:', err);
        }
      }

      // 2. TOTP で一致しない場合、リカバリーコードとして検証
      if (!mfaValid && !replayError && user.mfaRecoveryCodes) {
        const recResult = verifyRecoveryCode(rawCode, user.mfaRecoveryCodes);
        if (recResult.valid) {
          mfaValid = true;
          nextRecoveryCodesJson = recResult.remainingHashesJson ?? null;
        }
      }

      if (!mfaValid) {
        const updatedUser = await prisma.user.update({
          where: { id: user.id },
          data: { failedLoginAttempts: { increment: 1 } },
        });
        const willLock = updatedUser.failedLoginAttempts >= 5;
        if (willLock) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: 0,
              lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
            },
          });
        }

        await logAudit({
          actorId: user.id,
          action: willLock ? 'ACCOUNT_LOCKED' : 'MFA_FAILED',
          details: { reason: replayError || 'invalid_code' },
        });

        const failureMessage = willLock
          ? '認証コード試行回数が超過したため15分間ロックされました'
          : replayError || '認証コードが正しくありません';

        return NextResponse.json({
          error: failureMessage,
          locked: willLock,
        }, { status: willLock ? 423 : 401 });
      }

      // 2FA 検証成功時の状態更新 (リプレイ防止ステップ / リカバリーコード消費)
      // 条件付き更新により、同時リクエストによるリプレイや重複消費をDBレベルで確実に遮断
      if (nextLastTotpStep !== null) {
        const updateRes = await prisma.user.updateMany({
          where: {
            id: user.id,
            OR: [
              { lastTotpStep: null },
              { lastTotpStep: { lt: nextLastTotpStep } },
            ],
          },
          data: { lastTotpStep: nextLastTotpStep },
        });
        if (updateRes.count === 0) {
          return NextResponse.json({ error: '認証コードが既に再利用されています（リプレイ防止）' }, { status: 401 });
        }
      }

      if (nextRecoveryCodesJson !== null) {
        const updateRes = await prisma.user.updateMany({
          where: {
            id: user.id,
            mfaRecoveryCodes: user.mfaRecoveryCodes,
          },
          data: { mfaRecoveryCodes: nextRecoveryCodesJson },
        });
        if (updateRes.count === 0) {
          return NextResponse.json({ error: 'リカバリーコードが既に消費されています' }, { status: 401 });
        }
      }
    }

    // ログイン成功: カウンタリセット
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });

    const sessionUser = {
      id: user.id,
      email: user.email,
      role: user.role as 'member' | 'admin' | 'system_admin',
      displayName: user.profile?.displayName ?? user.email,
      tokenVersion: user.tokenVersion,
    };

    setSessionCookie(sessionUser);

    await logAudit({
      actorId: user.id,
      action: 'LOGIN',
      details: { role: user.role },
    });

    const res = NextResponse.json({ user: sessionUser }, { status: 200 });
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

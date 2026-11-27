import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword, setSessionCookie, verifySameOrigin } from '@/lib/auth-service';
import { sha256Hex, timingSafeEqualStr } from '@/lib/web-crypto';
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
    const { email, token, password } = body;

    if (!email || !token || !password) {
      return NextResponse.json({ error: 'メールアドレス、招待トークン、新しいパスワードを入力してください' }, { status: 400 });
    }

    if (typeof email !== 'string' || email.length > 255) {
      return NextResponse.json({ error: 'メールアドレスの形式が不正です（最大255文字）' }, { status: 400 });
    }

    if (typeof token !== 'string' || token.length > 128) {
      return NextResponse.json({ error: '招待トークンの形式が不正です' }, { status: 400 });
    }

    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return NextResponse.json({ error: 'パスワードは8文字以上128文字以内で設定してください' }, { status: 400 });
    }

    const rawIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '127.0.0.1';
    const ip = rawIp.split(',')[0].trim().slice(0, 45);
    const rateCheck = checkRateLimit(`setup-password:${ip}`, 10, 60000);
    if (!rateCheck.success) {
      return NextResponse.json(
        { error: 'アクセスが集中しています。しばらく待ってから再度お試しください。' },
        { status: 429, headers: { 'Retry-After': Math.ceil(rateCheck.resetMs / 1000).toString() } }
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanToken = token.trim();

    const user = await prisma.user.findUnique({
      where: { email: cleanEmail },
      include: { profile: true },
    });

    if (!user || !user.resetToken || !user.resetExpiresAt) {
      return NextResponse.json({ error: '無効な招待リンクまたはトークンです' }, { status: 400 });
    }

    // 利用停止アカウントのパスワード設定遮断
    if (user.status === 'suspended') {
      return NextResponse.json({ error: 'このアカウントは利用停止されています。' }, { status: 403 });
    }

    // アカウントロック判定 (5回失敗で15分ロック)
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return NextResponse.json({
        error: 'アカウントがロックされています。15分後に再度お試しください。',
        locked: true,
      }, { status: 423 });
    }

    // 有効期限チェック (48時間)
    if (new Date() > user.resetExpiresAt) {
      return NextResponse.json({ error: '招待リンクの有効期限（48時間）が切れています。管理者に再発行を依頼してください。' }, { status: 400 });
    }

    // トークン検証 (SHA-256 ハッシュを一定時間突合)
    const inputTokenHash = await sha256Hex(cleanToken);

    if (!timingSafeEqualStr(inputTokenHash, user.resetToken)) {
      const attempts = user.failedLoginAttempts + 1;
      const willLock = attempts >= 5;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
          lockedUntil: willLock ? new Date(Date.now() + 15 * 60 * 1000) : null,
        },
      });

      return NextResponse.json({
        error: willLock ? '試行回数が超過したため15分間ロックされました' : '招待トークンが正しくありません',
        locked: willLock,
      }, { status: willLock ? 423 : 401 });
    }

    // 新パスワードを Argon2id で安全にハッシュ化
    const newPasswordHash = await hashPassword(password);

    // 本登録・運用開始への更新（古い全セッションを即時無効化）
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newPasswordHash,
        status: 'active',
        resetToken: null,
        resetExpiresAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        tokenVersion: { increment: 1 },
      },
    });

    const sessionUser = {
      id: user.id,
      email: user.email,
      role: user.role as 'member' | 'admin' | 'system_admin',
      displayName: user.profile?.displayName ?? user.email,
      tokenVersion: updatedUser.tokenVersion,
    };

    // 自動ログイン (セッションCookie発行)
    await setSessionCookie(sessionUser);

    // 監査ログ記録 (機微情報・平文メールアドレス等のPIIは除外)
    await logAudit({
      actorId: user.id,
      action: 'SETUP_PASSWORD',
      details: { statusTransition: 'invited->active' },
    });

    const res = NextResponse.json({
      success: true,
      message: '本登録が完了しました。CBT活動記録を開始できます。',
      user: sessionUser,
    });
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  } catch (error) {
    console.error('Setup password error:', error);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getCurrentSessionUser, verifySameOrigin } from '@/lib/auth-service';
import { inviteMemberByAdmin } from '@/lib/dal/admin';
import { logAudit } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!verifySameOrigin(req)) {
    return NextResponse.json({ error: 'CSRF検証に失敗しました (不正なオリジン)' }, { status: 403 });
  }

  const user = await getCurrentSessionUser();
  if (!user || (user.role !== 'admin' && user.role !== 'system_admin')) {
    return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });
  }

  // 管理者単位 & IP単位の多層レート制限 (大量招待によるDB枯渇・DoS攻撃防止)
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '127.0.0.1';
  const adminRateCheck = checkRateLimit(`invite:admin:${user.id}`, 20, 60000);
  const ipRateCheck = checkRateLimit(`invite:ip:${ip}`, 30, 60000);
  if (!adminRateCheck.success || !ipRateCheck.success) {
    const resetMs = Math.max(adminRateCheck.resetMs, ipRateCheck.resetMs);
    return NextResponse.json(
      { error: '招待リクエストが上限に達しました。しばらく待ってから再度お試しください。' },
      { status: 429, headers: { 'Retry-After': Math.ceil(resetMs / 1000).toString() } }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'リクエストボディが正しいJSON形式ではありません' }, { status: 400 });
  }

  try {
    const { email, displayName, supportStatus } = body;

    if (!email || !displayName) {
      return NextResponse.json({ error: 'メールアドレスと氏名を入力してください' }, { status: 400 });
    }

    if (typeof email !== 'string' || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: '有効なメールアドレス形式を入力してください（最大255文字）' }, { status: 400 });
    }

    if (typeof displayName !== 'string' || displayName.trim().length === 0 || displayName.length > 50) {
      return NextResponse.json({ error: '氏名は1〜50文字以内で入力してください' }, { status: 400 });
    }

    const result = await inviteMemberByAdmin(user.id, {
      email,
      displayName,
      supportStatus: supportStatus === 'paused' ? 'paused' : 'active',
    });

    // 監査ログ記録 (機微情報・平文メールアドレス等のPIIは除外)
    await logAudit({
      actorId: user.id,
      targetUserId: result.member.id,
      action: 'INVITE_MEMBER',
      details: { supportStatus: result.member.supportStatus },
    });

    const res = NextResponse.json(result, { status: 201 });
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  } catch (error: unknown) {
    const err = error as Error;
    if (err.message && err.message.includes('既に登録されています')) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error('Failed to invite member:', error);
    return NextResponse.json({ error: 'メンバー仮登録に失敗しました' }, { status: 500 });
  }
}

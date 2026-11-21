import { NextResponse } from 'next/server';
import { clearSessionCookie, getCurrentSessionUser, revokeUserSessions, verifySameOrigin } from '@/lib/auth-service';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!verifySameOrigin(req)) {
    return NextResponse.json({ error: 'CSRF検証に失敗しました (不正なオリジン)' }, { status: 403 });
  }

  const user = await getCurrentSessionUser();
  if (user) {
    await revokeUserSessions(user.id);
    await logAudit({
      actorId: user.id,
      action: 'LOGOUT',
    });
  }
  clearSessionCookie();
  const res = NextResponse.json({ ok: true });
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res;
}

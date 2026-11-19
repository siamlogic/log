import { NextResponse } from 'next/server';
import { getCurrentSessionUser, verifySameOrigin } from '@/lib/auth-service';
import { updateMemberVisibilityForAdmin } from '@/lib/dal/admin';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  if (!verifySameOrigin(req)) {
    return NextResponse.json({ error: 'CSRF検証に失敗しました (不正なオリジン)' }, { status: 403 });
  }

  const user = await getCurrentSessionUser();
  if (!user || (user.role !== 'admin' && user.role !== 'system_admin')) {
    return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });
  }

  const targetMemberId = params.id;

  try {
    const { isVisible, supportStatus } = await req.json();

    if (supportStatus !== undefined && !['active', 'paused', 'completed'].includes(supportStatus)) {
      return NextResponse.json({ error: 'supportStatus は active, paused, completed のいずれかを指定してください' }, { status: 400 });
    }

    await updateMemberVisibilityForAdmin(user.id, targetMemberId, {
      isVisible: isVisible !== undefined ? Boolean(isVisible) : undefined,
      supportStatus,
    });

    await logAudit({
      actorId: user.id,
      targetUserId: targetMemberId,
      action: 'UPDATE_VISIBILITY',
      details: { isVisible, supportStatus },
    });

    const res = NextResponse.json({ ok: true });
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  } catch (error: unknown) {
    const err = error as Error;
    if (err.message && err.message.includes('Access denied')) {
      return NextResponse.json({ error: '担当外のメンバーデータにはアクセスできません' }, { status: 403 });
    }
    console.error('Failed to update member visibility:', error);
    return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
  }
}

export const PUT = PATCH;

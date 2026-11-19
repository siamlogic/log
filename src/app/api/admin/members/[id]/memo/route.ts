import { NextResponse } from 'next/server';
import { getCurrentSessionUser, verifySameOrigin } from '@/lib/auth-service';
import { updateAdminMemoForMember } from '@/lib/dal/admin';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function PUT(
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
    const { adminMemo } = await req.json();

    if (adminMemo !== null && adminMemo !== undefined) {
      if (typeof adminMemo !== 'string' || adminMemo.length > 10000) {
        return NextResponse.json({ error: '支援メモは10,000文字以内で入力してください' }, { status: 400 });
      }
    }

    await updateAdminMemoForMember(user.id, targetMemberId, {
      adminMemo: typeof adminMemo === 'string' ? adminMemo.trim() : '',
      adminName: user.displayName,
    });

    await logAudit({
      actorId: user.id,
      targetUserId: targetMemberId,
      action: 'UPDATE_MEMO',
    });

    const res = NextResponse.json({ ok: true });
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  } catch (error: unknown) {
    const err = error as Error;
    if (err.message && err.message.includes('Access denied')) {
      return NextResponse.json({ error: '担当外のメンバーデータにはアクセスできません' }, { status: 403 });
    }
    console.error('Failed to update admin memo:', error);
    return NextResponse.json({ error: '支援メモ更新に失敗しました' }, { status: 500 });
  }
}

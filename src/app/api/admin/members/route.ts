import { NextResponse } from 'next/server';
import { getCurrentSessionUser } from '@/lib/auth-service';
import { getAssignedMembersForAdmin } from '@/lib/dal/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await getCurrentSessionUser();
  if (!user || (user.role !== 'admin' && user.role !== 'system_admin')) {
    return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const includeHidden = searchParams.get('includeHidden') === 'true';

  try {
    const list = await getAssignedMembersForAdmin(user.id, includeHidden);
    const res = NextResponse.json(list);
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  } catch (error) {
    console.error('Failed to get admin members:', error);
    return NextResponse.json({ error: 'メンバー一覧取得に失敗しました' }, { status: 500 });
  }
}

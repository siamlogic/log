import { NextResponse } from 'next/server';
import { getCurrentSessionUser } from '@/lib/auth-service';
import { getMemberWeekActivitiesForAdmin } from '@/lib/dal/admin';
import { getMondayOfCurrentWeek, isMondayYmd } from '@/lib/date-utils';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentSessionUser();
  if (!user || (user.role !== 'admin' && user.role !== 'system_admin')) {
    return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });
  }

  const targetMemberId = params.id;
  if (!targetMemberId || typeof targetMemberId !== 'string' || targetMemberId.length > 64) {
    return NextResponse.json({ error: 'メンバーIDの指定が不正です' }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const mondayParam = searchParams.get('monday');
  if (mondayParam && !isMondayYmd(mondayParam)) {
    return NextResponse.json(
      { error: '週間表示の基準日は必ず月曜日（YYYY-MM-DD）を指定してください。' },
      { status: 400 }
    );
  }

  const mondayYmd = mondayParam || getMondayOfCurrentWeek();

  try {
    const data = await getMemberWeekActivitiesForAdmin(user.id, targetMemberId, mondayYmd);

    await logAudit({
      actorId: user.id,
      targetUserId: targetMemberId,
      action: 'VIEW_MEMBER',
      details: { monday: mondayYmd },
    });

    const res = NextResponse.json(data);
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  } catch (error: unknown) {
    const err = error as Error;
    if (err.message && err.message.includes('Access denied')) {
      return NextResponse.json({ error: '担当外のメンバーデータにはアクセスできません' }, { status: 403 });
    }
    console.error('Failed to get member week activities:', error);
    return NextResponse.json({ error: 'データ取得に失敗しました' }, { status: 500 });
  }
}

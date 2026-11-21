import { NextResponse } from 'next/server';
import { getCurrentSessionUser } from '@/lib/auth-service';
import { getWeekActivitiesForUser } from '@/lib/dal/cbt';
import { getMondayOfCurrentWeek, isMondayYmd } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await getCurrentSessionUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
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
    const data = await getWeekActivitiesForUser(user.id, mondayYmd);
    const res = NextResponse.json(data);
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  } catch (error) {
    console.error('Failed to get week activities:', error);
    return NextResponse.json({ error: 'データ取得に失敗しました' }, { status: 500 });
  }
}

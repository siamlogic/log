import { NextResponse } from 'next/server';
import { getCurrentSessionUser, verifySameOrigin } from '@/lib/auth-service';
import { copyWeekActivities } from '@/lib/dal/cbt';
import { logAudit } from '@/lib/audit';
import { isMondayYmd } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!verifySameOrigin(req)) {
    return NextResponse.json({ error: 'CSRF検証に失敗しました (不正なオリジン)' }, { status: 403 });
  }

  const user = await getCurrentSessionUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  try {
    const { sourceMondayYmd, targetMondayYmd, overwriteNonEmpty, includeMood } = await req.json();

    if (!sourceMondayYmd || !targetMondayYmd) {
      return NextResponse.json({ error: 'コピー元とコピー先の週（月曜日）を指定してください' }, { status: 400 });
    }

    if (!isMondayYmd(sourceMondayYmd) || !isMondayYmd(targetMondayYmd)) {
      return NextResponse.json(
        { error: '週間コピーの基準日は必ず月曜日（YYYY-MM-DD）を指定してください。' },
        { status: 400 }
      );
    }

    const result = await copyWeekActivities(user.id, {
      sourceMondayYmd,
      targetMondayYmd,
      overwriteNonEmpty: Boolean(overwriteNonEmpty),
      includeMood: Boolean(includeMood),
    });

    await logAudit({
      actorId: user.id,
      action: 'COPY_WEEK',
      details: { copiedCount: result.copiedCount, includeMood },
    });

    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  } catch (error) {
    console.error('Failed to copy week activities:', error);
    return NextResponse.json({ error: '週コピー処理に失敗しました' }, { status: 500 });
  }
}

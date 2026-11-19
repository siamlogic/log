import { NextResponse } from 'next/server';
import { getCurrentSessionUser, verifySameOrigin } from '@/lib/auth-service';
import { copyDayActivities } from '@/lib/dal/cbt';
import { logAudit } from '@/lib/audit';

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
    const { sourceDateYmd, targetDateYmd, overwriteNonEmpty, includeMood } = await req.json();

    if (!sourceDateYmd || !targetDateYmd) {
      return NextResponse.json({ error: 'コピー元とコピー先の日付を指定してください' }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDateYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(targetDateYmd)) {
      return NextResponse.json({ error: '日付フォーマットが不正です (YYYY-MM-DD)' }, { status: 400 });
    }

    const result = await copyDayActivities(user.id, {
      sourceDateYmd,
      targetDateYmd,
      overwriteNonEmpty: Boolean(overwriteNonEmpty),
      includeMood: Boolean(includeMood),
    });

    await logAudit({
      actorId: user.id,
      action: 'COPY_DAY',
      details: { copiedCount: result.copiedCount, includeMood },
    });

    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  } catch (error) {
    console.error('Failed to copy day activities:', error);
    return NextResponse.json({ error: '日コピー処理に失敗しました' }, { status: 500 });
  }
}

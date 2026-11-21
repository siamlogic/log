import { NextResponse } from 'next/server';
import { getCurrentSessionUser, verifySameOrigin } from '@/lib/auth-service';
import { copyDayActivities } from '@/lib/dal/cbt';
import { logAudit } from '@/lib/audit';
import { isValidYmd } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!verifySameOrigin(req)) {
    return NextResponse.json({ error: 'CSRF検証に失敗しました (不正なオリジン)' }, { status: 403 });
  }

  const user = await getCurrentSessionUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'リクエストボディが正しいJSON形式ではありません' }, { status: 400 });
  }

  try {
    const { sourceDateYmd, targetDateYmd, overwriteNonEmpty, includeMood } = body;

    if (!sourceDateYmd || !targetDateYmd) {
      return NextResponse.json({ error: 'コピー元とコピー先の日付を指定してください' }, { status: 400 });
    }

    if (!isValidYmd(sourceDateYmd) || !isValidYmd(targetDateYmd)) {
      return NextResponse.json({ error: '実在する有効な日付（YYYY-MM-DD）を指定してください' }, { status: 400 });
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

import { NextResponse } from 'next/server';
import { getCurrentSessionUser, verifySameOrigin } from '@/lib/auth-service';
import { applyActivityRange } from '@/lib/dal/cbt';
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
    const body = await req.json();
    const {
      startDateYmd,
      startHourSlot,
      durationHours,
      activityName,
      moodScore,
      moodRawLevel,
      moodDisplaySymbol,
      notes,
      overwriteNonEmpty,
      allowFirstSlotOverwrite,
      originalActivityName,
    } = body;

    // 必須パラメータチェック
    if (!startDateYmd || startHourSlot === undefined || !durationHours || !activityName) {
      return NextResponse.json({ error: '必須パラメータが不足しています' }, { status: 400 });
    }

    // 境界値・入力バリデーション
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateYmd)) {
      return NextResponse.json({ error: '日付フォーマットが不正です (YYYY-MM-DD)' }, { status: 400 });
    }

    const startHour = Number(startHourSlot);
    if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
      return NextResponse.json({ error: '開始時間枠は 0〜23 の整数を指定してください' }, { status: 400 });
    }

    const duration = Number(durationHours);
    if (!Number.isInteger(duration) || duration < 1 || duration > 24) {
      return NextResponse.json({ error: '継続時間は 1〜24 時間の範囲で指定してください' }, { status: 400 });
    }

    if (typeof activityName !== 'string' || activityName.trim().length === 0 || activityName.length > 255) {
      return NextResponse.json({ error: '活動内容は 1〜255 文字以内で入力してください' }, { status: 400 });
    }

    const hasMood = moodScore !== null && moodScore !== undefined;
    let parsedMoodScore: number | null = null;
    let parsedRawLevel: number | null = null;
    let parsedSymbol: string | null = null;

    if (hasMood) {
      const numScore = Number(moodScore);
      if (Number.isNaN(numScore) || numScore < 0.0 || numScore > 1.0) {
        return NextResponse.json({ error: '気分スコアは 0.00〜1.00 の範囲で指定してください' }, { status: 400 });
      }
      parsedMoodScore = Number(numScore.toFixed(3));
      parsedRawLevel = moodRawLevel !== null && moodRawLevel !== undefined ? Number(moodRawLevel) : null;
      parsedSymbol = moodDisplaySymbol ? String(moodDisplaySymbol).slice(0, 32) : null;
    }

    if (notes && (typeof notes !== 'string' || notes.length > 2000)) {
      return NextResponse.json({ error: 'メモは 2000 文字以内で入力してください' }, { status: 400 });
    }

    const result = await applyActivityRange(user.id, {
      startDateYmd,
      startHourSlot: startHour,
      durationHours: duration,
      activityName: activityName.trim(),
      moodScore: parsedMoodScore,
      moodRawLevel: parsedRawLevel,
      moodDisplaySymbol: parsedSymbol,
      notes: notes ? String(notes).trim() : null,
      overwriteNonEmpty: Boolean(overwriteNonEmpty),
      allowFirstSlotOverwrite: Boolean(allowFirstSlotOverwrite),
      originalActivityName: originalActivityName ? String(originalActivityName).trim() : null,
    });

    await logAudit({
      actorId: user.id,
      action: 'APPLY_ACTIVITY_RANGE',
      details: {
        startHour,
        duration,
        appliedCount: result.appliedCount,
        hasMood: parsedMoodScore !== null,
      },
    });

    const res = NextResponse.json({
      success: true,
      appliedCount: result.appliedCount,
      affectedDates: result.affectedDates,
    });
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  } catch (error) {
    console.error('Failed to apply activity range:', error);
    return NextResponse.json({ error: '時間帯範囲の登録に失敗しました' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getCurrentSessionUser, verifySameOrigin } from '@/lib/auth-service';
import { upsertActivitySlot, deleteActivitySlot } from '@/lib/dal/cbt';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request) {
  if (!verifySameOrigin(req)) {
    return NextResponse.json({ error: 'CSRF検証に失敗しました (不正なオリジン)' }, { status: 403 });
  }

  const user = await getCurrentSessionUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { recordDateYmd, hourSlot, activityName, moodScore, moodRawLevel, moodDisplaySymbol, notes } = body;

    if (!recordDateYmd || hourSlot === undefined || !activityName) {
      return NextResponse.json({ error: '必須パラメータが不足しています' }, { status: 400 });
    }

    // 境界値・入力バリデーション
    if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDateYmd)) {
      return NextResponse.json({ error: '日付フォーマットが不正です (YYYY-MM-DD)' }, { status: 400 });
    }

    const hour = Number(hourSlot);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return NextResponse.json({ error: '時間枠は 0〜23 の整数を指定してください' }, { status: 400 });
    }

    if (typeof activityName !== 'string' || activityName.trim().length === 0 || activityName.length > 255) {
      return NextResponse.json({ error: '活動内容は 1〜255 文字以内で入力してください' }, { status: 400 });
    }

    if (notes && (typeof notes !== 'string' || notes.length > 2000)) {
      return NextResponse.json({ error: 'メモは 2000 文字以内で入力してください' }, { status: 400 });
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
    // hasMood が false の場合は moodScore, moodRawLevel, moodDisplaySymbol をすべて null に正規化 (臨床安全性)

    const saved = await upsertActivitySlot(user.id, {
      recordDateYmd,
      hourSlot: hour,
      activityName: activityName.trim(),
      moodScore: parsedMoodScore,
      moodRawLevel: parsedRawLevel,
      moodDisplaySymbol: parsedSymbol,
      notes: notes ? String(notes).trim() : null,
    });

    await logAudit({
      actorId: user.id,
      action: 'UPDATE_SLOT',
      details: { hourSlot, hasMood: moodScore !== null },
    });

    const res = NextResponse.json(saved);
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  } catch (error) {
    console.error('Failed to update slot:', error);
    return NextResponse.json({ error: 'スロット更新に失敗しました' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!verifySameOrigin(req)) {
    return NextResponse.json({ error: 'CSRF検証に失敗しました (不正なオリジン)' }, { status: 403 });
  }

  const user = await getCurrentSessionUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  try {
    const { recordDateYmd, hourSlot } = await req.json();
    if (!recordDateYmd || hourSlot === undefined) {
      return NextResponse.json({ error: '必須パラメータが不足しています' }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDateYmd)) {
      return NextResponse.json({ error: '日付フォーマットが不正です (YYYY-MM-DD)' }, { status: 400 });
    }

    const hour = Number(hourSlot);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return NextResponse.json({ error: '時間枠は 0〜23 の整数を指定してください' }, { status: 400 });
    }

    await deleteActivitySlot(user.id, recordDateYmd, hour);


    await logAudit({
      actorId: user.id,
      action: 'DELETE_SLOT',
      details: { hourSlot },
    });

    const res = NextResponse.json({ ok: true });
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  } catch (error) {
    console.error('Failed to delete slot:', error);
    return NextResponse.json({ error: 'スロット削除に失敗しました' }, { status: 500 });
  }
}

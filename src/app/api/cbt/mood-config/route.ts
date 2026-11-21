import { NextResponse } from 'next/server';
import { getCurrentSessionUser, verifySameOrigin } from '@/lib/auth-service';
import { getMoodConfigForUser, updateMoodConfigForUser } from '@/lib/dal/cbt';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentSessionUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  try {
    const config = await getMoodConfigForUser(user.id);
    const res = NextResponse.json(config);
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  } catch (error) {
    console.error('Failed to get mood config:', error);
    return NextResponse.json({ error: '気分設定取得に失敗しました' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
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
    const { emotionLabel, styleType, scaleSteps } = body;

    if (!emotionLabel || !styleType || scaleSteps === undefined) {
      return NextResponse.json({ error: '必須パラメータが不足しています' }, { status: 400 });
    }

    const allowedStyles = ['weather', 'face', 'pawapuro', 'arrow', 'number'];
    if (!allowedStyles.includes(styleType)) {
      return NextResponse.json({ error: 'styleType は weather, face, pawapuro, arrow, number のいずれかを指定してください' }, { status: 400 });
    }

    const steps = Number(scaleSteps);
    if (!Number.isInteger(steps) || steps < 3 || steps > 11) {
      return NextResponse.json({ error: '段階数（scaleSteps）は 3〜11 の整数を指定してください' }, { status: 400 });
    }

    if (typeof emotionLabel !== 'string' || emotionLabel.trim().length === 0 || emotionLabel.length > 50) {
      return NextResponse.json({ error: '感情名（emotionLabel）は 1〜50 文字以内で入力してください' }, { status: 400 });
    }

    const updated = await updateMoodConfigForUser(user.id, {
      emotionLabel: emotionLabel.trim(),
      styleType,
      scaleSteps: steps,
    });

    await logAudit({
      actorId: user.id,
      action: 'UPDATE_MOOD_CONFIG',
      details: { emotionLabel, styleType, scaleSteps },
    });

    const res = NextResponse.json(updated);
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  } catch (error) {
    console.error('Failed to update mood config:', error);
    return NextResponse.json({ error: '気分設定更新に失敗しました' }, { status: 500 });
  }
}

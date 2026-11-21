import { NextResponse } from 'next/server';
import { getCurrentSessionUser, verifySameOrigin } from '@/lib/auth-service';
import { getTemplatesForUser, saveCustomTemplate } from '@/lib/dal/cbt';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentSessionUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  try {
    const list = await getTemplatesForUser(user.id);
    const res = NextResponse.json(list);
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  } catch (error) {
    console.error('Failed to get templates:', error);
    return NextResponse.json({ error: 'テンプレート取得に失敗しました' }, { status: 500 });
  }
}

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
    const { name, scheduleData } = body;
    if (!name || !scheduleData) {
      return NextResponse.json({ error: 'テンプレート名とスケジュールデータを指定してください' }, { status: 400 });
    }

    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
      return NextResponse.json({ error: 'テンプレート名は1〜100文字以内で入力してください' }, { status: 400 });
    }

    if (typeof scheduleData !== 'object' || Array.isArray(scheduleData) || scheduleData === null) {
      return NextResponse.json({ error: 'スケジュールデータは時間スロットオブジェクト形式で指定してください' }, { status: 400 });
    }

    // スケジュールデータの厳密なキー・値バリデーション & プロトタイプ汚染対策
    const cleanSchedule: Record<string, string> = {};
    const entries = Object.entries(scheduleData);
    if (entries.length > 24) {
      return NextResponse.json({ error: 'スケジュールデータは最大24枠（0〜23時）です' }, { status: 400 });
    }

    for (const [key, val] of entries) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return NextResponse.json({ error: '不正なプロパティキーが含まれています' }, { status: 400 });
      }
      const hour = Number(key);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        return NextResponse.json({ error: '時間枠キーは 0〜23 の整数を指定してください' }, { status: 400 });
      }
      if (typeof val !== 'string' || val.trim().length === 0 || val.length > 255) {
        return NextResponse.json({ error: 'テンプレート枠の活動名は 1〜255 文字以内で入力してください' }, { status: 400 });
      }
      cleanSchedule[String(hour)] = val.trim();
    }

    const created = await saveCustomTemplate(user.id, { name: name.trim(), scheduleData: cleanSchedule });

    await logAudit({
      actorId: user.id,
      action: 'SAVE_TEMPLATE',
      details: { templateName: name.trim() },
    });

    const res = NextResponse.json(created);
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  } catch (error) {
    console.error('Failed to save template:', error);
    return NextResponse.json({ error: 'テンプレート保存に失敗しました' }, { status: 500 });
  }
}

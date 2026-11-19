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

  try {
    const { name, scheduleData } = await req.json();
    if (!name || !scheduleData) {
      return NextResponse.json({ error: 'テンプレート名とスケジュールデータを指定してください' }, { status: 400 });
    }

    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
      return NextResponse.json({ error: 'テンプレート名は1〜100文字以内で入力してください' }, { status: 400 });
    }

    if (typeof scheduleData !== 'object' || Array.isArray(scheduleData) || scheduleData === null) {
      return NextResponse.json({ error: 'スケジュールデータは時間スロットオブジェクト形式で指定してください' }, { status: 400 });
    }

    const created = await saveCustomTemplate(user.id, { name: name.trim(), scheduleData });

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

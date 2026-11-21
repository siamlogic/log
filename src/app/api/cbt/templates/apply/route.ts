import { NextResponse } from 'next/server';
import { getCurrentSessionUser, verifySameOrigin } from '@/lib/auth-service';
import { applyTemplateToDays } from '@/lib/dal/cbt';
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
    const { templateId, targetDatesYmd, overwriteNonEmpty } = body;

    if (!templateId || !targetDatesYmd || !Array.isArray(targetDatesYmd) || targetDatesYmd.length === 0) {
      return NextResponse.json({ error: '必須パラメータが不足しています' }, { status: 400 });
    }

    if (typeof templateId !== 'string' || templateId.length > 64) {
      return NextResponse.json({ error: 'テンプレートIDの指定が不正です' }, { status: 400 });
    }

    if (targetDatesYmd.length > 31) {
      return NextResponse.json({ error: '一度に適用できる日数は最大31日以内です' }, { status: 400 });
    }

    for (const d of targetDatesYmd) {
      if (!isValidYmd(d)) {
        return NextResponse.json({ error: '実在する有効な日付（YYYY-MM-DD）を指定してください' }, { status: 400 });
      }
    }

    const result = await applyTemplateToDays(user.id, {
      templateId,
      targetDatesYmd,
      overwriteNonEmpty: Boolean(overwriteNonEmpty),
    });

    await logAudit({
      actorId: user.id,
      action: 'APPLY_TEMPLATE',
      details: { templateId, targetCount: targetDatesYmd.length, appliedCount: result.appliedCount },
    });

    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  } catch (error: unknown) {
    const err = error as Error;
    if (err.message && err.message.includes('Template not found')) {
      return NextResponse.json({ error: '指定されたテンプレートが見つからないか、アクセス権がありません' }, { status: 404 });
    }
    console.error('Failed to apply template:', error);
    return NextResponse.json({ error: 'テンプレート適用に失敗しました' }, { status: 500 });
  }
}

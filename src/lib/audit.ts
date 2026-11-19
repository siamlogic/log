import { prisma } from './prisma';

export interface AuditParams {
  actorId: string;
  targetUserId?: string | null;
  action: 'LOGIN' | 'LOGOUT' | 'VIEW_MEMBER' | 'UPDATE_MEMO' | 'UPDATE_VISIBILITY' | 'UPDATE_SLOT' | 'DELETE_SLOT' | 'COPY_DAY' | 'COPY_WEEK' | 'SAVE_TEMPLATE' | 'APPLY_TEMPLATE' | 'UPDATE_MOOD_CONFIG' | 'APPLY_ACTIVITY_RANGE' | 'INVITE_MEMBER' | 'SETUP_PASSWORD';
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
}

/**
 * 監査ログ記録ヘルパー
 * 機微情報（活動内容、メモ、パスワード等）は記録禁止
 */
export async function logAudit(params: AuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        targetUserId: params.targetUserId ?? null,
        action: params.action,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        details: params.details ? JSON.stringify(params.details) : null,
      },
    });
  } catch (error) {
    // 監査ログ自体の失敗で業務処理を落とさないよう、エラーロギングのみ行う
    console.error('Failed to write audit log:', error);
  }
}

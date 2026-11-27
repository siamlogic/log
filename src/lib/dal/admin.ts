import 'server-only';
import { getD1Binding, prisma } from '../prisma';
import { randomBytesHex, sha256Hex } from '../web-crypto';
import { getWeekActivitiesForUser } from './cbt';
import type { MemberSummaryDTO, WeekActivitiesDTO } from './types';

/**
 * 管理者が担当するメンバー一覧取得
 * 他管理者の担当メンバーは一切取得不可
 */
export async function getAssignedMembersForAdmin(
  sessionAdminId: string,
  includeHidden: boolean = false
): Promise<MemberSummaryDTO[]> {
  const relations = await prisma.adminMemberRelation.findMany({
    where: {
      adminId: sessionAdminId,
      ...(includeHidden ? {} : { isVisible: true }),
    },
    include: {
      member: {
        include: {
          profile: true,
          activities: {
            orderBy: [{ recordDate: 'desc' }, { hourSlot: 'desc' }],
            take: 1,
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return relations.map((rel) => {
    const lastAct = rel.member.activities[0];
    let lastRecordStr = '未記録';
    if (lastAct) {
      const d = lastAct.recordDate;
      lastRecordStr = `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()} ${lastAct.hourSlot}:00`;
    }

    return {
      id: rel.member.id,
      name: rel.member.profile?.displayName ?? '名前未設定',
      email: rel.member.email,
      avatarColor: rel.member.profile?.avatarColor ?? 'bg-teal-100 text-teal-800',
      supportStatus: rel.supportStatus,
      isVisible: rel.isVisible,
      status: rel.member.status,
      lastRecordDate: lastRecordStr,
      adminMemo: rel.adminMemo,
      memoUpdatedAt: rel.memoUpdatedAt ? rel.memoUpdatedAt.toISOString() : null,
      memoUpdatedBy: rel.memoUpdatedBy,
    };
  });
}

/**
 * 担当メンバーの週間活動記録シート閲覧
 * 担当外管理者からのアクセスは例外を投げて完全遮断
 */
export async function getMemberWeekActivitiesForAdmin(
  sessionAdminId: string,
  targetMemberId: string,
  mondayYmd: string
): Promise<{ member: MemberSummaryDTO; weekData: WeekActivitiesDTO }> {
  // 担当関係チェック
  const relation = await prisma.adminMemberRelation.findUnique({
    where: {
      adminId_memberId: {
        adminId: sessionAdminId,
        memberId: targetMemberId,
      },
    },
    include: {
      member: {
        include: { profile: true },
      },
    },
  });

  if (!relation) {
    throw new Error('Access denied: You are not assigned to this member.');
  }

  const weekData = await getWeekActivitiesForUser(targetMemberId, mondayYmd);

  const memberSummary: MemberSummaryDTO = {
    id: relation.member.id,
    name: relation.member.profile?.displayName ?? '名前未設定',
    email: relation.member.email,
    avatarColor: relation.member.profile?.avatarColor ?? 'bg-teal-100 text-teal-800',
    supportStatus: relation.supportStatus,
    isVisible: relation.isVisible,
    status: relation.member.status,
    adminMemo: relation.adminMemo,
    memoUpdatedAt: relation.memoUpdatedAt ? relation.memoUpdatedAt.toISOString() : null,
    memoUpdatedBy: relation.memoUpdatedBy,
  };

  return {
    member: memberSummary,
    weekData,
  };
}

/**
 * 支援メモ（カルテ）更新
 * メンバー本人には絶対に公開されない秘匿カルテ
 */
export async function updateAdminMemoForMember(
  sessionAdminId: string,
  targetMemberId: string,
  params: { adminMemo: string; adminName: string }
): Promise<void> {
  const relation = await prisma.adminMemberRelation.findUnique({
    where: {
      adminId_memberId: {
        adminId: sessionAdminId,
        memberId: targetMemberId,
      },
    },
  });

  if (!relation) {
    throw new Error('Access denied: You are not assigned to this member.');
  }

  await prisma.adminMemberRelation.update({
    where: {
      adminId_memberId: {
        adminId: sessionAdminId,
        memberId: targetMemberId,
      },
    },
    data: {
      adminMemo: params.adminMemo,
      memoUpdatedAt: new Date(),
      memoUpdatedBy: params.adminName,
    },
  });
}

/**
 * 担当メンバーの表示/非表示・ステータス更新
 */
export async function updateMemberVisibilityForAdmin(
  sessionAdminId: string,
  targetMemberId: string,
  params: { isVisible?: boolean; supportStatus?: string }
): Promise<void> {
  const relation = await prisma.adminMemberRelation.findUnique({
    where: {
      adminId_memberId: {
        adminId: sessionAdminId,
        memberId: targetMemberId,
      },
    },
  });

  if (!relation) {
    throw new Error('Access denied: You are not assigned to this member.');
  }

  await prisma.adminMemberRelation.update({
    where: {
      adminId_memberId: {
        adminId: sessionAdminId,
        memberId: targetMemberId,
      },
    },
    data: {
      ...(params.isVisible !== undefined ? { isVisible: params.isVisible } : {}),
      ...(params.supportStatus !== undefined ? { supportStatus: params.supportStatus } : {}),
    },
  });
}

/**
 * 管理者による担当メンバーの仮登録（招待）
 * @param sessionAdminId 招待を実行する管理者ID
 * @param params { email, displayName, supportStatus? }
 * @returns { member: MemberSummaryDTO, inviteToken: string }
 */
export async function inviteMemberByAdmin(
  sessionAdminId: string,
  params: { email: string; displayName: string; supportStatus?: string }
): Promise<{ member: MemberSummaryDTO; inviteToken: string }> {
  const email = params.email.trim().toLowerCase();
  const displayName = params.displayName.trim();

  if (!email || !displayName) {
    throw new Error('メールアドレスと氏名を入力してください。');
  }

  // 既存ユーザーチェック
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    throw new Error('このメールアドレスは既に登録されています。');
  }

  // 招待用セキュアトークン生成 (32バイト hex = 64文字)
  const rawInviteToken = randomBytesHex(32);
  const hashedToken = await sha256Hex(rawInviteToken);
  const tokenExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48時間有効
  const newUserId = globalThis.crypto.randomUUID();
  const relationId = globalThis.crypto.randomUUID();
  const now = new Date();
  const nowIso = now.toISOString();
  const supportStatus = params.supportStatus || 'active';
  const adminMemo = '仮登録完了。初回パスワード設定待ち。';
  const memoUpdatedBy = '管理者仮登録';
  const avatarColor = 'bg-indigo-100 text-indigo-800';

  const d1 = getD1Binding();
  if (d1) {
    // Cloudflare D1 ではネイティブ DB.batch() により途中失敗時の全件ロールバックを保証
    await d1.batch([
      d1
        .prepare(
          'INSERT INTO "users" ("id", "email", "password_hash", "role", "status", "failed_login_attempts", "mfa_enabled", "token_version", "reset_token", "reset_expires_at", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?)'
        )
        .bind(
          newUserId,
          email,
          'INVITED_PENDING_PASSWORD',
          'member',
          'invited',
          hashedToken,
          tokenExpiresAt.toISOString(),
          nowIso,
          nowIso
        ),
      d1
        .prepare(
          'INSERT INTO "user_profiles" ("user_id", "display_name", "avatar_color", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?)'
        )
        .bind(newUserId, displayName, avatarColor, nowIso, nowIso),
      d1
        .prepare(
          'INSERT INTO "mood_configurations" ("user_id", "emotion_label", "style_type", "scale_steps", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?)'
        )
        .bind(newUserId, '気分の良さ', 'weather', 5, nowIso, nowIso),
      d1
        .prepare(
          'INSERT INTO "admin_member_relations" ("id", "admin_id", "member_id", "support_status", "is_visible", "admin_memo", "memo_updated_at", "memo_updated_by", "created_at", "updated_at") VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)'
        )
        .bind(
          relationId,
          sessionAdminId,
          newUserId,
          supportStatus,
          adminMemo,
          nowIso,
          memoUpdatedBy,
          nowIso,
          nowIso
        ),
    ]);

    return {
      member: {
        id: newUserId,
        name: displayName,
        email,
        avatarColor,
        supportStatus,
        isVisible: true,
        status: 'invited',
        lastRecordDate: '招待中（未記録）',
        adminMemo,
        memoUpdatedAt: nowIso,
        memoUpdatedBy,
      },
      inviteToken: rawInviteToken,
    };
  }

  const [newUser, relation] = await prisma.$transaction([
    // 1. 仮登録ユーザー作成 (ステータス: invited)
    prisma.user.create({
      data: {
        id: newUserId,
        email,
        passwordHash: 'INVITED_PENDING_PASSWORD',
        role: 'member',
        status: 'invited',
        resetToken: hashedToken,
        resetExpiresAt: tokenExpiresAt,
        profile: {
          create: {
            displayName,
            avatarColor,
          },
        },
        moodConfiguration: {
          create: {
            emotionLabel: '気分の良さ',
            styleType: 'weather',
            scaleSteps: 5,
          },
        },
      },
      include: {
        profile: true,
      },
    }),
    // 2. 担当管理者とのリレーション作成
    prisma.adminMemberRelation.create({
      data: {
        id: relationId,
        adminId: sessionAdminId,
        memberId: newUserId,
        supportStatus,
        isVisible: true,
        adminMemo,
        memoUpdatedAt: now,
        memoUpdatedBy,
      },
    }),
  ]);

  const member: MemberSummaryDTO = {
    id: newUser.id,
    name: newUser.profile?.displayName ?? displayName,
    email: newUser.email,
    avatarColor: newUser.profile?.avatarColor ?? avatarColor,
    supportStatus: relation.supportStatus,
    isVisible: relation.isVisible,
    status: newUser.status,
    lastRecordDate: '招待中（未記録）',
    adminMemo: relation.adminMemo,
    memoUpdatedAt: relation.memoUpdatedAt ? relation.memoUpdatedAt.toISOString() : null,
    memoUpdatedBy: relation.memoUpdatedBy,
  };

  return {
    member,
    inviteToken: rawInviteToken,
  };
}

import 'server-only';
import { prisma } from '../prisma';
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

  const member = await prisma.$transaction(async (tx) => {
    // 1. 仮登録ユーザー作成 (ステータス: invited)
    const newUser = await tx.user.create({
      data: {
        email,
        passwordHash: 'INVITED_PENDING_PASSWORD',
        role: 'member',
        status: 'invited',
        resetToken: hashedToken,
        resetExpiresAt: tokenExpiresAt,
        profile: {
          create: {
            displayName,
            avatarColor: 'bg-indigo-100 text-indigo-800',
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
    });

    // 2. 担当管理者とのリレーション作成
    const relation = await tx.adminMemberRelation.create({
      data: {
        adminId: sessionAdminId,
        memberId: newUser.id,
        supportStatus: params.supportStatus || 'active',
        isVisible: true,
        adminMemo: '仮登録完了。初回パスワード設定待ち。',
        memoUpdatedAt: new Date(),
        memoUpdatedBy: '管理者仮登録',
      },
    });

    return {
      id: newUser.id,
      name: newUser.profile?.displayName ?? displayName,
      email: newUser.email,
      avatarColor: newUser.profile?.avatarColor ?? 'bg-indigo-100 text-indigo-800',
      supportStatus: relation.supportStatus,
      isVisible: relation.isVisible,
      status: newUser.status,
      lastRecordDate: '招待中（未記録）',
      adminMemo: relation.adminMemo,
      memoUpdatedAt: relation.memoUpdatedAt ? relation.memoUpdatedAt.toISOString() : null,
      memoUpdatedBy: relation.memoUpdatedBy,
    };
  });

  return {
    member,
    inviteToken: rawInviteToken,
  };
}

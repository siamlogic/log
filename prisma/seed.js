// Seed script for CBT Activity Recording System
const { PrismaClient } = require('@prisma/client');
const argon2 = require('@node-rs/argon2');
const crypto = require('crypto');

const prisma = new PrismaClient();

const MASTER_KEY_HEX =
  process.env.MFA_ENCRYPTION_KEY ||
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function encryptMfaSecret(secret) {
  const masterKey = Buffer.from(MASTER_KEY_HEX, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function hashRecoveryCode(code) {
  const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

async function main() {
  console.log('Seeding CBT database...');

  // SQLite WALモード & タイムアウト設定
  try {
    await prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL;');
    await prisma.$executeRawUnsafe('PRAGMA busy_timeout = 5000;');
  } catch (e) {
    console.warn('Note: Could not set WAL mode (may not be SQLite):', e.message);
  }

  // 1. クリーンアップ
  await prisma.auditLog.deleteMany();
  await prisma.cbtActivity.deleteMany();
  await prisma.adminMemberRelation.deleteMany();
  await prisma.moodConfiguration.deleteMany();
  await prisma.userProfile.deleteMany();
  await prisma.activityTemplate.deleteMany();
  await prisma.user.deleteMany();

  // 2. ユーザー作成 (Argon2id ハッシュ)
  const defaultPwHash = await argon2.hash('password123');

  // メンバー1: 田中 太郎
  const userMember1 = await prisma.user.create({
    data: {
      id: 'member-1',
      email: 'tanaka@example.com',
      passwordHash: defaultPwHash,
      role: 'member',
      profile: {
        create: {
          displayName: '田中 太郎',
          avatarColor: 'bg-teal-100 text-teal-800'
        }
      },
      moodConfiguration: {
        create: {
          emotionLabel: '気分の良さ',
          styleType: 'weather',
          scaleSteps: 5
        }
      }
    }
  });

  // 管理者1: 佐藤 医師
  const userAdmin1 = await prisma.user.create({
    data: {
      id: 'admin-1',
      email: 'sato@example.com',
      passwordHash: defaultPwHash,
      role: 'admin',
      profile: {
        create: {
          displayName: '佐藤 医師',
          avatarColor: 'bg-indigo-100 text-indigo-800'
        }
      }
    }
  });

  // メンバー2: 高橋 花子
  const userMember2 = await prisma.user.create({
    data: {
      id: 'member-2',
      email: 'takahashi@example.com',
      passwordHash: defaultPwHash,
      role: 'member',
      profile: {
        create: {
          displayName: '高橋 花子',
          avatarColor: 'bg-rose-100 text-rose-800'
        }
      },
      moodConfiguration: {
        create: {
          emotionLabel: '気分の良さ',
          styleType: 'face',
          scaleSteps: 5
        }
      }
    }
  });

  // メンバー3: 鈴木 一郎
  const userMember3 = await prisma.user.create({
    data: {
      id: 'member-3',
      email: 'suzuki@example.com',
      passwordHash: defaultPwHash,
      role: 'member',
      profile: {
        create: {
          displayName: '鈴木 一郎',
          avatarColor: 'bg-amber-100 text-amber-800'
        }
      }
    }
  });

  // ロックアウト体験用
  await prisma.user.create({
    data: {
      id: 'member-locked',
      email: 'locked@example.com',
      passwordHash: defaultPwHash,
      role: 'member',
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24時間後までロック
      profile: {
        create: {
          displayName: 'ロックアウト ユーザー',
          avatarColor: 'bg-slate-100 text-slate-800'
        }
      }
    }
  });

  // 2FA体験用 (AES-256-GCM 暗号化秘密鍵 & ハッシュ化リカバリーコード)
  const encryptedMfaSecret = encryptMfaSecret('JBSWY3DPEHPK3PXP');
  const hashedRecoveryCode = hashRecoveryCode('A8F2-9K1M');

  await prisma.user.create({
    data: {
      id: 'member-2fa',
      email: '2fa@example.com',
      passwordHash: defaultPwHash,
      role: 'member',
      mfaEnabled: true,
      mfaSecret: encryptedMfaSecret,
      mfaRecoveryCodes: JSON.stringify([hashedRecoveryCode]),
      lastTotpStep: null,
      profile: {
        create: {
          displayName: '2FAテスト ユーザー',
          avatarColor: 'bg-teal-100 text-teal-800'
        }
      }
    }
  });

  // 利用停止アカウント (セキュリティ遮断テスト用)
  await prisma.user.create({
    data: {
      id: 'member-suspended',
      email: 'suspended@example.com',
      passwordHash: defaultPwHash,
      role: 'member',
      status: 'suspended',
      profile: {
        create: {
          displayName: '利用停止 ユーザー',
          avatarColor: 'bg-red-100 text-red-800'
        }
      }
    }
  });

  // 3. 管理者-メンバー担当関係 & 非公開カルテメモ
  await prisma.adminMemberRelation.create({
    data: {
      adminId: userAdmin1.id,
      memberId: userMember1.id,
      supportStatus: 'active',
      isVisible: true,
      adminMemo: '金曜日に朝の散歩と上司との面談を実施し、気分の良さが75%〜100%へ改善。就寝枠の記録も安定している。次回面談で振り返りを行う。',
      memoUpdatedAt: new Date('2026-10-15T10:30:00Z'),
      memoUpdatedBy: '佐藤 医師'
    }
  });

  await prisma.adminMemberRelation.create({
    data: {
      adminId: userAdmin1.id,
      memberId: userMember2.id,
      supportStatus: 'active',
      isVisible: true,
      adminMemo: '在宅勤務時の昼食・散歩が定着しつつある。夕方の疲労蓄積に留意。',
      memoUpdatedAt: new Date('2026-10-14T15:00:00Z'),
      memoUpdatedBy: '佐藤 医師'
    }
  });

  await prisma.adminMemberRelation.create({
    data: {
      adminId: userAdmin1.id,
      memberId: userMember3.id,
      supportStatus: 'paused',
      isVisible: true,
      adminMemo: '休養期間中。近所コンビニへの外出で0.50達成。焦らず進める。',
      memoUpdatedAt: new Date('2026-10-12T11:00:00Z'),
      memoUpdatedBy: '佐藤 医師'
    }
  });

  // 4. プリセット活動テンプレート
  await prisma.activityTemplate.createMany({
    data: [
      {
        name: '平日出勤ルーティン',
        isPreset: true,
        templateType: 'day',
        scheduleData: JSON.stringify({
          "6": "起床",
          "7": "朝食・身支度",
          "8": "通勤",
          "9": "業務",
          "12": "昼食・休憩",
          "13": "業務",
          "18": "退勤",
          "19": "夕食",
          "20": "入浴・リラックス",
          "23": "就寝"
        })
      },
      {
        name: '在宅勤務ルーティン',
        isPreset: true,
        templateType: 'day',
        scheduleData: JSON.stringify({
          "7": "起床・朝食",
          "9": "在宅ワーク開始",
          "12": "昼食・近所散歩",
          "13": "在宅ワーク再開",
          "18": "業務終了・ストレッチ",
          "19": "自炊・夕食",
          "21": "自由時間",
          "23": "就寝"
        })
      },
      {
        name: '休日リフレッシュ',
        isPreset: true,
        templateType: 'day',
        scheduleData: JSON.stringify({
          "8": "起床・ゆっくり朝食",
          "10": "趣味・外出",
          "13": "ランチ",
          "15": "散歩・カフェ",
          "18": "夕食",
          "20": "入浴・読書",
          "23": "就寝"
        })
      },
      {
        name: '療養・休養パターン',
        isPreset: true,
        templateType: 'day',
        scheduleData: JSON.stringify({
          "8": "起床・水分補給",
          "9": "横になって休む",
          "12": "軽い昼食",
          "13": "休息・音楽鑑賞",
          "15": "ベランダで日光浴",
          "18": "夕食",
          "21": "就寝準備",
          "22": "就寝"
        })
      }
    ]
  });

  // 5. 田中 太郎の今週活動データ (2026-10-12〜2026-10-18)
  const baseDate = '2026-10-';
  const activities = [
    // 水曜 (10/14)
    { date: `${baseDate}14`, hour: 0, act: '就寝', score: null },
    { date: `${baseDate}14`, hour: 5, act: '起床', score: 0.5 },
    { date: `${baseDate}14`, hour: 6, act: '朝食準備', score: 0.5 },
    { date: `${baseDate}14`, hour: 7, act: '朝食', score: 0.5 },
    { date: `${baseDate}14`, hour: 8, act: '子どもを送る', score: 0.25 },
    { date: `${baseDate}14`, hour: 9, act: '仕事を休んで横に', score: 0.25 },
    { date: `${baseDate}14`, hour: 10, act: '横になっている', score: null },
    { date: `${baseDate}14`, hour: 13, act: '昼食', score: 0.5 },
    { date: `${baseDate}14`, hour: 17, act: '子ども迎え', score: 0.5 },
    { date: `${baseDate}14`, hour: 19, act: '夕飯', score: 0.75 },
    { date: `${baseDate}14`, hour: 20, act: '入浴', score: 0.75 },
    { date: `${baseDate}14`, hour: 23, act: '就寝', score: null },

    // 木曜 (10/15)
    { date: `${baseDate}15`, hour: 0, act: '就寝', score: null },
    { date: `${baseDate}15`, hour: 5, act: '起床', score: 0.5 },
    { date: `${baseDate}15`, hour: 6, act: '朝食準備', score: 0.5 },
    { date: `${baseDate}15`, hour: 7, act: '朝食', score: 0.75 },
    { date: `${baseDate}15`, hour: 8, act: '子どもを送る', score: 0.5 },
    { date: `${baseDate}15`, hour: 9, act: '仕事', score: 0.5 },
    { date: `${baseDate}15`, hour: 12, act: '昼食', score: 0.75 },
    { date: `${baseDate}15`, hour: 17, act: '子ども迎え', score: 0.75 },
    { date: `${baseDate}15`, hour: 19, act: '夕飯', score: 0.75 },
    { date: `${baseDate}15`, hour: 21, act: '読書・ストレッチ', score: 0.75, notes: 'リラックスできた' },
    { date: `${baseDate}15`, hour: 23, act: '就寝', score: null },

    // 金曜 (10/16)
    { date: `${baseDate}16`, hour: 0, act: '就寝', score: null },
    { date: `${baseDate}16`, hour: 6, act: '起床・散歩', score: 0.75, notes: '朝日が気持ちよかった' },
    { date: `${baseDate}16`, hour: 7, act: '朝食', score: 0.75 },
    { date: `${baseDate}16`, hour: 9, act: '仕事', score: 0.5 },
    { date: `${baseDate}16`, hour: 12, act: '同僚とランチ', score: 0.75 },
    { date: `${baseDate}16`, hour: 15, act: '上司と面談', score: 0.75, notes: '業務量の調整を相談できた' },
    { date: `${baseDate}16`, hour: 18, act: '帰宅・夕飯', score: 0.75 },
    { date: `${baseDate}16`, hour: 20, act: '入浴', score: 1.0 },
    { date: `${baseDate}16`, hour: 23, act: '就寝', score: null }
  ];

  for (const item of activities) {
    await prisma.cbtActivity.create({
      data: {
        userId: userMember1.id,
        recordDate: new Date(`${item.date}T00:00:00Z`),
        hourSlot: item.hour,
        activityName: item.act,
        moodScore: item.score,
        moodRawLevel: item.score !== null ? Math.round(item.score * 4) : null,
        moodDisplaySymbol: item.score !== null ? (item.score >= 0.8 ? '☀️' : item.score >= 0.6 ? '🌤️' : item.score >= 0.4 ? '☁️' : '🌧️') : null,
        notes: item.notes || null
      }
    });
  }

  console.log('Seeding completed successfully!');
}

main()
  .catch(e => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

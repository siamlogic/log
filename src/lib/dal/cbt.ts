import 'server-only';
import { prisma } from '../prisma';
import { parseYmdToUtcDate, formatUtcDateToYmd, generateWeekDays } from '../date-utils';
import type { WeekActivitiesDTO, DayActivitiesDTO, ActivitySlotDTO, MoodConfigDTO, ActivityTemplateDTO } from './types';

/**
 * 自身の1週間分の活動記録を取得
 * IDOR防止: クライアント指定IDではなく認証済セッションID強制バインド
 */
export async function getWeekActivitiesForUser(
  sessionUserId: string,
  mondayYmd: string
): Promise<WeekActivitiesDTO> {
  const weekDays = generateWeekDays(mondayYmd);
  const startUtc = parseYmdToUtcDate(weekDays[0].dateStr);
  const endUtc = parseYmdToUtcDate(weekDays[6].dateStr);

  const activities = await prisma.cbtActivity.findMany({
    where: {
      userId: sessionUserId,
      recordDate: {
        gte: startUtc,
        lte: endUtc,
      },
    },
    orderBy: [{ recordDate: 'asc' }, { hourSlot: 'asc' }],
  });

  // 日付ごとのマップ構築
  const daysMap: Record<string, DayActivitiesDTO> = {};
  weekDays.forEach((w) => {
    daysMap[w.key] = {
      dateStr: w.dateStr,
      dayKey: w.key,
      slots: {},
      averageMood: null,
      recordedCount: 0,
    };
  });

  const allScores: number[] = [];

  activities.forEach((act) => {
    const actDateStr = formatUtcDateToYmd(act.recordDate);
    const dayItem = weekDays.find((w) => w.dateStr === actDateStr);
    if (!dayItem) return;

    const targetDay = daysMap[dayItem.key];
    const slotDTO: ActivitySlotDTO = {
      id: act.id,
      hourSlot: act.hourSlot,
      activityName: act.activityName,
      moodScore: act.moodScore,
      moodRawLevel: act.moodRawLevel,
      moodDisplaySymbol: act.moodDisplaySymbol,
      notes: act.notes,
    };
    targetDay.slots[act.hourSlot] = slotDTO;
    targetDay.recordedCount++;

    if (act.moodScore !== null && act.moodScore !== undefined) {
      allScores.push(act.moodScore);
    }
  });

  // 各日の平均気分算出 (moodScore === null は母数除外)
  Object.values(daysMap).forEach((day) => {
    const dayScores = Object.values(day.slots)
      .map((s) => s.moodScore)
      .filter((s): s is number => s !== null && s !== undefined);
    if (dayScores.length > 0) {
      day.averageMood = Number((dayScores.reduce((a, b) => a + b, 0) / dayScores.length).toFixed(3));
    }
  });

  const totalAvg =
    allScores.length > 0
      ? Number((allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(3))
      : null;

  return {
    mondayDateStr: mondayYmd,
    days: daysMap,
    totalAverageMood: totalAvg,
  };
}

/**
 * 自身の1スロットの登録・更新
 */
export async function upsertActivitySlot(
  sessionUserId: string,
  params: {
    recordDateYmd: string;
    hourSlot: number;
    activityName: string;
    moodScore: number | null;
    moodRawLevel: number | null;
    moodDisplaySymbol: string | null;
    notes?: string | null;
  }
): Promise<ActivitySlotDTO> {
  const dateUtc = parseYmdToUtcDate(params.recordDateYmd);

  const saved = await prisma.cbtActivity.upsert({
    where: {
      userId_recordDate_hourSlot: {
        userId: sessionUserId,
        recordDate: dateUtc,
        hourSlot: params.hourSlot,
      },
    },
    update: {
      activityName: params.activityName,
      moodScore: params.moodScore,
      moodRawLevel: params.moodRawLevel,
      moodDisplaySymbol: params.moodDisplaySymbol,
      notes: params.notes ?? null,
    },
    create: {
      userId: sessionUserId,
      recordDate: dateUtc,
      hourSlot: params.hourSlot,
      activityName: params.activityName,
      moodScore: params.moodScore,
      moodRawLevel: params.moodRawLevel,
      moodDisplaySymbol: params.moodDisplaySymbol,
      notes: params.notes ?? null,
    },
  });

  return {
    id: saved.id,
    hourSlot: saved.hourSlot,
    activityName: saved.activityName,
    moodScore: saved.moodScore,
    moodRawLevel: saved.moodRawLevel,
    moodDisplaySymbol: saved.moodDisplaySymbol,
    notes: saved.notes,
  };
}

/**
 * 自身のスロット削除
 */
export async function deleteActivitySlot(
  sessionUserId: string,
  recordDateYmd: string,
  hourSlot: number
): Promise<void> {
  const dateUtc = parseYmdToUtcDate(recordDateYmd);
  await prisma.cbtActivity.deleteMany({
    where: {
      userId: sessionUserId,
      recordDate: dateUtc,
      hourSlot,
    },
  });
}

/**
 * 過去日の丸ごとコピー
 * デフォルト: 空枠のみ反映 (overwrite=false), 気分なし (includeMood=false)
 */
export async function copyDayActivities(
  sessionUserId: string,
  params: {
    sourceDateYmd: string;
    targetDateYmd: string;
    overwriteNonEmpty: boolean;
    includeMood: boolean;
  }
): Promise<{ copiedCount: number }> {
  const sourceUtc = parseYmdToUtcDate(params.sourceDateYmd);
  const targetUtc = parseYmdToUtcDate(params.targetDateYmd);

  const sourceSlots = await prisma.cbtActivity.findMany({
    where: { userId: sessionUserId, recordDate: sourceUtc },
  });

  if (sourceSlots.length === 0) return { copiedCount: 0 };

  const existingTargetSlots = await prisma.cbtActivity.findMany({
    where: { userId: sessionUserId, recordDate: targetUtc },
  });
  const existingMap = new Set(existingTargetSlots.map((s) => s.hourSlot));

  let copied = 0;
  await prisma.$transaction(async (tx) => {
    for (const slot of sourceSlots) {
      const exists = existingMap.has(slot.hourSlot);
      if (exists && !params.overwriteNonEmpty) continue;

      await tx.cbtActivity.upsert({
        where: {
          userId_recordDate_hourSlot: {
            userId: sessionUserId,
            recordDate: targetUtc,
            hourSlot: slot.hourSlot,
          },
        },
        update: {
          activityName: slot.activityName,
          moodScore: params.includeMood ? slot.moodScore : null,
          moodRawLevel: params.includeMood ? slot.moodRawLevel : null,
          moodDisplaySymbol: params.includeMood ? slot.moodDisplaySymbol : null,
          notes: slot.notes,
        },
        create: {
          userId: sessionUserId,
          recordDate: targetUtc,
          hourSlot: slot.hourSlot,
          activityName: slot.activityName,
          moodScore: params.includeMood ? slot.moodScore : null,
          moodRawLevel: params.includeMood ? slot.moodRawLevel : null,
          moodDisplaySymbol: params.includeMood ? slot.moodDisplaySymbol : null,
          notes: slot.notes,
        },
      });
      copied++;
    }
  });

  return { copiedCount: copied };
}

/**
 * 過去週の丸ごとコピー
 */
export async function copyWeekActivities(
  sessionUserId: string,
  params: {
    sourceMondayYmd: string;
    targetMondayYmd: string;
    overwriteNonEmpty: boolean;
    includeMood: boolean;
  }
): Promise<{ copiedCount: number }> {
  const sourceDays = generateWeekDays(params.sourceMondayYmd);
  const targetDays = generateWeekDays(params.targetMondayYmd);

  const startSourceUtc = parseYmdToUtcDate(sourceDays[0].dateStr);
  const endSourceUtc = parseYmdToUtcDate(sourceDays[6].dateStr);
  const startTargetUtc = parseYmdToUtcDate(targetDays[0].dateStr);
  const endTargetUtc = parseYmdToUtcDate(targetDays[6].dateStr);

  const sourceSlots = await prisma.cbtActivity.findMany({
    where: {
      userId: sessionUserId,
      recordDate: { gte: startSourceUtc, lte: endSourceUtc },
    },
  });

  if (sourceSlots.length === 0) return { copiedCount: 0 };

  const existingTargetSlots = await prisma.cbtActivity.findMany({
    where: {
      userId: sessionUserId,
      recordDate: { gte: startTargetUtc, lte: endTargetUtc },
    },
  });

  const existingMap = new Set(
    existingTargetSlots.map((s) => `${formatUtcDateToYmd(s.recordDate)}_${s.hourSlot}`)
  );

  let totalCopied = 0;
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < 7; i++) {
      const srcDateStr = sourceDays[i].dateStr;
      const tgtDateStr = targetDays[i].dateStr;
      const tgtDateUtc = parseYmdToUtcDate(tgtDateStr);

      const daySourceSlots = sourceSlots.filter(
        (s) => formatUtcDateToYmd(s.recordDate) === srcDateStr
      );

      for (const slot of daySourceSlots) {
        const key = `${tgtDateStr}_${slot.hourSlot}`;
        if (existingMap.has(key) && !params.overwriteNonEmpty) continue;

        await tx.cbtActivity.upsert({
          where: {
            userId_recordDate_hourSlot: {
              userId: sessionUserId,
              recordDate: tgtDateUtc,
              hourSlot: slot.hourSlot,
            },
          },
          update: {
            activityName: slot.activityName,
            moodScore: params.includeMood ? slot.moodScore : null,
            moodRawLevel: params.includeMood ? slot.moodRawLevel : null,
            moodDisplaySymbol: params.includeMood ? slot.moodDisplaySymbol : null,
            notes: slot.notes,
          },
          create: {
            userId: sessionUserId,
            recordDate: tgtDateUtc,
            hourSlot: slot.hourSlot,
            activityName: slot.activityName,
            moodScore: params.includeMood ? slot.moodScore : null,
            moodRawLevel: params.includeMood ? slot.moodRawLevel : null,
            moodDisplaySymbol: params.includeMood ? slot.moodDisplaySymbol : null,
            notes: slot.notes,
          },
        });
        totalCopied++;
      }
    }
  });

  return { copiedCount: totalCopied };
}

/**
 * テンプレートの一括適用 (活動内容のみ反映、気分は未入力 null 厳守)
 */
export async function applyTemplateToDays(
  sessionUserId: string,
  params: {
    templateId: string;
    targetDatesYmd: string[];
    overwriteNonEmpty: boolean;
  }
): Promise<{ appliedCount: number }> {
  const template = await prisma.activityTemplate.findFirst({
    where: {
      id: params.templateId,
      OR: [{ isPreset: true }, { userId: sessionUserId }],
    },
  });

  if (!template) throw new Error('Template not found');

  const slotsData: Record<string, string> = JSON.parse(template.scheduleData);
  let count = 0;

  await prisma.$transaction(async (tx) => {
    for (const dateYmd of params.targetDatesYmd) {
      const dateUtc = parseYmdToUtcDate(dateYmd);
      const existing = await tx.cbtActivity.findMany({
        where: { userId: sessionUserId, recordDate: dateUtc },
      });
      const existingHours = new Set(existing.map((e) => e.hourSlot));

      for (const [hourStr, actName] of Object.entries(slotsData)) {
        const hour = Number(hourStr);
        if (existingHours.has(hour) && !params.overwriteNonEmpty) continue;

        await tx.cbtActivity.upsert({
          where: {
            userId_recordDate_hourSlot: {
              userId: sessionUserId,
              recordDate: dateUtc,
              hourSlot: hour,
            },
          },
          update: {
            activityName: actName,
            moodScore: null,
            moodRawLevel: null,
            moodDisplaySymbol: null,
          },
          create: {
            userId: sessionUserId,
            recordDate: dateUtc,
            hourSlot: hour,
            activityName: actName,
            moodScore: null,
            moodRawLevel: null,
            moodDisplaySymbol: null,
          },
        });
        count++;
      }
    }
  });

  return { appliedCount: count };
}

/**
 * 自身の気分設定取得
 */
export async function getMoodConfigForUser(sessionUserId: string): Promise<MoodConfigDTO> {
  const config = await prisma.moodConfiguration.findUnique({
    where: { userId: sessionUserId },
  });

  if (!config) {
    return { emotionLabel: '気分の良さ', styleType: 'weather', scaleSteps: 5 };
  }

  return {
    emotionLabel: config.emotionLabel,
    styleType: config.styleType,
    scaleSteps: config.scaleSteps,
  };
}

/**
 * 自身の気分設定更新
 */
export async function updateMoodConfigForUser(
  sessionUserId: string,
  params: MoodConfigDTO
): Promise<MoodConfigDTO> {
  const updated = await prisma.moodConfiguration.upsert({
    where: { userId: sessionUserId },
    update: {
      emotionLabel: params.emotionLabel,
      styleType: params.styleType,
      scaleSteps: params.scaleSteps,
    },
    create: {
      userId: sessionUserId,
      emotionLabel: params.emotionLabel,
      styleType: params.styleType,
      scaleSteps: params.scaleSteps,
    },
  });

  return {
    emotionLabel: updated.emotionLabel,
    styleType: updated.styleType,
    scaleSteps: updated.scaleSteps,
  };
}

/**
 * テンプレート一覧取得
 */
export async function getTemplatesForUser(sessionUserId: string): Promise<ActivityTemplateDTO[]> {
  const tpls = await prisma.activityTemplate.findMany({
    where: {
      OR: [{ isPreset: true }, { userId: sessionUserId }],
    },
    orderBy: [{ isPreset: 'desc' }, { createdAt: 'desc' }],
  });

  return tpls.map((t) => ({
    id: t.id,
    name: t.name,
    isPreset: t.isPreset,
    templateType: t.templateType,
    slots: JSON.parse(t.scheduleData),
  }));
}

/**
 * カスタムテンプレート保存
 */
export async function saveCustomTemplate(
  sessionUserId: string,
  params: { name: string; scheduleData: Record<string, string> }
): Promise<ActivityTemplateDTO> {
  const created = await prisma.activityTemplate.create({
    data: {
      userId: sessionUserId,
      name: params.name,
      isPreset: false,
      templateType: 'day',
      scheduleData: JSON.stringify(params.scheduleData),
    },
  });

  return {
    id: created.id,
    name: created.name,
    isPreset: created.isPreset,
    templateType: created.templateType,
    slots: JSON.parse(created.scheduleData),
  };
}

/**
 * 連続スロット（時間帯範囲指定・就寝一括など）の登録・更新
 * 日跨ぎ・月跨ぎの計算をUTCベースで厳密に行い、単一トランザクションでアトミックに適用
 */
export async function applyActivityRange(
  sessionUserId: string,
  params: {
    startDateYmd: string;
    startHourSlot: number;
    durationHours: number;
    activityName: string;
    moodScore: number | null;
    moodRawLevel: number | null;
    moodDisplaySymbol: string | null;
    notes?: string | null;
    overwriteNonEmpty: boolean;
    allowFirstSlotOverwrite?: boolean;
    originalActivityName?: string | null;
  }
): Promise<{ appliedCount: number; affectedDates: string[] }> {
  if (params.durationHours < 1 || params.durationHours > 24) {
    throw new Error('durationHours must be between 1 and 24');
  }

  const startUtc = parseYmdToUtcDate(params.startDateYmd);

  interface TargetSlot {
    targetYmd: string;
    targetDateUtc: Date;
    targetHour: number;
    isFirst: boolean;
  }

  const targetSlots: TargetSlot[] = [];
  const affectedDatesSet = new Set<string>();

  for (let i = 0; i < params.durationHours; i++) {
    const slotMs = startUtc.getTime() + (params.startHourSlot + i) * 3600 * 1000;
    const slotDate = new Date(slotMs);
    const targetYmd = formatUtcDateToYmd(slotDate);
    const targetDateUtc = parseYmdToUtcDate(targetYmd);
    const targetHour = slotDate.getUTCHours();

    targetSlots.push({
      targetYmd,
      targetDateUtc,
      targetHour,
      isFirst: i === 0,
    });
    affectedDatesSet.add(targetYmd);
  }

  const affectedDateUtcs = Array.from(affectedDatesSet).map((ymd) => parseYmdToUtcDate(ymd));

  // 既存スロットを一括取得して保護判定 (キー -> 既存の活動名)
  const existingSlots = await prisma.cbtActivity.findMany({
    where: {
      userId: sessionUserId,
      recordDate: { in: affectedDateUtcs },
    },
  });

  const existingMap = new Map<string, string>();
  for (const s of existingSlots) {
    existingMap.set(`${formatUtcDateToYmd(s.recordDate)}_${s.hourSlot}`, s.activityName);
  }

  // 開始スロットの既存の活動名を取得
  const firstSlotKey = `${targetSlots[0]?.targetYmd}_${targetSlots[0]?.targetHour}`;
  const firstExistingActivity = existingMap.get(firstSlotKey) ?? '';
  const originalActivity = (params.originalActivityName ?? firstExistingActivity).trim();

  let totalApplied = 0;

  await prisma.$transaction(async (tx) => {
    for (const item of targetSlots) {
      const key = `${item.targetYmd}_${item.targetHour}`;
      const existingAct = existingMap.get(key);
      const exists = existingAct !== undefined;

      // 同一活動ブロックの判定: 元の活動名と一致していれば同一ブロックの更新とみなす
      const isSameBlock = originalActivity !== '' && exists && existingAct.trim() === originalActivity;

      // 保護判定: 既存枠が存在し、上書き不許可で、同一ブロックでもない枠はスキップ
      const shouldProtect = exists && !params.overwriteNonEmpty && !isSameBlock;
      
      if (shouldProtect) {
        if (!params.allowFirstSlotOverwrite || !item.isFirst) {
          continue;
        }
      }

      await tx.cbtActivity.upsert({
        where: {
          userId_recordDate_hourSlot: {
            userId: sessionUserId,
            recordDate: item.targetDateUtc,
            hourSlot: item.targetHour,
          },
        },
        update: {
          activityName: params.activityName,
          moodScore: params.moodScore,
          moodRawLevel: params.moodRawLevel,
          moodDisplaySymbol: params.moodDisplaySymbol,
          notes: params.notes ?? null,
        },
        create: {
          userId: sessionUserId,
          recordDate: item.targetDateUtc,
          hourSlot: item.targetHour,
          activityName: params.activityName,
          moodScore: params.moodScore,
          moodRawLevel: params.moodRawLevel,
          moodDisplaySymbol: params.moodDisplaySymbol,
          notes: params.notes ?? null,
        },
      });
      totalApplied++;
    }
  });

  return {
    appliedCount: totalApplied,
    affectedDates: Array.from(affectedDatesSet),
  };
}


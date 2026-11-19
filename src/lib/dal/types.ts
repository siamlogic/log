/**
 * Data Access Layer (DAL) 型定義 & DTO
 * メンバー向けDTOは admin_memo を構造的に排除
 */

export interface ActivitySlotDTO {
  id: string;
  hourSlot: number;
  activityName: string;
  moodScore: number | null;
  moodRawLevel: number | null;
  moodDisplaySymbol: string | null;
  notes: string | null;
}

export interface DayActivitiesDTO {
  dateStr: string;   // 'YYYY-MM-DD'
  dayKey: string;    // 'mon' | 'tue' | ...
  slots: Record<number, ActivitySlotDTO>;
  averageMood: number | null;
  recordedCount: number;
}

export interface WeekActivitiesDTO {
  mondayDateStr: string;
  days: Record<string, DayActivitiesDTO>;
  totalAverageMood: number | null;
}

export interface MemberSummaryDTO {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  supportStatus: string;
  isVisible: boolean;
  status?: string;
  lastRecordDate?: string | null;
  // 管理者専用（メンバー自身には非公開）
  adminMemo?: string | null;
  memoUpdatedAt?: string | null;
  memoUpdatedBy?: string | null;
}

export interface MoodConfigDTO {
  emotionLabel: string;
  styleType: string;
  scaleSteps: number;
}

export interface ActivityTemplateDTO {
  id: string;
  name: string;
  isPreset: boolean;
  templateType: string;
  slots: Record<string, string>; // { "6": "起床", "7": "朝食" }
}

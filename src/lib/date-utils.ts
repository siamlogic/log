/**
 * 日付・タイムゾーン厳密変換ユーティリティ
 * 原本Excel準拠（月曜始まり固定）およびUTC 0時日付バインド
 */

export function parseYmdToUtcDate(ymd: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error(`Invalid date format: ${ymd}. Expected YYYY-MM-DD.`);
  }
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  // カレンダー上に実在しない日付（例: 2月31日）の自動繰り上がり検出
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${ymd} does not exist.`);
  }
  return date;
}

/**
 * 指定した文字列が実在するカレンダー日付（YYYY-MM-DD）であるかを判定
 */
export function isValidYmd(ymd: string): boolean {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return false;
  }
  try {
    parseYmdToUtcDate(ymd);
    return true;
  } catch {
    return false;
  }
}

export function formatUtcDateToYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 指定した日付（YYYY-MM-DD）が月曜日であるかを判定
 */
export function isMondayYmd(ymd: string): boolean {
  try {
    const d = parseYmdToUtcDate(ymd);
    return d.getUTCDay() === 1;
  } catch {
    return false;
  }
}

/**
 * 基準日が含まれる週の月曜日（YYYY-MM-DD）を取得
 * サーバー環境（UTC）に依存せず、日本標準時（JST: UTC+9）基準で今週の月曜日を特定
 */
export function getMondayOfCurrentWeek(dateInput?: Date | string): string {
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const d = parseYmdToUtcDate(dateInput);
    const day = d.getUTCDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(d.getTime() + diffToMonday * 24 * 3600 * 1000);
    return formatUtcDateToYmd(monday);
  }

  // JST (UTC+9) 基準で現在日を算出
  const baseTime = dateInput instanceof Date ? dateInput.getTime() : Date.now();
  const jstNow = new Date(baseTime + 9 * 3600 * 1000);
  const y = jstNow.getUTCFullYear();
  const m = jstNow.getUTCMonth();
  const d = jstNow.getUTCDate();
  const day = jstNow.getUTCDay(); // 0: 日曜, 1: 月曜, ...
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const mondayDate = new Date(Date.UTC(y, m, d + diffToMonday));
  return formatUtcDateToYmd(mondayDate);
}

export interface WeekDayInfo {
  key: string;       // 'mon' | 'tue' | ...
  name: string;      // '月曜' | '火曜' | ...
  dateStr: string;   // 'YYYY-MM-DD'
  label: string;     // 'M/D'
  dateNum: number;   // 1〜31
}

/**
 * 指定月曜から7日間の曜日情報を生成 (月曜始まり固定)
 */
export function generateWeekDays(mondayYmd: string): WeekDayInfo[] {
  const mondayUtc = parseYmdToUtcDate(mondayYmd);
  const keys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const names = ['月曜', '火曜', '水曜', '木曜', '金曜', '土曜', '日曜'];

  return keys.map((key, i) => {
    const d = new Date(mondayUtc.getTime() + i * 24 * 60 * 60 * 1000);
    const m = d.getUTCMonth() + 1;
    const dateNum = d.getUTCDate();
    const dateStr = formatUtcDateToYmd(d);
    return {
      key,
      name: names[i],
      dateStr,
      label: `${m}/${dateNum}`,
      dateNum,
    };
  });
}

/**
 * 原本Excel (SCBT_2_katsudokiroku.xls) 完全準拠の時間スロットラベル
 */
export function getHourSlotLabel(hour: number): string {
  if (hour === 0) return '午前0～1時';
  if (hour < 12) return `午前${hour}～${hour + 1}時`;
  if (hour === 12) return '正午～1時';
  if (hour === 23) return '午後11～0時';
  return `午後${hour - 12}～${hour - 11}時`;
}


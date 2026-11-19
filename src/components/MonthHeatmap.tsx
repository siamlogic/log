'use client';

import React from 'react';
import type { WeekActivitiesDTO, MoodConfigDTO } from '@/lib/dal/types';
import { generateWeekDays, parseYmdToUtcDate, formatUtcDateToYmd } from '@/lib/date-utils';

interface MonthHeatmapProps {
  weekData: WeekActivitiesDTO;
  moodConfig: MoodConfigDTO;
  onSelectDay: (dayIndex: number) => void;
}

export function MonthHeatmap({ weekData, moodConfig, onSelectDay }: MonthHeatmapProps) {
  const weekDays = generateWeekDays(weekData.mondayDateStr);
  const mondayUtc = parseYmdToUtcDate(weekData.mondayDateStr);
  // 週の木曜日（インデックス3）を基準にして属する年月を動的決定（ISO-8601標準準拠）
  const midWeekUtc = new Date(mondayUtc.getTime() + 3 * 24 * 3600 * 1000);
  const year = midWeekUtc.getUTCFullYear();
  const month = midWeekUtc.getUTCMonth() + 1;

  // 当月の1日および先頭パディング（月曜始まり: 月=0, 火=1, ..., 日=6）
  const firstDayOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const leadPadding = (firstDayOfMonth.getUTCDay() + 6) % 7;
  const prevMonthLastDate = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  const currentMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();

  interface HeatmapCell {
    id: string;
    inMonth: boolean;
    dateNum: number;
    dateStr: string;
    dayIndex: number;
  }

  const cells: HeatmapCell[] = [];

  // 前月パディング
  for (let p = leadPadding - 1; p >= 0; p--) {
    const dNum = prevMonthLastDate - p;
    const prevDate = new Date(Date.UTC(year, month - 2, dNum));
    const dateStr = formatUtcDateToYmd(prevDate);
    const matchIdx = weekDays.findIndex((w) => w.dateStr === dateStr);
    cells.push({
      id: `prev-${dateStr}`,
      inMonth: false,
      dateNum: dNum,
      dateStr,
      dayIndex: matchIdx,
    });
  }

  // 当月セル
  for (let d = 1; d <= currentMonthDays; d++) {
    const curDate = new Date(Date.UTC(year, month - 1, d));
    const dateStr = formatUtcDateToYmd(curDate);
    const matchIdx = weekDays.findIndex((w) => w.dateStr === dateStr);
    cells.push({
      id: `cur-${dateStr}`,
      inMonth: true,
      dateNum: d,
      dateStr,
      dayIndex: matchIdx,
    });
  }

  // 翌月パディング (7列の倍数まで)
  const trailingPadding = (7 - (cells.length % 7)) % 7;
  for (let t = 1; t <= trailingPadding; t++) {
    const nextDate = new Date(Date.UTC(year, month, t));
    const dateStr = formatUtcDateToYmd(nextDate);
    const matchIdx = weekDays.findIndex((w) => w.dateStr === dateStr);
    cells.push({
      id: `next-${dateStr}`,
      inMonth: false,
      dateNum: t,
      dateStr,
      dayIndex: matchIdx,
    });
  }

  const getMoodBadgeClass = (score: number | null) => {
    if (score === null || score === undefined) return 'bg-slate-100 text-slate-500';
    if (score >= 0.7) return 'bg-teal-100 text-teal-800';
    if (score <= 0.3) return 'bg-rose-100 text-rose-800';
    return 'bg-amber-100 text-amber-800';
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <h2 className="text-base font-bold text-slate-800">
            🗓️ {year}年 {month}月 活動・気分ヒートマップ (月曜始まり)
          </h2>
          <p className="text-xs text-slate-500">
            記録状況と平均「{moodConfig.emotionLabel}」を可視化します（日付クリックで日表示へ移動）
          </p>
        </div>
        <div className="flex items-center space-x-2 text-[11px]">
          <span className="px-2 py-0.5 rounded bg-teal-100 text-teal-800 font-medium">良好 (70%〜)</span>
          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">普通 (40〜69%)</span>
          <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-medium">不調 (〜39%)</span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2 text-center text-xs font-bold text-slate-600">
        {['月', '火', '水', '木', '金', '土', '日'].map((dName, idx) => (
          <div key={dName} className={`py-1.5 rounded bg-slate-100 ${idx >= 5 ? 'text-amber-800 bg-amber-50' : ''}`}>
            {dName}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {cells.map((cell) => {
          const isThisWeek = cell.dayIndex !== -1;
          const dayKey = isThisWeek ? weekDays[cell.dayIndex]?.key : null;
          const dayRecord = dayKey ? weekData.days[dayKey] : null;
          const avgScore = dayRecord?.averageMood ?? null;
          const count = dayRecord?.recordedCount ?? 0;

          return (
            <div
              key={cell.id}
              onClick={() => {
                if (isThisWeek) onSelectDay(cell.dayIndex);
              }}
              className={`min-h-[88px] p-2.5 rounded-xl border transition flex flex-col justify-between ${
                !cell.inMonth
                  ? 'bg-slate-50/40 border-slate-100 text-slate-300'
                  : 'bg-white border-slate-200'
              } ${isThisWeek ? 'ring-2 ring-teal-500/60 cursor-pointer hover:bg-teal-50/30' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-bold ${isThisWeek ? 'text-teal-800' : ''}`}>{cell.dateNum}</span>
                {/* 今週の月曜日のみ「今週」バッジを表示 */}
                {isThisWeek && cell.dayIndex === 0 && (
                  <span className="text-[10px] bg-teal-600 text-white px-1.5 py-0.2 rounded font-bold">今週</span>
                )}
              </div>

              {count > 0 ? (
                <div className="space-y-1 mt-1">
                  <div className="text-[10px] text-slate-500">
                    記録: <strong>{count}</strong>枠
                  </div>
                  {avgScore !== null ? (
                    <div
                      className={`text-[11px] font-bold px-1.5 py-0.5 rounded text-center ${getMoodBadgeClass(
                        avgScore
                      )}`}
                    >
                      {Math.round(avgScore * 100)}%
                    </div>
                  ) : (
                    <div className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded text-center">
                      気分未記録
                    </div>
                  )}
                </div>
              ) : cell.inMonth ? (
                <div className="text-[10px] text-slate-300 text-center my-auto">未記録</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

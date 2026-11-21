'use client';

import React from 'react';
import { ChevronLeft, ChevronRight, Zap, Copy, Settings } from 'lucide-react';
import type { WeekActivitiesDTO, MoodConfigDTO } from '@/lib/dal/types';
import { generateWeekDays } from '@/lib/date-utils';

interface DayTimelineProps {
  weekData: WeekActivitiesDTO;
  selectedDayIndex: number;
  moodConfig: MoodConfigDTO;
  onDayIndexChange: (idx: number) => void;
  onSlotClick: (dateStr: string, dayKey: string, hourSlot: number) => void;
  onOpenTemplate: () => void;
  onOpenCopy: () => void;
  onOpenMoodSetting: () => void;
}

export function DayTimeline({
  weekData,
  selectedDayIndex,
  moodConfig,
  onDayIndexChange,
  onSlotClick,
  onOpenTemplate,
  onOpenCopy,
  onOpenMoodSetting,
}: DayTimelineProps) {
  const weekDays = generateWeekDays(weekData.mondayDateStr);
  const currentDay = weekDays[selectedDayIndex] || weekDays[0];
  const dayRecord = weekData.days[currentDay.key];

  const getMoodBadgeClass = (score: number | null) => {
    if (score === null || score === undefined) return 'bg-slate-100 text-slate-500';
    if (score >= 0.7) return 'bg-teal-100 text-teal-800';
    if (score <= 0.3) return 'bg-rose-100 text-rose-800';
    return 'bg-amber-100 text-amber-800';
  };

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
        {/* 日付ナビゲーションバー */}
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <button
            aria-label="前日へ"
            onClick={() => onDayIndexChange(Math.max(0, selectedDayIndex - 1))}
            disabled={selectedDayIndex === 0}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-bold disabled:opacity-30"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="text-center">
            <div className="text-base font-bold text-slate-800">
              {currentDay.name} ({currentDay.label})
            </div>
            <div className="text-[11px] text-slate-500">
              平均: {dayRecord?.averageMood !== null ? `${Math.round((dayRecord?.averageMood ?? 0) * 100)}%` : '未記録'}
            </div>
          </div>
          <button
            aria-label="翌日へ"
            onClick={() => onDayIndexChange(Math.min(6, selectedDayIndex + 1))}
            disabled={selectedDayIndex === 6}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-bold disabled:opacity-30"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* クイックアクションボタン */}
        <div className="grid grid-cols-3 gap-1.5 p-2 bg-slate-100/70 border-b border-slate-200 text-center">
          <button
            onClick={onOpenTemplate}
            className="min-h-[44px] px-2 bg-white rounded-lg border border-slate-200 text-[11px] font-semibold text-emerald-700 flex items-center justify-center space-x-1 shadow-xs"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>テンプレ</span>
          </button>
          <button
            onClick={onOpenCopy}
            className="min-h-[44px] px-2 bg-white rounded-lg border border-slate-200 text-[11px] font-semibold text-sky-700 flex items-center justify-center space-x-1 shadow-xs"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>日コピー</span>
          </button>
          <button
            onClick={onOpenMoodSetting}
            className="min-h-[44px] px-2 bg-white rounded-lg border border-slate-200 text-[11px] font-semibold text-amber-800 flex items-center justify-center space-x-1 shadow-xs"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>気分設定</span>
          </button>
        </div>

        {/* 24時間スロット 縦タイムライン */}
        <div className="divide-y divide-slate-100 max-h-[620px] overflow-y-auto p-2 space-y-1.5">
          {Array.from({ length: 24 }).map((_, hour) => {
            const slot = dayRecord?.slots[hour];
            const hasActivity = Boolean(slot?.activityName);
            const score = slot?.moodScore ?? null;

            return (
              <button
                type="button"
                key={hour}
                onClick={() => onSlotClick(currentDay.dateStr, currentDay.key, hour)}
                className={`w-full text-left min-h-[52px] p-2.5 rounded-xl border transition flex items-center justify-between cursor-pointer active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-teal-500 ${
                  hasActivity
                    ? 'bg-teal-50/40 border-teal-200'
                    : 'bg-slate-50/50 border-dashed border-slate-200 hover:bg-slate-100/60'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <div className="w-16 text-center shrink-0">
                    <span className="text-[11px] font-mono font-semibold text-slate-600 bg-white px-2 py-1 rounded border border-slate-200 shadow-xs block">
                      {hour.toString().padStart(2, '0')}:00
                    </span>
                  </div>
                  <div>
                    {hasActivity ? (
                      <div>
                        <div className="text-xs font-bold text-slate-800">{slot?.activityName}</div>
                        {slot?.notes && <div className="text-[10px] text-slate-500 mt-0.5">{slot.notes}</div>}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-300">タップして記録</span>
                    )}
                  </div>
                </div>

                {hasActivity && (
                  <div>
                    {score !== null ? (
                      <span className={`text-[11px] px-2 py-0.5 rounded font-bold ${getMoodBadgeClass(score)}`}>
                        {slot?.moodDisplaySymbol ?? ''} {Math.round(score * 100)}%
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">未記録</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

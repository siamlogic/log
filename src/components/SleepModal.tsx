'use client';

import React, { useState } from 'react';
import { X, Moon } from 'lucide-react';
import type { WeekDayInfo } from '@/lib/date-utils';

interface SleepModalProps {
  weekDays: WeekDayInfo[];
  defaultDayIndex: number;
  onClose: () => void;
  onSave: (params: {
    startDateYmd: string;
    startHourSlot: number;
    durationHours: number;
    overwriteNonEmpty: boolean;
  }) => Promise<void>;
}

export function SleepModal({
  weekDays,
  defaultDayIndex,
  onClose,
  onSave,
}: SleepModalProps) {
  // デフォルトは前夜（指定日の前日、または木曜夜）
  const initialDayIndex = defaultDayIndex > 0 ? defaultDayIndex - 1 : defaultDayIndex;
  const [startDayIndex, setStartDayIndex] = useState(initialDayIndex);
  const [startHour, setStartHour] = useState(23);
  const [endHour, setEndHour] = useState(7);
  const [overwriteNonEmpty, setOverwriteNonEmpty] = useState(false);
  const [saving, setSaving] = useState(false);

  // 睡眠継続時間の計算 (日跨ぎ考慮)
  let duration = endHour - startHour;
  if (duration <= 0) duration += 24;

  const startDay = weekDays[startDayIndex] || weekDays[0];

  const getOptionLabel = (day: WeekDayInfo, idx: number) => {
    if (idx === 6) {
      // 日曜夜の場合、翌朝は翌週の月曜日
      const [y, m, d] = day.dateStr.split('-').map(Number);
      const nextMon = new Date(Date.UTC(y, m - 1, d + 1));
      const nextMonLabel = `${nextMon.getUTCMonth() + 1}/${nextMon.getUTCDate()}`;
      return `${day.name} (${day.label}) 夜 〜 翌週月曜 (${nextMonLabel}) 朝`;
    }
    const next = weekDays[idx + 1] || weekDays[0];
    return `${day.name} (${day.label}) 夜 〜 ${next.name} (${next.label}) 朝`;
  };

  const isSundayRollover = startDayIndex === 6 && (startHour + duration > 24);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        startDateYmd: startDay.dateStr,
        startHourSlot: startHour,
        durationHours: duration,
        overwriteNonEmpty,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center">
              <Moon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">昨晩〜今朝の睡眠をまとめて記録</h3>
              <p className="text-xs text-slate-500">就寝から起床までの連続スロットに「就寝」を一括反映します</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">対象の日程</label>
            <select
              value={startDayIndex}
              onChange={(e) => setStartDayIndex(Number(e.target.value))}
              className="w-full p-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 text-xs font-medium"
            >
              {weekDays.map((day, idx) => (
                <option key={day.key} value={idx}>
                  {getOptionLabel(day, idx)}
                </option>
              ))}
            </select>
          </div>

          {isSundayRollover && (
            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] leading-relaxed flex items-center space-x-1.5">
              <span>ℹ️</span>
              <span>翌朝0時以降の睡眠枠は<strong>翌週の週間シート</strong>（月曜午前）に記録されます。</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">🛌 就寝時刻</label>
              <select
                value={startHour}
                onChange={(e) => setStartHour(Number(e.target.value))}
                className="w-full p-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 text-xs font-semibold"
              >
                <option value={21}>21:00 (午後9時)</option>
                <option value={22}>22:00 (午後10時)</option>
                <option value={23}>23:00 (午後11時)</option>
                <option value={0}>00:00 (午前0時)</option>
                <option value={1}>01:00 (午前1時)</option>
                <option value={2}>02:00 (午前2時)</option>
                <option value={3}>03:00 (午前3時)</option>
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">☀️ 起床時刻</label>
              <select
                value={endHour}
                onChange={(e) => setEndHour(Number(e.target.value))}
                className="w-full p-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 text-xs font-semibold"
              >
                <option value={5}>05:00 (午前5時)</option>
                <option value={6}>06:00 (午前6時)</option>
                <option value={7}>07:00 (午前7時)</option>
                <option value={8}>08:00 (午前8時)</option>
                <option value={9}>09:00 (午前9時)</option>
                <option value={10}>10:00 (午前10時)</option>
                <option value={11}>11:00 (午前11時)</option>
                <option value={12}>12:00 (正午)</option>
              </select>
            </div>
          </div>

          <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-xl space-y-1">
            <div className="flex items-center justify-between text-indigo-900 font-bold">
              <span>合計睡眠時間:</span>
              <span>{duration} 時間 ({startHour}:00 〜 翌{endHour}:00 / {duration}スロット)</span>
            </div>
            <p className="text-[11px] text-indigo-700">
              ※睡眠時間帯の気分スコアは臨床基準に従い未記録（NULL）として登録されます。
            </p>
          </div>

          <label className="flex items-center space-x-2 text-slate-700 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={overwriteNonEmpty}
              onChange={(e) => setOverwriteNonEmpty(e.target.checked)}
              className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-xs">すでに記録のある枠も上書きする (未チェック時は空枠のみ反映)</span>
          </label>

          <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-medium"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-100 transition flex items-center space-x-1.5 disabled:opacity-50"
            >
              <span>🌙 {saving ? '記録中...' : '睡眠を記録する'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

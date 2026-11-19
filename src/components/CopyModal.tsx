'use client';

import React, { useState } from 'react';
import { X, Copy, AlertCircle } from 'lucide-react';
import type { WeekActivitiesDTO } from '@/lib/dal/types';
import { generateWeekDays } from '@/lib/date-utils';

interface CopyModalProps {
  weekData: WeekActivitiesDTO;
  onClose: () => void;
  onExecuteCopyDay: (params: {
    sourceDateYmd: string;
    targetDateYmd: string;
    overwriteNonEmpty: boolean;
    includeMood: boolean;
  }) => Promise<void>;
  onExecuteCopyWeek: (params: {
    sourceMondayYmd: string;
    targetMondayYmd: string;
    overwriteNonEmpty: boolean;
    includeMood: boolean;
  }) => Promise<void>;
}

export function CopyModal({
  weekData,
  onClose,
  onExecuteCopyDay,
  onExecuteCopyWeek,
}: CopyModalProps) {
  const weekDays = generateWeekDays(weekData.mondayDateStr);
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const [sourceDayKey, setSourceDayKey] = useState('thu');
  const [targetDayKey, setTargetDayKey] = useState('sat');
  const [overwriteNonEmpty, setOverwriteNonEmpty] = useState(false);
  const [includeMood, setIncludeMood] = useState(false);
  const [executing, setExecuting] = useState(false);

  const handleCopy = async () => {
    setExecuting(true);
    try {
      if (mode === 'day') {
        const sourceDay = weekDays.find((d) => d.key === sourceDayKey);
        const targetDay = weekDays.find((d) => d.key === targetDayKey);
        if (!sourceDay || !targetDay) return;

        await onExecuteCopyDay({
          sourceDateYmd: sourceDay.dateStr,
          targetDateYmd: targetDay.dateStr,
          overwriteNonEmpty,
          includeMood,
        });
      } else {
        // 前週から今週への週コピー
        const [y, m, d] = weekData.mondayDateStr.split('-').map(Number);
        const prevMon = new Date(Date.UTC(y, m - 1, d - 7));
        const prevMonYmd = `${prevMon.getUTCFullYear()}-${String(prevMon.getUTCMonth() + 1).padStart(2, '0')}-${String(prevMon.getUTCDate()).padStart(2, '0')}`;

        await onExecuteCopyWeek({
          sourceMondayYmd: prevMonYmd,
          targetMondayYmd: weekData.mondayDateStr,
          overwriteNonEmpty,
          includeMood,
        });
      }
      onClose();
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <Copy className="w-5 h-5 text-sky-600" />
            <h3 className="text-base font-bold text-slate-800">過去の記録からコピー</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div className="flex p-1 bg-slate-100 rounded-lg text-xs font-semibold">
            <button
              onClick={() => setMode('day')}
              className={`flex-1 py-1.5 rounded-md transition ${
                mode === 'day' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              特定の日をコピー (1日分)
            </button>
            <button
              onClick={() => setMode('week')}
              className={`flex-1 py-1.5 rounded-md transition ${
                mode === 'week' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              前週丸ごとコピー (7日分)
            </button>
          </div>

          {mode === 'day' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">コピー元の日</label>
                <select
                  value={sourceDayKey}
                  onChange={(e) => setSourceDayKey(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  {weekDays.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.name} ({d.label}) の記録
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">コピー先の日</label>
                <select
                  value={targetDayKey}
                  onChange={(e) => setTargetDayKey(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  {weekDays.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.name} ({d.label})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-sky-50 border border-sky-100 rounded-xl text-xs text-sky-800 space-y-1">
              <div className="font-bold">前週のシート（7日分）を今週へ一括複製</div>
              <div>前週の生活リズムを今週の予定枠として手早くベース入力できます。</div>
            </div>
          )}

          {/* コピーオプション（臨床安全設計） */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5 text-xs">
            <div className="font-bold text-slate-700 flex items-center space-x-1">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              <span>誤上書き・データ捏造防止オプション</span>
            </div>

            <label className="flex items-start space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={overwriteNonEmpty}
                onChange={(e) => setOverwriteNonEmpty(e.target.checked)}
                className="mt-0.5 rounded text-teal-600 focus:ring-teal-500"
              />
              <span className="text-slate-600">
                <strong>すでに記録がある枠も上書きする</strong>
                <span className="block text-[11px] text-slate-400">
                  ※オフ（デフォルト）の場合、空いている枠のみに活動が反映されます。
                </span>
              </span>
            </label>

            <label className="flex items-start space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeMood}
                onChange={(e) => setIncludeMood(e.target.checked)}
                className="mt-0.5 rounded text-teal-600 focus:ring-teal-500"
              />
              <span className="text-slate-600">
                <strong>気分スコアも含めてコピーする</strong>
                <span className="block text-[11px] text-slate-400">
                  ※オフ（デフォルト）の場合、活動名のみコピーされ気分は未記録（null）となります。
                </span>
              </span>
            </label>
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              キャンセル
            </button>
            <button
              onClick={handleCopy}
              disabled={executing}
              className="px-5 py-2 text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white rounded-lg shadow-sm transition disabled:opacity-50"
            >
              {executing ? 'コピー実行中...' : 'コピーを実行'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

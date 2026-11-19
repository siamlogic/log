'use client';

import React, { useState } from 'react';
import { X, Zap, Check } from 'lucide-react';
import type { ActivityTemplateDTO, WeekActivitiesDTO } from '@/lib/dal/types';
import { generateWeekDays } from '@/lib/date-utils';

interface TemplateModalProps {
  templates: ActivityTemplateDTO[];
  weekData: WeekActivitiesDTO;
  onClose: () => void;
  onApplyTemplate: (params: {
    templateId: string;
    targetDatesYmd: string[];
    overwriteNonEmpty: boolean;
  }) => Promise<void>;
}

export function TemplateModal({
  templates,
  weekData,
  onClose,
  onApplyTemplate,
}: TemplateModalProps) {
  const weekDays = generateWeekDays(weekData.mondayDateStr);
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id || '');
  const [selectedDayKeys, setSelectedDayKeys] = useState<string[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [overwriteNonEmpty, setOverwriteNonEmpty] = useState(false);
  const [applying, setApplying] = useState(false);

  const toggleDay = (key: string) => {
    setSelectedDayKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleApply = async () => {
    if (!selectedTemplateId || selectedDayKeys.length === 0) return;

    const targetDates = selectedDayKeys
      .map((k) => weekDays.find((d) => d.key === k)?.dateStr)
      .filter((d): d is string => Boolean(d));

    setApplying(true);
    try {
      await onApplyTemplate({
        templateId: selectedTemplateId,
        targetDatesYmd: targetDates,
        overwriteNonEmpty,
      });
      onClose();
    } finally {
      setApplying(false);
    }
  };

  const activeTemplate = templates.find((t) => t.id === selectedTemplateId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <Zap className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-bold text-slate-800">定型ルーティン・テンプレート適用</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4 text-xs">
          {/* ① テンプレート選択 */}
          <div>
            <label className="block font-bold text-slate-700 mb-1.5">① テンプレートを選択</label>
            <div className="grid grid-cols-2 gap-2">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => setSelectedTemplateId(tpl.id)}
                  className={`p-2.5 rounded-xl border text-left transition ${
                    selectedTemplateId === tpl.id
                      ? 'border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-500/30'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="font-bold text-slate-800 flex items-center justify-between">
                    <span>{tpl.name}</span>
                    {selectedTemplateId === tpl.id && <Check className="w-4 h-4 text-emerald-600" />}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {Object.keys(tpl.slots).length} 枠の活動予定
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* プレビュー表示 */}
          {activeTemplate && (
            <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
              <div className="font-bold text-slate-700 text-[11px] mb-1">登録されている活動枠：</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(activeTemplate.slots).map(([h, act]) => (
                  <span key={h} className="px-2 py-0.5 rounded bg-white border border-slate-200 text-[10px] text-slate-600">
                    {h}:00 <strong>{act}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ② 反映先曜日の選択 */}
          <div>
            <label className="block font-bold text-slate-700 mb-1.5">② 反映する曜日を選択</label>
            <div className="grid grid-cols-7 gap-1">
              {weekDays.map((d) => {
                const isSelected = selectedDayKeys.includes(d.key);
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => toggleDay(d.key)}
                    className={`py-2 px-1 rounded-lg border text-center transition ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-600 text-white font-bold'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-[11px]">{d.name.charAt(0)}</div>
                    <div className="text-[9px] opacity-80">{d.label}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* オプション */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5 text-slate-600">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={overwriteNonEmpty}
                onChange={(e) => setOverwriteNonEmpty(e.target.checked)}
                className="rounded text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-xs">すでに記録がある枠も上書きする</span>
            </label>
            <p className="text-[10px] text-slate-400 pl-5">
              ※臨床データの整合性を保つため、テンプレートからは活動予定のみが反映され、気分スコアは未記録状態となります。
            </p>
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              キャンセル
            </button>
            <button
              onClick={handleApply}
              disabled={applying || selectedDayKeys.length === 0}
              className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm transition disabled:opacity-50"
            >
              {applying ? '反映中...' : `${selectedDayKeys.length}日間に一括反映`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

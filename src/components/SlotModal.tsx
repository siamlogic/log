'use client';

import React, { useState } from 'react';
import { X, Trash2, Check } from 'lucide-react';
import type { ActivitySlotDTO, MoodConfigDTO } from '@/lib/dal/types';

interface SlotModalProps {
  dayLabel: string;
  hourSlot: number;
  hourLabel: string;
  slot: ActivitySlotDTO | null;
  moodConfig: MoodConfigDTO;
  initialDurationHours?: number;
  initialIsRange?: boolean;
  onClose: () => void;
  onSave: (data: {
    activityName: string;
    moodScore: number | null;
    moodRawLevel: number | null;
    moodDisplaySymbol: string | null;
    notes: string | null;
    isRange?: boolean;
    durationHours?: number;
    overwriteNonEmpty?: boolean;
    originalActivityName?: string | null;
  }) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function SlotModal({
  dayLabel,
  hourSlot,
  hourLabel,
  slot,
  moodConfig,
  initialDurationHours,
  initialIsRange,
  onClose,
  onSave,
  onDelete,
}: SlotModalProps) {
  const [activityName, setActivityName] = useState(slot?.activityName ?? '');
  const [moodScore, setMoodScore] = useState<number | null>(slot?.moodScore ?? null);
  const [moodRawLevel, setMoodRawLevel] = useState<number | null>(slot?.moodRawLevel ?? null);
  const [moodDisplaySymbol, setMoodDisplaySymbol] = useState<string | null>(slot?.moodDisplaySymbol ?? null);
  const [notes, setNotes] = useState(slot?.notes ?? '');
  const [isRange, setIsRange] = useState(initialIsRange ?? false);
  const [durationHours, setDurationHours] = useState(initialDurationHours ?? 1);
  const [overwriteNonEmpty, setOverwriteNonEmpty] = useState(initialIsRange ?? false);
  const [saving, setSaving] = useState(false);

  const quickTags = ['起床', '朝食', '通勤', '仕事', '昼食', '散歩', '夕食', '入浴', '読書', '就寝'];

  const handleQuickTag = (tag: string) => {
    setActivityName(tag);
    if (tag === '就寝') {
      setMoodScore(null);
      setMoodRawLevel(null);
      setMoodDisplaySymbol(null);
      setIsRange(true);
      setDurationHours(8);
      setOverwriteNonEmpty(false);
    }
  };

  // 気分選択肢の生成 (3〜11段階)
  const steps = moodConfig.scaleSteps;
  const moodOptions = Array.from({ length: steps }).map((_, i) => {
    const ratio = steps === 1 ? 1 : Number((i / (steps - 1)).toFixed(4));
    const pct = Math.round(ratio * 100);
    let symbol = '';
    let label = '';

    if (moodConfig.styleType === 'weather') {
      if (ratio >= 0.8) { symbol = '☀️'; label = '快晴'; }
      else if (ratio >= 0.6) { symbol = '🌤️'; label = '晴れ'; }
      else if (ratio >= 0.4) { symbol = '☁️'; label = '曇り'; }
      else if (ratio >= 0.2) { symbol = '🌧️'; label = '雨'; }
      else { symbol = '⛈️'; label = '荒天'; }
    } else if (moodConfig.styleType === 'face') {
      if (ratio >= 0.8) { symbol = '😄'; label = '最高'; }
      else if (ratio >= 0.6) { symbol = '🙂'; label = '良好'; }
      else if (ratio >= 0.4) { symbol = '😐'; label = '普通'; }
      else if (ratio >= 0.2) { symbol = '🙁'; label = '不調'; }
      else { symbol = '😭'; label = '最悪'; }
    } else if (moodConfig.styleType === 'arrow') {
      if (ratio >= 0.8) { symbol = '⬆️'; label = '大幅良'; }
      else if (ratio >= 0.6) { symbol = '↗️'; label = 'やや良'; }
      else if (ratio >= 0.4) { symbol = '➡️'; label = '平行'; }
      else if (ratio >= 0.2) { symbol = '↘️'; label = 'やや悪'; }
      else { symbol = '⬇️'; label = '大幅悪'; }
    } else if (moodConfig.styleType === 'pawapuro') {
      if (ratio >= 0.8) { symbol = '🔥'; label = '絶好調'; }
      else if (ratio >= 0.6) { symbol = '⬆️'; label = '好調'; }
      else if (ratio >= 0.4) { symbol = '➡️'; label = '普通'; }
      else if (ratio >= 0.2) { symbol = '⬇️'; label = '不調'; }
      else { symbol = '💀'; label = '絶不調'; }
    } else {
      symbol = `${pct}%`;
      label = `Lv${i + 1}`;
    }

    const fullLabel = steps > 5 && moodConfig.styleType !== 'number' ? `${label}(${pct}%)` : label;
    return { level: i, score: ratio, symbol, label: fullLabel };
  });

  const handleSelectMood = (opt: { score: number; level: number; symbol: string }) => {
    setMoodScore(opt.score);
    setMoodRawLevel(opt.level);
    setMoodDisplaySymbol(opt.symbol);
  };

  const handleClearMood = () => {
    setMoodScore(null);
    setMoodRawLevel(null);
    setMoodDisplaySymbol(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activityName.trim()) return;

    setSaving(true);
    try {
      await onSave({
        activityName: activityName.trim(),
        moodScore,
        moodRawLevel,
        moodDisplaySymbol,
        notes: notes.trim() || null,
        isRange,
        durationHours,
        overwriteNonEmpty,
        originalActivityName: slot?.activityName ?? null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const endHourSlot = (hourSlot + durationHours) % 24;
  const isRollover = hourSlot + durationHours >= 24;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <div className="text-xs font-semibold text-teal-700">{dayLabel}</div>
            <div className="text-base font-bold text-slate-800">{hourLabel} の活動記録</div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">活動内容</label>
            <input
              type="text"
              required
              value={activityName}
              onChange={(e) => setActivityName(e.target.value)}
              placeholder="例: 朝の散歩、デスクワーク、昼食、就寝"
              className="w-full p-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
            {/* クイックタグ */}
            <div className="mt-2 flex flex-wrap gap-1">
              {quickTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => handleQuickTag(tag)}
                  className="px-2 py-0.5 text-[11px] rounded bg-slate-100 hover:bg-teal-50 hover:text-teal-700 text-slate-600 transition"
                >
                  + {tag}
                </button>
              ))}
            </div>
          </div>

          {/* 複数スロット連続入力（時間帯の範囲指定） */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <label className="flex items-center space-x-2 cursor-pointer font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={isRange}
                  onChange={(e) => setIsRange(e.target.checked)}
                  className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500"
                />
                <span>⏱️ 複数時間をまとめて記録 (範囲指定)</span>
              </label>
              {isRange && (
                <span className="text-[11px] font-semibold text-teal-700 bg-teal-100/60 px-2 py-0.5 rounded-full">
                  {durationHours}時間分
                </span>
              )}
            </div>

            {isRange && (
              <div className="space-y-2 pt-1 text-xs">
                <div className="flex items-center space-x-2">
                  <span className="text-slate-500 shrink-0">継続時間:</span>
                  <select
                    value={durationHours}
                    onChange={(e) => setDurationHours(Number(e.target.value))}
                    className="flex-1 p-1.5 border border-slate-300 rounded-lg bg-white text-xs font-medium"
                  >
                    {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                      <option key={h} value={h}>
                        {h}時間 ({hourSlot}:00 〜 {(hourSlot + h) % 24}:00{(hourSlot + h) >= 24 ? ' 翌日' : ''})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="text-[11px] text-slate-500">
                  反映対象: <strong className="text-teal-700">{hourSlot}:00 〜 {isRollover ? '翌' : ''}{endHourSlot}:00 ({durationHours}スロット)</strong>
                </div>
                <label className="flex items-center space-x-2 text-[11px] text-slate-600 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={overwriteNonEmpty}
                    onChange={(e) => setOverwriteNonEmpty(e.target.checked)}
                    className="w-3.5 h-3.5 rounded text-teal-600 focus:ring-teal-500"
                  />
                  <span>すでに入力のある枠も上書きする (未チェック時は空枠のみ反映)</span>
                </label>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700">
                {moodConfig.emotionLabel} ({moodConfig.scaleSteps}段階)
              </label>
              <button
                type="button"
                onClick={handleClearMood}
                className="text-[11px] text-slate-400 hover:text-slate-600 hover:underline"
              >
                未記録・睡眠（記録しない）
              </button>
            </div>

            <div className="grid grid-cols-5 gap-1.5">
              {moodOptions.map((opt) => {
                const isSelected = moodScore !== null && Math.abs(moodScore - opt.score) < 0.001;
                return (
                  <button
                    key={opt.level}
                    type="button"
                    onClick={() => handleSelectMood(opt)}
                    className={`p-2 rounded-xl border text-center transition flex flex-col items-center justify-center ${
                      isSelected
                        ? 'border-teal-500 bg-teal-50 text-teal-800 ring-2 ring-teal-500/30'
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <span className="text-lg leading-none mb-1">{opt.symbol}</span>
                    <span className="text-[10px] font-medium leading-tight line-clamp-1">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">補足・気付きメモ</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="気持ちの変化や振り返りメモ（任意）"
              className="w-full p-2.5 text-xs rounded-xl border border-slate-300 focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
            {slot?.activityName ? (
              <button
                type="button"
                onClick={async () => {
                  if (confirm('このスロットの記録を削除しますか？')) {
                    await onDelete();
                    onClose();
                  }
                }}
                className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-medium flex items-center space-x-1"
              >
                <Trash2 className="w-4 h-4" />
                <span>削除</span>
              </button>
            ) : <div />}

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-lg shadow-sm transition disabled:opacity-50"
              >
                {saving ? '保存中...' : '記録を保存'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

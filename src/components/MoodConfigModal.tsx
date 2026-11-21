'use client';

import React, { useState } from 'react';
import { X, Settings, Sparkles } from 'lucide-react';
import type { MoodConfigDTO } from '@/lib/dal/types';

interface MoodConfigModalProps {
  currentConfig: MoodConfigDTO;
  onClose: () => void;
  onSaveConfig: (config: MoodConfigDTO) => Promise<void>;
}

export function MoodConfigModal({
  currentConfig,
  onClose,
  onSaveConfig,
}: MoodConfigModalProps) {
  const [emotionLabel, setEmotionLabel] = useState(currentConfig.emotionLabel);
  const [styleType, setStyleType] = useState(currentConfig.styleType);
  const [scaleSteps, setScaleSteps] = useState(currentConfig.scaleSteps);
  const [saving, setSaving] = useState(false);

  const styleList = [
    { key: 'weather', name: '天気マーク', sample: '☀️ 🌤️ ☁️ 🌧️ ⛈️', desc: '快晴・晴れ・曇り・雨・荒天' },
    { key: 'face', name: '顔マーク', sample: '😄 🙂 😐 🙁 😭', desc: '最高・良好・普通・不調・最悪' },
    { key: 'pawapuro', name: 'パワプロ風調子', sample: '🔥 ⬆️ ➡️ ⬇️ 💀', desc: '絶好調・好調・普通・不調・絶不調' },
    { key: 'arrow', name: '調子矢印マーク', sample: '⬆️ ↗️ ➡️ ↘️ ⬇️', desc: 'その時点の調子の向き (大幅良〜大幅悪)' },
    { key: 'number', name: '数値パーセント', sample: '100% 75% 50% 25% 0%', desc: '0%〜100%のパーセント数値' },
  ];

  // プレビュー用選択肢生成
  const previewOptions = Array.from({ length: scaleSteps }).map((_, i) => {
    const ratio = scaleSteps === 1 ? 1 : Number((i / (scaleSteps - 1)).toFixed(4));
    const pct = Math.round(ratio * 100);
    let symbol = '';

    if (styleType === 'weather') {
      if (ratio >= 0.8) symbol = '☀️';
      else if (ratio >= 0.6) symbol = '🌤️';
      else if (ratio >= 0.4) symbol = '☁️';
      else if (ratio >= 0.2) symbol = '🌧️';
      else symbol = '⛈️';
    } else if (styleType === 'face') {
      if (ratio >= 0.8) symbol = '😄';
      else if (ratio >= 0.6) symbol = '🙂';
      else if (ratio >= 0.4) symbol = '😐';
      else if (ratio >= 0.2) symbol = '🙁';
      else symbol = '😭';
    } else if (styleType === 'arrow') {
      if (ratio >= 0.8) symbol = '⬆️';
      else if (ratio >= 0.6) symbol = '↗️';
      else if (ratio >= 0.4) symbol = '➡️';
      else if (ratio >= 0.2) symbol = '↘️';
      else symbol = '⬇️';
    } else if (styleType === 'pawapuro') {
      if (ratio >= 0.8) symbol = '🔥';
      else if (ratio >= 0.6) symbol = '⬆️';
      else if (ratio >= 0.4) symbol = '➡️';
      else if (ratio >= 0.2) symbol = '⬇️';
      else symbol = '💀';
    } else {
      symbol = `${pct}%`;
    }

    return { level: i, symbol, pct };
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveConfig({
        emotionLabel: emotionLabel.trim() || '気分の良さ',
        styleType,
        scaleSteps,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <Settings className="w-5 h-5 text-amber-600" />
            <h3 className="text-base font-bold text-slate-800">「気持ち」の表現カスタマイズ</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4 text-xs">
          {/* 対象感情名設定 */}
          <div>
            <label className="block font-bold text-slate-700 mb-1">記録対象の感情名（指標）</label>
            <input
              type="text"
              value={emotionLabel}
              onChange={(e) => setEmotionLabel(e.target.value)}
              placeholder="気分の良さ、楽しみ度、達成感、充実度など"
              className="w-full p-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
            />
            <div className="mt-1.5 flex gap-1.5">
              {['気分の良さ', '楽しみ度', '達成感', '充実度'].map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => setEmotionLabel(sample)}
                  className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] hover:bg-amber-50 hover:text-amber-800 transition"
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>

          {/* 表現スタイル選択 */}
          <div>
            <label className="block font-bold text-slate-700 mb-1.5">表現アイコンスタイル</label>
            <div className="space-y-1.5">
              {styleList.map((st) => (
                <div
                  key={st.key}
                  onClick={() => setStyleType(st.key)}
                  className={`p-2.5 rounded-xl border cursor-pointer transition flex items-center justify-between ${
                    styleType === st.key
                      ? 'border-amber-500 bg-amber-50/50 ring-2 ring-amber-500/30'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div>
                    <div className="font-bold text-slate-800">{st.name}</div>
                    <div className="text-[11px] text-slate-500">{st.desc}</div>
                  </div>
                  <div className="text-base font-mono">{st.sample}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 段階数設定 (3〜11段階) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-bold text-slate-700">選択段階数</label>
              <span className="font-bold text-amber-700 text-sm">{scaleSteps} 段階</span>
            </div>
            <div className="flex items-center space-x-3">
              <input
                type="range"
                min="3"
                max="11"
                step="1"
                value={scaleSteps}
                onChange={(e) => setScaleSteps(Number(e.target.value))}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-amber-600"
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>3段階 (簡略)</span>
              <span>5段階 (推奨)</span>
              <span>11段階 (原本準拠)</span>
            </div>
          </div>

          {/* リアルタイムプレビュー */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div className="font-bold text-slate-700 text-[11px] mb-2 flex items-center space-x-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>入力時のボタンプレビュー：</span>
            </div>
            <div className="flex flex-wrap gap-1 justify-center">
              {previewOptions.map((opt) => (
                <div
                  key={opt.level}
                  className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-center shadow-2xs"
                >
                  <div className="text-base leading-none">{opt.symbol}</div>
                  <div className="text-[9px] text-slate-400 mt-0.5">{opt.pct}%</div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow-sm transition disabled:opacity-50"
            >
              {saving ? '保存中...' : '設定を保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

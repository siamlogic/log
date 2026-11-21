'use client';

import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Clock,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  Zap,
  Copy,
  Settings,
  LogOut,
  User,
  ShieldAlert,
  Moon,
} from 'lucide-react';
import type { SessionUser } from '@/lib/auth-service';
import type { WeekActivitiesDTO, MoodConfigDTO, ActivityTemplateDTO, ActivitySlotDTO } from '@/lib/dal/types';
import { generateWeekDays, getHourSlotLabel, getMondayOfCurrentWeek } from '@/lib/date-utils';
import { WeekMatrix } from './WeekMatrix';
import { DayTimeline } from './DayTimeline';
import { MonthHeatmap } from './MonthHeatmap';
import { SlotModal } from './SlotModal';
import { SleepModal } from './SleepModal';
import { CopyModal } from './CopyModal';
import { TemplateModal } from './TemplateModal';
import { MoodConfigModal } from './MoodConfigModal';
import { AdminView } from './AdminView';

interface CbtAppProps {
  currentUser: SessionUser;
  onLogout: () => void;
}

export function CbtApp({ currentUser, onLogout }: CbtAppProps) {
  const [currentRole, setCurrentRole] = useState<'member' | 'admin'>(
    currentUser.role === 'admin' || currentUser.role === 'system_admin' ? 'admin' : 'member'
  );
  const [calendarView, setCalendarView] = useState<'week' | 'day' | 'month'>('week');
  const [selectedDayIndex, setSelectedDayIndex] = useState(3); // 木曜デフォルト
  const [currentMonday, setCurrentMonday] = useState(getMondayOfCurrentWeek());

  const [weekData, setWeekData] = useState<WeekActivitiesDTO | null>(null);
  const [moodConfig, setMoodConfig] = useState<MoodConfigDTO>({
    emotionLabel: '気分の良さ',
    styleType: 'weather',
    scaleSteps: 5,
  });
  const [templates, setTemplates] = useState<ActivityTemplateDTO[]>([]);

  // モーダル管理
  const [editingSlot, setEditingSlot] = useState<{
    dateStr: string;
    dayKey: string;
    hourSlot: number;
    slot: ActivitySlotDTO | null;
    detectedDuration?: number;
  } | null>(null);
  const [showSleepModal, setShowSleepModal] = useState(false);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showMoodModal, setShowMoodModal] = useState(false);

  const [toastMessage, setToastMessage] = useState('');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  // 1週間データ取得
  const fetchWeekActivities = async (mondayYmd: string) => {
    try {
      const res = await fetch(`/api/cbt/activities/week?monday=${mondayYmd}`);
      if (res.ok) {
        const data = await res.json();
        setWeekData(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // 気分設定取得
  const fetchMoodConfig = async () => {
    try {
      const res = await fetch('/api/cbt/mood-config');
      if (res.ok) {
        const data = await res.json();
        setMoodConfig(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // テンプレート一覧取得
  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/cbt/templates');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (currentRole === 'member') {
      fetchWeekActivities(currentMonday);
      fetchMoodConfig();
      fetchTemplates();
    }
  }, [currentMonday, currentRole]);

  // セッション無操作タイムアウト監視 (25分警告、30分自動ログアウト: 要配慮個人情報の離席保護)
  useEffect(() => {
    let warnTimer: NodeJS.Timeout;
    let logoutTimer: NodeJS.Timeout;

    const resetIdleTimer = () => {
      clearTimeout(warnTimer);
      clearTimeout(logoutTimer);

      warnTimer = setTimeout(() => {
        showToast('セッションの有効期限が近づいています (残り5分)');
      }, 25 * 60 * 1000);

      logoutTimer = setTimeout(async () => {
        alert('セッション有効期限が切れました。安全のため自動ログアウトします。');
        try {
          await fetch('/api/auth/logout', { method: 'POST' });
        } catch {
          // 通信エラー時もクライアント側状態は破棄
        }
        onLogout();
      }, 30 * 60 * 1000);
    };

    const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    activityEvents.forEach((ev) => window.addEventListener(ev, resetIdleTimer, { passive: true }));
    resetIdleTimer();

    return () => {
      clearTimeout(warnTimer);
      clearTimeout(logoutTimer);
      activityEvents.forEach((ev) => window.removeEventListener(ev, resetIdleTimer));
    };
  }, [onLogout]);

  // 週送りナビゲーション
  const changeWeek = (diffWeeks: number) => {
    const [y, m, d] = currentMonday.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + diffWeeks * 7));
    const nextYmd = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    setCurrentMonday(nextYmd);
    showToast(diffWeeks > 0 ? '翌週へ移動しました' : '前週へ移動しました');
  };

  const resetToCurrentWeek = () => {
    setCurrentMonday(getMondayOfCurrentWeek());
    showToast('今週のシートへ戻りました');
  };

  // スロットクリック時のハンドラ (後続の同一活動の連続時間を自動検出)
  const handleSlotClick = (dateStr: string, dayKey: string, hourSlot: number) => {
    if (!weekData) return;
    const slot = weekData.days[dayKey]?.slots[hourSlot] || null;
    const actName = slot?.activityName?.trim();

    let detectedDuration = 1;
    if (actName) {
      const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      const startDayIdx = dayKeys.indexOf(dayKey);
      if (startDayIdx !== -1) {
        for (let i = 1; i < 24; i++) {
          const nextTotalHour = hourSlot + i;
          const dayOffset = Math.floor(nextTotalHour / 24);
          const nextDayIdx = startDayIdx + dayOffset;
          const nextHour = nextTotalHour % 24;
          if (nextDayIdx >= dayKeys.length) break;
          const nextKey = dayKeys[nextDayIdx];
          const nextSlot = weekData.days[nextKey]?.slots[nextHour];
          if (nextSlot?.activityName?.trim() === actName) {
            detectedDuration++;
          } else {
            break;
          }
        }
      }
    }

    setEditingSlot({
      dateStr,
      dayKey,
      hourSlot,
      slot,
      detectedDuration,
    });
  };

  // スロット保存 (単一または範囲一括)
  const handleSaveSlot = async (slotData: {
    activityName: string;
    moodScore: number | null;
    moodRawLevel: number | null;
    moodDisplaySymbol: string | null;
    notes: string | null;
    isRange?: boolean;
    durationHours?: number;
    overwriteNonEmpty?: boolean;
    originalActivityName?: string | null;
  }) => {
    if (!editingSlot) return;

    if (slotData.isRange && (slotData.durationHours ?? 1) > 1) {
      const res = await fetch('/api/cbt/activities/range', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDateYmd: editingSlot.dateStr,
          startHourSlot: editingSlot.hourSlot,
          durationHours: slotData.durationHours,
          activityName: slotData.activityName,
          moodScore: slotData.moodScore,
          moodRawLevel: slotData.moodRawLevel,
          moodDisplaySymbol: slotData.moodDisplaySymbol,
          notes: slotData.notes,
          overwriteNonEmpty: Boolean(slotData.overwriteNonEmpty),
          allowFirstSlotOverwrite: true,
          originalActivityName: slotData.originalActivityName ?? null,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        showToast(`「${slotData.activityName}」を ${data.appliedCount} スロットに反映しました`);
        fetchWeekActivities(currentMonday);
      } else {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error || '範囲記録の保存に失敗しました';
        showToast(`❌ ${errMsg}`);
        throw new Error(errMsg);
      }
    } else {
      const res = await fetch('/api/cbt/activities/slot', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordDateYmd: editingSlot.dateStr,
          hourSlot: editingSlot.hourSlot,
          activityName: slotData.activityName,
          moodScore: slotData.moodScore,
          moodRawLevel: slotData.moodRawLevel,
          moodDisplaySymbol: slotData.moodDisplaySymbol,
          notes: slotData.notes,
        }),
      });

      if (res.ok) {
        showToast('記録を保存しました');
        fetchWeekActivities(currentMonday);
      } else {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error || 'スロットの保存に失敗しました';
        showToast(`❌ ${errMsg}`);
        throw new Error(errMsg);
      }
    }
  };

  // 睡眠クイック一括保存
  const handleSaveSleepRange = async (params: {
    startDateYmd: string;
    startHourSlot: number;
    durationHours: number;
    overwriteNonEmpty: boolean;
  }) => {
    const res = await fetch('/api/cbt/activities/range', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDateYmd: params.startDateYmd,
        startHourSlot: params.startHourSlot,
        durationHours: params.durationHours,
        activityName: '就寝',
        moodScore: null,
        moodRawLevel: null,
        moodDisplaySymbol: null,
        notes: null,
        overwriteNonEmpty: params.overwriteNonEmpty,
        allowFirstSlotOverwrite: false,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const isSundayNight = weekDays[6] && params.startDateYmd === weekDays[6].dateStr;
      const isRollover = params.startHourSlot + params.durationHours > 24;
      const notice = isSundayNight && isRollover
        ? ' (※翌朝分は翌週月曜のシートに記録されました)'
        : '';
      showToast(`睡眠記録: ${data.appliedCount} スロットに「就寝」を一括登録しました${notice}`);
      fetchWeekActivities(currentMonday);
    } else {
      const errData = await res.json().catch(() => ({}));
      const errMsg = errData.error || '睡眠記録の一括登録に失敗しました';
      showToast(`❌ ${errMsg}`);
      throw new Error(errMsg);
    }
  };

  // スロット削除
  const handleDeleteSlot = async () => {
    if (!editingSlot) return;

    const res = await fetch('/api/cbt/activities/slot', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recordDateYmd: editingSlot.dateStr,
        hourSlot: editingSlot.hourSlot,
      }),
    });

    if (res.ok) {
      showToast('記録を削除しました');
      fetchWeekActivities(currentMonday);
    } else {
      const errData = await res.json().catch(() => ({}));
      const errMsg = errData.error || 'スロット削除に失敗しました';
      showToast(`❌ ${errMsg}`);
      throw new Error(errMsg);
    }
  };

  // コピー実行
  const handleCopyDay = async (params: {
    sourceDateYmd: string;
    targetDateYmd: string;
    overwriteNonEmpty: boolean;
    includeMood: boolean;
  }) => {
    const res = await fetch('/api/cbt/copy/day', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.ok) {
      const data = await res.json();
      showToast(`${data.copiedCount} 枠の活動をコピーしました`);
      fetchWeekActivities(currentMonday);
    } else {
      const errData = await res.json().catch(() => ({}));
      const errMsg = errData.error || '日コピー処理に失敗しました';
      showToast(`❌ ${errMsg}`);
      throw new Error(errMsg);
    }
  };

  const handleCopyWeek = async (params: {
    sourceMondayYmd: string;
    targetMondayYmd: string;
    overwriteNonEmpty: boolean;
    includeMood: boolean;
  }) => {
    const res = await fetch('/api/cbt/copy/week', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.ok) {
      const data = await res.json();
      showToast(`前週の記録から ${data.copiedCount} 枠をコピーしました`);
      fetchWeekActivities(currentMonday);
    } else {
      const errData = await res.json().catch(() => ({}));
      const errMsg = errData.error || '週コピー処理に失敗しました';
      showToast(`❌ ${errMsg}`);
      throw new Error(errMsg);
    }
  };

  // テンプレート適用
  const handleApplyTemplate = async (params: {
    templateId: string;
    targetDatesYmd: string[];
    overwriteNonEmpty: boolean;
  }) => {
    const res = await fetch('/api/cbt/templates/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.ok) {
      const data = await res.json();
      showToast(`テンプレートの活動予定を ${data.appliedCount} 枠に反映しました`);
      fetchWeekActivities(currentMonday);
    } else {
      const errData = await res.json().catch(() => ({}));
      const errMsg = errData.error || 'テンプレート適用に失敗しました';
      showToast(`❌ ${errMsg}`);
      throw new Error(errMsg);
    }
  };

  // 気分設定保存
  const handleSaveMoodConfig = async (newConfig: MoodConfigDTO) => {
    const res = await fetch('/api/cbt/mood-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig),
    });
    if (res.ok) {
      setMoodConfig(newConfig);
      showToast('気分設定を更新しました');
    } else {
      const errData = await res.json().catch(() => ({}));
      const errMsg = errData.error || '気分設定の更新に失敗しました';
      showToast(`❌ ${errMsg}`);
      throw new Error(errMsg);
    }
  };

  // ログアウト
  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    onLogout();
  };

  const weekDays = generateWeekDays(currentMonday);

  return (
    <div className="min-h-screen flex flex-col flex-1 bg-slate-100 text-slate-800">
      {/* トップナビゲーションバー */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center text-white shadow-md shadow-teal-100 shrink-0 font-bold">
              CBT
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-slate-800 leading-tight">
                CBT 週間活動記録システム
              </h1>
              <p className="text-[11px] text-slate-500 hidden sm:block">
                行動活性化・気分トラッキング（対象指標: <strong className="text-teal-700">{moodConfig.emotionLabel}</strong>）
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 sm:space-x-3">
            {/* ロール切り替え (管理者・システム管理者権限を持つユーザーのみ表示) */}
            {(currentUser.role === 'admin' || currentUser.role === 'system_admin') && (
              <div className="bg-slate-100 p-1 rounded-lg flex items-center space-x-1 border border-slate-200 text-xs">
                <button
                  onClick={() => setCurrentRole('member')}
                  className={`px-2.5 py-1.5 rounded-md transition font-semibold flex items-center space-x-1 ${
                    currentRole === 'member' ? 'bg-white shadow text-teal-700' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <User className="w-3.5 h-3.5" />
                  <span>メンバー</span>
                </button>
                <button
                  onClick={() => setCurrentRole('admin')}
                  className={`px-2.5 py-1.5 rounded-md transition font-semibold flex items-center space-x-1 ${
                    currentRole === 'admin' ? 'bg-white shadow text-indigo-700' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>👨‍⚕️ 管理者</span>
                </button>
              </div>
            )}

            {/* カレンダー表示切り替え (メンバー時のみ) */}
            {currentRole === 'member' && (
              <div className="bg-slate-100 p-1 rounded-lg flex items-center space-x-1 border border-slate-200 text-xs">
                <button
                  onClick={() => setCalendarView('week')}
                  className={`px-2.5 py-1.5 rounded-md transition font-semibold flex items-center space-x-1 ${
                    calendarView === 'week' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'
                  }`}
                  title="PC向け週間マトリクス"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>週表示</span>
                </button>
                <button
                  onClick={() => setCalendarView('day')}
                  className={`px-2.5 py-1.5 rounded-md transition font-semibold flex items-center space-x-1 ${
                    calendarView === 'day' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'
                  }`}
                  title="スマホ向け1日縦スクロール"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>日表示</span>
                </button>
                <button
                  onClick={() => setCalendarView('month')}
                  className={`px-2.5 py-1.5 rounded-md transition font-semibold flex items-center space-x-1 ${
                    calendarView === 'month' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'
                  }`}
                  title="月間カレンダー・ヒートマップ"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>月表示</span>
                </button>
              </div>
            )}

            {/* ユーザーバッジ */}
            <div className="hidden lg:flex items-center space-x-2 pl-2 border-l border-slate-200 text-xs">
              <div className="w-8 h-8 rounded-full bg-teal-100 text-teal-800 flex items-center justify-center font-bold">
                {currentUser.displayName.charAt(0)}
              </div>
              <div className="text-left">
                <div className="font-semibold text-slate-800">{currentUser.displayName}</div>
                <div className="text-slate-400 text-[10px]">
                  {currentRole === 'member' ? 'メンバー (本人)' : '管理者'}
                </div>
              </div>
            </div>

            {/* ログアウトボタン */}
            <button
              onClick={handleLogout}
              className="p-2 text-slate-500 hover:text-rose-600 rounded-lg hover:bg-slate-100 transition"
              title="ログアウト"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {currentRole === 'member' && (
          <div className="space-y-4">
            {/* 共通ツールバー */}
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
              {/* 週送りナビ */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => changeWeek(-1)}
                  className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600"
                  title="前週へ"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="text-xs sm:text-sm font-bold text-slate-800 px-1">
                  📅 {weekDays[0].label}({weekDays[0].name.charAt(0)}) 〜 {weekDays[6].label}({weekDays[6].name.charAt(0)})
                </div>
                <button
                  onClick={() => changeWeek(1)}
                  className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600"
                  title="翌週へ"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={resetToCurrentWeek}
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-lg border border-slate-200 font-medium"
                >
                  今週
                </button>
              </div>

              {/* クイックアクション */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setShowSleepModal(true)}
                  className="text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-3 py-2 rounded-lg flex items-center space-x-1.5 transition shadow-xs"
                >
                  <Moon className="w-3.5 h-3.5" />
                  <span>睡眠を一括記録</span>
                </button>
                <button
                  onClick={() => setShowTemplateModal(true)}
                  className="text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-3 py-2 rounded-lg flex items-center space-x-1.5 transition"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>定型テンプレート</span>
                </button>
                <button
                  onClick={() => setShowCopyModal(true)}
                  className="text-xs font-semibold bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 px-3 py-2 rounded-lg flex items-center space-x-1.5 transition"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>過去からコピー</span>
                </button>
                <button
                  onClick={() => setShowMoodModal(true)}
                  className="text-xs font-semibold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 px-3 py-2 rounded-lg flex items-center space-x-1.5 transition"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>気分設定 ({moodConfig.emotionLabel})</span>
                </button>
              </div>
            </div>

            {/* 表示ビュー切り替え */}
            {weekData ? (
              <>
                {calendarView === 'week' && (
                  <WeekMatrix
                    weekData={weekData}
                    moodConfig={moodConfig}
                    onSlotClick={handleSlotClick}
                  />
                )}

                {calendarView === 'day' && (
                  <DayTimeline
                    weekData={weekData}
                    selectedDayIndex={selectedDayIndex}
                    moodConfig={moodConfig}
                    onDayIndexChange={setSelectedDayIndex}
                    onSlotClick={handleSlotClick}
                    onOpenTemplate={() => setShowTemplateModal(true)}
                    onOpenCopy={() => setShowCopyModal(true)}
                    onOpenMoodSetting={() => setShowMoodModal(true)}
                  />
                )}

                {calendarView === 'month' && (
                  <MonthHeatmap
                    weekData={weekData}
                    moodConfig={moodConfig}
                    onSelectDay={(idx) => {
                      setSelectedDayIndex(idx);
                      setCalendarView('day');
                    }}
                  />
                )}
              </>
            ) : (
              <div className="bg-white p-12 rounded-xl border border-slate-200 text-center text-slate-400 text-xs">
                週間記録データを読み込み中...
              </div>
            )}
          </div>
        )}

        {currentRole === 'admin' && <AdminView />}
      </main>

      {/* フッター */}
      <footer className="bg-white border-t border-slate-200 py-3 px-4 text-center text-xs text-slate-400 mt-auto">
        <span>CBT 週間活動記録システム</span>
      </footer>

      {/* モーダル群 */}
      {showSleepModal && (
        <SleepModal
          weekDays={weekDays}
          defaultDayIndex={selectedDayIndex}
          onClose={() => setShowSleepModal(false)}
          onSave={handleSaveSleepRange}
        />
      )}

      {editingSlot && (
        <SlotModal
          dayLabel={weekDays.find((d) => d.key === editingSlot.dayKey)?.name || ''}
          hourSlot={editingSlot.hourSlot}
          hourLabel={getHourSlotLabel(editingSlot.hourSlot)}
          slot={editingSlot.slot}
          moodConfig={moodConfig}
          initialDurationHours={editingSlot.detectedDuration}
          initialIsRange={(editingSlot.detectedDuration ?? 1) > 1}
          onClose={() => setEditingSlot(null)}
          onSave={handleSaveSlot}
          onDelete={handleDeleteSlot}
        />
      )}

      {showCopyModal && weekData && (
        <CopyModal
          weekData={weekData}
          onClose={() => setShowCopyModal(false)}
          onExecuteCopyDay={handleCopyDay}
          onExecuteCopyWeek={handleCopyWeek}
        />
      )}

      {showTemplateModal && weekData && (
        <TemplateModal
          templates={templates}
          weekData={weekData}
          onClose={() => setShowTemplateModal(false)}
          onApplyTemplate={handleApplyTemplate}
        />
      )}

      {showMoodModal && (
        <MoodConfigModal
          currentConfig={moodConfig}
          onClose={() => setShowMoodModal(false)}
          onSaveConfig={handleSaveMoodConfig}
        />
      )}

      {/* トースト通知 */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-800 text-white px-4 py-2.5 rounded-xl shadow-xl text-xs flex items-center space-x-2">
          <span>✅</span>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}

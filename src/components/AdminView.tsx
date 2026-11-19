'use client';

import React, { useState, useEffect } from 'react';
import { Users, FileText, ChevronLeft, ChevronRight, Save, ShieldAlert, Search, Eye, EyeOff, UserPlus } from 'lucide-react';
import type { MemberSummaryDTO, WeekActivitiesDTO } from '@/lib/dal/types';
import { generateWeekDays, getHourSlotLabel, getMondayOfCurrentWeek } from '@/lib/date-utils';
import { InviteModal } from './InviteModal';

interface AdminViewProps {
  onSlotClick?: (dateStr: string, dayKey: string, hourSlot: number) => void;
}

export function AdminView() {
  const [members, setMembers] = useState<MemberSummaryDTO[]>([]);
  const [selectedMember, setSelectedMember] = useState<MemberSummaryDTO | null>(null);
  const [weekData, setWeekData] = useState<WeekActivitiesDTO | null>(null);
  const [currentMonday, setCurrentMonday] = useState(getMondayOfCurrentWeek());
  const [adminMemoInput, setAdminMemoInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingMemo, setSavingMemo] = useState(false);
  const [adminToast, setAdminToast] = useState<{ message: string; isError?: boolean } | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [togglingVisibilityId, setTogglingVisibilityId] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);

  const showToast = (message: string, isError = false) => {
    setAdminToast({ message, isError });
    setTimeout(() => setAdminToast(null), 3000);
  };

  // 担当メンバー一覧取得
  const fetchMembers = React.useCallback(async () => {
    try {
      const res = await fetch('/api/admin/members?includeHidden=true');
      if (res.ok) {
        const data = await res.json();
        setMembers(data);
        if (data.length > 0 && !selectedMember) {
          setSelectedMember(data[0]);
          setAdminMemoInput(data[0].adminMemo || '');
        }
      }
    } finally {
      setLoading(false);
    }
  }, [selectedMember]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // 選択中メンバーの週間記録取得
  const fetchMemberWeek = async (memberId: string, mondayYmd: string) => {
    try {
      const res = await fetch(`/api/admin/members/${memberId}/activities/week?monday=${mondayYmd}`);
      if (res.ok) {
        const data = await res.json();
        setWeekData(data.weekData);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (selectedMember) {
      fetchMemberWeek(selectedMember.id, currentMonday);
    }
  }, [selectedMember, currentMonday]);

  const handleSelectMember = (m: MemberSummaryDTO) => {
    setSelectedMember(m);
    setAdminMemoInput(m.adminMemo || '');
  };

  const handleSaveMemo = async () => {
    if (!selectedMember) return;
    setSavingMemo(true);
    try {
      const res = await fetch(`/api/admin/members/${selectedMember.id}/memo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminMemo: adminMemoInput }),
      });
      if (res.ok) {
        showToast('支援メモを保存しました');
        // ローカルステート更新 (選択中メンバーおよび一覧リストの両方を同期)
        const nowIso = new Date().toISOString();
        setSelectedMember((prev) => prev ? { ...prev, adminMemo: adminMemoInput, memoUpdatedAt: nowIso } : null);
        setMembers((prev) => prev.map((m) => m.id === selectedMember.id ? { ...m, adminMemo: adminMemoInput, memoUpdatedAt: nowIso } : m));
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || '支援メモの保存に失敗しました', true);
      }
    } catch {
      showToast('通信エラーが発生しました', true);
    } finally {
      setSavingMemo(false);
    }
  };

  const changeWeek = (diffWeeks: number) => {
    const [y, m, d] = currentMonday.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + diffWeeks * 7));
    const nextYmd = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    setCurrentMonday(nextYmd);
  };

  const weekDays = generateWeekDays(currentMonday);

  const getMoodBadgeClass = (score: number | null) => {
    if (score === null || score === undefined) return 'bg-slate-100 text-slate-500';
    if (score >= 0.7) return 'bg-teal-100 text-teal-800';
    if (score <= 0.3) return 'bg-rose-100 text-rose-800';
    return 'bg-amber-100 text-amber-800';
  };

  const getCellBgClass = (score: number | null) => {
    if (score === null || score === undefined) return '';
    if (score >= 0.7) return 'bg-teal-50/40';
    if (score <= 0.3) return 'bg-rose-50/30';
    return 'bg-amber-50/30';
  };


  const handleToggleVisibility = async (e: React.MouseEvent, m: MemberSummaryDTO) => {
    e.stopPropagation();
    const newVisibility = !m.isVisible;
    setTogglingVisibilityId(m.id);
    try {
      const res = await fetch(`/api/admin/members/${m.id}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isVisible: newVisibility }),
      });
      if (res.ok) {
        setMembers((prev) =>
          prev.map((item) => (item.id === m.id ? { ...item, isVisible: newVisibility } : item))
        );
        if (selectedMember?.id === m.id) {
          setSelectedMember((prev) => (prev ? { ...prev, isVisible: newVisibility } : null));
        }
        showToast(newVisibility ? 'メンバーを一覧に再表示しました' : 'メンバーを非表示（アーカイブ）にしました');
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || '表示状態の変更に失敗しました', true);
      }
    } catch {
      showToast('通信エラーが発生しました', true);
    } finally {
      setTogglingVisibilityId(null);
    }
  };

  const filteredMembers = members.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesVisibility = showHidden ? true : m.isVisible;
    return matchesSearch && matchesVisibility;
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* 左サイドバー: 担当メンバー一覧 */}
      <div className="lg:col-span-1 bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Users className="w-5 h-5 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-800">担当メンバー</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowInviteModal(true)}
            className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold shadow-xs flex items-center space-x-1 transition"
            title="新しい担当メンバーを仮登録して招待"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>仮登録</span>
          </button>
        </div>

        <div className="space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="メンバー名・メールで検索"
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {/* 非表示メンバー表示フィルタ */}
          <div className="flex items-center justify-between text-[11px] text-slate-500 px-0.5">
            <label className="flex items-center space-x-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
              />
              <span>非表示メンバーも表示</span>
            </label>
            <span className="text-[10px] text-slate-400">
              {filteredMembers.length}名表示
            </span>
          </div>
        </div>

        <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
          {filteredMembers.map((m) => (
            <div
              key={m.id}
              onClick={() => handleSelectMember(m)}
              className={`p-3 rounded-xl border cursor-pointer transition ${
                selectedMember?.id === m.id
                  ? 'border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-500/20'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              } ${!m.isVisible ? 'opacity-70 bg-slate-50/80 border-dashed' : ''}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${m.avatarColor}`}>
                    {m.name.charAt(0)}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800 flex items-center space-x-1">
                      <span>{m.name}</span>
                      {!m.isVisible && (
                        <span className="text-[9px] bg-slate-200 text-slate-600 px-1 py-0.2 rounded font-normal">
                          非表示中
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400">{m.email}</div>
                  </div>
                </div>
                <div className="flex items-center space-x-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    m.supportStatus === 'active' ? 'bg-emerald-100 text-emerald-800 font-medium' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {m.supportStatus === 'active' ? '進行中' : '休止'}
                  </span>
                  {/* 表示/非表示トグルボタン (L9要求) */}
                  <button
                    type="button"
                    onClick={(e) => handleToggleVisibility(e, m)}
                    disabled={togglingVisibilityId === m.id}
                    title={m.isVisible ? '一覧から非表示にする（アーカイブ）' : '一覧に再表示する'}
                    className={`p-1 rounded text-[10px] font-medium transition flex items-center space-x-0.5 ${
                      m.isVisible
                        ? 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                        : 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100 font-bold'
                    }`}
                  >
                    {m.isVisible ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-slate-400 flex items-center justify-between border-t border-slate-100 pt-1.5">
                <span>最終記録:</span>
                <span className="font-medium text-slate-600">{m.lastRecordDate ?? '未記録'}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 右メイン: メンバーカルテ・詳細・週間シート */}
      <div className="lg:col-span-3 space-y-4">
        {selectedMember ? (
          <>
            {/* 支援メモ (カルテ) */}
            <div className="bg-amber-50/60 rounded-xl border-2 border-amber-200/80 p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <FileText className="w-5 h-5 text-amber-700" />
                  <h3 className="text-sm font-bold text-slate-800">
                    👨‍⚕️ {selectedMember.name} さんの支援者カルテメモ
                  </h3>
                  <span className="text-[10px] bg-rose-100 text-rose-800 px-2 py-0.5 rounded font-bold flex items-center space-x-1">
                    <ShieldAlert className="w-3 h-3" />
                    <span>本人非公開 (絶対秘匿)</span>
                  </span>
                </div>
                {selectedMember.memoUpdatedAt && (
                  <span className="text-[11px] text-slate-400">
                    最終更新: {new Date(selectedMember.memoUpdatedAt).toLocaleString('ja-JP')}
                  </span>
                )}
              </div>

              <textarea
                rows={3}
                value={adminMemoInput}
                onChange={(e) => setAdminMemoInput(e.target.value)}
                placeholder="支援方針、面談での気付き、次回振り返りの着眼点などを記録（メンバー本人には一切公開されません）"
                className="w-full p-2.5 text-xs rounded-xl border border-amber-300 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />

              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500">
                  ※DAL層にてメンバー向けAPIレスポンスから構造的に除外されています。
                </span>
                <button
                  onClick={handleSaveMemo}
                  disabled={savingMemo}
                  className="px-4 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow-sm transition flex items-center space-x-1 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingMemo ? '保存中...' : '支援メモを保存'}</span>
                </button>
              </div>
            </div>

            {/* 日別 気分推移グラフ */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-slate-700">
                  📈 {selectedMember.name} さんの日別平均気分推移
                </h3>
                <span className="text-xs text-slate-500">
                  週間平均スコア:{' '}
                  <strong className="text-teal-700">
                    {weekData?.totalAverageMood !== null && weekData?.totalAverageMood !== undefined
                      ? `${Math.round(weekData.totalAverageMood * 100)}%`
                      : '未記録'}
                  </strong>
                </span>
              </div>

              <div className="grid grid-cols-7 gap-2 items-end h-28 pt-4 px-2 bg-slate-50 rounded-lg border border-slate-100">
                {weekDays.map((d) => {
                  const dayRecord = weekData?.days[d.key];
                  const avg = dayRecord?.averageMood ?? null;
                  const heightPx = avg !== null ? Math.max(12, Math.round(avg * 64)) : 4;

                  return (
                    <div key={d.key} className="flex flex-col items-center h-full justify-end">
                      <div className="text-[10px] font-bold text-slate-600 mb-1">
                        {avg !== null ? `${Math.round(avg * 100)}%` : '-'}
                      </div>
                      <div
                        style={{ height: `${heightPx}px` }}
                        className={`w-full max-w-[36px] rounded-t transition-all duration-300 ${
                          avg === null ? 'bg-slate-200' : avg >= 0.7 ? 'bg-teal-500' : avg <= 0.3 ? 'bg-rose-400' : 'bg-amber-400'
                        }`}
                      />
                      <div className="text-[10px] text-slate-500 mt-1">{d.name.charAt(0)}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* メンバーの週間活動記録シート (閲覧) */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-slate-800">
                  📋 {selectedMember.name} さんの週間活動記録シート
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => changeWeek(-1)}
                    className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600"
                    title="前週"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-bold text-slate-700">
                    {weekDays[0].label}({weekDays[0].name.charAt(0)}) 〜 {weekDays[6].label}({weekDays[6].name.charAt(0)})
                  </span>
                  <button
                    onClick={() => changeWeek(1)}
                    className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600"
                    title="翌週"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setCurrentMonday(getMondayOfCurrentWeek())}
                    className="text-[11px] px-2 py-1 border border-slate-200 rounded hover:bg-slate-50 font-medium"
                  >
                    今週
                  </button>
                </div>
              </div>

              {weekData ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse min-w-[920px]">
                    <thead>
                      <tr className="bg-slate-50 text-slate-700">
                        <th rowSpan={2} className="w-24 py-2 px-2 border-b border-r border-slate-200 text-center font-medium bg-slate-50 align-middle">
                          時間帯
                        </th>
                        {weekDays.map((d) => (
                          <th key={d.key} colSpan={2} className="py-2 px-2 border-b border-r border-slate-200 text-center font-semibold">
                            {d.name} ({d.label})
                          </th>
                        ))}
                      </tr>
                      <tr className="bg-slate-50/80 text-slate-600">
                        {weekDays.map((d) => (
                          <React.Fragment key={'admin-sub-' + d.key}>
                            <th className="py-1 px-1.5 border-b border-r border-slate-200 text-center font-medium text-[10px] min-w-[72px]">
                              行動
                            </th>
                            <th className="py-1 px-1 border-b border-r border-slate-200 text-center font-medium text-[10px] w-14 min-w-[48px]">
                              気分
                            </th>
                          </React.Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {Array.from({ length: 24 }).map((_, hour) => (
                        <tr key={hour} className="hover:bg-slate-50/40">
                          <td className="py-1.5 px-2 border-r border-slate-200 text-center font-mono text-[10px] text-slate-500 bg-slate-50/50">
                            {getHourSlotLabel(hour)}
                          </td>
                          {weekDays.map((d) => {
                            const slot = weekData.days[d.key]?.slots[hour];
                            const score = slot?.moodScore ?? null;
                            const hasActivity = Boolean(slot?.activityName);
                            return (
                              <React.Fragment key={d.key}>
                                <td className={`p-1.5 border-r border-slate-200 align-middle ${hasActivity ? 'bg-white' : 'bg-slate-50/20'}`}>
                                  <div className="flex items-center justify-between">
                                    <span className={`font-semibold text-[11px] truncate ${hasActivity ? 'text-slate-800' : 'text-slate-300'}`}>
                                      {slot?.activityName || '-'}
                                    </span>
                                    {slot?.notes && <span className="text-[10px] text-slate-400 shrink-0 ml-1" title={slot.notes}>📝</span>}
                                  </div>
                                </td>
                                <td className={`p-1 border-r border-slate-200 text-center align-middle ${getCellBgClass(score)}`}>
                                  {score !== null ? (
                                    <span className={`text-[9px] px-1 py-0.5 rounded font-bold inline-flex items-center space-x-0.5 ${getMoodBadgeClass(score)}`}>
                                      <span>{slot?.moodDisplaySymbol ?? ''}</span>
                                      <span>{Math.round(score * 100)}%</span>
                                    </span>
                                  ) : hasActivity ? (
                                    <span className="text-[9px] text-slate-400">-</span>
                                  ) : (
                                    <span className="text-[9px] text-slate-200">-</span>
                                  )}
                                </td>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-slate-400">読み込み中...</div>
              )}
            </div>
          </>
        ) : (
          <div className="bg-white p-8 rounded-xl border border-slate-200 text-center text-slate-400 text-xs">
            担当メンバーを選択してください
          </div>
        )}
      </div>

      {adminToast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-xl shadow-xl text-xs flex items-center space-x-2 ${
            adminToast.isError ? 'bg-rose-700 text-white' : 'bg-slate-800 text-white'
          }`}
        >
          <span>{adminToast.isError ? '❌' : '✅'}</span>
          <span>{adminToast.message}</span>
        </div>
      )}

      {showInviteModal && (
        <InviteModal
          onClose={() => setShowInviteModal(false)}
          onMemberInvited={(newMember) => {
            setMembers((prev) => [newMember, ...prev]);
            setSelectedMember(newMember);
          }}
        />
      )}
    </div>
  );
}

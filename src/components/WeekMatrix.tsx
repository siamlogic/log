'use client';

import React from 'react';
import type { WeekActivitiesDTO, MoodConfigDTO } from '@/lib/dal/types';
import { generateWeekDays, getHourSlotLabel } from '@/lib/date-utils';

interface WeekMatrixProps {
  weekData: WeekActivitiesDTO;
  moodConfig: MoodConfigDTO;
  onSlotClick: (dateStr: string, dayKey: string, hourSlot: number) => void;
}

export function WeekMatrix({ weekData, moodConfig, onSlotClick }: WeekMatrixProps) {
  const weekDays = generateWeekDays(weekData.mondayDateStr);

  const getMoodBadgeClass = (score: number | null) => {
    if (score === null || score === undefined) return 'bg-slate-100 text-slate-500';
    if (score >= 0.7) return 'bg-teal-100 text-teal-800';
    if (score <= 0.3) return 'bg-rose-100 text-rose-800';
    return 'bg-amber-100 text-amber-800';
  };

  const getCellBgClass = (score: number | null, hasActivity: boolean) => {
    if (!hasActivity) return 'bg-white hover:bg-slate-50/80';
    if (score === null || score === undefined) return 'bg-slate-50/80 hover:bg-slate-100';
    if (score >= 0.7) return 'bg-teal-50/40 hover:bg-teal-50/70';
    if (score <= 0.3) return 'bg-rose-50/30 hover:bg-rose-50/60';
    return 'bg-amber-50/30 hover:bg-amber-50/60';
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse min-w-[1020px]">
          <thead>
            <tr className="bg-slate-50 text-slate-700">
              <th rowSpan={2} className="w-24 py-2.5 px-3 border-b border-r border-slate-200 font-semibold text-center sticky left-0 bg-slate-100 z-20 align-middle">
                時間帯
              </th>
              {weekDays.map((d, i) => (
                <th
                  key={d.key}
                  colSpan={2}
                  className={`py-2 px-2 border-b border-r border-slate-200 font-bold text-center ${
                    i >= 5 ? 'bg-amber-50/70 text-amber-900' : 'bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="text-sm">{d.name}</div>
                  <div className="text-[11px] font-normal text-slate-500">{d.label}</div>
                </th>
              ))}
            </tr>
            <tr className="bg-slate-50/90 text-slate-600">
              {weekDays.map((d) => (
                <React.Fragment key={'sub-' + d.key}>
                  <th className="py-1 px-2 border-b border-r border-slate-200 text-center font-medium text-[11px] min-w-[86px]">
                    行動
                  </th>
                  <th className="py-1 px-1 border-b border-r border-slate-200 text-center font-medium text-[11px] w-16 min-w-[56px]">
                    {moodConfig.styleType === 'number' ? '％' : '気分'}
                  </th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {Array.from({ length: 24 }).map((_, hour) => (
              <tr key={hour} className="hover:bg-slate-50/40 transition">
                <td className="py-2 px-2.5 border-r border-slate-200 text-center font-mono text-[11px] font-medium text-slate-500 bg-slate-50/80 sticky left-0 z-10 whitespace-nowrap">
                  {getHourSlotLabel(hour)}
                </td>
                {weekDays.map((d) => {
                  const dayRecord = weekData.days[d.key];
                  const slot = dayRecord?.slots[hour];
                  const hasActivity = Boolean(slot?.activityName);
                  const score = slot?.moodScore ?? null;

                  return (
                    <React.Fragment key={d.key}>
                      {/* 行動（活動内容）セル */}
                      <td
                        onClick={() => onSlotClick(d.dateStr, d.key, hour)}
                        className={`p-1.5 border-r border-slate-200 cursor-pointer transition align-middle ${
                          hasActivity ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/20 hover:bg-slate-50'
                        }`}
                        title="クリックして活動・気分をまとめて入力"
                      >
                        <div className="min-h-[26px] flex items-center justify-between">
                          <span
                            className={`font-medium text-[11px] leading-tight truncate ${
                              hasActivity ? 'text-slate-800' : 'text-slate-300'
                            }`}
                          >
                            {slot?.activityName || '-'}
                          </span>
                          {slot?.notes && <span className="text-[10px] text-slate-400 shrink-0 ml-1" title={slot.notes}>📝</span>}
                        </div>
                      </td>

                      {/* 気分（％ / 記号）セル */}
                      <td
                        onClick={() => onSlotClick(d.dateStr, d.key, hour)}
                        className={`p-1 border-r border-slate-200 cursor-pointer transition text-center align-middle ${getCellBgClass(
                          score,
                          hasActivity
                        )}`}
                        title="クリックして活動・気分をまとめて入力"
                      >
                        <div className="min-h-[26px] flex items-center justify-center">
                          {score !== null ? (
                            <span
                              className={`text-[10px] px-1 py-0.5 rounded font-bold inline-flex items-center space-x-0.5 ${getMoodBadgeClass(
                                score
                              )}`}
                            >
                              <span>{slot?.moodDisplaySymbol ?? ''}</span>
                              <span>{Math.round(score * 100)}%</span>
                            </span>
                          ) : hasActivity ? (
                            <span className="text-[9px] text-slate-400 bg-slate-100/80 px-1 py-0.2 rounded">
                              -
                            </span>
                          ) : (
                            <span className="text-slate-200 text-xs">-</span>
                          )}
                        </div>
                      </td>
                    </React.Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {/* 日別平均気分スコア集計行 */}
          <tfoot>
            <tr className="bg-slate-100/90 font-bold text-slate-700 border-t-2 border-slate-300">
              <td className="py-2 px-2 text-center text-xs sticky left-0 bg-slate-100 z-10 border-r border-slate-200">
                日別平均
              </td>
              {weekDays.map((d) => {
                const dayRecord = weekData.days[d.key];
                const avg = dayRecord?.averageMood ?? null;
                return (
                  <td key={d.key} colSpan={2} className="py-2 px-2 text-center border-r border-slate-200 text-xs">
                    {avg !== null ? (
                      <span className={`px-2 py-0.5 rounded text-[11px] ${getMoodBadgeClass(avg)}`}>
                        {Math.round(avg * 100)}%
                      </span>
                    ) : (
                      <span className="text-slate-400 font-normal">-</span>
                    )}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

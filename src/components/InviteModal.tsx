'use client';

import React, { useState } from 'react';
import { X, UserPlus, Copy, Check, AlertCircle } from 'lucide-react';
import type { MemberSummaryDTO } from '@/lib/dal/types';

interface InviteModalProps {
  onClose: () => void;
  onMemberInvited: (newMember: MemberSummaryDTO) => void;
}

export function InviteModal({ onClose, onMemberInvited }: InviteModalProps) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [supportStatus, setSupportStatus] = useState<'active' | 'paused'>('active');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 招待成功後のトークン表示画面
  const [inviteResult, setInviteResult] = useState<{
    member: MemberSummaryDTO;
    inviteToken: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!displayName.trim() || !email.trim()) {
      setError('氏名とメールアドレスを入力してください');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/members/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          email: email.trim(),
          supportStatus,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '仮登録に失敗しました');
        return;
      }

      setInviteResult(data);
      onMemberInvited(data.member);
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setSubmitting(false);
    }
  };

  const [copyError, setCopyError] = useState('');

  const handleCopyLink = async () => {
    if (!inviteResult) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const setupUrl = `${origin}/?mode=setup&token=${inviteResult.inviteToken}&email=${encodeURIComponent(
      inviteResult.member.email
    )}`;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(setupUrl);
        setCopied(true);
        setCopyError('');
        setTimeout(() => setCopied(false), 3000);
      } else {
        throw new Error('Clipboard API not supported');
      }
    } catch {
      setCopyError('自動コピーに失敗しました。下のリンク枠から手動でコピーしてください。');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <UserPlus className="w-5 h-5 text-indigo-600" />
            <h3 className="text-base font-bold text-slate-800">担当メンバーの仮登録・招待</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {!inviteResult ? (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs">
            {error && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 flex items-center space-x-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label htmlFor="invite-display-name" className="block font-bold text-slate-700 mb-1">メンバー氏名（表示名）</label>
              <input
                id="invite-display-name"
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="例: 佐々木 健太"
                className="w-full p-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="invite-email" className="block font-bold text-slate-700 mb-1">メールアドレス</label>
              <input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="例: sasaki@example.com"
                className="w-full p-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="invite-support-status" className="block font-bold text-slate-700 mb-1">支援ステータス</label>
              <select
                id="invite-support-status"
                value={supportStatus}
                onChange={(e) => setSupportStatus(e.target.value as 'active' | 'paused')}
                className="w-full p-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
              >
                <option value="active">進行中（アクティブ支援）</option>
                <option value="paused">休止中（観察・保留）</option>
              </select>
            </div>

            <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl text-slate-600 text-[11px] leading-relaxed">
              仮登録を行うと、担当関係が自動生成され、<strong>有効期限48時間の招待トークン</strong>が発行されます。メンバーはこのトークンを用いて初期パスワードを設定し、運用を開始します。
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-100 transition disabled:opacity-50"
              >
                {submitting ? '仮登録中...' : '仮登録して招待トークン発行'}
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-4 space-y-4 text-xs">
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900">
              <div className="font-bold flex items-center space-x-1.5 text-sm">
                <Check className="w-4 h-4 text-emerald-600" />
                <span>仮登録が完了しました</span>
              </div>
              <p className="mt-1 text-[11px] text-emerald-800">
                <strong>{inviteResult.member.name}</strong> さんのアカウントが仮登録（invited）されました。
              </p>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                メンバー向け招待・パスワード設定リンク（有効期限: 48時間）
              </label>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-[11px] break-all select-all text-slate-700">
                {typeof window !== 'undefined' ? window.location.origin : ''}/?mode=setup&token=
                {inviteResult.inviteToken}&email={encodeURIComponent(inviteResult.member.email)}
              </div>
              {copyError && (
                <p className="mt-1.5 text-xs text-rose-600 font-medium">{copyError}</p>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleCopyLink}
                className="flex-1 py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center justify-center space-x-1.5 shadow-md shadow-indigo-100 transition"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? '招待リンクをコピーしました！' : '招待リンクをコピー'}</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="py-2.5 px-4 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold"
              >
                閉じる
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

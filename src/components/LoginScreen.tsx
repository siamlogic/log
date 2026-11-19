'use client';

import React, { useState, useEffect } from 'react';
import { Lock, Mail, ShieldAlert, KeyRound, UserCheck, Key } from 'lucide-react';
import type { SessionUser } from '@/lib/auth-service';

interface LoginScreenProps {
  onLoginSuccess: (user: SessionUser) => void;
}

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mfaMode, setMfaMode] = useState<'totp' | 'recovery'>('totp');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState('');
  const [isLocked, setIsLocked] = useState(false);
  const [loading, setLoading] = useState(false);

  // 初回パスワード設定 (招待からの本登録)
  const [setupEmail, setSetupEmail] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const mode = params.get('mode');
      const token = params.get('token');
      const paramEmail = params.get('email');
      if (mode === 'setup' || token) {
        setStep(3);
        if (token) setSetupToken(token);
        if (paramEmail) setSetupEmail(decodeURIComponent(paramEmail));
      }
    }
  }, []);

  const handleSetupPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!setupEmail.trim() || !setupToken.trim() || !setupPassword) {
      setError('メールアドレス、招待トークン、新しいパスワードを入力してください');
      return;
    }

    if (setupPassword.length < 8) {
      setError('パスワードは8文字以上で入力してください');
      return;
    }

    if (setupPassword !== setupPasswordConfirm) {
      setError('パスワード（確認用）が一致しません');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/setup-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: setupEmail.trim(),
          token: setupToken.trim(),
          password: setupPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'パスワード設定に失敗しました');
        return;
      }

      if (data.user) {
        onLoginSuccess(data.user);
      }
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError('');
    setIsLocked(false);

    if (!email.trim() || !password.trim()) {
      setError('メールアドレスとパスワードを入力してください');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          mfaCode: step === 2 ? (mfaMode === 'totp' ? mfaCode : recoveryCode) : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'ログインに失敗しました');
        if (data.locked) setIsLocked(true);
        setLoading(false);
        return;
      }

      if (data.requireMfa) {
        setStep(2);
        setLoading(false);
        return;
      }

      if (data.user) {
        onLoginSuccess(data.user);
      }
    } catch (err) {
      setError('通信エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-teal-50/50 to-emerald-50/50 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-teal-600 flex items-center justify-center text-white shadow-lg shadow-teal-200/60 mx-auto mb-4">
            <Lock className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">CBT 週間活動記録システム</h1>
          <p className="text-sm text-slate-500 mt-1">行動活性化・気分トラッキング</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-slate-200/80 p-6">
          {step === 1 && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800 mb-1">ログイン</h2>
                <p className="text-xs text-slate-500 mb-4">登録済みのメールアドレスとパスワードでサインイン</p>
              </div>

              {isLocked && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start space-x-2">
                  <ShieldAlert className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" />
                  <div>
                    <div className="font-bold">アカウントがロックされています</div>
                    <div className="mt-0.5">連続5回のログイン失敗により15分間ロックされました。しばらく経ってから再度お試しください。</div>
                  </div>
                </div>
              )}

              {error && !isLocked && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
                  {error}
                </div>
              )}

              <div className="space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">メールアドレス</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 focus:outline-none text-sm"
                      placeholder="tanaka@example.com"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">パスワード</label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 focus:outline-none text-sm"
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-5 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-teal-200/60 transition active:scale-[0.99] disabled:opacity-50"
              >
                {loading ? 'ログイン中...' : 'ログイン'}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => { setStep(3); setError(''); }}
                  className="text-xs text-teal-700 hover:text-teal-900 font-bold hover:underline transition"
                >
                  📨 管理者から招待された方はこちら（初回パスワード設定）
                </button>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-100 text-[11px] text-slate-500 text-center space-y-1">
                <p className="font-semibold text-slate-600">テスト用アカウント：</p>
                <p>メンバー: <code className="bg-slate-100 px-1 rounded">tanaka@example.com</code> / <code className="bg-slate-100 px-1 rounded">password123</code></p>
                <p>管理者: <code className="bg-slate-100 px-1 rounded">sato@example.com</code> / <code className="bg-slate-100 px-1 rounded">password123</code></p>
                <p>2FA: <code className="bg-slate-100 px-1 rounded">2fa@example.com</code> / ロック: <code className="bg-slate-100 px-1 rounded">locked@example.com</code></p>
              </div>
            </form>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center space-x-2 mb-2">
                <button
                  type="button"
                  onClick={() => { setStep(1); setError(''); }}
                  className="text-slate-400 hover:text-slate-600 text-xs"
                >
                  ← 戻る
                </button>
                <h2 className="text-lg font-bold text-slate-800">🔐 2段階認証</h2>
              </div>
              <p className="text-xs text-slate-600">
                {mfaMode === 'totp' ? '認証アプリ（Google Authenticator等）の6桁コードを入力してください' : '8桁のリカバリーコードを入力してください'}
              </p>

              {error && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
                  {error}
                </div>
              )}

              {mfaMode === 'totp' ? (
                <div>
                  <input
                    type="text"
                    maxLength={6}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    placeholder="123456"
                    className="w-full text-center tracking-[0.3em] text-2xl font-mono p-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleLogin()}
                    className="w-full mt-4 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-teal-200/60 transition"
                  >
                    認証コードを確認
                  </button>
                  <div className="mt-3 text-center">
                    <button
                      type="button"
                      onClick={() => { setMfaMode('recovery'); setError(''); }}
                      className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
                    >
                      🔑 リカバリーコードを使用
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <input
                    type="text"
                    value={recoveryCode}
                    onChange={(e) => setRecoveryCode(e.target.value)}
                    placeholder="A8F2-9K1M"
                    className="w-full text-center font-mono tracking-wider p-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500 focus:outline-none text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => handleLogin()}
                    className="w-full mt-4 py-3 bg-slate-700 hover:bg-slate-800 text-white rounded-xl font-bold text-sm transition"
                  >
                    リカバリーコードで認証
                  </button>
                  <div className="mt-3 text-center">
                    <button
                      type="button"
                      onClick={() => { setMfaMode('totp'); setError(''); }}
                      className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
                    >
                      📱 認証アプリのコードを使用
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <form onSubmit={handleSetupPassword} className="space-y-4">
              <div className="flex items-center space-x-2 mb-1">
                <button
                  type="button"
                  onClick={() => { setStep(1); setError(''); }}
                  className="text-slate-400 hover:text-slate-600 text-xs"
                >
                  ← 戻る
                </button>
                <h2 className="text-lg font-bold text-slate-800 flex items-center space-x-1.5">
                  <UserCheck className="w-5 h-5 text-indigo-600" />
                  <span>初回パスワード設定</span>
                </h2>
              </div>
              <p className="text-xs text-slate-500 mb-2">
                管理者から受け取った招待情報で初期パスワードを設定し、CBT活動記録の運用を開始します。
              </p>

              {error && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
                  {error}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">登録メールアドレス</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                    <input
                      type="email"
                      required
                      value={setupEmail}
                      onChange={(e) => setSetupEmail(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none text-xs"
                      placeholder="sasaki@example.com"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">招待トークン</label>
                  <div className="relative">
                    <Key className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                    <input
                      type="text"
                      required
                      value={setupToken}
                      onChange={(e) => setSetupToken(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none text-xs font-mono"
                      placeholder="64桁の招待トークン"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">新しいパスワード (8文字以上)</label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={setupPassword}
                      onChange={(e) => setSetupPassword(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none text-xs"
                      placeholder="••••••••"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">パスワード（確認用）</label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={setupPasswordConfirm}
                      onChange={(e) => setSetupPasswordConfirm(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none text-xs"
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-lg shadow-indigo-100 transition active:scale-[0.99] disabled:opacity-50"
              >
                {loading ? '設定中...' : 'パスワードを設定して運用開始'}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => { setStep(1); setError(''); }}
                  className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
                >
                  ← 通常ログイン画面に戻る
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

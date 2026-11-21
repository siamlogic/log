'use client';

import React, { useState, useEffect } from 'react';
import type { SessionUser } from '@/lib/auth-service';
import { LoginScreen } from '@/components/LoginScreen';
import { CbtApp } from '@/components/CbtApp';

export default function HomePage() {
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // 初回マウント時にセッション確認
  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setCurrentUser(data.user);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setCheckingAuth(false);
      }
    };
    checkSession();
  }, []);

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400 text-xs font-medium">
        読み込み中...
      </div>
    );
  }

  if (!currentUser) {
    return <LoginScreen onLoginSuccess={(user) => setCurrentUser(user)} />;
  }

  return <CbtApp currentUser={currentUser} onLogout={() => setCurrentUser(null)} />;
}

import { cookies } from 'next/headers';
import { prisma } from './prisma';
import { getEnvVar } from './cf-env';
import {
  base64UrlDecode,
  base64UrlEncode,
  hmacHex,
  pbkdf2Hex,
  randomBytesHex,
  timingSafeEqualStr,
} from './web-crypto';

const SESSION_COOKIE_NAME = 'cbt_session_token';

function isProductionEnv(): boolean {
  return (getEnvVar('NODE_ENV') ?? process.env.NODE_ENV) === 'production';
}

function getSessionSecret(): string {
  const secret = getEnvVar('NEXTAUTH_SECRET');
  if (!secret || secret.length < 32) {
    if (isProductionEnv()) {
      throw new Error('FATAL: NEXTAUTH_SECRET must be set and at least 32 characters in production.');
    }
    return 'cbt-default-dev-secret-key-32chars';
  }
  return secret;
}

type Argon2Module = {
  hash: (password: string, options?: Record<string, unknown>) => Promise<string>;
  verify: (hash: string, password: string) => Promise<boolean>;
};

let cachedArgon2: Argon2Module | null | undefined = undefined;

// Node.js ネイティブ環境用 Argon2id。Edge / Cloudflare Workers 環境へのフォールバック対応
function getArgon2Module(): Argon2Module | null {
  if (cachedArgon2 !== undefined) return cachedArgon2;
  if (process.env.NEXT_RUNTIME === 'edge') {
    cachedArgon2 = null;
    return null;
  }
  try {
    const mod = require('@node-rs/argon2');
    if (mod && typeof mod.hash === 'function' && typeof mod.verify === 'function') {
      cachedArgon2 = mod as Argon2Module;
      return cachedArgon2;
    }
  } catch {
    // Edge / Workers 等でロード不可の場合は null（PBKDF2 へフォールバック）
  }
  cachedArgon2 = null;
  return null;
}

// タイミング攻撃・ユーザー列挙防止用ダミーハッシュ (ユーザー非存在時も同等の計算時間を消費)
export const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQxMjM0NTY3OA$Bqj8NqB9f2vL5wP8x1y3z4A5b6c7d8e9';

export interface SessionUser {
  id: string;
  email: string;
  role: 'member' | 'admin' | 'system_admin';
  displayName: string;
  tokenVersion?: number;
}

/**
 * パスワードを Argon2id (Node.js環境) または PBKDF2 (Cloudflare Edge環境) で安全にハッシュ化
 */
export async function hashPassword(password: string): Promise<string> {
  const preferPbkdf2 = getEnvVar('PREFER_PBKDF2_HASH') === 'true';
  const argon2Module = preferPbkdf2 ? null : getArgon2Module();
  if (argon2Module) {
    try {
      return await argon2Module.hash(password, {
        memoryCost: 19456,
        timeCost: 2,
        outputLen: 32,
      });
    } catch {
      // Edge / Cloudflare Workers 環境等でネイティブアドオンが実行できない場合は PBKDF2 へフォールバック
    }
  }

  // Cloudflare Pages / Workers 向け Web Crypto PBKDF2-SHA256 (100,000反復)
  const salt = randomBytesHex(16);
  const derived = await pbkdf2Hex(password, salt, 100000, 32);
  return `$pbkdf2$100000$${salt}$${derived}`;
}

/**
 * パスワードの検証
 * Argon2id ハッシュ、PBKDF2 ハッシュ、旧HMAC-SHA256ハッシュとの互換突合 (タイミング攻撃対策済み)
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (storedHash.startsWith('$argon2')) {
    const argon2Module = getArgon2Module();
    if (argon2Module) {
      try {
        return await argon2Module.verify(storedHash, password);
      } catch {
        return false;
      }
    }
    // Edge Runtime 等でネイティブ Argon2 が利用不可の場合もタイミング均等化のためダミー PBKDF2 計算を実行
    await pbkdf2Hex(password, 'edge-argon2-dummy-salt', 100000, 32);
    console.warn('[auth] Argon2 hash cannot be verified in Edge Runtime; pre-migration to PBKDF2 is required.');
    return false;
  }

  if (storedHash.startsWith('$pbkdf2$')) {
    const parts = storedHash.split('$');
    if (parts.length === 5) {
      const iterations = Number(parts[2]);
      const salt = parts[3];
      const hash = parts[4];
      const derived = await pbkdf2Hex(password, salt, iterations, 32);
      return timingSafeEqualStr(hash, derived);
    }
    return false;
  }

  // 後方互換性: 旧HMAC-SHA256ハッシュの安全突合 (タイミング攻撃対策済み)
  const legacySalt = 'cbt-salt-2026';
  const legacyExpected = await hmacHex('SHA-256', legacySalt, password);
  return timingSafeEqualStr(legacyExpected, storedHash);
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  const payload = JSON.stringify({
    ...user,
    tokenVersion: user.tokenVersion ?? 0,
    exp: Date.now() + 12 * 60 * 60 * 1000, // 12時間
  });
  const encoded = base64UrlEncode(payload);
  const signature = await hmacHex('SHA-256', getSessionSecret(), encoded);
  return `${encoded}.${signature}`;
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) return null;

    const expectedSig = await hmacHex('SHA-256', getSessionSecret(), encoded);
    if (!timingSafeEqualStr(signature, expectedSig)) {
      return null;
    }

    const json = base64UrlDecode(encoded);
    const data = JSON.parse(json);

    if (Date.now() > data.exp) return null;

    return {
      id: data.id,
      email: data.email,
      role: data.role,
      displayName: data.displayName,
      tokenVersion: typeof data.tokenVersion === 'number' ? data.tokenVersion : 0,
    };
  } catch {
    return null;
  }
}

/**
 * サーバー側でセッションユーザーを取得（DBの tokenVersion と照合して即時失効を検証）
 */
export async function getCurrentSessionUser(): Promise<SessionUser | null> {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const verified = await verifySessionToken(token);
  if (!verified) return null;

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: verified.id },
      select: { tokenVersion: true, status: true },
    });
    if (!dbUser || dbUser.status === 'suspended') return null;
    if (dbUser.tokenVersion !== (verified.tokenVersion ?? 0)) return null;

    return verified;
  } catch {
    return null;
  }
}

/**
 * ユーザーの全セッションを即時失効 (ログアウト / パスワード変更 / 停止時)
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
}

/**
 * セッションCookieをセット
 */
export async function setSessionCookie(user: SessionUser): Promise<void> {
  const token = await createSessionToken(user);
  cookies().set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProductionEnv(),
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60,
  });
}

/**
 * CSRF 防止のための同一オリジン（Same-Origin）検証 (SEC-502)
 * 1. Fetch Metadata (Sec-Fetch-Site): ブラウザが cross-site と判定しているリクエストを先制遮断
 * 2. Origin / Referer ヘッダー: Host ヘッダーとの完全一致を検証
 */
export function verifySameOrigin(req: Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return true;
  }

  // 1. Fetch Metadata 検証: cross-site リクエストは無条件拒否 (ブラウザ強制付与・偽造不可)
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite === 'cross-site') {
    return false;
  }

  const host = req.headers.get('host') || req.headers.get('x-forwarded-host');
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  if (!host) return true; // ホストヘッダー欠落時（テスト・内部呼び出し）はフォールバック

  if (origin) {
    try {
      const originHost = new URL(origin).host;
      return originHost === host;
    } catch {
      return false;
    }
  }

  if (referer) {
    try {
      const refererHost = new URL(referer).host;
      return refererHost === host;
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * セッションCookieを破棄（ログアウト）
 */
export function clearSessionCookie(): void {
  cookies().set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: isProductionEnv(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

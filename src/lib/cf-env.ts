import { getRequestContext } from '@cloudflare/next-on-pages';

export interface CloudflareRuntimeEnv {
  DB?: unknown;
  NEXTAUTH_SECRET?: string;
  MFA_ENCRYPTION_KEY?: string;
  NODE_ENV?: string;
  [key: string]: unknown;
}

/**
 * Cloudflare Pages Functions (getRequestContext) または Node.js (process.env) から
 * 実行時の環境変数およびバインディングを透過的に取得する
 */
export function getRuntimeEnv(): CloudflareRuntimeEnv {
  try {
    const ctx = getRequestContext();
    if (ctx && ctx.env) {
      return ctx.env as unknown as CloudflareRuntimeEnv;
    }
  } catch {
    // ローカル Node.js 環境やビルド時（RequestContext 外）では例外になるためフォールバック
  }
  return process.env as unknown as CloudflareRuntimeEnv;
}

/**
 * 環境変数を Cloudflare Pages 環境・Node.js process.env の双方から安全に取得する
 */
export function getEnvVar(key: string): string | undefined {
  const runtimeEnv = getRuntimeEnv();
  const val = runtimeEnv[key];
  if (typeof val === 'string' && val.length > 0) {
    return val;
  }
  return process.env[key];
}

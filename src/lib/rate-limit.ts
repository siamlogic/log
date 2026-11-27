// In-memory sliding window rate limiter
// Used to prevent brute-force attacks on sensitive endpoints like /api/auth/login

interface RateLimitRecord {
  timestamps: number[];
}

const MAX_ENTRIES = 10000;
const CLEANUP_INTERVAL_MS = 300000;
const rateLimitMap = new Map<string, RateLimitRecord>();
let lastCleanupTime = 0;

/**
 * 期限切れエントリの遅延クリーンアップ
 * (Cloudflare Workers Edge Runtime のグローバルスコープ setInterval 禁止規約に対応)
 */
function cleanupStaleEntries(now: number): void {
  if (now - lastCleanupTime < CLEANUP_INTERVAL_MS) return;
  lastCleanupTime = now;
  rateLimitMap.forEach((record, key) => {
    record.timestamps = record.timestamps.filter((t: number) => now - t < 60000);
    if (record.timestamps.length === 0) {
      rateLimitMap.delete(key);
    }
  });
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetMs: number;
}

export function checkRateLimit(
  identifier: string,
  maxRequests: number = 10,
  windowMs: number = 60000
): RateLimitResult {
  const safeId = typeof identifier === 'string' && identifier.length > 128 ? identifier.slice(0, 128) : (identifier || 'unknown');
  const now = Date.now();
  cleanupStaleEntries(now);
  let record = rateLimitMap.get(safeId);

  if (!record) {
    // 容量制限: 最大エントリ数を超過した場合は最古のエントリを削除
    if (rateLimitMap.size >= MAX_ENTRIES) {
      const oldestKey = rateLimitMap.keys().next().value;
      if (oldestKey) rateLimitMap.delete(oldestKey);
    }
    record = { timestamps: [] };
    rateLimitMap.set(safeId, record);
  } else {
    // Map の順序を最新にリフレッシュ (LRU動作)
    rateLimitMap.delete(safeId);
    rateLimitMap.set(safeId, record);
  }

  // Filter timestamps within current window
  record.timestamps = record.timestamps.filter((t) => now - t < windowMs);

  if (record.timestamps.length >= maxRequests) {
    const oldest = record.timestamps[0];
    const resetMs = Math.max(0, windowMs - (now - oldest));
    return {
      success: false,
      remaining: 0,
      resetMs,
    };
  }

  record.timestamps.push(now);
  return {
    success: true,
    remaining: maxRequests - record.timestamps.length,
    resetMs: windowMs,
  };
}

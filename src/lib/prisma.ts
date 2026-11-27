import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';
import { getRuntimeEnv } from './cf-env';

type D1Binding = ConstructorParameters<typeof PrismaD1>[0];

// @prisma/driver-adapter-utils ColumnTypeEnum 定義 (Text=7, DateTime=10)
const COLUMN_TYPE_TEXT = 7;
const COLUMN_TYPE_DATETIME = 10;

// Prisma スキーマ上で DateTime 型として定義されているカラム名一覧
// これ以外の自由記述 TEXT 列 (notes, activity_name 等) が ISO 日時文字列を含んでも DateTime と誤推論されないよう保護
const DATETIME_COLUMN_NAMES = new Set([
  'record_date',
  'created_at',
  'updated_at',
  'locked_until',
  'reset_expires_at',
  'memo_updated_at',
]);

export interface D1PreparedStatementLike {
  bind: (...values: unknown[]) => D1PreparedStatementLike;
}

export interface D1BatchResultLike {
  meta?: {
    changes?: number;
  };
}

export interface D1DatabaseLike {
  prepare: (query: string) => D1PreparedStatementLike;
  batch: <T = D1BatchResultLike>(statements: D1PreparedStatementLike[]) => Promise<T[]>;
}

/**
 * Prisma 5.22 SQLite / D1 driver adapter 互換の UTC 日時文字列 (秒精度・+00:00) を生成
 */
export function formatPrismaSqliteDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

class SchemaAwarePrismaD1 extends PrismaD1 {
  async queryRaw(query: Parameters<PrismaD1['queryRaw']>[0]) {
    const result = await super.queryRaw(query);
    return result.map((resultSet) => {
      for (let i = 0; i < resultSet.columnNames.length; i++) {
        if (
          resultSet.columnTypes[i] === COLUMN_TYPE_DATETIME &&
          !DATETIME_COLUMN_NAMES.has(resultSet.columnNames[i])
        ) {
          resultSet.columnTypes[i] = COLUMN_TYPE_TEXT;
        }
      }
      return resultSet;
    });
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  walConfirmed?: boolean;
  walInitPromise?: Promise<void> | null;
};

const d1ClientCache = new WeakMap<object, PrismaClient>();

function ensureLocalSqliteWal(client: PrismaClient): void {
  if (globalForPrisma.walConfirmed || globalForPrisma.walInitPromise) return;
  globalForPrisma.walInitPromise = (async () => {
    try {
      const rows = await client.$queryRawUnsafe<Array<{ journal_mode?: string }>>(
        'PRAGMA journal_mode = WAL;'
      );
      await client.$queryRawUnsafe('PRAGMA busy_timeout = 5000;');
      const mode =
        Array.isArray(rows) && rows[0] ? String(rows[0].journal_mode ?? '').toLowerCase() : '';
      if (mode === 'wal') {
        globalForPrisma.walConfirmed = true;
      }
    } catch {
      // ロック競合等で失敗した場合は次回呼び出し時に再試行
    } finally {
      globalForPrisma.walInitPromise = null;
    }
  })();
}

/**
 * Cloudflare D1 バインディングが存在する場合にネイティブ D1 インスタンスを返す
 * (ローカル SQLite 環境では null)
 */
export function getD1Binding(): D1DatabaseLike | null {
  const env = getRuntimeEnv();
  if (
    env.DB &&
    typeof env.DB === 'object' &&
    typeof (env.DB as D1DatabaseLike).prepare === 'function' &&
    typeof (env.DB as D1DatabaseLike).batch === 'function'
  ) {
    return env.DB as D1DatabaseLike;
  }
  return null;
}

function getLocalPrismaClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  ensureLocalSqliteWal(globalForPrisma.prisma);
  return globalForPrisma.prisma;
}

function getActivePrismaClient(): PrismaClient {
  const d1 = getD1Binding();
  if (d1) {
    const dbObj = d1 as unknown as object;
    let client = d1ClientCache.get(dbObj);
    if (!client) {
      const adapter = new SchemaAwarePrismaD1(dbObj as D1Binding);
      client = new PrismaClient({
        adapter,
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
      });
      d1ClientCache.set(dbObj, client);
    }
    return client;
  }
  return getLocalPrismaClient();
}

/**
 * ローカル SQLite (Node.js) と Cloudflare D1 (Pages Functions Edge) を
 * 実行時コンテキストに応じて自動的に切り替える透過的 Prisma Proxy
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getActivePrismaClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

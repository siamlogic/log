import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';
import { getRuntimeEnv } from './cf-env';

type D1Binding = ConstructorParameters<typeof PrismaD1>[0];

export interface D1PreparedStatementLike {
  bind: (...values: unknown[]) => D1PreparedStatementLike;
}

export interface D1DatabaseLike {
  prepare: (query: string) => D1PreparedStatementLike;
  batch: <T = unknown>(statements: D1PreparedStatementLike[]) => Promise<T[]>;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const d1ClientCache = new WeakMap<object, PrismaClient>();

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
  return globalForPrisma.prisma;
}

function getActivePrismaClient(): PrismaClient {
  const d1 = getD1Binding();
  if (d1) {
    const dbObj = d1 as unknown as object;
    let client = d1ClientCache.get(dbObj);
    if (!client) {
      const adapter = new PrismaD1(dbObj as D1Binding);
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

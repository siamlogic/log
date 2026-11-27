import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';
import { getRuntimeEnv } from './cf-env';

type D1Binding = ConstructorParameters<typeof PrismaD1>[0];

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const d1ClientCache = new WeakMap<object, PrismaClient>();

function getLocalPrismaClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return globalForPrisma.prisma;
}

function getActivePrismaClient(): PrismaClient {
  const env = getRuntimeEnv();
  if (env.DB && typeof env.DB === 'object') {
    const dbObj = env.DB as object;
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
 * (複数書込みの原子性を保つため、$transaction は配列バッチ形式を使用すること)
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getActivePrismaClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

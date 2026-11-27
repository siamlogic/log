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

function getActivePrismaClient(): { client: PrismaClient; isD1: boolean } {
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
    return { client, isD1: true };
  }
  return { client: getLocalPrismaClient(), isD1: false };
}

/**
 * ローカル SQLite (Node.js) と Cloudflare D1 (Pages Functions Edge) を
 * 実行時コンテキストに応じて自動的に切り替える透過的 Prisma Proxy
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const { client, isD1 } = getActivePrismaClient();

    if (prop === '$transaction') {
      return (arg: unknown, options?: unknown) => {
        // Cloudflare D1 ドライバアダプターは対話型トランザクション(BEGIN/COMMIT)非対応のため、
        // 関数型トランザクションのみ D1 上では逐次実行へフォールバックする（ローカル SQLite は厳密な ACID トランザクションを維持）
        if (isD1 && typeof arg === 'function') {
          return (arg as (tx: PrismaClient) => Promise<unknown>)(client);
        }
        return (client.$transaction as (...args: unknown[]) => unknown)(arg, options);
      };
    }

    const value = Reflect.get(client, prop, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

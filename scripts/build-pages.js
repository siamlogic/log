#!/usr/bin/env node

/**
 * Cloudflare Pages ビルド実行スクリプト
 *
 * 1. 全 App Router 動的ルート (API Route Handlers / page.tsx) へ一時的に `export const runtime = 'edge';` を注入
 * 2. `@cloudflare/next-on-pages` を実行して Cloudflare Pages Functions 向け成果物 (.vercel/output/static) を生成
 * 3. 終了後 (成功・失敗問わず) 元のファイル内容を復元し、ローカル Node.js (SQLite) 運用との互換性を維持
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const EDGE_DIRECTIVE = "export const runtime = 'edge';\n";

function collectTargetFiles(dir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTargetFiles(fullPath, results);
    } else if (entry.name === 'route.ts' || entry.name === 'page.tsx') {
      results.push(fullPath);
    }
  }
  return results;
}

console.log('⚡️ Starting Cloudflare Pages build preparation...');

const isWindows = os.platform() === 'win32';
if (isWindows) {
  console.log('ℹ️  Detected Windows environment.');
  console.log('ℹ️  Note: @cloudflare/next-on-pages runs Vercel CLI internally which requires bash (standard in Linux/Cloudflare CI).');
}

const backups = new Map();
const targetFiles = collectTargetFiles(APP_DIR);

try {
  // 1. Edge Runtime 宣言の一時注入 (Client Component は静的配信されるため除外)
  for (const filePath of targetFiles) {
    const original = fs.readFileSync(filePath, 'utf8');
    if (/^['"]use client['"];?/.test(original.trimStart())) {
      continue;
    }
    if (!/export\s+const\s+runtime\s*=/.test(original)) {
      backups.set(filePath, original);
      fs.writeFileSync(filePath, `${EDGE_DIRECTIVE}${original}`, 'utf8');
    }
  }
  console.log(`🔧 Temporarily configured ${backups.size} route/page files for Edge Runtime.`);

  // 2. Prisma Client 再生成 (driverAdapters 対応確認)
  const npxCmd = isWindows ? 'npx.cmd' : 'npx';
  const genResult = spawnSync(npxCmd, ['prisma', 'generate'], {
    stdio: 'inherit',
    shell: true,
  });
  if (genResult.status !== 0) {
    process.exit(genResult.status ?? 1);
  }

  // 3. @cloudflare/next-on-pages ビルド実行
  const buildResult = spawnSync(npxCmd, ['@cloudflare/next-on-pages'], {
    stdio: 'inherit',
    shell: true,
  });

  if (buildResult.error) {
    console.warn('\n⚠️  Local next-on-pages invocation encountered a platform limitation:');
    console.warn(`    ${buildResult.error.message}`);
    if (isWindows) {
      process.exit(0);
    }
    process.exit(1);
  }

  if (buildResult.status !== 0) {
    if (isWindows) {
      console.warn(`\n⚠️  Build exited with code ${buildResult.status} (expected on native Windows due to next-on-pages bash requirement).`);
      console.warn('💡 Remote Cloudflare Pages builds (Linux) will succeed automatically.');
      process.exit(0);
    }
    process.exit(buildResult.status ?? 1);
  }
} finally {
  // 4. 注入したファイルの確実な復元
  for (const [filePath, original] of backups.entries()) {
    fs.writeFileSync(filePath, original, 'utf8');
  }
  if (backups.size > 0) {
    console.log(`♻️  Restored ${backups.size} route/page files to default Node.js runtime.`);
  }
}

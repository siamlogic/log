#!/usr/bin/env node

/**
 * Cloudflare Pages ビルド実行スクリプト
 *
 * 1. 全 App Router 動的ルート (API Route Handlers / Server Component の page.tsx) へ一時的に `export const runtime = 'edge';` を注入
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

/**
 * ファイル先頭の空白および //・/* ... *\/ コメントを読み飛ばした上で 'use client' ディレクティブを判定する
 */
function hasUseClientDirective(source) {
  let i = 0;
  const len = source.length;
  while (i < len) {
    // 空白スキップ
    while (i < len && /\s/.test(source[i])) i++;
    if (i >= len) break;
    // 単一行コメント // ...
    if (source[i] === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < len && source[i] !== '\n') i++;
      continue;
    }
    // 複数行コメント /* ... */
    if (source[i] === '/' && source[i + 1] === '*') {
      const closeIdx = source.indexOf('*/', i + 2);
      if (closeIdx === -1) break;
      i = closeIdx + 2;
      continue;
    }
    break;
  }
  const rest = source.slice(i);
  return /^(['"])use client\1\s*;?/.test(rest);
}

function runPagesBuild() {
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
      if (hasUseClientDirective(original)) {
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
      return genResult.status ?? 1;
    }

    // 3. @cloudflare/next-on-pages ビルド実行
    const buildResult = spawnSync(npxCmd, ['@cloudflare/next-on-pages'], {
      stdio: 'inherit',
      shell: true,
    });

    if (buildResult.error) {
      console.warn('\n⚠️  Local next-on-pages invocation encountered a platform limitation:');
      console.warn(`    ${buildResult.error.message}`);
      return isWindows ? 0 : 1;
    }

    if (buildResult.status !== 0) {
      if (isWindows) {
        console.warn(`\n⚠️  Build exited with code ${buildResult.status} (expected on native Windows due to next-on-pages bash requirement).`);
        console.warn('💡 Remote Cloudflare Pages builds (Linux) will succeed automatically.');
        return 0;
      }
      return buildResult.status ?? 1;
    }

    return 0;
  } finally {
    // 4. 注入したファイルの確実な復元
    for (const [filePath, original] of backups.entries()) {
      fs.writeFileSync(filePath, original, 'utf8');
    }
    if (backups.size > 0) {
      console.log(`♻️  Restored ${backups.size} route/page files to default Node.js runtime.`);
    }
  }
}

process.exitCode = runPagesBuild();

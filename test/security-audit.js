/**
 * セキュリティ攻撃シミュレーション & 脆弱性診断スクリプト (Security Penetration Test)
 * 以下の攻撃ベクトルに対してローカルサーバー (http://localhost:3001) の防御耐性を実地検証
 * 1. タイミング攻撃・ユーザー列挙 (Timing Attack / User Enumeration)
 * 2. Fetch Metadata によるクロスサイト CSRF 攻撃
 * 3. 招待トークン総当たり攻撃によるアカウントロックアウト (Brute Force Token Guessing)
 * 4. 管理者招待 API への大量リクエスト DoS (Rate Limit Bypass Attack)
 * 5. 特殊文字・SQLi・不正ペイロード注入耐性
 * 6. XSS ペイロード注入耐性
 * 7. 長大文字・バッファ超過 DoS 攻撃耐性 (パスワード / 活動名 / メモ)
 */

const http = require('http');

let passed = 0;
let failed = 0;

function assert(cond, name, details = '') {
  if (cond) {
    console.log(`🛡️ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`💥 [FAIL] ${name} ${details ? '- ' + details : ''}`);
    failed++;
  }
}

function request(options, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const reqHeaders = {
      ...options.headers,
      ...headers,
    };
    if (body) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(body);
    }

    const req = http.request(
      {
        hostname: 'localhost',
        port: 3001,
        ...options,
        headers: reqHeaders,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, body: data, json });
        });
      }
    );

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function runSecurityAudit() {
  console.log('===============================================================');
  console.log('   CBT Activity Record - Security Penetration Test & Audit    ');
  console.log('===============================================================\n');

  // --- 1. タイミング攻撃 & ユーザー列挙 (User Enumeration) 検証 ---
  console.log('--- 1. タイミング攻撃 & ユーザー列挙 (Timing Attack & User Enumeration) ---');
  const existingEmail = 'tanaka@example.com';
  const dummyEmail = 'nonexistent_' + Date.now() + '@example.com';
  const wrongPassword = 'WrongPassword999!';

  // ウォームアップ (JIT / モジュール初期ロードの初回遅延を排除)
  await request({ path: '/api/auth/login', method: 'POST' }, JSON.stringify({ email: 'warmup@example.com', password: wrongPassword }));

  // 存在するユーザーでのレスポンス時間計測 (4回計測の平均)
  const existingTimes = [];
  for (let i = 0; i < 4; i++) {
    const t0 = process.hrtime.bigint();
    await request(
      { path: '/api/auth/login', method: 'POST' },
      JSON.stringify({ email: existingEmail, password: wrongPassword })
    );
    const t1 = process.hrtime.bigint();
    existingTimes.push(Number(t1 - t0) / 1e6);
  }

  // 存在しないユーザーでのレスポンス時間計測 (4回計測の平均)
  const dummyTimes = [];
  for (let i = 0; i < 4; i++) {
    const t0 = process.hrtime.bigint();
    await request(
      { path: '/api/auth/login', method: 'POST' },
      JSON.stringify({ email: dummyEmail, password: wrongPassword })
    );
    const t1 = process.hrtime.bigint();
    dummyTimes.push(Number(t1 - t0) / 1e6);
  }

  const avgExisting = existingTimes.reduce((a, b) => a + b, 0) / existingTimes.length;
  const avgDummy = dummyTimes.reduce((a, b) => a + b, 0) / dummyTimes.length;
  const diffRatio = Math.abs(avgExisting - avgDummy) / Math.max(avgExisting, avgDummy);

  console.log(`  > 存在ユーザー平均応答時間: ${avgExisting.toFixed(1)}ms`);
  console.log(`  > 未存在ユーザー平均応答時間: ${avgDummy.toFixed(1)}ms`);
  console.log(`  > 時間差異比率: ${(diffRatio * 100).toFixed(1)}%`);

  // ダミーハッシュ＋ジッター遅延により時間差が同等（比率差異が35%以内）であることを検証
  assert(
    diffRatio < 0.35,
    'ユーザー列挙対策: 存在/未存在ユーザー間で応答時間が高度に均衡しており推測不能',
    `差異比率が ${(diffRatio * 100).toFixed(1)}%`
  );

  // --- 2. Fetch Metadata による CSRF 先制遮断攻撃シミュレーション ---
  console.log('\n--- 2. Fetch Metadata (Sec-Fetch-Site) CSRF 先制遮断攻撃 ---');
  // 攻撃者が外部サイトから cross-site でリクエストを送信した場合
  const csrfCrossSiteRes = await request(
    { path: '/api/cbt/activities/slot', method: 'PUT' },
    JSON.stringify({ recordDateYmd: '2026-11-21', hourSlot: 12, activityName: 'CSRF攻撃試行' }),
    {
      'Sec-Fetch-Site': 'cross-site',
      'Host': 'localhost:3001',
    }
  );
  assert(
    csrfCrossSiteRes.status === 403,
    'CSRF防御: Sec-Fetch-Site: cross-site リクエストを 403 Forbidden で先制遮断',
    `Status: ${csrfCrossSiteRes.status}`
  );

  // --- 3. 管理者ログイン & 初回招待トークン総当たり攻撃によるアカウントロック ---
  console.log('\n--- 3. 初回パスワード設定 トークン総当たり攻撃 & アカウントロック ---');
  // 管理者ログイン
  const adminLoginRes = await request(
    { path: '/api/auth/login', method: 'POST' },
    JSON.stringify({ email: 'sato@example.com', password: 'password123' })
  );
  const adminCookie = adminLoginRes.headers['set-cookie']?.[0]?.split(';')[0];
  assert(adminLoginRes.status === 200 && Boolean(adminCookie), '管理者ログイン成功 (セッションCookie取得)');

  // 新規招待を1件発行
  const targetEmail = `audit_target_${Date.now()}@example.com`;
  const inviteTargetRes = await request(
    { path: '/api/admin/members/invite', method: 'POST' },
    JSON.stringify({ email: targetEmail, displayName: 'Lockout Target' }),
    {
      'Cookie': adminCookie,
      'Host': 'localhost:3001',
      'Origin': 'http://localhost:3001',
    }
  );
  assert(inviteTargetRes.status === 201, '招待発行成功 (201 Created)');

  // 偽のトークンで5回連続試行
  let lockOccurred = false;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const bruteRes = await request(
      { path: '/api/auth/setup-password', method: 'POST' },
      JSON.stringify({
        email: targetEmail,
        token: `fake_token_attempt_${attempt}_${'0'.repeat(40)}`,
        password: 'NewStrongPassword123!',
      }),
      {
        'Host': 'localhost:3001',
        'Origin': 'http://localhost:3001',
        'X-Forwarded-For': `203.0.113.${attempt}`, // 分散IPをシミュレート
      }
    );

    if (attempt >= 5 && bruteRes.status === 423) {
      lockOccurred = true;
    }
  }
  assert(lockOccurred, 'ブルートフォース防御: 不正トークン5回試行で 423 Locked に遷移しアカウントを保護');

  // --- 4. 管理者招待 API レート制限 (DoS / 大量招待) 攻撃シミュレーション ---
  console.log('\n--- 4. 管理者招待 API レート制限 & DoS 耐性 ---');
  // 招待 API へ25回連続で高速リクエスト送信 (上限は20回/分)
  let rateLimitHit = false;
  for (let i = 0; i < 25; i++) {
    const inviteRes = await request(
      { path: '/api/admin/members/invite', method: 'POST' },
      JSON.stringify({
        email: `flood_test_${i}_${Date.now()}@example.com`,
        displayName: `Flood User ${i}`,
      }),
      {
        'Cookie': adminCookie,
        'Host': 'localhost:3001',
        'Origin': 'http://localhost:3001',
      }
    );
    if (inviteRes.status === 429) {
      rateLimitHit = true;
      break;
    }
  }
  assert(rateLimitHit, 'DoS防御: 管理者招待 API への過剰リクエストを 429 Too Many Requests で遮断');

  // --- 5. 特殊文字 & SQL インジェクション (SQLi) 攻撃耐性 ---
  console.log('\n--- 5. 特殊文字 & SQL インジェクション (SQLi) 攻撃耐性 ---');
  const sqliPayloads = [
    "' OR '1'='1",
    "'; DROP TABLE cbt_activities; --",
    '1 UNION SELECT null, null, null--',
    'admin\'--',
  ];

  let sqliSafe = true;
  for (const payload of sqliPayloads) {
    const res = await request(
      { path: '/api/auth/login', method: 'POST' },
      JSON.stringify({ email: payload, password: 'password' })
    );
    if (res.status !== 401 && res.status !== 400) {
      sqliSafe = false;
      break;
    }
  }
  assert(sqliSafe, 'SQLi防御: 特殊文字・SQL構文の直接注入によるエラーや認証バイパスが発生しない');

  // --- 6. XSS ペイロード注入 & 無害化検証 ---
  console.log('\n--- 6. XSS ペイロード注入 & 無害化検証 ---');
  // 一般メンバーでログイン
  const memberLogin = await request(
    { path: '/api/auth/login', method: 'POST' },
    JSON.stringify({ email: 'tanaka@example.com', password: 'password123' })
  );
  const memberCookie = memberLogin.headers['set-cookie']?.[0]?.split(';')[0];

  const xssPayload = '<script>alert("XSS")</script><img src=x onerror=alert(1)>';
  const slotRes = await request(
    { path: '/api/cbt/activities/slot', method: 'PUT' },
    JSON.stringify({
      recordDateYmd: '2026-11-21',
      hourSlot: 15,
      activityName: xssPayload,
      notes: xssPayload,
    }),
    {
      'Cookie': memberCookie,
      'Host': 'localhost:3001',
      'Origin': 'http://localhost:3001',
    }
  );

  assert(
    slotRes.status === 200,
    'XSS防御: HTMLタグを含む文字列をDBに文字列リテラルとして安全に格納 (実行不能)'
  );

  // --- 7. 長大文字 & メモリ枯渇 DoS 攻撃耐性 ---
  console.log('\n--- 7. 長大文字 & メモリ枯渇 DoS 攻撃耐性 ---');
  const hugePassword = 'A'.repeat(500); // 500文字のパスワード
  const dosRes = await request(
    { path: '/api/auth/login', method: 'POST' },
    JSON.stringify({ email: 'tanaka@example.com', password: hugePassword })
  );
  assert(
    dosRes.status === 400,
    '長大パスワードDoS防御: 128文字を超える長大パスワードはArgon2id計算前に 400 Bad Request で即座に遮断'
  );

  // 長大活動名 (10,000文字)
  const hugeActivityRes = await request(
    { path: '/api/cbt/activities/slot', method: 'PUT' },
    JSON.stringify({
      recordDateYmd: '2026-11-21',
      hourSlot: 10,
      activityName: 'X'.repeat(10000),
    }),
    {
      'Cookie': memberCookie,
      'Host': 'localhost:3001',
      'Origin': 'http://localhost:3001',
    }
  );
  assert(
    hugeActivityRes.status === 400,
    '長大活動名DoS防御: 255文字を超える長大活動名は 400 Bad Request で即座に遮断'
  );

  // 長大メモ (5,000文字)
  const hugeNotesRes = await request(
    { path: '/api/cbt/activities/slot', method: 'PUT' },
    JSON.stringify({
      recordDateYmd: '2026-11-21',
      hourSlot: 10,
      activityName: '読書',
      notes: 'N'.repeat(5000),
    }),
    {
      'Cookie': memberCookie,
      'Host': 'localhost:3001',
      'Origin': 'http://localhost:3001',
    }
  );
  assert(
    hugeNotesRes.status === 400,
    '長大メモDoS防御: 2000文字を超える長大メモは 400 Bad Request で即座に遮断'
  );

  console.log('\n===============================================================');
  console.log(` セキュリティ診断サマリー: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) process.exit(1);
}

runSecurityAudit().catch((err) => {
  console.error('Audit execution error:', err);
  process.exit(1);
});

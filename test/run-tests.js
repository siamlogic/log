// CBT Activity Record System - Complete Automated Test Suite
// Covers Authentication, Security Headers, Rate Limiting, RBAC/DAL Isolation, Data Leakage Prevention, and CBT Operations

const http = require('http');
const crypto = require('crypto');
const { execSync } = require('child_process');

function generateTestTOTP(secretBase32, timeStep) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secretBase32.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const key = Buffer.from(bytes);
  const step = timeStep ?? Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step), 0);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return code.toString().padStart(6, '0');
}

function request(options, body = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const headers = { ...options.headers };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    if (cookie) {
      headers['Cookie'] = cookie;
    }

    const req = http.request({ ...options, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: json || data,
          setCookie: res.headers['set-cookie'],
        });
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function runTests() {
  console.log('======================================================');
  console.log('   CBT Activity Record System - Automated Test Suite  ');
  console.log('======================================================\n');

  // テスト実行前のDB初期化（決定論的テスト保証）
  try {
    execSync('node prisma/seed.js', { stdio: 'ignore' });
    console.log('Database seeded for clean test execution.\n');
  } catch (err) {
    console.error('Failed to seed DB before test:', err);
  }

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
      failed++;
    }
  }

  // --- 1. Security Headers & DLP (Data Leakage Prevention) ---
  console.log('--- 1. Security Headers & Non-Functional Verification ---');
  const headersRes = await request({
    hostname: 'localhost',
    port: 3001,
    path: '/api/auth/me',
    method: 'GET',
  });
  assert(headersRes.headers['x-frame-options'] === 'DENY', 'Security Header: X-Frame-Options is DENY');
  assert(headersRes.headers['x-content-type-options'] === 'nosniff', 'Security Header: X-Content-Type-Options is nosniff');
  assert(
    headersRes.headers['cache-control'] && headersRes.headers['cache-control'].includes('no-store'),
    'Security Header: Cache-Control is no-store (Prevents PHI browser caching)'
  );

  // --- 2. Authentication & Account Protection ---
  console.log('\n--- 2. Authentication & Account Lockout ---');
  // 2-1. Member Login
  const loginRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/login', method: 'POST' },
    JSON.stringify({ email: 'tanaka@example.com', password: 'password123' })
  );
  assert(loginRes.statusCode === 200 && loginRes.data.user.email === 'tanaka@example.com', 'Member login succeeds (200 OK)');
  const memberCookie = loginRes.setCookie ? loginRes.setCookie[0].split(';')[0] : null;
  assert(Boolean(memberCookie), 'Session cookie issued');

  // 2-2. Bad Password
  const failRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/login', method: 'POST' },
    JSON.stringify({ email: 'tanaka@example.com', password: 'wrongpassword' })
  );
  assert(failRes.statusCode === 401, 'Invalid credentials rejected with 401');

  // 2-3. Account Lockout
  const lockRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/login', method: 'POST' },
    JSON.stringify({ email: 'locked@example.com', password: 'password123' })
  );
  assert(lockRes.statusCode === 423, 'Locked account returns 423 Locked');

  // 2-4. 2FA MFA Challenge
  const mfaRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/login', method: 'POST' },
    JSON.stringify({ email: '2fa@example.com', password: 'password123' })
  );
  assert(mfaRes.data.requireMfa === true, '2FA user triggers requireMfa challenge');

  // 2-5. 2FA RFC 6238 TOTP Code Verification
  const validTotp = generateTestTOTP('JBSWY3DPEHPK3PXP');
  const mfaSuccessRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/login', method: 'POST' },
    JSON.stringify({ email: '2fa@example.com', password: 'password123', mfaCode: validTotp })
  );
  assert(mfaSuccessRes.statusCode === 200 && mfaSuccessRes.data.user.email === '2fa@example.com', 'RFC 6238 TOTP code verification succeeds (200 OK)');

  // 2-6. 2FA Replay Attack Prevention
  const replayRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/login', method: 'POST' },
    JSON.stringify({ email: '2fa@example.com', password: 'password123', mfaCode: validTotp })
  );
  assert(replayRes.statusCode === 401 && replayRes.data.error.includes('リプレイ'), '2FA Replay Attack Blocked: Reusing identical step code is rejected');

  // 2-7. 2FA Invalid Code Rejection
  const invalidTotpRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/login', method: 'POST' },
    JSON.stringify({ email: '2fa@example.com', password: 'password123', mfaCode: '000000' })
  );
  assert(invalidTotpRes.statusCode === 401, '2FA Invalid code rejected with 401');

  // 2-8. 2FA Recovery Code Verification (A8F2-9K1M)
  const recoverySuccessRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/login', method: 'POST' },
    JSON.stringify({ email: '2fa@example.com', password: 'password123', mfaCode: 'A8F2-9K1M' })
  );
  assert(recoverySuccessRes.statusCode === 200 && recoverySuccessRes.data.user.email === '2fa@example.com', '2FA Recovery code succeeds (200 OK)');

  // 2-9. 2FA Recovery Code Single-Use Rejection (Code is now burned)
  const reuseRecoveryRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/login', method: 'POST' },
    JSON.stringify({ email: '2fa@example.com', password: 'password123', mfaCode: 'A8F2-9K1M' })
  );
  assert(reuseRecoveryRes.statusCode === 401, '2FA Single-Use Recovery Code: Burned code cannot be reused (401)');

  // --- 3. CBT Member Activities & Clinical Integrity ---
  console.log('\n--- 3. CBT Weekly Sheet & Clinical Data Integrity ---');
  const weekRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/cbt/activities/week?monday=2026-10-12', method: 'GET' },
    null,
    memberCookie
  );
  assert(weekRes.statusCode === 200 && weekRes.data.days.wed.slots[13] !== undefined, 'GET week activities returns Wednesday recorded slots');
  assert(weekRes.data.days.wed.slots[10].moodScore === null, 'Clinical Safety: Rest/sleep slot has moodScore: null (no default 0.00)');

  // Slot Save (PUT)
  const slotUpdateRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/cbt/activities/slot', method: 'PUT' },
    JSON.stringify({
      recordDateYmd: '2026-10-12',
      hourSlot: 10,
      activityName: '散歩と読書',
      moodScore: 0.75,
      moodRawLevel: 3,
      moodDisplaySymbol: '🌤️',
      notes: '気分良好',
    }),
    memberCookie
  );
  assert(slotUpdateRes.statusCode === 200 && slotUpdateRes.data.activityName === '散歩と読書', 'PUT slot updates activity and mood snapshot');

  // Multi-Slot Activity Range (POST /api/cbt/activities/range)
  const rangeRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/cbt/activities/range', method: 'POST' },
    JSON.stringify({
      startDateYmd: '2026-10-15', // 木曜日
      startHourSlot: 23,          // 23:00 就寝
      durationHours: 8,           // 8時間（翌金曜 07:00 まで日跨ぎ）
      activityName: '就寝',
      moodScore: null,            // 臨床原則: 睡眠は気分未入力 (NULL)
      moodRawLevel: null,
      moodDisplaySymbol: null,
      overwriteNonEmpty: true,
      allowFirstSlotOverwrite: true,
    }),
    memberCookie
  );
  assert(
    rangeRes.statusCode === 200 && rangeRes.data.success === true && rangeRes.data.appliedCount === 8,
    'POST range applies 8 consecutive slots across midnight with null mood score'
  );

  // Range Verification across midnight: Check Fri 0:00 - 6:00
  const verifyRangeRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/cbt/activities/week?monday=2026-10-12', method: 'GET' },
    null,
    memberCookie
  );
  const thu23 = verifyRangeRes.data.days.thu.slots[23];
  const fri0 = verifyRangeRes.data.days.fri.slots[0];
  const fri6 = verifyRangeRes.data.days.fri.slots[6];
  assert(
    thu23?.activityName === '就寝' && fri0?.activityName === '就寝' && fri6?.activityName === '就寝' && fri0?.moodScore === null,
    'Midnight Rollover: Sleep spans Thursday 23:00 into Friday 0:00-6:00 correctly with mood: null'
  );

  // Mood Config
  const moodRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/cbt/mood-config', method: 'GET' },
    null,
    memberCookie
  );
  assert(moodRes.statusCode === 200 && moodRes.data.emotionLabel === '気分の良さ', 'GET mood config returns clinical emotion label');

  // Preset Templates
  const tplRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/cbt/templates', method: 'GET' },
    null,
    memberCookie
  );
  assert(tplRes.statusCode === 200 && tplRes.data.length >= 4, 'GET templates returns preset lifestyle routines');

  // --- 4. Admin Operations & Zero Trust Isolation ---
  console.log('\n--- 4. Admin Operations & Zero Trust Access Isolation ---');
  // 4-1. Member tries to access Admin route (Forbidden)
  const idorRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/admin/members', method: 'GET' },
    null,
    memberCookie
  );
  assert(idorRes.statusCode === 403, 'RBAC Guard: Member access to /api/admin/members is BLOCKED (403 Forbidden)');

  // 4-2. Admin Login
  const adminLoginRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/login', method: 'POST' },
    JSON.stringify({ email: 'sato@example.com', password: 'password123' })
  );
  const adminCookie = adminLoginRes.setCookie[0].split(';')[0];
  assert(adminLoginRes.statusCode === 200 && adminLoginRes.data.user.role === 'admin', 'Doctor/Admin login succeeds');

  // 4-3. Admin gets assigned members
  const adminMembersRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/admin/members', method: 'GET' },
    null,
    adminCookie
  );
  assert(adminMembersRes.statusCode === 200 && adminMembersRes.data.length >= 3, 'Admin gets assigned members list with status');

  // 4-4. Admin updates confidential note
  const memoRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/admin/members/member-1/memo', method: 'PUT' },
    JSON.stringify({ adminMemo: '週末の面談に向けて散歩習慣の継続を確認。' }),
    adminCookie
  );
  assert(memoRes.statusCode === 200 && memoRes.data.ok === true, 'Admin updates confidential clinical memo');

  // 4-5. Zero-Trust Leakage Check: Member CANNOT see adminMemo
  const leakCheckRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/cbt/activities/week?monday=2026-10-12', method: 'GET' },
    null,
    memberCookie
  );
  const leakCheckJson = JSON.stringify(leakCheckRes.data);
  assert(
    !leakCheckJson.includes('adminMemo') && !leakCheckJson.includes('散歩習慣の継続を確認'),
    'ZERO TRUST DAL: Confidential admin_memo is NEVER present in member payload'
  );

  // 4-6. Admin IDOR Check: Admin cannot access member they are NOT assigned to
  const unassignedRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/admin/members/unassigned-member-999/memo', method: 'PUT' },
    JSON.stringify({ adminMemo: '不正アクセス試行' }),
    adminCookie
  );
  assert(unassignedRes.statusCode === 404 || unassignedRes.statusCode === 403, 'Admin IDOR Guard: Blocked from unassigned member data');

  // 4-7. Admin Member Visibility Toggle (memo.txt L9)
  const hideRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/admin/members/member-2/visibility', method: 'PATCH' },
    JSON.stringify({ isVisible: false }),
    adminCookie
  );
  assert(hideRes.statusCode === 200, 'Admin can toggle member visibility to hidden (isVisible: false)');

  const listVisibleOnlyRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/admin/members', method: 'GET' },
    null,
    adminCookie
  );
  const isMember2Hidden = !listVisibleOnlyRes.data.some((m) => m.id === 'member-2');
  assert(isMember2Hidden, 'GET /api/admin/members excludes hidden member when includeHidden is false');

  const restoreVisRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/admin/members/member-2/visibility', method: 'PATCH' },
    JSON.stringify({ isVisible: true }),
    adminCookie
  );
  assert(restoreVisRes.statusCode === 200, 'Admin can restore member visibility (isVisible: true)');

  // --- 5. Member Provisional Registration & Initial Password Setup (memo.txt L8) ---
  console.log('\n--- 5. Member Invite & Password Setup Flow (memo.txt L8) ---');
  // 5-1. Admin invites / provisionally registers member
  const testInviteEmail = `invited-${Date.now()}@example.com`;
  const inviteRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/admin/members/invite', method: 'POST' },
    JSON.stringify({
      email: testInviteEmail,
      displayName: 'テスト仮登録メンバー',
      supportStatus: 'active',
    }),
    adminCookie
  );
  assert(inviteRes.statusCode === 201 && Boolean(inviteRes.data.inviteToken), 'Admin invites member and receives secure 48h invite token (201 Created)');
  const inviteToken = inviteRes.data.inviteToken;

  // 5-2. Duplicate invite rejected
  const dupInviteRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/admin/members/invite', method: 'POST' },
    JSON.stringify({
      email: testInviteEmail,
      displayName: '重複メンバー',
    }),
    adminCookie
  );
  assert(dupInviteRes.statusCode === 409, 'Duplicate member invitation rejected with 409 Conflict');

  // 5-3. Member setup password with invalid token rejected
  const badTokenRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/setup-password', method: 'POST' },
    JSON.stringify({
      email: testInviteEmail,
      token: 'invalid-token-1234567890abcdef',
      password: 'newSecurePassword123',
    })
  );
  assert(badTokenRes.statusCode === 401, 'Password setup with invalid token rejected (401)');

  // 5-4. Member setup password succeeds and starts active operation
  const setupRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/setup-password', method: 'POST' },
    JSON.stringify({
      email: testInviteEmail,
      token: inviteToken,
      password: 'newSecurePassword123',
    })
  );
  assert(setupRes.statusCode === 200 && setupRes.data.success === true, 'Member sets password with valid token and starts operation (200 OK)');
  const newMemberCookie = setupRes.setCookie ? setupRes.setCookie[0].split(';')[0] : null;
  assert(Boolean(newMemberCookie), 'Session cookie issued upon password setup');

  // 5-5. New member logs in with the newly set password
  const newLoginRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/login', method: 'POST' },
    JSON.stringify({
      email: testInviteEmail,
      password: 'newSecurePassword123',
    })
  );
  assert(newLoginRes.statusCode === 200 && newLoginRes.data.user.email === testInviteEmail, 'Newly registered member logs in with Argon2id password (200 OK)');

  // 5-6. Single-use token: Reusing token is rejected
  const reuseTokenRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/setup-password', method: 'POST' },
    JSON.stringify({
      email: testInviteEmail,
      token: inviteToken,
      password: 'anotherPassword456',
    })
  );
  assert(reuseTokenRes.statusCode === 400, 'Burned invite token cannot be reused (400)');

  // --- 6. Adversarial Review Fix Verification ---
  console.log('\n--- 6. Adversarial Review Fix Verification ---');

  // 6-1. SEC-03: Session Revocation upon Logout
  const tempLoginRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/login', method: 'POST' },
    JSON.stringify({ email: 'suzuki@example.com', password: 'password123' })
  );
  const tempCookie = tempLoginRes.setCookie ? tempLoginRes.setCookie[0].split(';')[0] : null;
  assert(Boolean(tempCookie), 'SEC-03: Temp login succeeded and cookie issued');

  // ログアウト実行
  const logoutRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/logout', method: 'POST' },
    null,
    tempCookie
  );
  assert(logoutRes.statusCode === 200, 'SEC-03: Logout succeeded (200 OK)');

  // ログアウト前の古いCookieで /api/auth/me にアクセス (tokenVersion不整合で即時失効拒絶)
  const deadSessionRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/me', method: 'GET' },
    null,
    tempCookie
  );
  assert(deadSessionRes.statusCode === 401, 'SEC-03: Dead session token is immediately revoked on server (401 Unauthorized)');

  // 6-2. CLN-02: Weekly Copy requires Monday
  const nonMondayWeekCopyRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/cbt/copy/week', method: 'POST' },
    JSON.stringify({
      sourceMondayYmd: '2026-10-14', // 水曜日
      targetMondayYmd: '2026-10-19',
    }),
    memberCookie
  );
  assert(
    nonMondayWeekCopyRes.statusCode === 400 && nonMondayWeekCopyRes.data.error.includes('月曜日'),
    'CLN-02: Week copy rejects non-Monday source date (400 Bad Request)'
  );

  // 6-3. CLN-03: Invalid Calendar Date Rejected
  const invalidDateRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/cbt/activities/slot', method: 'PUT' },
    JSON.stringify({
      recordDateYmd: '2026-02-31', // 実在しない日付
      hourSlot: 12,
      activityName: '不正日付テスト',
    }),
    memberCookie
  );
  assert(
    invalidDateRes.statusCode === 400,
    'CLN-03: Non-existent calendar date (2026-02-31) is rejected with 400 Bad Request'
  );

  // 6-4. SEC-06: Huge Password Rejected
  const hugePasswordRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/setup-password', method: 'POST' },
    JSON.stringify({
      email: 'tanaka@example.com',
      token: 'some-token',
      password: 'A'.repeat(200), // 128文字超過
    })
  );
  assert(
    hugePasswordRes.statusCode === 400 && hugePasswordRes.data.error.includes('128文字'),
    'SEC-06: Passwords exceeding 128 characters are rejected for DoS protection (400)'
  );

  // 6-5. SEC-01: 2FA MFA Code Brute-force triggers 423 Lockout
  for (let i = 0; i < 4; i++) {
    await request(
      { hostname: 'localhost', port: 3001, path: '/api/auth/login', method: 'POST' },
      JSON.stringify({ email: '2fa@example.com', password: 'password123', mfaCode: '000000' })
    );
  }
  const lockTriggerRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/login', method: 'POST' },
    JSON.stringify({ email: '2fa@example.com', password: 'password123', mfaCode: '000000' })
  );
  assert(
    lockTriggerRes.statusCode === 423 && lockTriggerRes.data.locked === true,
    'SEC-01: 2FA code brute-force (5 consecutive failures) triggers 423 Account Lockout'
  );

  // 6-6. SEC-202: Template apply date array limit (DoS protection)
  const hugeDates = Array.from({ length: 32 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
  const hugeTemplateRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/cbt/templates/apply', method: 'POST' },
    JSON.stringify({ templateId: 'tpl-1', targetDatesYmd: hugeDates }),
    memberCookie
  );
  assert(
    hugeTemplateRes.statusCode === 400 && hugeTemplateRes.data.error.includes('31日以内'),
    'SEC-202: Template apply rejects arrays over 31 days (400 DoS Protection)'
  );

  // 6-7. SEC-204: Mood config boundary & style enum validation
  const badMoodConfigRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/cbt/mood-config', method: 'PUT' },
    JSON.stringify({ emotionLabel: 'テスト', styleType: 'invalid_style', scaleSteps: 99 }),
    memberCookie
  );
  assert(
    badMoodConfigRes.statusCode === 400,
    'SEC-204: Mood config rejects invalid styleType and out-of-range scaleSteps (400 Bad Request)'
  );

  // 6-8. SEC-205: Admin member visibility rejects invalid supportStatus
  const badStatusRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/admin/members/member-1/visibility', method: 'PATCH' },
    JSON.stringify({ supportStatus: 'invalid_hacked_status' }),
    adminCookie
  );
  assert(
    badStatusRes.statusCode === 400,
    'SEC-205: Visibility update rejects invalid supportStatus enum (400 Bad Request)'
  );

  // 6-9. SEC-401: 2FA TOTP replay attack does NOT bypass lockout (triggers 423 Lockout upon repeated attempts)
  // seed で佐藤（2fa@example.com）は 6-5 でロックされているので、別の2FAテストまたはDBリセット後の検証
  // ここでは別の新規招待ユーザーまたは初期化済みユーザーでテスト可能
  const mfaReplayCheckRes = await request(
    { hostname: 'localhost', port: 3001, path: '/api/auth/login', method: 'POST' },
    JSON.stringify({ email: '2fa@example.com', password: 'password123', mfaCode: '123456' })
  );
  assert(
    mfaReplayCheckRes.statusCode === 423 && mfaReplayCheckRes.data.locked === true,
    'SEC-401: Replay or invalid 2FA attempts keep locked status enforced (423)'
  );

  // 6-10. SEC-502: CSRF Cross-Origin Request Blocked
  const csrfRes = await request(
    {
      hostname: 'localhost',
      port: 3001,
      path: '/api/cbt/activities/slot',
      method: 'PUT',
      headers: {
        'Origin': 'https://evil-attacker.com',
        'Host': 'localhost:3001',
      },
    },
    JSON.stringify({
      recordDateYmd: '2026-11-18',
      hourSlot: 10,
      activityName: 'CSRF攻撃テスト',
    }),
    memberCookie
  );
  assert(
    csrfRes.statusCode === 403 && csrfRes.data.error.includes('CSRF'),
    'SEC-502: Cross-origin mutation request is blocked by Same-Origin check (403 Forbidden)'
  );

  console.log(`\n======================================================`);
  console.log(` Test Summary: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================`);

  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error('Test execution error:', e);
  process.exit(1);
});

import crypto from 'crypto';

function getMasterKeyBuffer(): Buffer {
  const envKey = process.env.MFA_ENCRYPTION_KEY;
  if (!envKey || envKey.length !== 64) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: MFA_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes) in production.');
    }
    return Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
  }
  return Buffer.from(envKey, 'hex');
}

/**
 * Base32 デコード (RFC 4648)
 */
export function base32Decode(base32: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = base32.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    if (idx === -1) throw new Error(`Invalid Base32 character: ${clean[i]}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * Base32 エンコード (RFC 4648)
 */
export function base32Encode(buffer: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

/**
 * AES-256-GCM による MFA 秘密鍵の暗号化
 * 出力形式: v1:ivHex:tagHex:encryptedHex (将来の鍵ローテーション対応)
 */
export function encryptMfaSecret(secret: string): string {
  const masterKey = getMasterKeyBuffer();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * AES-256-GCM による MFA 秘密鍵の復号
 */
export function decryptMfaSecret(encryptedPayload: string): string {
  const masterKey = getMasterKeyBuffer();
  const parts = encryptedPayload.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted MFA secret format.');
  }
  const [version, ivHex, tagHex, dataHex] = parts;
  if (version !== 'v1') {
    throw new Error(`Unsupported encryption version: ${version}`);
  }
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * RFC 6238 準拠の TOTP コード生成 (6桁、30秒ステップ、HMAC-SHA1)
 */
export function generateTOTP(secretBase32: string, timeStep?: number): string {
  const step = timeStep ?? Math.floor(Date.now() / 1000 / 30);
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step), 0);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return code.toString().padStart(6, '0');
}

/**
 * RFC 6238 準拠の TOTP 検証
 * - 許容範囲: 前後 ±1 ステップ (計 90 秒)
 * - リプレイ攻撃防止: 最後に検証されたステップ (lastTotpStep) 以下のステップは再利用拒否
 */
export function verifyTOTP(
  secretBase32: string,
  token: string,
  lastTotpStep?: bigint | number | null
): { valid: boolean; verifiedStep?: bigint; error?: string } {
  const cleanedToken = token.trim().replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleanedToken)) {
    return { valid: false, error: '6桁の数字を入力してください' };
  }

  const currentStep = Math.floor(Date.now() / 1000 / 30);
  const stepsToCheck = [currentStep, currentStep - 1, currentStep + 1];

  for (const step of stepsToCheck) {
    const expected = generateTOTP(secretBase32, step);
    const expectedBuf = Buffer.from(expected);
    const tokenBuf = Buffer.from(cleanedToken);

    if (tokenBuf.length === expectedBuf.length && crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
      const stepBigInt = BigInt(step);
      if (lastTotpStep !== null && lastTotpStep !== undefined) {
        const lastStepBigInt = BigInt(lastTotpStep);
        if (stepBigInt <= lastStepBigInt) {
          return {
            valid: false,
            error: 'この認証コードは既に使用されています。次のコードが生成されるまでお待ちください（リプレイ攻撃防止）。',
          };
        }
      }
      return { valid: true, verifiedStep: stepBigInt };
    }
  }

  return { valid: false, error: '認証コードが正しくありません' };
}

/**
 * リカバリーコードの SHA-256 ハッシュ生成
 */
export function hashRecoveryCode(code: string): string {
  const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * リカバリーコードの検証 (使い捨て型)
 */
export function verifyRecoveryCode(
  code: string,
  storedCodesJson: string | null
): { valid: boolean; remainingHashesJson?: string } {
  if (!storedCodesJson) return { valid: false };
  try {
    const hashes: string[] = JSON.parse(storedCodesJson);
    if (!Array.isArray(hashes) || hashes.length === 0) return { valid: false };

    const inputHash = hashRecoveryCode(code);
    const index = hashes.findIndex((h) => {
      const hBuf = Buffer.from(h, 'hex');
      const inBuf = Buffer.from(inputHash, 'hex');
      return hBuf.length === inBuf.length && crypto.timingSafeEqual(hBuf, inBuf);
    });

    if (index === -1) return { valid: false };

    // 使用済みコードを消費（除外）
    const remaining = hashes.filter((_, i) => i !== index);
    return { valid: true, remainingHashesJson: JSON.stringify(remaining) };
  } catch {
    return { valid: false };
  }
}

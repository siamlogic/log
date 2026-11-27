import { getEnvVar } from './cf-env';
import {
  aes256GcmDecrypt,
  aes256GcmEncrypt,
  hexToBytes,
  hmacBytes,
  sha256Hex,
  timingSafeEqualStr,
} from './web-crypto';

function getMasterKeyBytes(): Uint8Array {
  const envKey = getEnvVar('MFA_ENCRYPTION_KEY');
  const nodeEnv = getEnvVar('NODE_ENV') ?? process.env.NODE_ENV;
  if (!envKey || envKey.length !== 64) {
    if (nodeEnv === 'production') {
      throw new Error('FATAL: MFA_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes) in production.');
    }
    return hexToBytes('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  }
  return hexToBytes(envKey);
}

/**
 * Base32 デコード (RFC 4648)
 */
export function base32Decode(base32: string): Uint8Array {
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
  return new Uint8Array(bytes);
}

/**
 * Base32 エンコード (RFC 4648)
 */
export function base32Encode(buffer: Uint8Array): string {
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
export async function encryptMfaSecret(secret: string): Promise<string> {
  const masterKey = getMasterKeyBytes();
  const { ivHex, tagHex, dataHex } = await aes256GcmEncrypt(masterKey, secret);
  return `v1:${ivHex}:${tagHex}:${dataHex}`;
}

/**
 * AES-256-GCM による MFA 秘密鍵の復号
 */
export async function decryptMfaSecret(encryptedPayload: string): Promise<string> {
  const masterKey = getMasterKeyBytes();
  const parts = encryptedPayload.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted MFA secret format.');
  }
  const [version, ivHex, tagHex, dataHex] = parts;
  if (version !== 'v1') {
    throw new Error(`Unsupported encryption version: ${version}`);
  }
  return aes256GcmDecrypt(masterKey, ivHex, tagHex, dataHex);
}

/**
 * RFC 6238 準拠の TOTP コード生成 (6桁、30秒ステップ、HMAC-SHA1)
 */
export async function generateTOTP(secretBase32: string, timeStep?: number): Promise<string> {
  const step = timeStep ?? Math.floor(Date.now() / 1000 / 30);
  const key = base32Decode(secretBase32);
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, BigInt(step), false);

  const hmac = await hmacBytes('SHA-1', key, buf);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const hmacView = new DataView(hmac.buffer, hmac.byteOffset, hmac.byteLength);
  const code = (hmacView.getUint32(offset, false) & 0x7fffffff) % 1000000;
  return code.toString().padStart(6, '0');
}

/**
 * RFC 6238 準拠の TOTP 検証
 * - 許容範囲: 前後 ±1 ステップ (計 90 秒)
 * - リプレイ攻撃防止: 最後に検証されたステップ (lastTotpStep) 以下のステップは再利用拒否
 */
export async function verifyTOTP(
  secretBase32: string,
  token: string,
  lastTotpStep?: bigint | number | null
): Promise<{ valid: boolean; verifiedStep?: bigint; error?: string }> {
  const cleanedToken = token.trim().replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleanedToken)) {
    return { valid: false, error: '6桁の数字を入力してください' };
  }

  const currentStep = Math.floor(Date.now() / 1000 / 30);
  const stepsToCheck = [currentStep, currentStep - 1, currentStep + 1];

  for (const step of stepsToCheck) {
    const expected = await generateTOTP(secretBase32, step);
    if (timingSafeEqualStr(cleanedToken, expected)) {
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
export async function hashRecoveryCode(code: string): Promise<string> {
  const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return sha256Hex(normalized);
}

/**
 * リカバリーコードの検証 (使い捨て型)
 */
export async function verifyRecoveryCode(
  code: string,
  storedCodesJson: string | null
): Promise<{ valid: boolean; remainingHashesJson?: string }> {
  if (!storedCodesJson) return { valid: false };
  try {
    const hashes: string[] = JSON.parse(storedCodesJson);
    if (!Array.isArray(hashes) || hashes.length === 0) return { valid: false };

    const inputHash = await hashRecoveryCode(code);
    const index = hashes.findIndex((h) => timingSafeEqualStr(h, inputHash));

    if (index === -1) return { valid: false };

    // 使用済みコードを消費（除外）
    const remaining = hashes.filter((_, i) => i !== index);
    return { valid: true, remainingHashesJson: JSON.stringify(remaining) };
  } catch {
    return { valid: false };
  }
}

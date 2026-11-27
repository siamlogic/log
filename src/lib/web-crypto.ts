/**
 * Web Crypto API ベースの暗号・ハッシュユーティリティ
 * Node.js (v20+)・Next.js Edge Runtime・Cloudflare Workers/Pages Functions の全環境でネイティブ動作
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string length.');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function base64UrlEncode(input: string): string {
  const bytes = textEncoder.encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(b64u: string): string {
  const padded = b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return textDecoder.decode(bytes);
}

export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  return timingSafeEqualBytes(textEncoder.encode(a), textEncoder.encode(b));
}

export function randomBytesHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', toBufferSource(textEncoder.encode(input)));
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacBytes(
  algorithm: 'SHA-256' | 'SHA-1',
  key: Uint8Array | string,
  data: Uint8Array | string
): Promise<Uint8Array> {
  const keyBytes = typeof key === 'string' ? textEncoder.encode(key) : key;
  const dataBytes = typeof data === 'string' ? textEncoder.encode(data) : data;
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    toBufferSource(keyBytes),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign']
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, toBufferSource(dataBytes));
  return new Uint8Array(sig);
}

export async function hmacHex(
  algorithm: 'SHA-256' | 'SHA-1',
  key: Uint8Array | string,
  data: Uint8Array | string
): Promise<string> {
  const sig = await hmacBytes(algorithm, key, data);
  return bytesToHex(sig);
}

export async function pbkdf2Hex(
  password: string,
  salt: string,
  iterations: number,
  keyLenBytes: number
): Promise<string> {
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    toBufferSource(textEncoder.encode(password)),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: toBufferSource(textEncoder.encode(salt)),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    keyLenBytes * 8
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function aes256GcmEncrypt(
  keyBytes: Uint8Array,
  plaintext: string
): Promise<{ ivHex: string; tagHex: string; dataHex: string }> {
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    toBufferSource(keyBytes),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const cipherBuffer = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBufferSource(iv), tagLength: 128 },
    cryptoKey,
    toBufferSource(textEncoder.encode(plaintext))
  );
  const cipherBytes = new Uint8Array(cipherBuffer);
  // Web Crypto API の AES-GCM は末尾 16 バイトが認証タグ
  const encryptedData = cipherBytes.slice(0, cipherBytes.length - 16);
  const tag = cipherBytes.slice(cipherBytes.length - 16);
  return {
    ivHex: bytesToHex(iv),
    tagHex: bytesToHex(tag),
    dataHex: bytesToHex(encryptedData),
  };
}

export async function aes256GcmDecrypt(
  keyBytes: Uint8Array,
  ivHex: string,
  tagHex: string,
  dataHex: string
): Promise<string> {
  const iv = hexToBytes(ivHex);
  const tag = hexToBytes(tagHex);
  const data = hexToBytes(dataHex);
  const combined = new Uint8Array(data.length + tag.length);
  combined.set(data, 0);
  combined.set(tag, data.length);

  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    toBufferSource(keyBytes),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const plainBuffer = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBufferSource(iv), tagLength: 128 },
    cryptoKey,
    toBufferSource(combined)
  );
  return textDecoder.decode(plainBuffer);
}

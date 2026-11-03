import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type SealedPurpose = 'login-handoff' | 'steam-session' | 'review-plan';

export type TokenPayload = {
  purpose: SealedPurpose;
  issuedAt: number;
  expiresAt: number;
  steamId?: string;
  refreshToken?: string;
  binding?: string;
  appId?: number;
  names?: string[];
  revision?: string;
};

const AAD = Buffer.from('steam-cloud-manager:vercel:v1');
const MAX_TOKEN_BYTES = 16384;

export function sessionEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const encoded = env.SCM_SESSION_KEY;
  if (!encoded || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) {
    throw new Error('SCM_SESSION_KEY must contain exactly 32 random bytes encoded as base64url');
  }
  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== 32) throw new Error('SCM_SESSION_KEY is invalid');
  return key;
}

export function encryptToken(data: TokenPayload, key: Buffer): string {
  if (key.length !== 32 || data.expiresAt <= data.issuedAt) {
    throw new Error('Invalid encryption key or expiry');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const result = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  if (result.byteLength > MAX_TOKEN_BYTES) throw new Error('Session token exceeds safe size');
  return result.toString('base64url');
}

export function decryptToken(
  text: string | undefined, key: Buffer, purpose: SealedPurpose, now = Date.now(),
): TokenPayload | null {
  if (!text || text.length > MAX_TOKEN_BYTES * 2 ||
    !/^[A-Za-z0-9_-]+$/.test(text) || key.length !== 32) return null;
  try {
    const raw = Buffer.from(text, 'base64url');
    if (raw.length < 29 || raw.length > MAX_TOKEN_BYTES) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    decipher.setAAD(AAD);
    const value = JSON.parse(Buffer.concat([
      decipher.update(raw.subarray(28)), decipher.final(),
    ]).toString('utf8')) as TokenPayload;
    if (value.purpose !== purpose ||
      !Number.isSafeInteger(value.issuedAt) ||
      !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt <= now || value.issuedAt > now + 5000 ||
      value.expiresAt <= value.issuedAt) return null;
    return value;
  } catch { return null; }
}

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type TokenPurpose = 'scm-session' | 'review-plan' | 'export-ticket';

export interface BaseTokenPayload {
  purpose: TokenPurpose;
  issuedAt: number;
  expiresAt: number;
}

export interface SessionTokenPayload extends BaseTokenPayload {
  purpose: 'scm-session';
  sessionId: string;
  csrfToken: string;
  mode: 'live' | 'demo';
  connectionId?: string;
  steamId?: string;
  displayName?: string;
  refreshToken?: string;
}

export interface ReviewPlanTokenPayload extends BaseTokenPayload {
  purpose: 'review-plan';
  appId: number;
  names: string[];
  revision: string;
  confirmation?: string;
  binding?: string;
}

export interface ExportTicketTokenPayload extends BaseTokenPayload {
  purpose: 'export-ticket';
  appId: number;
  names: string[];
  revision: string;
  ticketId: string;
  binding?: string;
}

export type TokenPayload =
  | SessionTokenPayload
  | ReviewPlanTokenPayload
  | ExportTicketTokenPayload;

export const AAD = Buffer.from('steam-cloud-manager:vercel:v1');
export const IV_LENGTH = 12; // 96-bit nonce standard for AES-GCM
export const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag
export const KEY_BYTES = 32; // 256 bits for AES-256
export const MAX_TOKEN_BYTES = 16384; // 16 KB upper safety bound
export const CLOCK_TOLERANCE_MS = 5000; // 5s clock skew tolerance

let memoizedEphemeralKey: Buffer | null = null;

export function resolveEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const encoded = env.SCM_SESSION_KEY;
  if (encoded) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) {
      throw new Error(
        'SCM_SESSION_KEY must contain exactly 32 random bytes encoded as a 43-character base64url string',
      );
    }
    const key = Buffer.from(encoded, 'base64url');
    if (key.length !== KEY_BYTES) {
      throw new Error('SCM_SESSION_KEY is invalid');
    }
    return key;
  }

  const isProduction = env.NODE_ENV === 'production' || Boolean(env.VERCEL);
  if (isProduction) {
    throw new Error('SCM_SESSION_KEY must be configured in production and Vercel environments');
  }

  if (!memoizedEphemeralKey) {
    memoizedEphemeralKey = randomBytes(KEY_BYTES);
  }
  return memoizedEphemeralKey;
}

export function resetEphemeralKeyForTesting(): void {
  memoizedEphemeralKey = null;
}

export function encryptToken(payload: TokenPayload, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Invalid encryption key: expected ${KEY_BYTES} bytes`);
  }
  if (!Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt)) {
    throw new Error('Token timestamps must be safe integers');
  }
  if (payload.expiresAt <= payload.issuedAt) {
    throw new Error('Token expiry must be greater than issue timestamp');
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);

  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const tokenBuffer = Buffer.concat([iv, authTag, ciphertext]);
  if (tokenBuffer.length > MAX_TOKEN_BYTES) {
    throw new Error('Token payload exceeds maximum allowed size');
  }

  return tokenBuffer.toString('base64url');
}

export function decryptToken<T extends TokenPayload>(
  text: string | undefined,
  key: Buffer,
  expectedPurpose: T['purpose'],
  now: number = Date.now(),
): T | null {
  if (!text || typeof text !== 'string') return null;
  if (text.length > MAX_TOKEN_BYTES * 2 || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  if (key.length !== KEY_BYTES) return null;

  try {
    const raw = Buffer.from(text, 'base64url');
    if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH + 1 || raw.length > MAX_TOKEN_BYTES) {
      return null;
    }

    const iv = raw.subarray(0, IV_LENGTH);
    const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    decipher.setAAD(AAD);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const payload = JSON.parse(plaintext.toString('utf8')) as TokenPayload;

    if (!payload || typeof payload !== 'object') return null;
    if (payload.purpose !== expectedPurpose) return null;
    if (!Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt)) {
      return null;
    }
    if (payload.expiresAt <= payload.issuedAt) return null;
    if (payload.expiresAt <= now) return null;
    if (payload.issuedAt > now + CLOCK_TOLERANCE_MS) return null;

    if (expectedPurpose === 'scm-session') {
      const p = payload as SessionTokenPayload;
      if (typeof p.sessionId !== 'string' || !p.sessionId) return null;
      if (typeof p.csrfToken !== 'string' || !p.csrfToken) return null;
      if (p.mode !== 'live' && p.mode !== 'demo') return null;
    } else if (expectedPurpose === 'review-plan') {
      const p = payload as ReviewPlanTokenPayload;
      if (!Number.isInteger(p.appId) || p.appId < 1) return null;
      if (!Array.isArray(p.names) || p.names.length === 0 || p.names.length > 500) return null;
      if (typeof p.revision !== 'string' || !p.revision) return null;
    } else if (expectedPurpose === 'export-ticket') {
      const p = payload as ExportTicketTokenPayload;
      if (!Number.isInteger(p.appId) || p.appId < 1) return null;
      if (!Array.isArray(p.names) || p.names.length === 0) return null;
      if (typeof p.revision !== 'string' || !p.revision) return null;
      if (typeof p.ticketId !== 'string' || !p.ticketId) return null;
    }

    return payload as T;
  } catch {
    return null;
  }
}

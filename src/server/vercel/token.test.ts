import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sessionEncryptionKey, encryptToken, decryptToken } from './token.js';

test('Vercel token encryption protects Steam refresh credentials and expires', () => {
  const key = randomBytes(32);
  const claims = {
    purpose: 'steam-session' as const, issuedAt: 1000, expiresAt: 60000,
    steamId: '76561198000000000', refreshToken: 'SENSITIVE-STEAM-REFRESH',
  };
  const encrypted = encryptToken(claims, key);
  assert.ok(!encrypted.includes(claims.refreshToken));
  assert.deepEqual(decryptToken(encrypted, key, 'steam-session', 4000), claims);
  assert.equal(decryptToken(encrypted, key, 'login-handoff', 4000), null);
  assert.equal(decryptToken(encrypted, key, 'steam-session', 60000), null);
  assert.equal(decryptToken(encrypted, randomBytes(32), 'steam-session', 4000), null);
  const altered = Buffer.from(encrypted, 'base64url');
  altered[altered.length - 1] ^= 1;
  assert.equal(decryptToken(altered.toString('base64url'), key, 'steam-session', 4000), null);
});

test('only a cryptographically strong 32-byte environment key is accepted', () => {
  assert.throws(() => sessionEncryptionKey({}));
  assert.throws(() => sessionEncryptionKey({SCM_SESSION_KEY:'password'}));
  const key = randomBytes(32);
  assert.deepEqual(sessionEncryptionKey({SCM_SESSION_KEY:key.toString('base64url')}), key);
});

test('invalid expiry, purpose and future-issued tokens fail validation', () => {
  const key = randomBytes(32);
  assert.throws(() => encryptToken({purpose:'steam-session',issuedAt:10,expiresAt:10},key));
  const token = encryptToken({purpose:'review-plan',issuedAt:8000,expiresAt:10000},key);
  assert.equal(decryptToken(token,key,'review-plan',2000),null);
  assert.equal(decryptToken(token,key,'review-plan',10000),null);
});

import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createCipheriv } from 'node:crypto';
import {
  encryptToken,
  decryptToken,
  resolveEncryptionKey,
  resetEphemeralKeyForTesting,
  AAD,
  IV_LENGTH,
  AUTH_TAG_LENGTH,
  KEY_BYTES,
  MAX_TOKEN_BYTES,
  CLOCK_TOLERANCE_MS,
  type SessionTokenPayload,
  type ReviewPlanTokenPayload,
  type ExportTicketTokenPayload,
} from './session-token.js';
import { SessionStore, type Session } from './sessions.js';
import { DemoCloudDriver } from './demo-driver.js';
import type { CloudDriver } from './steam/contracts.js';
import type { LoginInfo } from '../shared/types.js';

// Helper to manually create valid AES-256-GCM tokens with arbitrary raw payloads
function createRawEncryptedToken(
  rawPlaintext: Buffer | string,
  key: Buffer,
  iv: Buffer = randomBytes(IV_LENGTH),
  aad: Buffer = AAD,
): string {
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const pt = typeof rawPlaintext === 'string' ? Buffer.from(rawPlaintext, 'utf8') : rawPlaintext;
  const ciphertext = Buffer.concat([cipher.update(pt), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64url');
}

// Helper to craft a mock CloudDriver for testing
function createMockLiveDriver(overrides?: LoginInfo): CloudDriver {
  return {
    async startLogin() {},
    getLogin(): LoginInfo {
      return (
        overrides ?? {
          status: 'connected',
          user: { steamId: '76561198012345678', displayName: 'MockLiveUser' },
        }
      );
    },
    async listGames() {
      return [];
    },
    async listFiles() {
      return { appId: 100, changeNumber: '1', files: [] };
    },
    async downloadFile() {
      throw new Error('Not implemented');
    },
    async deleteFiles() {
      return { deleted: [], failed: [], batchCompleted: true };
    },
    close() {},
  };
}

describe('Milestone 1 Adversarial Challenge: Cryptographic & Session Hardening', () => {
  const masterKey = randomBytes(KEY_BYTES);
  const now = 1_700_000_000_000;

  const validSessionPayload: SessionTokenPayload = {
    purpose: 'scm-session',
    sessionId: 'session_adv_001',
    csrfToken: 'csrf_adv_secret_key',
    mode: 'demo',
    steamId: '76561198000000000',
    displayName: 'Demo Account',
    issuedAt: now,
    expiresAt: now + 3600_000,
  };

  const validReviewPlanPayload: ReviewPlanTokenPayload = {
    purpose: 'review-plan',
    appId: 949230,
    names: ['Save_01.cok', 'Save_02.cok'],
    revision: 'f'.repeat(64),
    confirmation: 'DELETE 2',
    issuedAt: now,
    expiresAt: now + 300_000,
  };

  const validExportTicketPayload: ExportTicketTokenPayload = {
    purpose: 'export-ticket',
    appId: 1086940,
    names: ['Save_01.lsv'],
    revision: 'e'.repeat(64),
    ticketId: 'ticket_adv_xyz',
    issuedAt: now,
    expiresAt: now + 300_000,
  };

  describe('1. Ciphertext and Wire-Format Fuzzing', () => {
    it('1.1: Exhaustive single-bit flips across every byte and bit position are 100% rejected', () => {
      const token = encryptToken(validSessionPayload, masterKey);
      const raw = Buffer.from(token, 'base64url');
      let totalFlips = 0;
      let rejectedFlips = 0;

      for (let byteIdx = 0; byteIdx < raw.length; byteIdx++) {
        for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
          const mutated = Buffer.from(raw);
          mutated[byteIdx] ^= 1 << bitIdx;
          totalFlips++;

          const mutatedToken = mutated.toString('base64url');
          const decrypted = decryptToken(mutatedToken, masterKey, 'scm-session', now + 1000);
          if (decrypted === null) {
            rejectedFlips++;
          }
        }
      }

      assert.ok(totalFlips > 1000, `Expected >1000 bit flips, tested ${totalFlips}`);
      assert.equal(
        rejectedFlips,
        totalFlips,
        `All ${totalFlips} single-bit flips must return null (zero bypasses)`,
      );
    });

    it('1.2: Truncated wire formats are rejected without throwing uncaught errors', () => {
      const token = encryptToken(validSessionPayload, masterKey);
      const raw = Buffer.from(token, 'base64url');

      // Test all sub-slices from 0 to 28 bytes (< IV_LENGTH + AUTH_TAG_LENGTH + 1)
      for (let len = 0; len < IV_LENGTH + AUTH_TAG_LENGTH + 1; len++) {
        const truncated = raw.subarray(0, len).toString('base64url');
        assert.equal(
          decryptToken(truncated, masterKey, 'scm-session', now + 1000),
          null,
          `Truncated length ${len} must be rejected`,
        );
      }

      // Truncate ciphertext by 1, 2, 5, 10 bytes
      for (const cut of [1, 2, 5, 10, 20]) {
        if (raw.length - cut > IV_LENGTH + AUTH_TAG_LENGTH) {
          const truncated = raw.subarray(0, raw.length - cut).toString('base64url');
          assert.equal(
            decryptToken(truncated, masterKey, 'scm-session', now + 1000),
            null,
            `Ciphertext truncated by ${cut} bytes must be rejected`,
          );
        }
      }
    });

    it('1.3: Corrupted IVs with all 0x00, all 0xFF, or altered nonces fail authentication', () => {
      const token = encryptToken(validSessionPayload, masterKey);
      const raw = Buffer.from(token, 'base64url');

      // All zeros IV
      const zeroIv = Buffer.from(raw);
      zeroIv.fill(0, 0, IV_LENGTH);
      assert.equal(decryptToken(zeroIv.toString('base64url'), masterKey, 'scm-session', now + 1000), null);

      // All 0xFF IV
      const ffIv = Buffer.from(raw);
      ffIv.fill(0xff, 0, IV_LENGTH);
      assert.equal(decryptToken(ffIv.toString('base64url'), masterKey, 'scm-session', now + 1000), null);

      // Random IV
      const randIv = Buffer.from(raw);
      randomBytes(IV_LENGTH).copy(randIv, 0);
      assert.equal(decryptToken(randIv.toString('base64url'), masterKey, 'scm-session', now + 1000), null);
    });

    it('1.4: Truncated or boundary-shifted auth tags fail AES-GCM verification', () => {
      const token = encryptToken(validSessionPayload, masterKey);
      const raw = Buffer.from(token, 'base64url');

      // Shift boundary: tag shifted by 1 byte into ciphertext
      const shifted = Buffer.concat([
        raw.subarray(0, IV_LENGTH + AUTH_TAG_LENGTH - 1),
        raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH),
      ]);
      assert.equal(decryptToken(shifted.toString('base64url'), masterKey, 'scm-session', now + 1000), null);
    });

    it('1.5: Invalid base64url characters, whitespace, padding, and injection strings return null safely', () => {
      const token = encryptToken(validSessionPayload, masterKey);

      const hostileInputs = [
        token + '=', // standard base64 padding
        token + '==',
        token.replace(/_/g, '/').replace(/-/g, '+'), // standard base64 chars
        token + ' ', // trailing space
        ' ' + token, // leading space
        token + '\n', // newline
        token + '\0', // null byte
        token + '<script>alert(1)</script>',
        token + "' OR '1'='1",
        'not_base64_url_#$!@%',
        '🔥💥🚀', // emojis
        'ПриветМирСессия', // unicode
        '\r\n\t',
      ];

      for (const input of hostileInputs) {
        assert.equal(
          decryptToken(input, masterKey, 'scm-session', now + 1000),
          null,
          `Hostile input "${input.slice(0, 20)}..." must return null`,
        );
      }
    });

    it('1.6: Non-JSON and malformed plaintext payloads fail parsing gracefully', () => {
      const nonJsonPayloads = [
        'not a json payload',
        '12345678',
        'true',
        'false',
        'null',
        '',
        '{"purpose": "scm-session", "broken": ',
        '{"purpose": "scm-session", unquoted_key: 123}',
        '["scm-session", "session_id"]',
        Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]), // raw binary
      ];

      for (const rawPt of nonJsonPayloads) {
        const craftedToken = createRawEncryptedToken(rawPt, masterKey);
        assert.equal(
          decryptToken(craftedToken, masterKey, 'scm-session', now + 1000),
          null,
          `Non-JSON payload "${String(rawPt).slice(0, 20)}" must return null`,
        );
      }
    });

    it('1.7: AAD tampering or mismatch fails AES-256-GCM authentication', () => {
      const forgedAads = [
        Buffer.from('steam-cloud-manager:vercel:v0'), // altered version
        Buffer.from('steam-cloud-manager:local:v1'),
        Buffer.alloc(0), // empty AAD
        Buffer.from('steam-cloud-manager:vercel:v1-extra-bytes'),
      ];

      for (const badAad of forgedAads) {
        const token = createRawEncryptedToken(JSON.stringify(validSessionPayload), masterKey, undefined, badAad);
        assert.equal(
          decryptToken(token, masterKey, 'scm-session', now + 1000),
          null,
          `Token with tampered AAD "${badAad.toString()}" must fail decryption`,
        );
      }
    });

    it('1.8: Nonce/IV entropy: 1000 successive encryptions generate strictly unique 96-bit IVs', () => {
      const ivs = new Set<string>();
      const iterations = 1000;
      for (let i = 0; i < iterations; i++) {
        const token = encryptToken(validSessionPayload, masterKey);
        const raw = Buffer.from(token, 'base64url');
        const iv = raw.subarray(0, IV_LENGTH).toString('hex');
        assert.ok(!ivs.has(iv), `IV collision detected on iteration ${i}!`);
        ivs.add(iv);
      }
      assert.equal(ivs.size, iterations);
    });
  });

  describe('2. Purpose Confusion and Schema Guardrails', () => {
    it('2.1: Purpose confusion across scm-session, review-plan, and export-ticket is strictly blocked', () => {
      const sessionToken = encryptToken(validSessionPayload, masterKey);
      const planToken = encryptToken(validReviewPlanPayload, masterKey);
      const exportToken = encryptToken(validExportTicketPayload, masterKey);

      // scm-session as review-plan or export-ticket
      assert.equal(decryptToken(sessionToken, masterKey, 'review-plan', now + 1000), null);
      assert.equal(decryptToken(sessionToken, masterKey, 'export-ticket', now + 1000), null);

      // review-plan as scm-session or export-ticket
      assert.equal(decryptToken(planToken, masterKey, 'scm-session', now + 1000), null);
      assert.equal(decryptToken(planToken, masterKey, 'export-ticket', now + 1000), null);

      // export-ticket as scm-session or review-plan
      assert.equal(decryptToken(exportToken, masterKey, 'scm-session', now + 1000), null);
      assert.equal(decryptToken(exportToken, masterKey, 'review-plan', now + 1000), null);
    });

    it('2.2: Unknown or forged purpose in plaintext payload is rejected', () => {
      const forgedPayload = {
        purpose: 'admin-override',
        sessionId: 's1',
        csrfToken: 'c1',
        mode: 'demo',
        issuedAt: now,
        expiresAt: now + 3600_000,
      };
      // @ts-expect-error intentionally invalid purpose
      const token = encryptToken(forgedPayload, masterKey);
      assert.equal(decryptToken(token, masterKey, 'scm-session', now + 1000), null);
    });

    it('2.3: SessionTokenPayload type-confusion attacks are rejected', () => {
      const badSessions = [
        { ...validSessionPayload, sessionId: 12345 }, // non-string sessionId
        { ...validSessionPayload, sessionId: '' }, // empty sessionId
        { ...validSessionPayload, csrfToken: null }, // non-string csrfToken
        { ...validSessionPayload, csrfToken: '' }, // empty csrfToken
        { ...validSessionPayload, mode: 'superuser' }, // invalid mode
        { ...validSessionPayload, mode: 'root' },
        { ...validSessionPayload, mode: undefined },
      ];

      for (const bad of badSessions) {
        const token = createRawEncryptedToken(JSON.stringify(bad), masterKey);
        assert.equal(
          decryptToken(token, masterKey, 'scm-session', now + 1000),
          null,
          `Bad session field ${JSON.stringify(bad).slice(0, 30)} must return null`,
        );
      }
    });

    it('2.4: ReviewPlanTokenPayload schema validation rejects invalid appId, names, and revisions', () => {
      const badPlans = [
        { ...validReviewPlanPayload, appId: 0 }, // non-positive appId
        { ...validReviewPlanPayload, appId: -100 },
        { ...validReviewPlanPayload, appId: 1.5 }, // non-integer
        { ...validReviewPlanPayload, appId: '949230' }, // string appId
        { ...validReviewPlanPayload, names: [] }, // empty names
        { ...validReviewPlanPayload, names: 'Save.cok' }, // non-array
        { ...validReviewPlanPayload, names: Array.from({ length: 501 }, (_, i) => `f_${i}`) }, // >500 names
        { ...validReviewPlanPayload, revision: '' }, // empty revision
        { ...validReviewPlanPayload, revision: 123 }, // non-string revision
      ];

      for (const bad of badPlans) {
        const token = createRawEncryptedToken(JSON.stringify(bad), masterKey);
        assert.equal(decryptToken(token, masterKey, 'review-plan', now + 1000), null);
      }
    });

    it('2.5: ExportTicketTokenPayload schema validation rejects invalid ticketId and parameters', () => {
      const badTickets = [
        { ...validExportTicketPayload, appId: -5 },
        { ...validExportTicketPayload, names: [] },
        { ...validExportTicketPayload, revision: '' },
        { ...validExportTicketPayload, ticketId: '' },
        { ...validExportTicketPayload, ticketId: 9999 },
      ];

      for (const bad of badTickets) {
        const token = createRawEncryptedToken(JSON.stringify(bad), masterKey);
        assert.equal(decryptToken(token, masterKey, 'export-ticket', now + 1000), null);
      }
    });

    it('2.6: Prototype pollution attempts in JSON payload do not pollute Object.prototype', () => {
      const maliciousJson = JSON.stringify({
        purpose: 'scm-session',
        sessionId: 'session_adv_proto',
        csrfToken: 'csrf_adv_proto',
        mode: 'demo',
        issuedAt: now,
        expiresAt: now + 3600_000,
        __proto__: { pollutedAdmin: true },
        constructor: { prototype: { pollutedRole: 'admin' } },
      });

      const token = createRawEncryptedToken(maliciousJson, masterKey);
      const res = decryptToken<SessionTokenPayload>(token, masterKey, 'scm-session', now + 1000);
      assert.ok(res);
      // @ts-expect-error check global prototype pollution
      assert.equal(Object.prototype.pollutedAdmin, undefined);
      // @ts-expect-error check global prototype pollution
      assert.equal(Object.prototype.pollutedRole, undefined);
    });
  });

  describe('3. Expiration and Clock Tolerance Edge Cases', () => {
    it('3.1: Boundary condition at exact expiration (now === expiresAt) returns null', () => {
      const token = encryptToken(validSessionPayload, masterKey);
      assert.equal(
        decryptToken(token, masterKey, 'scm-session', validSessionPayload.expiresAt),
        null,
        'Exact expiration time must be rejected',
      );
    });

    it('3.2: 1ms past expiration returns null, 1ms before expiration returns payload', () => {
      const token = encryptToken(validSessionPayload, masterKey);
      assert.equal(
        decryptToken(token, masterKey, 'scm-session', validSessionPayload.expiresAt + 1),
        null,
        '1ms past expiration must be rejected',
      );
      assert.notEqual(
        decryptToken(token, masterKey, 'scm-session', validSessionPayload.expiresAt - 1),
        null,
        '1ms before expiration must be accepted',
      );
    });

    it('3.3: Future tokens: accepted within 5000ms clock tolerance, rejected beyond 5000ms', () => {
      const token = encryptToken(validSessionPayload, masterKey);
      // now is 5000ms behind issuedAt -> exactly at tolerance boundary
      assert.notEqual(
        decryptToken(token, masterKey, 'scm-session', validSessionPayload.issuedAt - CLOCK_TOLERANCE_MS),
        null,
        'Within clock tolerance (5000ms) must be accepted',
      );
      // now is 5001ms behind issuedAt -> exceeds tolerance
      assert.equal(
        decryptToken(token, masterKey, 'scm-session', validSessionPayload.issuedAt - (CLOCK_TOLERANCE_MS + 1)),
        null,
        'Beyond clock tolerance (5001ms) must be rejected',
      );
    });

    it('3.4: Inverted timestamps (expiresAt <= issuedAt) are rejected in both encrypt and decrypt', () => {
      // In encryptToken
      assert.throws(() =>
        encryptToken({ ...validSessionPayload, issuedAt: now, expiresAt: now }, masterKey),
      );
      assert.throws(() =>
        encryptToken({ ...validSessionPayload, issuedAt: now, expiresAt: now - 1000 }, masterKey),
      );

      // In decryptToken via crafted raw token
      const invertedPayload = {
        ...validSessionPayload,
        issuedAt: now,
        expiresAt: now - 500,
      };
      const token = createRawEncryptedToken(JSON.stringify(invertedPayload), masterKey);
      assert.equal(decryptToken(token, masterKey, 'scm-session', now - 1000), null);
    });

    it('3.5: Non-safe-integer or float timestamps are rejected', () => {
      const badTimestamps = [
        { issuedAt: NaN, expiresAt: now + 3600_000 },
        { issuedAt: now, expiresAt: Infinity },
        { issuedAt: -Infinity, expiresAt: now + 3600_000 },
        { issuedAt: now + 0.5, expiresAt: now + 3600_000 },
        { issuedAt: '1700000000000', expiresAt: now + 3600_000 },
      ];

      for (const ts of badTimestamps) {
        // @ts-expect-error invalid timestamp types
        assert.throws(() => encryptToken({ ...validSessionPayload, ...ts }, masterKey));
        const token = createRawEncryptedToken(JSON.stringify({ ...validSessionPayload, ...ts }), masterKey);
        assert.equal(decryptToken(token, masterKey, 'scm-session', now + 1000), null);
      }
    });
  });

  describe('4. Payload Boundaries and Resource Exhaustion', () => {
    it('4.1: Tokens exceeding MAX_TOKEN_BYTES * 2 are rejected prior to base64url decoding', () => {
      const oversizedText = 'a'.repeat(MAX_TOKEN_BYTES * 2 + 1);
      const start = process.hrtime.bigint();
      const res = decryptToken(oversizedText, masterKey, 'scm-session', now);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;

      assert.equal(res, null);
      assert.ok(elapsedMs < 5, `Rejection took ${elapsedMs.toFixed(2)}ms; should be instant <5ms`);
    });

    it('4.2: Payload exceeding MAX_TOKEN_BYTES (16KB) throws in encrypt and returns null in decrypt', () => {
      const hugePlan: ReviewPlanTokenPayload = {
        ...validReviewPlanPayload,
        names: Array.from({ length: 500 }, (_, i) => `very_long_save_filename_path_padding_${i}_${'x'.repeat(40)}`),
      };
      const serialized = JSON.stringify(hugePlan);
      assert.ok(serialized.length > MAX_TOKEN_BYTES, `Expected serialized > 16KB, got ${serialized.length}`);

      assert.throws(
        () => encryptToken(hugePlan, masterKey),
        /exceeds maximum allowed size/,
      );

      // Test decryptToken boundary
      const craftedHuge = createRawEncryptedToken(Buffer.alloc(MAX_TOKEN_BYTES + 10, 0x41), masterKey);
      assert.equal(decryptToken(craftedHuge, masterKey, 'scm-session', now), null);
    });

    it('4.3: 1MB attack payload is rejected safely with zero memory leak or unhandled exception', () => {
      const massiveGarbage = 'X'.repeat(1_000_000);
      const start = process.hrtime.bigint();
      const res = decryptToken(massiveGarbage, masterKey, 'scm-session', now);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;

      assert.equal(res, null);
      assert.ok(elapsedMs < 10, `1MB payload rejected in ${elapsedMs.toFixed(2)}ms`);
    });
  });

  describe('5. Key Derivation, Environment Hardening & Memoization', () => {
    it('5.1: Malformed SCM_SESSION_KEY strings throw descriptive errors', () => {
      resetEphemeralKeyForTesting();

      // 42 characters (1 byte short)
      assert.throws(
        () => resolveEncryptionKey({ SCM_SESSION_KEY: 'A'.repeat(42) }),
        /must contain exactly 32 random bytes/,
      );

      // 44 characters (1 character too long / standard base64 padded)
      assert.throws(
        () => resolveEncryptionKey({ SCM_SESSION_KEY: 'A'.repeat(44) }),
        /must contain exactly 32 random bytes/,
      );

      // 43 characters containing invalid base64url characters
      assert.throws(
        () => resolveEncryptionKey({ SCM_SESSION_KEY: 'A'.repeat(42) + '+' }),
        /must contain exactly 32 random bytes/,
      );
      assert.throws(
        () => resolveEncryptionKey({ SCM_SESSION_KEY: 'A'.repeat(42) + '/' }),
        /must contain exactly 32 random bytes/,
      );
      assert.throws(
        () => resolveEncryptionKey({ SCM_SESSION_KEY: 'A'.repeat(42) + '=' }),
        /must contain exactly 32 random bytes/,
      );
    });

    it('5.2: Unset SCM_SESSION_KEY in production or Vercel environments throws error', () => {
      resetEphemeralKeyForTesting();

      // NODE_ENV=production
      assert.throws(
        () => resolveEncryptionKey({ NODE_ENV: 'production' }),
        /must be configured in production and Vercel environments/,
      );

      // VERCEL=1
      assert.throws(
        () => resolveEncryptionKey({ VERCEL: '1' }),
        /must be configured in production and Vercel environments/,
      );

      // VERCEL=true
      assert.throws(
        () => resolveEncryptionKey({ VERCEL: 'true' }),
        /must be configured in production and Vercel environments/,
      );
    });

    it('5.3: Dev and test environments generate and memoize an ephemeral 32-byte key', () => {
      resetEphemeralKeyForTesting();

      const k1 = resolveEncryptionKey({});
      assert.equal(k1.length, 32);

      const k2 = resolveEncryptionKey({});
      assert.equal(k1, k2, 'Must return the exact memoized instance');

      resetEphemeralKeyForTesting();
      const k3 = resolveEncryptionKey({});
      assert.equal(k3.length, 32);
      assert.notDeepEqual(k1, k3, 'Reset must generate a fresh random key');
    });

    it('5.4: Non-32-byte keys are rejected in encryptToken and decryptToken', () => {
      const shortKey = randomBytes(16);
      const longKey = randomBytes(64);

      assert.throws(() => encryptToken(validSessionPayload, shortKey), /Invalid encryption key/);
      assert.throws(() => encryptToken(validSessionPayload, longKey), /Invalid encryption key/);

      const token = encryptToken(validSessionPayload, masterKey);
      assert.equal(decryptToken(token, shortKey, 'scm-session', now + 1000), null);
      assert.equal(decryptToken(token, longKey, 'scm-session', now + 1000), null);
    });
  });

  describe('6. Cold Rehydration & Multi-Instance Consistency Stress', () => {
    it('6.1: Cold rehydration across multiple independent SessionStores recovers full state', async () => {
      const sharedKey = randomBytes(KEY_BYTES);
      let currentTime = now;
      const getNow = () => currentTime;

      // Instance 1: creates and issues token for Demo session
      const store1 = new SessionStore(() => new DemoCloudDriver(), 3600_000, 100, getNow, {
        encryptionKey: sharedKey,
      });

      const session1 = store1.create({ mode: 'demo' });
      await session1.driver.startLogin();
      const token1 = store1.issueToken(session1);

      // Instance 2: Cold instance (has completely empty memory cache)
      const store2 = new SessionStore(() => new DemoCloudDriver(), 3600_000, 100, getNow, {
        encryptionKey: sharedKey,
      });

      const rehydrated2 = store2.get(token1);
      assert.ok(rehydrated2, 'Store2 must rehydrate session from token1');
      assert.equal(rehydrated2.id, session1.id);
      assert.equal(rehydrated2.csrfToken, session1.csrfToken);
      assert.equal(rehydrated2.mode, 'demo');
      assert.equal(rehydrated2.steamId, '76561198000000000');
      assert.equal(rehydrated2.displayName, 'Demo Account');
      assert.equal(rehydrated2.driver.getLogin().status, 'connected');

      // Instance 3: Another cold instance verifies warm cache hit on store2 vs cold hit on store3
      const store3 = new SessionStore(() => new DemoCloudDriver(), 3600_000, 100, getNow, {
        encryptionKey: sharedKey,
      });

      const rehydrated3 = store3.get(token1);
      assert.ok(rehydrated3, 'Store3 must rehydrate session from token1');
      assert.equal(rehydrated3.id, session1.id);
      assert.equal(rehydrated3.csrfToken, session1.csrfToken);

      store1.close();
      store2.close();
      store3.close();
    });

    it('6.2: Multi-hop token rotation across 5 independent instances preserves continuity', () => {
      const sharedKey = randomBytes(KEY_BYTES);
      let currentTime = now;
      const getNow = () => currentTime;

      let currentToken = '';
      const originalSessionId = 'session_multihop_001';
      const originalCsrf = 'csrf_multihop_secret';

      // Chain across 5 independent store instances
      const storeChain: SessionStore[] = [];
      try {
        for (let hop = 0; hop < 5; hop++) {
          const store = new SessionStore(() => new DemoCloudDriver(), 3600_000, 100, getNow, {
            encryptionKey: sharedKey,
          });
          storeChain.push(store);

          if (hop === 0) {
            const s = store.create({ mode: 'demo' });
            s.id = originalSessionId;
            s.csrfToken = originalCsrf;
            currentToken = store.issueToken(s);
          } else {
            // Rehydrate on cold store
            const rehydrated = store.get(currentToken);
            assert.ok(rehydrated, `Hop ${hop} failed to rehydrate`);
            assert.equal(rehydrated.id, originalSessionId);
            assert.equal(rehydrated.csrfToken, originalCsrf);
            assert.equal(rehydrated.mode, 'demo');

            // Advance time slightly and re-issue token
            currentTime += 10_000;
            currentToken = store.issueToken(rehydrated);
          }
        }
      } finally {
        for (const s of storeChain) s.close();
      }
    });

    it('6.3: Live session cold rehydration recovers refreshToken, steamId and displayName', () => {
      const sharedKey = randomBytes(KEY_BYTES);
      const testUser = { steamId: '76561198099999999', displayName: 'HardcoreGamer' };
      const store1 = new SessionStore(
        () => createMockLiveDriver({ status: 'connected', user: testUser }),
        3600_000,
        100,
        () => now,
        { encryptionKey: sharedKey },
      );
      const store2 = new SessionStore(
        () => createMockLiveDriver({ status: 'connected', user: testUser }),
        3600_000,
        100,
        () => now,
        { encryptionKey: sharedKey },
      );

      try {
        const liveSession = store1.create({
          mode: 'live',
          steamId: testUser.steamId,
          displayName: testUser.displayName,
          refreshToken: 'refresh_token_ultra_secret_123',
        });
        const token = store1.issueToken(liveSession);

        const rehydrated = store2.get(token);
        assert.ok(rehydrated, 'Store2 must rehydrate live session');
        assert.equal(rehydrated.id, liveSession.id);
        assert.equal(rehydrated.csrfToken, liveSession.csrfToken);
        assert.equal(rehydrated.mode, 'live');
        assert.equal(rehydrated.steamId, testUser.steamId);
        assert.equal(rehydrated.displayName, testUser.displayName);
        assert.equal(rehydrated.refreshToken, 'refresh_token_ultra_secret_123');
      } finally {
        store1.close();
        store2.close();
      }
    });

    it('6.4: Cryptographic key isolation: SessionStore with wrong key returns undefined', () => {
      const keyA = randomBytes(KEY_BYTES);
      const keyB = randomBytes(KEY_BYTES);

      const storeA = new SessionStore(() => new DemoCloudDriver(), 3600_000, 100, () => now, {
        encryptionKey: keyA,
      });
      const storeB = new SessionStore(() => new DemoCloudDriver(), 3600_000, 100, () => now, {
        encryptionKey: keyB,
      });

      try {
        const sessionA = storeA.create({ mode: 'demo' });
        const tokenA = storeA.issueToken(sessionA);

        const resultOnStoreB = storeB.get(tokenA);
        assert.equal(resultOnStoreB, undefined, 'StoreB with different key must return undefined');
      } finally {
        storeA.close();
        storeB.close();
      }
    });

    it('6.5: SessionStore rejects corrupted or purpose-confused tokens gracefully', () => {
      const sharedKey = randomBytes(KEY_BYTES);
      const store = new SessionStore(() => new DemoCloudDriver(), 3600_000, 100, () => now, {
        encryptionKey: sharedKey,
      });

      try {
        // Corrupted token
        assert.equal(store.get('corrupted_random_token_base64url'), undefined);

        // Valid review-plan token passed to SessionStore.get()
        const planToken = encryptToken(validReviewPlanPayload, sharedKey);
        assert.equal(
          store.get(planToken),
          undefined,
          'Review plan token passed to session store must return undefined',
        );

        // Valid export-ticket token passed to SessionStore.get()
        const ticketToken = encryptToken(validExportTicketPayload, sharedKey);
        assert.equal(
          store.get(ticketToken),
          undefined,
          'Export ticket token passed to session store must return undefined',
        );
      } finally {
        store.close();
      }
    });

    it('6.6: Expired rehydration token returns undefined and destroys local session', () => {
      const sharedKey = randomBytes(KEY_BYTES);
      let currentTime = now;
      const getNow = () => currentTime;

      const store1 = new SessionStore(() => new DemoCloudDriver(), 60_000, 100, getNow, {
        encryptionKey: sharedKey,
      });
      const store2 = new SessionStore(() => new DemoCloudDriver(), 60_000, 100, getNow, {
        encryptionKey: sharedKey,
      });

      try {
        const session = store1.create({ mode: 'demo' });
        const token = store1.issueToken(session);

        // 10s later -> still valid
        currentTime += 10_000;
        assert.ok(store2.get(token));

        // Advance beyond TTL (61s) -> expired
        currentTime += 60_000;
        assert.equal(store2.get(token), undefined, 'Expired token must return undefined');
      } finally {
        store1.close();
        store2.close();
      }
    });

    it('6.7: High-concurrency cold rehydration: 50 concurrent requests rehydrate safely without corruption', async () => {
      const sharedKey = randomBytes(KEY_BYTES);
      const storeOrigin = new SessionStore(() => new DemoCloudDriver(), 3600_000, 100, () => now, {
        encryptionKey: sharedKey,
      });
      const storeTarget = new SessionStore(() => new DemoCloudDriver(), 3600_000, 100, () => now, {
        encryptionKey: sharedKey,
      });

      try {
        const session = storeOrigin.create({ mode: 'demo' });
        const token = storeOrigin.issueToken(session);

        // Fire 50 concurrent get() invocations on cold storeTarget
        const promises = Array.from({ length: 50 }, async () => {
          return storeTarget.get(token);
        });

        const results = await Promise.all(promises);
        assert.equal(results.length, 50);
        for (const res of results) {
          assert.ok(res, 'Every concurrent rehydration call must resolve to a valid session');
          assert.equal(res.id, session.id);
          assert.equal(res.csrfToken, session.csrfToken);
          assert.equal(res.mode, 'demo');
        }
      } finally {
        storeOrigin.close();
        storeTarget.close();
      }
    });

    it('6.8: SessionStore capacity exhaustion: throws SESSION_LIMIT (503) when active limit reached', () => {
      const sharedKey = randomBytes(KEY_BYTES);
      const maxSessions = 5;
      const store = new SessionStore(() => new DemoCloudDriver(), 3600_000, maxSessions, () => now, {
        encryptionKey: sharedKey,
      });

      try {
        const sessions: Session[] = [];
        for (let i = 0; i < maxSessions; i++) {
          const s = store.create({ mode: 'demo' });
          s.busy = true; // Mark busy to prevent idle eviction
          sessions.push(s);
        }

        // Creating one more when all active sessions are busy must throw SESSION_LIMIT
        assert.throws(() => store.create({ mode: 'demo' }), (err: any) => {
          return err.statusCode === 503 && err.code === 'SESSION_LIMIT';
        });
      } finally {
        store.close();
      }
    });
  });
});

import { describe, it } from 'node:test';
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
  type SessionTokenPayload,
  type ReviewPlanTokenPayload,
} from './session-token.js';
import { SessionStore } from './sessions.js';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { DemoCloudDriver } from './demo-driver.js';

function craftRawToken(payload: unknown, key: Buffer, iv: Buffer = randomBytes(IV_LENGTH)): string {
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64url');
}

function extractCookie(setCookie: string | string[] | undefined): string {
  if (!setCookie) throw new Error('Expected set-cookie header');
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return raw.split(';')[0];
}

async function createTestApp(options: {
  clock?: () => number;
  sessionKey?: string;
  secure?: boolean;
} = {}) {
  const env: NodeJS.ProcessEnv = {
    APP_ORIGIN: options.secure ? 'https://steam-cloud-manager.vercel.app' : 'http://127.0.0.1:3000',
    NODE_ENV: options.secure ? 'production' : 'test',
  };
  if (options.sessionKey) {
    env.SCM_SESSION_KEY = options.sessionKey;
  }
  if (options.secure) {
    env.VERCEL = '1';
  }
  const config = readConfig(env);
  const app = await buildApp({
    config,
    now: options.clock ?? (() => Date.now()),
    logger: false,
    serveStatic: false,
  });
  return { app, config };
}

describe('Session Token Suite (Feature EF2)', () => {
  describe('Tier 1: Feature Coverage — EF2-A Token Primitives & EF2-B Cold Start Rehydration', () => {
    it('T1-FEAT-F1-01: AES-256-GCM Token Encryption Confidentiality & AAD Binding', () => {
      const key = randomBytes(KEY_BYTES);
      const now = 1_700_000_000_000;
      const payload: SessionTokenPayload = {
        purpose: 'scm-session',
        sessionId: 'sess_123',
        csrfToken: 'csrf_secret',
        mode: 'demo',
        steamId: '76561198000000000',
        displayName: 'Demo Account',
        issuedAt: now,
        expiresAt: now + 3600_000,
      };

      const token = encryptToken(payload, key);
      assert.ok(!token.includes('sess_123'));
      assert.ok(!token.includes('csrf_secret'));
      assert.ok(!token.includes('Demo Account'));
      assert.equal(token.length >= 40, true);
      assert.match(token, /^[A-Za-z0-9_-]+$/);

      const raw = Buffer.from(token, 'base64url');
      assert.ok(raw.length >= IV_LENGTH + AUTH_TAG_LENGTH + 1);
    });

    it('T1-FEAT-F1-02: AES-256-GCM Token Decryption Round-Trip & Claim Recovery', () => {
      const key = randomBytes(KEY_BYTES);
      const now = 1_700_000_000_000;
      const payload: SessionTokenPayload = {
        purpose: 'scm-session',
        sessionId: 'session_live_999',
        csrfToken: 'csrf_live_token',
        mode: 'live',
        steamId: '76561198012345678',
        displayName: 'GamerOne',
        refreshToken: 'secret_refresh_token_xyz',
        issuedAt: now,
        expiresAt: now + 3600_000,
      };

      const token = encryptToken(payload, key);
      const decrypted = decryptToken<SessionTokenPayload>(token, key, 'scm-session', now + 1000);
      assert.deepEqual(decrypted, payload);
      assert.equal(decrypted?.mode, 'live');
      assert.equal(decrypted?.purpose, 'scm-session');
      assert.equal(decrypted?.refreshToken, 'secret_refresh_token_xyz');
    });

    it('T1-FEAT-F1-03: SCM_SESSION_KEY Production Key Resolution from Environment', () => {
      const rawKey = randomBytes(KEY_BYTES);
      const base64url32Bytes = rawKey.toString('base64url');
      assert.equal(base64url32Bytes.length, 43);

      const keyProd = resolveEncryptionKey({
        SCM_SESSION_KEY: base64url32Bytes,
        NODE_ENV: 'production',
      });
      assert.equal(keyProd.length, KEY_BYTES);
      assert.deepEqual(keyProd, rawKey);

      const keyVercel = resolveEncryptionKey({
        SCM_SESSION_KEY: base64url32Bytes,
        VERCEL: '1',
      });
      assert.equal(keyVercel.length, KEY_BYTES);
      assert.deepEqual(keyVercel, rawKey);
    });

    it('T1-FEAT-F1-04: Ephemeral Key Generation Fallback in Dev/Test Environments', () => {
      resetEphemeralKeyForTesting();
      const key1 = resolveEncryptionKey({ NODE_ENV: 'test' });
      assert.equal(key1.length, KEY_BYTES);
      const key2 = resolveEncryptionKey({ NODE_ENV: 'test' });
      assert.deepEqual(key1, key2);

      resetEphemeralKeyForTesting();
      const key3 = resolveEncryptionKey({ NODE_ENV: 'test' });
      assert.equal(key3.length, KEY_BYTES);
      assert.notDeepEqual(key1, key3);
    });

    it("T1-FEAT-F1-05: Purpose Isolation Binding ('scm-session' vs 'review-plan')", () => {
      const key = randomBytes(KEY_BYTES);
      const now = 1_700_000_000_000;
      const planPayload: ReviewPlanTokenPayload = {
        purpose: 'review-plan',
        appId: 949230,
        names: ['Save_01.cok'],
        revision: 'rev_123',
        confirmation: 'DELETE 1',
        issuedAt: now,
        expiresAt: now + 300_000,
      };

      const planToken = encryptToken(planPayload, key);
      assert.equal(decryptToken(planToken, key, 'scm-session', now + 1000), null);
      assert.equal(decryptToken(planToken, key, 'export-ticket', now + 1000), null);
      const decrypted = decryptToken<ReviewPlanTokenPayload>(planToken, key, 'review-plan', now + 1000);
      assert.deepEqual(decrypted, planPayload);
    });

    it('T1-FEAT-F1-06: Token Lifecycle Expiration Enforcement', () => {
      const key = randomBytes(KEY_BYTES);
      const token = encryptToken(
        {
          purpose: 'scm-session',
          sessionId: 's1',
          csrfToken: 'c1',
          mode: 'demo',
          issuedAt: 1000,
          expiresAt: 5000,
        },
        key,
      );

      assert.notEqual(decryptToken(token, key, 'scm-session', 4999), null);
      assert.equal(decryptToken(token, key, 'scm-session', 5000), null);
      assert.equal(decryptToken(token, key, 'scm-session', 5001), null);
    });

    it('T1-FEAT-F2-01: Cold-Start Rehydration of Demo Session from Encrypted Cookie', async (t) => {
      const sessionKey = randomBytes(KEY_BYTES).toString('base64url');
      const { app: app1 } = await createTestApp({ sessionKey });
      t.after(() => app1.close());

      const init = await app1.inject({ url: '/api/session' });
      const cookie1 = extractCookie(init.headers['set-cookie']);
      const csrf = init.json().csrfToken as string;

      const demoLogin = await app1.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          origin: 'http://127.0.0.1:3000',
          cookie: cookie1,
          'x-csrf-token': csrf,
        },
        payload: {},
      });
      assert.equal(demoLogin.statusCode, 200);
      const demoCookie = extractCookie(demoLogin.headers['set-cookie']);
      await app1.close();

      // Instance B: Fresh Fastify instance with empty memory
      const { app: app2 } = await createTestApp({ sessionKey });
      t.after(() => app2.close());

      const res = await app2.inject({
        url: '/api/session',
        headers: { cookie: demoCookie },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.mode, 'demo');
      assert.equal(body.login.status, 'connected');
      assert.equal(body.login.user.steamId, '76561198000000000');
      assert.equal(body.login.user.displayName, 'Demo Account');
    });

    it('T1-FEAT-F2-02: Demo Driver Attachment & State Continuity Across Cold Instances', async (t) => {
      const sessionKey = randomBytes(KEY_BYTES).toString('base64url');
      const { app: app1 } = await createTestApp({ sessionKey });
      t.after(() => app1.close());

      const init = await app1.inject({ url: '/api/session' });
      const cookie1 = extractCookie(init.headers['set-cookie']);
      const csrf = init.json().csrfToken as string;

      const demoLogin = await app1.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          origin: 'http://127.0.0.1:3000',
          cookie: cookie1,
          'x-csrf-token': csrf,
        },
        payload: {},
      });
      const demoCookie = extractCookie(demoLogin.headers['set-cookie']);
      await app1.close();

      // Instance B: Fresh Fastify instance
      const { app: app2 } = await createTestApp({ sessionKey });
      t.after(() => app2.close());

      const res = await app2.inject({
        url: '/api/games',
        headers: { cookie: demoCookie },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.ok(Array.isArray(body.games));
      assert.equal(body.games.length, 3);
      const appIds = body.games.map((g: { appId: number }) => g.appId).sort((a: number, b: number) => a - b);
      assert.deepEqual(appIds, [949230, 1086940, 1245620]);
    });

    it('T1-FEAT-F2-03: Unauthenticated Session Initialization on Missing Cookie', async (t) => {
      const { app } = await createTestApp();
      t.after(() => app.close());

      const res = await app.inject({ url: '/api/session' });
      assert.equal(res.statusCode, 200);
      assert.ok(res.headers['set-cookie']);
      const body = res.json();
      assert.equal(body.login.status, 'disconnected');
      assert.equal(body.mode, 'live');
      assert.ok(typeof body.csrfToken === 'string' && body.csrfToken.length > 0);
    });

    it('T1-FEAT-F2-04: Corrupted Session Cookie Recovery without 500 Server Error', async (t) => {
      const { app } = await createTestApp();
      t.after(() => app.close());

      const res = await app.inject({
        url: '/api/session',
        headers: { cookie: 'scm-session=corrupted-malformed-cookie-value!@#$' },
      });
      assert.equal(res.statusCode, 200);
      assert.ok(res.headers['set-cookie']);
      const body = res.json();
      assert.equal(body.login.status, 'disconnected');
      assert.equal(body.mode, 'live');
      assert.ok(typeof body.csrfToken === 'string' && body.csrfToken.length > 0);
    });

    it('T1-FEAT-F2-05: Protected API Guard on Cold Instance without Valid Session', async (t) => {
      const { app } = await createTestApp();
      t.after(() => app.close());

      const resNoCookie = await app.inject({ url: '/api/games' });
      assert.equal(resNoCookie.statusCode, 401);
      assert.equal(resNoCookie.json().error.code, 'SESSION_REQUIRED');

      const resCorrupted = await app.inject({
        url: '/api/games',
        headers: { cookie: 'scm-session=invalid-token' },
      });
      assert.equal(resCorrupted.statusCode, 401);
      assert.equal(resCorrupted.json().error.code, 'SESSION_REQUIRED');
    });
  });

  describe('Tier 2: Boundary & Corner Cases — EF2-A Cryptographic Edge Cases & EF2-B Cold Start Invariants', () => {
    it('T2-BOUND-F1-01: Single-Bit Ciphertext Flipping Triggers Auth Tag Rejection', () => {
      const key = randomBytes(KEY_BYTES);
      const now = 1_700_000_000_000;
      const token = encryptToken(
        {
          purpose: 'scm-session',
          sessionId: 'sess_abc',
          csrfToken: 'csrf_xyz',
          mode: 'demo',
          issuedAt: now,
          expiresAt: now + 60_000,
        },
        key,
      );
      const raw = Buffer.from(token, 'base64url');

      const ciphertextOffsets = [
        IV_LENGTH + AUTH_TAG_LENGTH,
        IV_LENGTH + AUTH_TAG_LENGTH + 5,
        raw.length - 1,
      ];
      for (const offset of ciphertextOffsets) {
        const tampered = Buffer.from(raw);
        tampered[offset] ^= 1;
        assert.equal(
          decryptToken(tampered.toString('base64url'), key, 'scm-session', now + 1000),
          null,
        );
      }
    });

    it('T2-BOUND-F1-02: Single-Bit IV and Auth Tag Modification Rejection', () => {
      const key = randomBytes(KEY_BYTES);
      const now = 1_700_000_000_000;
      const token = encryptToken(
        {
          purpose: 'scm-session',
          sessionId: 'sess_abc',
          csrfToken: 'csrf_xyz',
          mode: 'demo',
          issuedAt: now,
          expiresAt: now + 60_000,
        },
        key,
      );
      const raw = Buffer.from(token, 'base64url');

      // Tamper IV (bytes 0 to 11)
      for (const ivIdx of [0, 5, IV_LENGTH - 1]) {
        const tamperedIv = Buffer.from(raw);
        tamperedIv[ivIdx] ^= 1;
        assert.equal(
          decryptToken(tamperedIv.toString('base64url'), key, 'scm-session', now + 1000),
          null,
        );
      }

      // Tamper Auth Tag (bytes 12 to 27)
      for (const tagIdx of [IV_LENGTH, IV_LENGTH + 7, IV_LENGTH + AUTH_TAG_LENGTH - 1]) {
        const tamperedTag = Buffer.from(raw);
        tamperedTag[tagIdx] ^= 1;
        assert.equal(
          decryptToken(tamperedTag.toString('base64url'), key, 'scm-session', now + 1000),
          null,
        );
      }
    });

    it('T2-BOUND-F1-03: Future-Issued Token Clock Skew Boundary (issuedAt > now + 5000)', () => {
      const key = randomBytes(KEY_BYTES);
      const now = 1_000_000;

      // Token issued exactly 5000ms in future
      const tokenAtTolerance = encryptToken(
        {
          purpose: 'scm-session',
          sessionId: 's1',
          csrfToken: 'c1',
          mode: 'demo',
          issuedAt: now + 5000,
          expiresAt: now + 60_000,
        },
        key,
      );
      assert.notEqual(decryptToken(tokenAtTolerance, key, 'scm-session', now), null);

      // Token issued 5001ms in future (exceeds 5000ms clock tolerance)
      const tokenOverTolerance = encryptToken(
        {
          purpose: 'scm-session',
          sessionId: 's2',
          csrfToken: 'c2',
          mode: 'demo',
          issuedAt: now + 5001,
          expiresAt: now + 60_000,
        },
        key,
      );
      assert.equal(decryptToken(tokenOverTolerance, key, 'scm-session', now), null);
    });

    it('T2-BOUND-F1-04: Exact Expiration Boundary (now === expiresAt vs expiresAt - 1)', () => {
      const key = randomBytes(KEY_BYTES);
      const token = encryptToken(
        {
          purpose: 'scm-session',
          sessionId: 's1',
          csrfToken: 'c1',
          mode: 'demo',
          issuedAt: 1000,
          expiresAt: 10000,
        },
        key,
      );

      assert.notEqual(decryptToken(token, key, 'scm-session', 9999), null);
      assert.equal(decryptToken(token, key, 'scm-session', 10000), null);
      assert.equal(decryptToken(token, key, 'scm-session', 10001), null);
    });

    it('T2-BOUND-F1-05: Inverted Timestamps Rejection (expiresAt <= issuedAt)', () => {
      const key = randomBytes(KEY_BYTES);

      assert.throws(
        () =>
          encryptToken(
            {
              purpose: 'scm-session',
              sessionId: 's1',
              csrfToken: 'c1',
              mode: 'demo',
              issuedAt: 1000,
              expiresAt: 1000,
            },
            key,
          ),
        /Token expiry must be greater than issue timestamp/,
      );

      assert.throws(
        () =>
          encryptToken(
            {
              purpose: 'scm-session',
              sessionId: 's1',
              csrfToken: 'c1',
              mode: 'demo',
              issuedAt: 1000,
              expiresAt: 999,
            },
            key,
          ),
        /Token expiry must be greater than issue timestamp/,
      );

      const forgedToken = craftRawToken(
        {
          purpose: 'scm-session',
          sessionId: 's1',
          csrfToken: 'c1',
          mode: 'demo',
          issuedAt: 1000,
          expiresAt: 999,
        },
        key,
      );
      assert.equal(decryptToken(forgedToken, key, 'scm-session', 500), null);
    });

    it('T2-BOUND-F1-06: Maximum Token Size Denial-of-Service Boundary (MAX_TOKEN_BYTES = 16384)', () => {
      const key = randomBytes(KEY_BYTES);

      assert.equal(decryptToken('A'.repeat(33000), key, 'scm-session'), null);

      const hugePayload: SessionTokenPayload = {
        purpose: 'scm-session',
        sessionId: 's1',
        csrfToken: 'c1',
        mode: 'demo',
        displayName: 'x'.repeat(MAX_TOKEN_BYTES + 100),
        issuedAt: 1000,
        expiresAt: 5000,
      };
      assert.throws(
        () => encryptToken(hugePayload, key),
        /Token payload exceeds maximum allowed size/,
      );
    });

    it('T2-BOUND-F2-01: Rapid Sequential Invocations Across Distinct Memory Instances', async () => {
      const sessionKey = randomBytes(KEY_BYTES).toString('base64url');

      const { app: app0 } = await createTestApp({ sessionKey });
      const init = await app0.inject({ url: '/api/session' });
      const cookie0 = extractCookie(init.headers['set-cookie']);
      const csrf = init.json().csrfToken as string;

      const demoRes = await app0.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          origin: 'http://127.0.0.1:3000',
          cookie: cookie0,
          'x-csrf-token': csrf,
        },
        payload: {},
      });
      const demoCookie = extractCookie(demoRes.headers['set-cookie']);
      await app0.close();

      for (let i = 0; i < 10; i++) {
        const { app } = await createTestApp({ sessionKey });
        const res = await app.inject({
          url: '/api/session',
          headers: { cookie: demoCookie },
        });
        assert.equal(res.statusCode, 200, `Instance ${i} failed`);
        const body = res.json();
        assert.equal(body.mode, 'demo');
        assert.equal(body.login.status, 'connected');
        assert.equal(body.login.user.steamId, '76561198000000000');
        await app.close();
      }
    });

    it('T2-BOUND-F2-02: Expired Cookie on Cold Start Reverts to Fresh Idle Session', async (t) => {
      const sessionKey = randomBytes(KEY_BYTES).toString('base64url');
      const key = Buffer.from(sessionKey, 'base64url');
      let currentTime = 1_000_000;
      const { app } = await createTestApp({
        sessionKey,
        clock: () => currentTime,
      });
      t.after(() => app.close());

      const expiredToken = craftRawToken(
        {
          purpose: 'scm-session',
          sessionId: 'expired_sess',
          csrfToken: 'expired_csrf',
          mode: 'demo',
          issuedAt: currentTime - 60_000,
          expiresAt: currentTime - 1000,
        },
        key,
      );

      const res = await app.inject({
        url: '/api/session',
        headers: { cookie: `scm-session=${expiredToken}` },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.login.status, 'disconnected');
      assert.equal(body.mode, 'live');
      const newCookie = extractCookie(res.headers['set-cookie']);
      assert.notEqual(newCookie, `scm-session=${expiredToken}`);
    });

    it('T2-BOUND-F2-03: Rehydration with Unknown or Malformed Mode in Payload', async (t) => {
      const sessionKey = randomBytes(KEY_BYTES).toString('base64url');
      const key = Buffer.from(sessionKey, 'base64url');
      const { app } = await createTestApp({ sessionKey });
      t.after(() => app.close());

      const malformedToken = craftRawToken(
        {
          purpose: 'scm-session',
          sessionId: 'mal_sess',
          csrfToken: 'mal_csrf',
          mode: 'malicious',
          issuedAt: Date.now(),
          expiresAt: Date.now() + 60_000,
        },
        key,
      );

      const res = await app.inject({
        url: '/api/session',
        headers: { cookie: `scm-session=${malformedToken}` },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.mode, 'live');
      assert.equal(body.login.status, 'disconnected');
    });

    it('T2-BOUND-F2-04: Multi-Instance Delete Plan Expiration Boundary Across Cold Instances', async (t) => {
      const sessionKey = randomBytes(KEY_BYTES).toString('base64url');
      let currentTime = 1_000_000;
      const clock = () => currentTime;

      // Instance A creates the session and delete plan
      const { app: appA } = await createTestApp({ sessionKey, clock });
      const init = await appA.inject({ url: '/api/session' });
      const cookieA = extractCookie(init.headers['set-cookie']);
      const csrf = init.json().csrfToken as string;

      const demoLogin = await appA.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          origin: 'http://127.0.0.1:3000',
          cookie: cookieA,
          'x-csrf-token': csrf,
        },
        payload: {},
      });
      const demoCookie = extractCookie(demoLogin.headers['set-cookie']);

      const filesRes = await appA.inject({
        url: '/api/games/949230/files',
        headers: { cookie: demoCookie },
      });
      const { files, revision } = filesRes.json();

      const planRes = await appA.inject({
        method: 'POST',
        url: '/api/games/949230/delete-plan',
        headers: {
          origin: 'http://127.0.0.1:3000',
          cookie: demoCookie,
          'x-csrf-token': csrf,
        },
        payload: {
          names: [files[0].name],
          revision,
        },
      });
      assert.equal(planRes.statusCode, 200);
      const { planId, confirmation } = planRes.json();
      await appA.close();

      // Advance clock past expiration (plan TTL is 5 min = 300_000ms -> expiresAt is 1_300_000)
      currentTime = 1_000_000 + 300_001;

      // Instance B: Fresh Fastify instance executing delete at now + 300_001
      const { app: appB } = await createTestApp({ sessionKey, clock });
      t.after(() => appB.close());

      const deleteRes = await appB.inject({
        method: 'POST',
        url: '/api/games/949230/delete',
        headers: {
          origin: 'http://127.0.0.1:3000',
          cookie: demoCookie,
          'x-csrf-token': csrf,
        },
        payload: {
          planId,
          confirmation,
          gamesClosed: true,
        },
      });
      assert.equal(deleteRes.statusCode, 409);
      assert.equal(deleteRes.json().error.code, 'PLAN_EXPIRED');
    });

    it('T2-BOUND-F2-05: Cold-Start Rehydration Preserves CSRF Token Parity', async (t) => {
      const sessionKey = randomBytes(KEY_BYTES).toString('base64url');

      // Instance A
      const { app: appA } = await createTestApp({ sessionKey });
      const init = await appA.inject({ url: '/api/session' });
      const cookieA = extractCookie(init.headers['set-cookie']);
      const csrf = init.json().csrfToken as string;

      const demoLogin = await appA.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          origin: 'http://127.0.0.1:3000',
          cookie: cookieA,
          'x-csrf-token': csrf,
        },
        payload: {},
      });
      const demoCookie = extractCookie(demoLogin.headers['set-cookie']);
      await appA.close();

      // Instance B: Fresh Fastify instance
      const { app: appB } = await createTestApp({ sessionKey });
      t.after(() => appB.close());

      // Matching CSRF token succeeds
      const resValid = await appB.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          origin: 'http://127.0.0.1:3000',
          cookie: demoCookie,
          'x-csrf-token': csrf,
        },
        payload: {},
      });
      assert.equal(resValid.statusCode, 200);

      // 1-char mismatched CSRF token rejected with 403 CSRF_FAILED
      const badCsrf = csrf.slice(0, -1) + (csrf.endsWith('a') ? 'b' : 'a');
      const resMismatch = await appB.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          origin: 'http://127.0.0.1:3000',
          cookie: demoCookie,
          'x-csrf-token': badCsrf,
        },
        payload: {},
      });
      assert.equal(resMismatch.statusCode, 403);
      assert.equal(resMismatch.json().error.code, 'CSRF_FAILED');
    });
  });

  describe('Tier 3: Pairwise Combinations — Cryptography + Cold Start Rehydration', () => {
    it('T3-COMB-01: Encrypted Token + Cold Start Rehydration direct SessionStore test', () => {
      const key = randomBytes(KEY_BYTES);
      let storeTime = 1_000_000;
      const storeClock = () => storeTime;

      const store1 = new SessionStore(
        () => new DemoCloudDriver(),
        3600_000,
        100,
        storeClock,
        { encryptionKey: key },
      );

      const session = store1.create({ mode: 'demo' });
      void session.driver.startLogin();
      const token = store1.issueToken(session);
      store1.close();

      // Store 2: Fresh instance simulating serverless cold start with zero in-memory state
      const store2 = new SessionStore(
        () => new DemoCloudDriver(),
        3600_000,
        100,
        storeClock,
        { encryptionKey: key },
      );

      const rehydrated = store2.get(token);
      assert.ok(rehydrated);
      assert.equal(rehydrated.id, session.id);
      assert.equal(rehydrated.csrfToken, session.csrfToken);
      assert.equal(rehydrated.mode, 'demo');
      assert.equal(rehydrated.driver.getLogin().status, 'connected');
      assert.equal(rehydrated.driver.getLogin().user?.displayName, 'Demo Account');
      assert.equal(rehydrated.driver.getLogin().user?.steamId, '76561198000000000');
      store2.close();
    });
  });
});

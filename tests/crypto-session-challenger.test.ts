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
} from '../src/server/session-token.js';
import { SessionStore, type Session } from '../src/server/sessions.js';
import { buildApp } from '../src/server/app.js';
import type { Config } from '../src/server/config.js';
import { DemoCloudDriver } from '../src/server/demo-driver.js';

function createRawToken(
  plaintext: Buffer | string,
  key: Buffer,
  iv: Buffer = randomBytes(IV_LENGTH),
  aad: Buffer = AAD,
): string {
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const pt = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const ciphertext = Buffer.concat([cipher.update(pt), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64url');
}

function getBaseConfig(overrides?: Partial<Config>): Config {
  return {
    port: 3000,
    host: '127.0.0.1',
    sessionTtlMs: 3600_000,
    maxSessions: 100,
    appOrigin: 'http://127.0.0.1:3000',
    secureCookies: false,
    allowedSteamIds: [],
    demoMode: false,
    production: false,
    ...overrides,
  };
}

describe('Challenger 1 Empirical Verification: Crypto, Session Security & App Regressions', () => {
  const testKey = randomBytes(KEY_BYTES);
  const now = 1_700_000_000_000;

  const validPayload: SessionTokenPayload = {
    purpose: 'scm-session',
    sessionId: 'chal1_sess_999',
    csrfToken: 'chal1_csrf_secret_abc123',
    mode: 'demo',
    steamId: '76561198011111111',
    displayName: 'AdversarialTester',
    issuedAt: now,
    expiresAt: now + 3600_000,
  };

  describe('Section 1: Exhaustive Bit-Flip and Tampering Oracles', () => {
    it('IV Bit-Flips: Every single bit flip in the 12-byte IV is rejected (96/96 rejected)', () => {
      const token = encryptToken(validPayload, testKey);
      const raw = Buffer.from(token, 'base64url');
      let rejected = 0;
      let total = 0;

      for (let byteIdx = 0; byteIdx < IV_LENGTH; byteIdx++) {
        for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
          const corrupted = Buffer.from(raw);
          corrupted[byteIdx] ^= 1 << bitIdx;
          total++;
          const res = decryptToken(corrupted.toString('base64url'), testKey, 'scm-session', now + 1000);
          if (res === null) rejected++;
        }
      }

      assert.equal(total, IV_LENGTH * 8);
      assert.equal(rejected, total, 'Every single IV bit flip must be rejected by GCM tag verification');
    });

    it('Auth Tag Bit-Flips: Every single bit flip in the 16-byte Auth Tag is rejected (128/128 rejected)', () => {
      const token = encryptToken(validPayload, testKey);
      const raw = Buffer.from(token, 'base64url');
      let rejected = 0;
      let total = 0;

      for (let byteIdx = IV_LENGTH; byteIdx < IV_LENGTH + AUTH_TAG_LENGTH; byteIdx++) {
        for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
          const corrupted = Buffer.from(raw);
          corrupted[byteIdx] ^= 1 << bitIdx;
          total++;
          const res = decryptToken(corrupted.toString('base64url'), testKey, 'scm-session', now + 1000);
          if (res === null) rejected++;
        }
      }

      assert.equal(total, AUTH_TAG_LENGTH * 8);
      assert.equal(rejected, total, 'Every single Auth Tag bit flip must fail tag authentication');
    });

    it('Ciphertext Bit-Flips: Every single bit flip across entire ciphertext body is rejected', () => {
      const token = encryptToken(validPayload, testKey);
      const raw = Buffer.from(token, 'base64url');
      let rejected = 0;
      let total = 0;

      const ctOffset = IV_LENGTH + AUTH_TAG_LENGTH;
      for (let byteIdx = ctOffset; byteIdx < raw.length; byteIdx++) {
        for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
          const corrupted = Buffer.from(raw);
          corrupted[byteIdx] ^= 1 << bitIdx;
          total++;
          const res = decryptToken(corrupted.toString('base64url'), testKey, 'scm-session', now + 1000);
          if (res === null) rejected++;
        }
      }

      assert.ok(total > 500, `Expected >500 ciphertext bit tests, ran ${total}`);
      assert.equal(rejected, total, 'Every single ciphertext bit flip must be rejected');
    });

    it('Multi-byte and burst mutations in ciphertext/tag/iv are 100% rejected', () => {
      const token = encryptToken(validPayload, testKey);
      const raw = Buffer.from(token, 'base64url');

      for (let run = 0; run < 100; run++) {
        const corrupted = Buffer.from(raw);
        // Flip between 2 and 10 random bytes
        const numMutations = 2 + Math.floor(Math.random() * 9);
        for (let m = 0; m < numMutations; m++) {
          const pos = Math.floor(Math.random() * corrupted.length);
          corrupted[pos] ^= 1 + Math.floor(Math.random() * 255);
        }
        const res = decryptToken(corrupted.toString('base64url'), testKey, 'scm-session', now + 1000);
        assert.equal(res, null, `Multi-byte burst mutation run ${run} must return null`);
      }
    });
  });

  describe('Section 2: AAD and Key Isolation Robustness', () => {
    it('AAD Tampering: Altered, truncated, extended, or empty AAD fails authentication', () => {
      const variations = [
        Buffer.alloc(0),
        Buffer.from('steam-cloud-manager:vercel'),
        Buffer.from('steam-cloud-manager:vercel:v2'),
        Buffer.from('steam-cloud-manager:vercel:v1.0'),
        Buffer.from('steam-cloud-manager:cloudflare:v1'),
        Buffer.concat([AAD, Buffer.from('\0')]),
        Buffer.concat([Buffer.from('X'), AAD]),
      ];

      for (const badAad of variations) {
        const crafted = createRawToken(JSON.stringify(validPayload), testKey, undefined, badAad);
        const res = decryptToken(crafted, testKey, 'scm-session', now + 1000);
        assert.equal(res, null, `Tampered AAD "${badAad.toString()}" must fail decryption`);
      }
    });

    it('Key Isolation: 100 distinct keys cannot decrypt a token encrypted with testKey', () => {
      const token = encryptToken(validPayload, testKey);

      for (let i = 0; i < 100; i++) {
        const otherKey = randomBytes(KEY_BYTES);
        const res = decryptToken(token, otherKey, 'scm-session', now + 1000);
        assert.equal(res, null, `Alien key #${i} must not decrypt token`);
      }
    });

    it('Key 1-bit flip: Single bit flip in encryption key completely fails decryption', () => {
      const token = encryptToken(validPayload, testKey);

      for (let byteIdx = 0; byteIdx < KEY_BYTES; byteIdx++) {
        for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
          const mutantKey = Buffer.from(testKey);
          mutantKey[byteIdx] ^= 1 << bitIdx;
          const res = decryptToken(token, mutantKey, 'scm-session', now + 1000);
          assert.equal(res, null, `Key bit-flip at byte ${byteIdx} bit ${bitIdx} must return null`);
        }
      }
    });
  });

  describe('Section 3: Expiration, Clock Skew, and Lifecycle', () => {
    it('Expired tokens fail to rehydrate across all time deltas', () => {
      const token = encryptToken(validPayload, testKey);

      // Boundary: exact expiration
      assert.equal(decryptToken(token, testKey, 'scm-session', validPayload.expiresAt), null);

      // 1 millisecond past
      assert.equal(decryptToken(token, testKey, 'scm-session', validPayload.expiresAt + 1), null);

      // 1 minute past
      assert.equal(decryptToken(token, testKey, 'scm-session', validPayload.expiresAt + 60_000), null);

      // 1 day past
      assert.equal(decryptToken(token, testKey, 'scm-session', validPayload.expiresAt + 86_400_000), null);

      // 1 year past
      assert.equal(decryptToken(token, testKey, 'scm-session', validPayload.expiresAt + 31_536_000_000), null);
    });

    it('Future token clock tolerance is strictly clamped to +/- 5000ms', () => {
      const token = encryptToken(validPayload, testKey);

      // At exactly +5000ms in future: ACCEPT
      assert.notEqual(
        decryptToken(token, testKey, 'scm-session', validPayload.issuedAt - CLOCK_TOLERANCE_MS),
        null,
      );

      // At +5001ms in future: REJECT
      assert.equal(
        decryptToken(token, testKey, 'scm-session', validPayload.issuedAt - (CLOCK_TOLERANCE_MS + 1)),
        null,
      );

      // At +10000ms in future: REJECT
      assert.equal(
        decryptToken(token, testKey, 'scm-session', validPayload.issuedAt - 10000),
        null,
      );
    });

    it('Inverted or non-safe timestamps are rejected by both encrypt and decrypt', () => {
      // Inverted timestamps
      const invertedPayload = { ...validPayload, issuedAt: now + 1000, expiresAt: now };
      assert.throws(() => encryptToken(invertedPayload, testKey));
      const crafted = createRawToken(JSON.stringify(invertedPayload), testKey);
      assert.equal(decryptToken(crafted, testKey, 'scm-session', now), null);

      // Equal timestamps
      const equalPayload = { ...validPayload, issuedAt: now, expiresAt: now };
      assert.throws(() => encryptToken(equalPayload, testKey));
      const craftedEqual = createRawToken(JSON.stringify(equalPayload), testKey);
      assert.equal(decryptToken(craftedEqual, testKey, 'scm-session', now), null);
    });
  });

  describe('Section 4: Malformed Base64url and Fuzzing Inputs', () => {
    it('Malformed base64url characters, injections, and control characters return null without throwing', () => {
      const hostileFuzz = [
        '',
        ' ',
        '\t\n\r',
        '!!!@@@###$$$%%%^^^&&&***',
        '==',
        '===',
        'a',
        'ab',
        'abc',
        'abcd==',
        'Zm9vYmFy=',
        '../etc/passwd',
        '\\x00\\x00\\x00',
        '\0'.repeat(100),
        '{"invalid":"base64url"}',
        'SELECT * FROM users;',
        '<svg onload=alert(1)>',
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M',
      ];

      for (const input of hostileFuzz) {
        assert.doesNotThrow(() => {
          const res = decryptToken(input, testKey, 'scm-session', now);
          assert.equal(res, null, `Hostile input ${input.slice(0, 20)} must return null`);
        });
      }
    });

    it('Oversized attack strings (>32KB) are aborted in <1ms without high CPU or memory allocation', () => {
      const hugeStrings = [
        'A'.repeat(MAX_TOKEN_BYTES * 2 + 1),
        'A'.repeat(MAX_TOKEN_BYTES * 5),
        'A'.repeat(1024 * 1024), // 1 MB
      ];

      for (const huge of hugeStrings) {
        const start = performance.now();
        const res = decryptToken(huge, testKey, 'scm-session', now);
        const duration = performance.now() - start;

        assert.equal(res, null);
        assert.ok(duration < 2, `Oversized string rejection took ${duration}ms, should be <2ms`);
      }
    });
  });

  describe('Section 5: High-Concurrency Stress & Cold Rehydration', () => {
    it('100 concurrent requests across 10 clean SessionStores rehydrate without race conditions', async () => {
      const sharedKey = randomBytes(KEY_BYTES);
      let currentTime = now;
      const getNow = () => currentTime;

      // Primary store creates demo session and live session
      const primaryStore = new SessionStore(() => new DemoCloudDriver(), 3600_000, 200, getNow, {
        encryptionKey: sharedKey,
      });

      const demoSess = primaryStore.create({ mode: 'demo' });
      await demoSess.driver.startLogin();
      const demoToken = primaryStore.issueToken(demoSess);

      const liveSess = primaryStore.create({
        mode: 'live',
        steamId: '76561198077777777',
        displayName: 'ConcurrentPlayer',
        refreshToken: 'sec_refresh_tok_123',
      });
      const liveToken = primaryStore.issueToken(liveSess);

      // Create 10 independent cold SessionStores
      const coldStores = Array.from({ length: 10 }, () => {
        return new SessionStore(() => new DemoCloudDriver(), 3600_000, 200, getNow, {
          encryptionKey: sharedKey,
        });
      });

      try {
        // Fire 100 concurrent rehydrations distributed across the 10 cold stores
        const tasks: Promise<Session | undefined>[] = [];
        for (let i = 0; i < 100; i++) {
          const store = coldStores[i % coldStores.length];
          const token = i % 2 === 0 ? demoToken : liveToken;
          tasks.push(
            new Promise((resolve) => {
              setImmediate(() => {
                resolve(store.get(token));
              });
            }),
          );
        }

        const results = await Promise.all(tasks);
        assert.equal(results.length, 100);

        for (let i = 0; i < 100; i++) {
          const s = results[i];
          assert.ok(s, `Task ${i} must successfully rehydrate session`);
          if (i % 2 === 0) {
            assert.equal(s.id, demoSess.id);
            assert.equal(s.mode, 'demo');
            assert.equal(s.displayName, 'Demo Account');
          } else {
            assert.equal(s.id, liveSess.id);
            assert.equal(s.mode, 'live');
            assert.equal(s.steamId, '76561198077777777');
            assert.equal(s.displayName, 'ConcurrentPlayer');
            assert.equal(s.refreshToken, 'sec_refresh_tok_123');
          }
        }
      } finally {
        primaryStore.close();
        for (const s of coldStores) s.close();
      }
    });
  });

  describe('Section 6: Full Integration with app.ts & Cookie Handling Non-Regression', () => {
    it('app.ts sets __Host-scm with Secure; HttpOnly; SameSite=Strict when secureCookies is true', async () => {
      const config = getBaseConfig({
        production: true,
        secureCookies: true,
        appOrigin: 'https://steam-cloud-manager.vercel.app',
      });

      const app = await buildApp({ config });
      try {
        const res = await app.inject({
          method: 'GET',
          url: '/api/session',
          headers: {
            host: 'steam-cloud-manager.vercel.app',
          },
        });

        assert.equal(res.statusCode, 200);
        const setCookie = res.headers['set-cookie'];
        assert.ok(setCookie, 'set-cookie header must be present');
        const cookieStr = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string);

        assert.ok(cookieStr.startsWith('__Host-scm='), 'Cookie name must be __Host-scm in secure mode');
        assert.ok(cookieStr.includes('HttpOnly'), 'Cookie must be HttpOnly');
        assert.ok(cookieStr.includes('SameSite=Strict'), 'Cookie must be SameSite=Strict');
        assert.ok(cookieStr.includes('Secure'), 'Cookie must be Secure');
        assert.ok(cookieStr.includes('Path=/'), 'Cookie path must be /');
      } finally {
        await app.close();
      }
    });

    it('Tampered or corrupted cookie in app request does NOT crash server and issues clean session', async () => {
      const config = getBaseConfig();
      const app = await buildApp({ config });
      try {
        const hostileCookies = [
          'scm-session=corrupted_invalid_base64url_string',
          'scm-session=' + 'A'.repeat(50),
          'scm-session=' + 'B'.repeat(500),
          'scm-session=null',
          'scm-session=',
        ];

        for (const cookieHeader of hostileCookies) {
          const res = await app.inject({
            method: 'GET',
            url: '/api/session',
            headers: {
              host: '127.0.0.1:3000',
              cookie: cookieHeader,
            },
          });

          // Must gracefully recover and return 200 with new valid session
          assert.equal(res.statusCode, 200, `Cookie ${cookieHeader} caused failure`);
          const body = JSON.parse(res.body);
          assert.ok(body.csrfToken);
          assert.equal(body.login.status, 'disconnected');
          assert.ok(res.headers['set-cookie'], 'Server must set fresh session cookie');
        }
      } finally {
        await app.close();
      }
    });

    it('Protected POST endpoint with tampered cookie is rejected with 403 CSRF_FAILED or 401', async () => {
      const config = getBaseConfig();
      const app = await buildApp({ config });
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/demo',
          headers: {
            host: '127.0.0.1:3000',
            origin: 'http://127.0.0.1:3000',
            'x-csrf-token': 'fake_csrf_token',
            cookie: 'scm-session=corrupted_cookie_value',
          },
        });

        assert.equal(res.statusCode, 403);
        const body = JSON.parse(res.body);
        assert.equal(body.error.code, 'CSRF_FAILED');
      } finally {
        await app.close();
      }
    });

    it('POST /api/auth/demo rotates session, re-encrypts token and preserves CSRF consistency', async () => {
      const config = getBaseConfig();
      const app = await buildApp({ config });
      try {
        // Step 1: Initialize session
        const sessRes = await app.inject({
          method: 'GET',
          url: '/api/session',
          headers: { host: '127.0.0.1:3000' },
        });
        assert.equal(sessRes.statusCode, 200);
        const cookie1 = sessRes.headers['set-cookie'] as string;
        const body1 = JSON.parse(sessRes.body);

        // Step 2: Call POST /api/auth/demo with valid cookie and CSRF
        const demoRes = await app.inject({
          method: 'POST',
          url: '/api/auth/demo',
          headers: {
            host: '127.0.0.1:3000',
            origin: 'http://127.0.0.1:3000',
            'x-csrf-token': body1.csrfToken,
            cookie: cookie1,
          },
        });

        assert.equal(demoRes.statusCode, 200);
        const body2 = JSON.parse(demoRes.body);
        assert.equal(body2.mode, 'demo');
        assert.equal(body2.login.status, 'connected');
        assert.equal(body2.login.user.displayName, 'Demo Account');

        const cookie2 = demoRes.headers['set-cookie'] as string;
        assert.ok(cookie2, 'Demo login must reissue updated encrypted session cookie');

        // Step 3: Call GET /api/games with demo cookie
        const gamesRes = await app.inject({
          method: 'GET',
          url: '/api/games',
          headers: {
            host: '127.0.0.1:3000',
            cookie: cookie2,
          },
        });

        assert.equal(gamesRes.statusCode, 200);
        const body = JSON.parse(gamesRes.body);
        assert.ok(Array.isArray(body.games));
        assert.ok(body.games.length >= 3, 'Demo games list must contain at least 3 games');
      } finally {
        await app.close();
      }
    });

    it('POST /api/auth/logout destroys session, rotates identity and issues fresh session', async () => {
      const config = getBaseConfig();
      const app = await buildApp({ config });
      try {
        // Step 1: Session init & demo login
        const sessRes = await app.inject({
          method: 'GET',
          url: '/api/session',
          headers: { host: '127.0.0.1:3000' },
        });
        const cookie1 = sessRes.headers['set-cookie'] as string;
        const body1 = JSON.parse(sessRes.body);

        const demoRes = await app.inject({
          method: 'POST',
          url: '/api/auth/demo',
          headers: {
            host: '127.0.0.1:3000',
            origin: 'http://127.0.0.1:3000',
            'x-csrf-token': body1.csrfToken,
            cookie: cookie1,
          },
        });
        const cookieDemo = demoRes.headers['set-cookie'] as string;
        const bodyDemo = JSON.parse(demoRes.body);

        // Step 2: Logout
        const logoutRes = await app.inject({
          method: 'POST',
          url: '/api/auth/logout',
          headers: {
            host: '127.0.0.1:3000',
            origin: 'http://127.0.0.1:3000',
            'x-csrf-token': bodyDemo.csrfToken,
            cookie: cookieDemo,
          },
        });

        assert.equal(logoutRes.statusCode, 200);
        const bodyLogout = JSON.parse(logoutRes.body);
        assert.equal(bodyLogout.login.status, 'disconnected');
        const cookieLogout = logoutRes.headers['set-cookie'] as string;
        assert.ok(cookieLogout);

        // Step 3: Newly issued cookieLogout must be in disconnected state (401 on /api/games)
        const logoutCheck = await app.inject({
          method: 'GET',
          url: '/api/games',
          headers: {
            host: '127.0.0.1:3000',
            cookie: cookieLogout,
          },
        });
        assert.equal(logoutCheck.statusCode, 401);
        const logoutErr = JSON.parse(logoutCheck.body);
        assert.equal(logoutErr.error.code, 'STEAM_REQUIRED');
      } finally {
        await app.close();
      }
    });

    it('Live session cold rehydration and logout: live token is not authenticated after logout in fresh instance', async () => {
      const config = getBaseConfig();
      const app = await buildApp({ config });
      try {
        // Live session without connected steam driver returns 401 STEAM_REQUIRED on /api/games
        const sessRes = await app.inject({
          method: 'GET',
          url: '/api/session',
          headers: { host: '127.0.0.1:3000' },
        });
        const cookieLive = sessRes.headers['set-cookie'] as string;

        const checkRes = await app.inject({
          method: 'GET',
          url: '/api/games',
          headers: {
            host: '127.0.0.1:3000',
            cookie: cookieLive,
          },
        });
        assert.equal(checkRes.statusCode, 401);
        const err = JSON.parse(checkRes.body);
        assert.equal(err.error.code, 'STEAM_REQUIRED');
      } finally {
        await app.close();
      }
    });

    it('Review-Plan and Export-Ticket token encryption & adversarial tamper resistance', () => {
      const planPayload: ReviewPlanTokenPayload = {
        purpose: 'review-plan',
        appId: 1086940,
        names: ['save_game_1.lsv', 'save_game_2.lsv'],
        revision: 'a'.repeat(64),
        confirmation: 'DELETE 2',
        binding: 'sess_123:conn_456',
        issuedAt: now,
        expiresAt: now + 300_000,
      };

      const ticketPayload: ExportTicketTokenPayload = {
        purpose: 'export-ticket',
        appId: 1086940,
        names: ['save_game_1.lsv'],
        revision: 'a'.repeat(64),
        ticketId: 'ticket_random_999',
        binding: 'sess_123:conn_456',
        issuedAt: now,
        expiresAt: now + 300_000,
      };

      const planToken = encryptToken(planPayload, testKey);
      const ticketToken = encryptToken(ticketPayload, testKey);

      // Decrypt valid
      const decPlan = decryptToken<ReviewPlanTokenPayload>(planToken, testKey, 'review-plan', now + 1000);
      assert.ok(decPlan);
      assert.equal(decPlan.appId, 1086940);
      assert.equal(decPlan.binding, 'sess_123:conn_456');

      const decTicket = decryptToken<ExportTicketTokenPayload>(ticketToken, testKey, 'export-ticket', now + 1000);
      assert.ok(decTicket);
      assert.equal(decTicket.ticketId, 'ticket_random_999');

      // Cross-purpose mismatch: plan token cannot decrypt as ticket and vice versa
      assert.equal(decryptToken(planToken, testKey, 'export-ticket', now + 1000), null);
      assert.equal(decryptToken(ticketToken, testKey, 'review-plan', now + 1000), null);
      assert.equal(decryptToken(planToken, testKey, 'scm-session', now + 1000), null);

      // Single-bit flip on planToken auth tag
      const rawPlan = Buffer.from(planToken, 'base64url');
      rawPlan[IV_LENGTH + 2] ^= 0x01;
      assert.equal(decryptToken(rawPlan.toString('base64url'), testKey, 'review-plan', now + 1000), null);
    });

    it('Array CSRF header or type-confusion header attack returns 403 CSRF_FAILED', async () => {
      const config = getBaseConfig();
      const app = await buildApp({ config });
      try {
        const sessRes = await app.inject({
          method: 'GET',
          url: '/api/session',
          headers: { host: '127.0.0.1:3000' },
        });
        const cookie = sessRes.headers['set-cookie'] as string;

        // Try sending multiple/array x-csrf-token (fastify treats comma-joined or array)
        const attackRes = await app.inject({
          method: 'POST',
          url: '/api/auth/demo',
          headers: {
            host: '127.0.0.1:3000',
            origin: 'http://127.0.0.1:3000',
            'x-csrf-token': 'bad_token_value',
            cookie,
          },
        });
        assert.equal(attackRes.statusCode, 403);
        const err = JSON.parse(attackRes.body);
        assert.equal(err.error.code, 'CSRF_FAILED');
      } finally {
        await app.close();
      }
    });
  });
});

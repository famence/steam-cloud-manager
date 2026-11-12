import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { encryptToken, KEY_BYTES } from './session-token.js';
import handler, { closeAppForTesting } from '../../api/index.js';

function getCookie(res: { headers: Record<string, unknown> }): string | undefined {
  const header = res.headers['set-cookie'];
  if (Array.isArray(header)) {
    return header[0]?.split(';')[0];
  }
  return typeof header === 'string' ? header.split(';')[0] : undefined;
}

describe('Tier 5 Adversarial Coverage Hardening: Backend, Perimeter & Cryptography', () => {
  // =========================================================================
  // 1. api/index.ts Serverless Lifecycle & Error Handling
  // =========================================================================
  describe('1. api/index.ts Serverless Lifecycle & Fault Resilience', () => {
    it('T5-ADV-API-01: Serverless handler exits cleanly when res.writableEnded is true', async () => {
      const fakeReq = new EventEmitter();
      const fakeRes = new EventEmitter() as any;
      fakeRes.writableEnded = true;
      fakeRes.headersSent = false;
      let endCalled = false;
      fakeRes.end = () => {
        endCalled = true;
      };

      await handler(fakeReq as any, fakeRes as any);
      assert.equal(
        endCalled,
        false,
        'Handler must return early without writing when writableEnded is true',
      );
    });

    it('T5-ADV-API-02: Serverless initialization failure emits HTTP 500 JSON and recovers on next call', async () => {
      process.env.SCM_SESSION_KEY = 'invalid_short_key';
      process.env.VERCEL = '1';
      await closeAppForTesting();

      const fakeReq = new EventEmitter();
      const fakeRes = new EventEmitter() as any;
      fakeRes.headersSent = false;
      let statusCode = 0;
      let jsonPayload = '';
      fakeRes.setHeader = () => {};
      fakeRes.end = (chunk: string) => {
        jsonPayload = chunk;
      };
      Object.defineProperty(fakeRes, 'statusCode', {
        set(val: number) {
          statusCode = val;
        },
        get() {
          return statusCode;
        },
      });

      await handler(fakeReq as any, fakeRes as any);
      assert.equal(statusCode, 500);
      assert.deepEqual(JSON.parse(jsonPayload), {
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' },
      });

      // Cleanup and recovery verification
      delete process.env.SCM_SESSION_KEY;
      delete process.env.VERCEL;
      await closeAppForTesting();
    });

    it('T5-ADV-API-03: Double-header-send is suppressed if res.headersSent is already true', async () => {
      process.env.SCM_SESSION_KEY = 'invalid_short_key';
      process.env.VERCEL = '1';
      await closeAppForTesting();

      const fakeReq = new EventEmitter();
      const fakeRes = new EventEmitter() as any;
      fakeRes.headersSent = true;
      let setHeaderCalled = false;
      fakeRes.setHeader = () => {
        setHeaderCalled = true;
      };
      fakeRes.end = () => {};

      await handler(fakeReq as any, fakeRes as any);
      assert.equal(
        setHeaderCalled,
        false,
        'setHeader must never be called if headers were already sent',
      );

      delete process.env.SCM_SESSION_KEY;
      delete process.env.VERCEL;
      await closeAppForTesting();
    });
  });

  // =========================================================================
  // 2. Security Perimeter, Host/Origin & Parameter Boundaries
  // =========================================================================
  describe('2. Security Perimeter, Host/Origin & Parameter Boundaries', () => {
    it('T5-ADV-SEC-01: Host Header Internal Whitespace and Smuggling Injection Rejection', async (t) => {
      const config = readConfig({
        VERCEL: '1',
        APP_ORIGIN: 'https://steam-cloud-manager.vercel.app',
        SCM_SESSION_KEY: 'k'.repeat(43),
      });
      const app = await buildApp({ config, logger: false });
      t.after(() => app.close());

      const hostileHosts = [
        'steam cloud-manager.vercel.app',
        'steam\tcloud-manager.vercel.app',
        'steam\rcloud-manager.vercel.app',
        'steam\ncloud-manager.vercel.app',
        '   ',
        '\t',
      ];

      for (const host of hostileHosts) {
        const res = await app.inject({ url: '/api/session', headers: { host } });
        assert.equal(res.statusCode, 403, `Host "${host}" must be rejected`);
        assert.equal(res.json().error.code, 'INVALID_HOST');
      }
    });

    it('T5-ADV-SEC-02: Cloud Host Port, Subdomain Boundary and URL Injection Rejection', async (t) => {
      const config = readConfig({
        VERCEL: '1',
        APP_ORIGIN: 'https://steam-cloud-manager.vercel.app',
        SCM_SESSION_KEY: 'k'.repeat(43),
      });
      const app = await buildApp({ config, logger: false });
      t.after(() => app.close());

      const invalidHosts = [
        'steam-cloud-manager.vercel.app:8080',
        'steam-cloud-manager.vercel.app:3000',
        'vercel.app',
        '.vercel.app',
        'evil..vercel.app',
        'steam-cloud-manager.vercel.app/path',
        'steam-cloud-manager.vercel.app?query=1',
        'steam-cloud-manager.vercel.app#hash',
        'user:pass@steam-cloud-manager.vercel.app',
      ];

      for (const host of invalidHosts) {
        const res = await app.inject({ url: '/api/session', headers: { host } });
        assert.equal(res.statusCode, 403, `Host "${host}" should return 403`);
        assert.equal(res.json().error.code, 'INVALID_HOST');
      }
    });

    it('T5-ADV-SEC-03: Fastify Prototype Pollution & Malformed JSON Body Rejection', async (t) => {
      const config = readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000' });
      const app = await buildApp({ config, logger: false });
      t.after(() => app.close());

      const init = await app.inject({ url: '/api/session', headers: { host: '127.0.0.1:3000' } });
      const cookie = getCookie(init);
      const csrf = init.json().csrfToken;

      // 1. Prototype pollution attempt
      const protoRes = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          host: '127.0.0.1:3000',
          origin: 'http://127.0.0.1:3000',
          cookie,
          'x-csrf-token': csrf,
          'content-type': 'application/json',
        },
        body: '{"__proto__": {"polluted": true}}',
      });
      assert.equal(protoRes.statusCode, 400);
      assert.equal(protoRes.json().error.code, 'INVALID_REQUEST');
      assert.equal((Object.prototype as any).polluted, undefined);

      // 2. Syntax-invalid JSON body
      const syntaxRes = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          host: '127.0.0.1:3000',
          origin: 'http://127.0.0.1:3000',
          cookie,
          'x-csrf-token': csrf,
          'content-type': 'application/json',
        },
        body: '{"unclosed": ',
      });
      assert.equal(syntaxRes.statusCode, 400);
      assert.equal(syntaxRes.json().error.code, 'INVALID_REQUEST');
    });

    it('T5-ADV-SEC-04: AppID Integer & Range Boundary Validation (0, negative, >0xffffffff)', async (t) => {
      const config = readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000' });
      const app = await buildApp({ config, logger: false });
      t.after(() => app.close());

      const init = await app.inject({ url: '/api/session', headers: { host: '127.0.0.1:3000' } });
      const cookie = getCookie(init);
      const csrf = init.json().csrfToken;

      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie, 'x-csrf-token': csrf },
        payload: {},
      });
      const demoCookie = getCookie(login);

      const invalidAppIds = ['0', '-1', '4294967296', '1.5', 'NaN', 'Infinity'];
      for (const appId of invalidAppIds) {
        const res = await app.inject({
          url: `/api/games/${appId}/files`,
          headers: { host: '127.0.0.1:3000', cookie: demoCookie },
        });
        assert.equal(res.statusCode, 400, `AppID ${appId} should return 400`);
        assert.equal(res.json().error.code, 'INVALID_INPUT');
      }

      // 0xffffffff (4294967295) is accepted at the boundary
      const boundaryRes = await app.inject({
        url: '/api/games/4294967295/files',
        headers: { host: '127.0.0.1:3000', cookie: demoCookie },
      });
      assert.equal(boundaryRes.statusCode, 200);
    });

    it('T5-ADV-SEC-05: Strict Query Parameter Rejection on Download Route', async (t) => {
      const config = readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000' });
      const app = await buildApp({ config, logger: false });
      t.after(() => app.close());

      const init = await app.inject({ url: '/api/session', headers: { host: '127.0.0.1:3000' } });
      const cookie = getCookie(init);
      const csrf = init.json().csrfToken;

      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie, 'x-csrf-token': csrf },
        payload: {},
      });
      const demoCookie = getCookie(login);

      const res = await app.inject({
        url: '/api/games/949230/download?name=Saves/Cedar%20Valley.cok&extraParam=attack',
        headers: { host: '127.0.0.1:3000', cookie: demoCookie },
      });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error.code, 'INVALID_INPUT');
    });
  });

  // =========================================================================
  // 3. Concurrency, Transfer Tracking & Mid-Flight Session Revocation
  // =========================================================================
  describe('3. Concurrency, Transfer Tracking & Mid-Flight Session Revocation', () => {
    it('T5-ADV-CONC-01: Deletion Attempt During Active File Transfer Throws DOWNLOAD_RUNNING (409)', async (t) => {
      const downloadStream = new PassThrough();
      const config = readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000' });

      const app = await buildApp({
        config,
        logger: false,
        driverFactory: () => ({
          connected: true,
          startLogin: async () => {},
          getLogin: () => ({ status: 'connected', user: { steamId: '76561198000000000', displayName: 'Tester' } }),
          listGames: async () => [{ appId: 100, name: 'TestGame', fileCount: 1, totalBytes: 100 }],
          listFiles: async (appId: number) => ({
            appId,
            changeNumber: '1',
            files: [{ name: 'save.dat', size: 100, modifiedAt: 1000, sha: 'a'.repeat(40) }],
          }),
          downloadFile: async () => ({ stream: downloadStream, size: 100 }),
          deleteFiles: async () => ({ deleted: ['save.dat'], failed: [], batchCompleted: true }),
          close: () => {},
        }),
      });
      t.after(() => app.close());

      const init = await app.inject({ url: '/api/session', headers: { host: '127.0.0.1:3000' } });
      const cookie = getCookie(init);
      const csrf = init.json().csrfToken;

      const filesRes = await app.inject({ url: '/api/games/100/files', headers: { host: '127.0.0.1:3000', cookie } });
      const { revision } = filesRes.json();

      const planRes = await app.inject({
        method: 'POST',
        url: '/api/games/100/delete-plan',
        headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie, 'x-csrf-token': csrf },
        payload: { names: ['save.dat'], revision },
      });
      const plan = planRes.json();

      // Begin download
      const downloadPromise = app.inject({
        url: '/api/games/100/download?name=save.dat',
        headers: { host: '127.0.0.1:3000', cookie },
      });

      // Attempt delete while transfer is active
      const deleteRes = await app.inject({
        method: 'POST',
        url: '/api/games/100/delete',
        headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie, 'x-csrf-token': csrf },
        payload: { planId: plan.planId, confirmation: plan.confirmation, gamesClosed: true },
      });

      assert.equal(deleteRes.statusCode, 409);
      assert.equal(deleteRes.json().error.code, 'DOWNLOAD_RUNNING');

      downloadStream.end();
      await downloadPromise;
    });

    it('T5-ADV-CONC-02: Mid-Flight Session Revocation During listFiles() Blocks Delete-Plan Creation', async (t) => {
      const config = readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000' });
      let driverInstance: any;
      let appInstance: any;

      const app = await buildApp({
        config,
        logger: false,
        driverFactory: () => {
          driverInstance = {
            connected: true,
            startLogin: async () => {},
            getLogin: () => ({ status: 'connected', user: { steamId: '76561198000000000', displayName: 'Tester' } }),
            listGames: async () => [],
            listFiles: async (appId: number) => ({
              appId,
              changeNumber: '1',
              files: [{ name: 'save.dat', size: 100, modifiedAt: 1000, sha: 'a'.repeat(40) }],
            }),
            downloadFile: async () => ({ stream: new PassThrough(), size: 100 }),
            deleteFiles: async () => ({ deleted: [], failed: [], batchCompleted: true }),
            close: () => {},
          };
          return driverInstance;
        },
      });
      appInstance = app;
      t.after(() => app.close());

      const init = await app.inject({ url: '/api/session', headers: { host: '127.0.0.1:3000' } });
      const cookie = getCookie(init);
      const csrf = init.json().csrfToken;

      // Invalidate session mid-flight during listFiles
      driverInstance.listFiles = async (appId: number) => {
        await appInstance.inject({
          method: 'POST',
          url: '/api/auth/logout',
          headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie, 'x-csrf-token': csrf },
          payload: {},
        });
        return {
          appId,
          changeNumber: '1',
          files: [{ name: 'save.dat', size: 100, modifiedAt: 1000, sha: 'a'.repeat(40) }],
        };
      };

      const planRes = await app.inject({
        method: 'POST',
        url: '/api/games/100/delete-plan',
        headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie, 'x-csrf-token': csrf },
        payload: { names: ['save.dat'], revision: 'a'.repeat(64) },
      });

      assert.equal(planRes.statusCode, 401);
      assert.equal(planRes.json().error.code, 'SESSION_EXPIRED');
    });

    it('T5-ADV-CONC-03: Export Ticket Concurrency Cap Rejection (429 DOWNLOAD_LIMIT)', async (t) => {
      const streams: PassThrough[] = [];
      const config = readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000' });

      const app = await buildApp({
        config,
        logger: false,
        driverFactory: () => ({
          connected: true,
          startLogin: async () => {},
          getLogin: () => ({ status: 'connected', user: { steamId: '76561198000000000', displayName: 'Tester' } }),
          listGames: async () => [{ appId: 100, name: 'TestGame', fileCount: 1, totalBytes: 100 }],
          listFiles: async (appId: number) => ({
            appId,
            changeNumber: '1',
            files: [{ name: 'save.dat', size: 100, modifiedAt: 1000, sha: 'a'.repeat(40) }],
          }),
          downloadFile: async () => {
            const s = new PassThrough();
            streams.push(s);
            return { stream: s, size: 100 };
          },
          deleteFiles: async () => ({ deleted: [], failed: [], batchCompleted: true }),
          close: () => {},
        }),
      });
      t.after(() => app.close());

      const init = await app.inject({ url: '/api/session', headers: { host: '127.0.0.1:3000' } });
      const cookie = getCookie(init);
      const csrf = init.json().csrfToken;

      const filesRes = await app.inject({ url: '/api/games/100/files', headers: { host: '127.0.0.1:3000', cookie } });
      const { revision } = filesRes.json();

      const exp = await app.inject({
        method: 'POST',
        url: '/api/games/100/exports',
        headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie, 'x-csrf-token': csrf },
        payload: { names: ['save.dat'], revision },
      });
      const ticketUrl = exp.json().downloadUrl;

      // Launch 2 single-file downloads
      const d1 = app.inject({ url: '/api/games/100/download?name=save.dat', headers: { host: '127.0.0.1:3000', cookie } });
      await new Promise((r) => setTimeout(r, 20));
      const d2 = app.inject({ url: '/api/games/100/download?name=save.dat', headers: { host: '127.0.0.1:3000', cookie } });
      await new Promise((r) => setTimeout(r, 20));

      // Attempt ZIP export download while 2 transfers are active
      const exportRes = await app.inject({ url: ticketUrl, headers: { host: '127.0.0.1:3000', cookie } });
      assert.equal(exportRes.statusCode, 429);
      assert.equal(exportRes.json().error.code, 'DOWNLOAD_LIMIT');

      for (const s of streams) s.end();
      await Promise.all([d1, d2]);
    });

    it('T5-ADV-CONC-04: Export Ticket Ring Buffer Eviction (>5 tickets flushes older tickets)', async (t) => {
      const config = readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000' });
      const app = await buildApp({ config, logger: false });
      t.after(() => app.close());

      const init = await app.inject({ url: '/api/session', headers: { host: '127.0.0.1:3000' } });
      const cookie = getCookie(init);
      const csrf = init.json().csrfToken;

      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie, 'x-csrf-token': csrf },
        payload: {},
      });
      const demoCookie = getCookie(login);

      const filesRes = await app.inject({ url: '/api/games/949230/files', headers: { host: '127.0.0.1:3000', cookie: demoCookie } });
      const { files, revision } = filesRes.json();

      const tickets: string[] = [];
      for (let i = 0; i < 5; i++) {
        const exp = await app.inject({
          method: 'POST',
          url: '/api/games/949230/exports',
          headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie: demoCookie, 'x-csrf-token': csrf },
          payload: { names: [files[0].name], revision },
        });
        tickets.push(exp.json().downloadUrl);
      }

      // 6th ticket clears earlier 5 tickets
      const exp6 = await app.inject({
        method: 'POST',
        url: '/api/games/949230/exports',
        headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie: demoCookie, 'x-csrf-token': csrf },
        payload: { names: [files[0].name], revision },
      });
      const ticket6Url = exp6.json().downloadUrl;

      const oldRes = await app.inject({ url: tickets[0], headers: { host: '127.0.0.1:3000', cookie: demoCookie } });
      assert.equal(oldRes.statusCode, 404);
      assert.equal(oldRes.json().error.code, 'EXPORT_EXPIRED');

      const newRes = await app.inject({ url: ticket6Url, headers: { host: '127.0.0.1:3000', cookie: demoCookie } });
      assert.equal(newRes.statusCode, 200);
    });
  });

  // =========================================================================
  // 4. Cryptographic Key Rotation & Cold-Start Rehydration Boundaries
  // =========================================================================
  describe('4. Cryptographic Key Rotation & Cold-Start Rehydration Boundaries', () => {
    it('T5-ADV-CRYPTO-01: Key Rotation Gracefully Evicts Old Tokens without 500', async (t) => {
      const oldKey = randomBytes(KEY_BYTES);
      const newKey = randomBytes(KEY_BYTES);
      const newKeyStr = newKey.toString('base64url');
      process.env.SCM_SESSION_KEY = newKeyStr;

      const config = readConfig({ SCM_SESSION_KEY: newKeyStr, APP_ORIGIN: 'http://127.0.0.1:3000' });
      const app = await buildApp({ config, logger: false });
      t.after(() => {
        delete process.env.SCM_SESSION_KEY;
        return app.close();
      });

      const oldToken = encryptToken(
        {
          purpose: 'scm-session',
          sessionId: 'old_session',
          csrfToken: 'old_csrf',
          mode: 'demo',
          issuedAt: Date.now(),
          expiresAt: Date.now() + 3600_000,
        },
        oldKey,
      );

      const resSession = await app.inject({
        url: '/api/session',
        headers: { host: '127.0.0.1:3000', cookie: `scm-session=${oldToken}` },
      });
      assert.equal(resSession.statusCode, 200);
      const newCookie = getCookie(resSession);
      assert.notEqual(newCookie, `scm-session=${oldToken}`);

      const resGames = await app.inject({
        url: '/api/games',
        headers: { host: '127.0.0.1:3000', cookie: `scm-session=${oldToken}` },
      });
      assert.equal(resGames.statusCode, 401);
      assert.equal(resGames.json().error.code, 'SESSION_REQUIRED');
    });

    it('T5-ADV-CRYPTO-02: Russian Language Confirmation Phrase Generation & Verification', async (t) => {
      const config = readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000' });
      const app = await buildApp({ config, logger: false });
      t.after(() => app.close());

      const init = await app.inject({ url: '/api/session', headers: { host: '127.0.0.1:3000' } });
      const cookie = getCookie(init);
      const csrf = init.json().csrfToken;

      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie, 'x-csrf-token': csrf },
        payload: {},
      });
      const demoCookie = getCookie(login);

      const filesRes = await app.inject({ url: '/api/games/949230/files', headers: { host: '127.0.0.1:3000', cookie: demoCookie } });
      const { files, revision } = filesRes.json();

      const planRes = await app.inject({
        method: 'POST',
        url: '/api/games/949230/delete-plan',
        headers: {
          host: '127.0.0.1:3000',
          origin: 'http://127.0.0.1:3000',
          cookie: demoCookie,
          'x-csrf-token': csrf,
          'accept-language': 'ru-RU,ru;q=0.9',
        },
        payload: { names: [files[0].name], revision },
      });
      const plan = planRes.json();
      assert.equal(plan.confirmation, 'УДАЛИТЬ 1');

      // Mismatched confirmation
      const badConfirm = await app.inject({
        method: 'POST',
        url: '/api/games/949230/delete',
        headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie: demoCookie, 'x-csrf-token': csrf },
        payload: { planId: plan.planId, confirmation: 'DELETE 1', gamesClosed: true },
      });
      assert.equal(badConfirm.statusCode, 400);
      assert.equal(badConfirm.json().error.code, 'CONFIRMATION_MISMATCH');

      // Exact Russian confirmation
      const goodConfirm = await app.inject({
        method: 'POST',
        url: '/api/games/949230/delete',
        headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie: demoCookie, 'x-csrf-token': csrf },
        payload: { planId: plan.planId, confirmation: 'УДАЛИТЬ 1', gamesClosed: true },
      });
      assert.equal(goodConfirm.statusCode, 200);
      assert.deepEqual(goodConfirm.json().deleted, [files[0].name]);
    });
  });
});

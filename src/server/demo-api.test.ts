import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { buildApp } from './app.js';
import { readConfig, type Config } from './config.js';
import { DemoCloudDriver } from './demo-driver.js';
import {
  decryptToken,
  KEY_BYTES,
  resetEphemeralKeyForTesting,
  type SessionTokenPayload,
} from './session-token.js';

function extractCookie(setCookie: string | string[] | undefined): string {
  if (!setCookie) throw new Error('Expected set-cookie header in response');
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return raw.split(';')[0].trim();
}

async function createTestApp(
  options: {
    clock?: () => number;
    sessionKey?: string;
    secure?: boolean;
  } = {},
) {
  const env: NodeJS.ProcessEnv = {
    APP_ORIGIN: options.secure
      ? 'https://steam-cloud-manager.vercel.app'
      : 'http://127.0.0.1:3000',
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

function createTestClient(
  app: any,
  options: { host?: string; origin?: string; secure?: boolean } = {},
) {
  const host =
    options.host || (options.secure ? 'steam-cloud-manager.vercel.app' : '127.0.0.1:3000');
  const origin =
    options.origin ||
    (options.secure ? 'https://steam-cloud-manager.vercel.app' : 'http://127.0.0.1:3000');
  let cookie: string | undefined;
  let csrf: string | undefined;

  function updateState(res: any) {
    const sc = res.headers['set-cookie'];
    if (sc) {
      cookie = extractCookie(sc);
    }
    try {
      const json = res.json();
      if (json && typeof json.csrfToken === 'string') {
        csrf = json.csrfToken;
      }
    } catch {
      // Non-JSON responses leave CSRF unchanged
    }
  }

  return {
    get cookie() {
      return cookie;
    },
    set cookie(val: string | undefined) {
      cookie = val;
    },
    get csrf() {
      return csrf;
    },
    set csrf(val: string | undefined) {
      csrf = val;
    },
    host,
    origin,

    async get(url: string, headers: Record<string, string> = {}) {
      const res = await app.inject({
        method: 'GET',
        url,
        headers: {
          host,
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
      });
      updateState(res);
      return res;
    },

    async post(url: string, payload: unknown = {}, headers: Record<string, string> = {}) {
      const res = await app.inject({
        method: 'POST',
        url,
        headers: {
          host,
          origin,
          ...(cookie ? { cookie } : {}),
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
          ...headers,
        },
        payload: payload as Record<string, unknown>,
      });
      updateState(res);
      return res;
    },

    async initSession() {
      return this.get('/api/session');
    },

    async demoLogin() {
      if (!cookie || !csrf) {
        await this.initSession();
      }
      return this.post('/api/auth/demo', {});
    },

    async logout() {
      return this.post('/api/auth/logout', {});
    },
  };
}

describe('Demo Mode API Lifecycle Suite (Feature EF4)', () => {
  describe('Tier 1: Feature Coverage — EF4 Demo Mode API Lifecycle', () => {
    it('T1-FEAT-F4-01: 1-Click Demo Mode Login (POST /api/auth/demo)', async (t) => {
      const { app } = await createTestApp();
      t.after(() => app.close());
      const client = createTestClient(app);

      const initRes = await client.initSession();
      assert.equal(initRes.statusCode, 200);
      assert.equal(initRes.json().mode, 'live');
      assert.equal(initRes.json().login.status, 'disconnected');
      assert.ok(client.cookie);
      assert.ok(client.csrf);

      const loginRes = await client.demoLogin();
      assert.equal(loginRes.statusCode, 200);
      const body = loginRes.json();
      assert.equal(body.mode, 'demo');
      assert.equal(body.login.status, 'connected');
      assert.equal(body.login.user.steamId, '76561198000000000');
      assert.equal(body.login.user.displayName, 'Demo Account');
      assert.ok(loginRes.headers['set-cookie']);

      // Subsequent session check retains demo connection
      const checkRes = await client.get('/api/session');
      assert.equal(checkRes.statusCode, 200);
      assert.equal(checkRes.json().mode, 'demo');
      assert.equal(checkRes.json().login.status, 'connected');
      assert.equal(checkRes.json().login.user.steamId, '76561198000000000');
    });

    it('T1-FEAT-F4-02: Demo Library Listing (GET /api/games)', async (t) => {
      const { app } = await createTestApp();
      t.after(() => app.close());
      const client = createTestClient(app);
      await client.demoLogin();

      const res = await client.get('/api/games');
      assert.equal(res.statusCode, 200);
      const { games } = res.json();
      assert.equal(games.length, 3);

      const appIds = games.map((g: any) => g.appId).sort((a: number, b: number) => a - b);
      assert.deepEqual(appIds, [949230, 1086940, 1245620]);

      const names = games.map((g: any) => g.name).sort();
      assert.deepEqual(names, ["Baldur's Gate 3", 'Cities: Skylines II', 'ELDEN RING'].sort());

      for (const game of games) {
        assert.ok(game.fileCount > 0, `Game ${game.appId} must have files`);
        assert.ok(game.totalBytes > 0, `Game ${game.appId} must have non-zero size`);
      }
    });

    it('T1-FEAT-F4-03: Demo File Listing & Single Save Streaming Download', async (t) => {
      const { app } = await createTestApp();
      t.after(() => app.close());
      const client = createTestClient(app);
      await client.demoLogin();

      const filesRes = await client.get('/api/games/949230/files');
      assert.equal(filesRes.statusCode, 200);
      const filesBody = filesRes.json();
      assert.equal(filesBody.appId, 949230);
      assert.equal(filesBody.files.length, 6);
      assert.match(filesBody.revision, /^[a-f0-9]{64}$/);

      const target = filesBody.files.find((f: any) => f.name === 'Saves/Cedar Valley.cok');
      assert.ok(target, 'Target save file must exist');
      assert.ok(target.size > 0);
      assert.match(target.sha, /^[a-f0-9]{40}$/);

      const downRes = await client.get('/api/games/949230/download?name=Saves/Cedar%20Valley.cok');
      assert.equal(downRes.statusCode, 200);
      assert.equal(downRes.headers['content-type'], 'application/octet-stream');
      assert.equal(downRes.headers['cache-control'], 'no-store');
      assert.equal(downRes.headers['content-length'], String(target.size));

      const disp = downRes.headers['content-disposition'] as string;
      assert.ok(disp);
      assert.match(
        disp,
        /^attachment;\s*filename="Cedar Valley\.cok";\s*filename\*=UTF-8''Cedar%20Valley\.cok$/,
      );
      assert.ok(!disp.includes('\r') && !disp.includes('\n'), 'CRLF must be absent');

      assert.equal(downRes.rawPayload.length, target.size);
      const computedSha = createHash('sha1').update(downRes.rawPayload).digest('hex');
      assert.equal(computedSha, target.sha);
      assert.ok(downRes.rawPayload.toString('utf8').includes('DEMO ONLY — this is not a real game save.'));
    });

    it('T1-FEAT-F4-04: Demo ZIP Export Ticket Creation and Retrieval', async (t) => {
      const { app } = await createTestApp();
      t.after(() => app.close());
      const client = createTestClient(app);
      await client.demoLogin();

      const filesRes = await client.get('/api/games/949230/files');
      const { revision } = filesRes.json();

      const exportRes = await client.post('/api/games/949230/exports', {
        names: ['Saves/Cedar Valley.cok', 'Settings.coc'],
        revision,
      });
      assert.equal(exportRes.statusCode, 200);
      const { downloadUrl } = exportRes.json();
      assert.match(downloadUrl, /^\/api\/exports\/[\w-]{43}$/);

      const zipRes = await client.get(downloadUrl);
      assert.equal(zipRes.statusCode, 200);
      assert.equal(zipRes.headers['content-type'], 'application/zip');
      assert.match(zipRes.headers['content-disposition'] as string, /steam-cloud-949230\.zip/);

      // Verify ZIP magic bytes PK\x03\x04
      assert.equal(zipRes.rawPayload.subarray(0, 2).toString('latin1'), 'PK');
      assert.deepEqual(zipRes.rawPayload.subarray(0, 4), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      assert.equal(zipRes.rawPayload.readUInt32LE(0), 0x04034b50);
      assert.ok(zipRes.rawPayload.includes(Buffer.from('manifest.json')));
      assert.ok(zipRes.rawPayload.includes(Buffer.from('DEMO ONLY')));

      // Second retrieval: single-use ticket must be consumed and expired
      const zipRes2 = await client.get(downloadUrl);
      assert.equal(zipRes2.statusCode, 404);
      assert.equal(zipRes2.json().error.code, 'EXPORT_EXPIRED');
    });

    it('T1-FEAT-F4-05: Two-Phase Deletion Confirmation in Demo Mode', async (t) => {
      const { app } = await createTestApp();
      t.after(() => app.close());
      const client = createTestClient(app);
      await client.demoLogin();

      const filesBefore = await client.get('/api/games/949230/files');
      assert.equal(filesBefore.json().files.length, 6);
      const { revision } = filesBefore.json();

      const planRes = await client.post('/api/games/949230/delete-plan', {
        names: ['Settings.coc'],
        revision,
      });
      assert.equal(planRes.statusCode, 200);
      const plan = planRes.json();
      assert.equal(plan.confirmation, 'DELETE 1');
      assert.equal(plan.files.length, 1);
      assert.deepEqual(plan.names, ['Settings.coc']);
      assert.ok(plan.totalBytes > 0);
      assert.ok(typeof plan.planId === 'string' && plan.planId.length > 20);
      assert.equal(plan.revision, undefined);

      const delRes = await client.post('/api/games/949230/delete', {
        planId: plan.planId,
        confirmation: 'DELETE 1',
        gamesClosed: true,
      });
      assert.equal(delRes.statusCode, 200);
      const delBody = delRes.json();
      assert.equal(delBody.batchCompleted, true);
      assert.deepEqual(delBody.deleted, ['Settings.coc']);
      assert.deepEqual(delBody.failed, []);

      const filesAfter = await client.get('/api/games/949230/files');
      assert.equal(filesAfter.json().files.length, 5);
      assert.ok(!filesAfter.json().files.some((f: any) => f.name === 'Settings.coc'));
    });

    it('T1-FEAT-F4-06: Demo Session Logout & Identity Cleanup (POST /api/auth/logout)', async (t) => {
      const { app } = await createTestApp();
      t.after(() => app.close());
      const client = createTestClient(app);
      await client.demoLogin();

      const gamesRes = await client.get('/api/games');
      assert.equal(gamesRes.statusCode, 200);

      const oldDemoCookie = client.cookie!;
      const logoutRes = await client.logout();
      assert.equal(logoutRes.statusCode, 200);
      const body = logoutRes.json();
      assert.equal(body.mode, 'live');
      assert.equal(body.login.status, 'disconnected');
      assert.notEqual(client.cookie, oldDemoCookie);

      // Accessing /api/games with post-logout session fails with STEAM_REQUIRED
      const resGamesAfter = await client.get('/api/games');
      assert.equal(resGamesAfter.statusCode, 401);
      assert.equal(resGamesAfter.json().error.code, 'STEAM_REQUIRED');

      // Accessing /api/games without any session cookie fails with SESSION_REQUIRED
      const noCookieRes = await app.inject({
        url: '/api/games',
        headers: { host: client.host },
      });
      assert.equal(noCookieRes.statusCode, 401);
      assert.equal(noCookieRes.json().error.code, 'SESSION_REQUIRED');
    });
  });

  describe('Tier 2: Boundary & Corner Cases — EF4 Demo Boundaries & Resource Limits', () => {
    it('T2-BOUND-F4-01: Rapid Repeated Clicks to POST /api/auth/demo (Idempotence)', async (t) => {
      const { app } = await createTestApp();
      t.after(() => app.close());
      const client = createTestClient(app);
      await client.initSession();

      const responses = [];
      for (let i = 0; i < 5; i++) {
        const res = await client.post('/api/auth/demo', {});
        responses.push(res);
      }

      for (const r of responses) {
        assert.equal(r.statusCode, 200);
        assert.equal(r.json().mode, 'demo');
        assert.equal(r.json().login.status, 'connected');
      }

      const session = await client.get('/api/session');
      assert.equal(session.statusCode, 200);
      assert.equal(session.json().mode, 'demo');
      assert.equal(session.json().login.status, 'connected');
      assert.equal(session.json().login.user.steamId, '76561198000000000');
    });

    it('T2-BOUND-F4-02: Selection Limit Cap for ZIP Export and Deletion (500 Files Boundary)', async (t) => {
      const { app } = await createTestApp();
      t.after(() => app.close());
      const client = createTestClient(app);
      await client.demoLogin();

      const filesRes = await client.get('/api/games/949230/files');
      const { revision } = filesRes.json();

      const names501 = Array.from({ length: 501 }, (_, i) => `save_${i}.cok`);

      const resPlan501 = await client.post('/api/games/949230/delete-plan', {
        names: names501,
        revision,
      });
      assert.equal(resPlan501.statusCode, 400);
      assert.equal(resPlan501.json().error.code, 'INVALID_INPUT');

      const resExport501 = await client.post('/api/games/949230/exports', {
        names: names501,
        revision,
      });
      assert.equal(resExport501.statusCode, 400);
      assert.equal(resExport501.json().error.code, 'INVALID_INPUT');

      // Duplicate file names within limit are also rejected by selectionSchema
      const resDup = await client.post('/api/games/949230/exports', {
        names: ['Settings.coc', 'Settings.coc'],
        revision,
      });
      assert.equal(resDup.statusCode, 400);
      assert.equal(resDup.json().error.code, 'INVALID_INPUT');
    });

    it('T2-BOUND-F4-03: Deletion Replay Prevention (Double Delete Attempt)', async (t) => {
      const { app } = await createTestApp();
      t.after(() => app.close());
      const client = createTestClient(app);
      await client.demoLogin();

      const filesRes = await client.get('/api/games/1245620/files');
      const { revision } = filesRes.json();

      const planRes = await client.post('/api/games/1245620/delete-plan', {
        names: ['ER0000.sl2.bak'],
        revision,
      });
      assert.equal(planRes.statusCode, 200);
      const { planId, confirmation } = planRes.json();

      // First delete executes and consumes the plan
      const res1 = await client.post('/api/games/1245620/delete', {
        planId,
        confirmation,
        gamesClosed: true,
      });
      assert.equal(res1.statusCode, 200);
      assert.equal(res1.json().batchCompleted, true);
      assert.deepEqual(res1.json().deleted, ['ER0000.sl2.bak']);

      // Second delete attempt with identical planId is rejected
      const res2 = await client.post('/api/games/1245620/delete', {
        planId,
        confirmation,
        gamesClosed: true,
      });
      assert.equal(res2.statusCode, 409);
      assert.match(res2.json().error.code, /^(FILES_CHANGED|PLAN_EXPIRED)$/);
    });

    it('T2-BOUND-F4-04: Exact Confirmation Phrase Matching (DELETE 1 vs delete 1)', async (t) => {
      const { app } = await createTestApp();
      t.after(() => app.close());
      const client = createTestClient(app);
      await client.demoLogin();

      const filesRes = await client.get('/api/games/1086940/files');
      const { revision } = filesRes.json();

      const planRes = await client.post('/api/games/1086940/delete-plan', {
        names: ['Save_02.lsv'],
        revision,
      });
      assert.equal(planRes.statusCode, 200);
      const { planId, confirmation } = planRes.json();
      assert.equal(confirmation, 'DELETE 1');

      // Lowercase mismatch
      const resLower = await client.post('/api/games/1086940/delete', {
        planId,
        confirmation: 'delete 1',
        gamesClosed: true,
      });
      assert.equal(resLower.statusCode, 400);
      assert.equal(resLower.json().error.code, 'CONFIRMATION_MISMATCH');

      // Wrong count
      const resCount = await client.post('/api/games/1086940/delete', {
        planId,
        confirmation: 'DELETE 2',
        gamesClosed: true,
      });
      assert.equal(resCount.statusCode, 400);
      assert.equal(resCount.json().error.code, 'CONFIRMATION_MISMATCH');

      // Trailing space
      const resSpace = await client.post('/api/games/1086940/delete', {
        planId,
        confirmation: 'DELETE 1 ',
        gamesClosed: true,
      });
      assert.equal(resSpace.statusCode, 400);
      assert.equal(resSpace.json().error.code, 'CONFIRMATION_MISMATCH');

      // Empty string
      const resEmpty = await client.post('/api/games/1086940/delete', {
        planId,
        confirmation: '',
        gamesClosed: true,
      });
      assert.equal(resEmpty.statusCode, 400);
      assert.equal(resEmpty.json().error.code, 'CONFIRMATION_MISMATCH');

      // gamesClosed must be true
      const resNotClosed = await client.post('/api/games/1086940/delete', {
        planId,
        confirmation: 'DELETE 1',
        gamesClosed: false,
      });
      assert.equal(resNotClosed.statusCode, 400);
      assert.equal(resNotClosed.json().error.code, 'INVALID_INPUT');

      // Failed confirmation does not consume plan; sending exact confirmation succeeds
      const resValid = await client.post('/api/games/1086940/delete', {
        planId,
        confirmation: 'DELETE 1',
        gamesClosed: true,
      });
      assert.equal(resValid.statusCode, 200);
      assert.equal(resValid.json().batchCompleted, true);
    });

    it('T2-BOUND-F4-05: Download File Traversal and Special Characters in File Name', async (t) => {
      const { app } = await createTestApp();
      t.after(() => app.close());
      const client = createTestClient(app);
      await client.demoLogin();

      const res1 = await client.get('/api/games/949230/download?name=../../etc/passwd');
      assert.equal(res1.statusCode, 404);
      assert.equal(res1.json().error.code, 'FILE_NOT_FOUND');

      const res2 = await client.get(
        '/api/games/949230/download?name=..%2F..%2Fwindows%2Fsystem32',
      );
      assert.equal(res2.statusCode, 404);
      assert.equal(res2.json().error.code, 'FILE_NOT_FOUND');

      const res3 = await client.get('/api/games/949230/download?name=NonExistentSave.sav');
      assert.equal(res3.statusCode, 404);
      assert.equal(res3.json().error.code, 'FILE_NOT_FOUND');

      const res4 = await client.get('/api/games/949230/download?name=');
      assert.equal(res4.statusCode, 400);
      assert.equal(res4.json().error.code, 'INVALID_INPUT');
    });

    it('T2-BOUND-F4-06: Concurrency Cap: Max 2 Active Downloads per Session', async (t) => {
      const { app } = await createTestApp();
      t.after(() => app.close());
      const client = createTestClient(app);
      await client.demoLogin();

      let releaseDownloads!: () => void;
      const hold = new Promise<void>((resolve) => {
        releaseDownloads = resolve;
      });

      const origDownload = DemoCloudDriver.prototype.downloadFile;
      try {
        DemoCloudDriver.prototype.downloadFile = async function (appId, file) {
          const controlled = new Readable({ read() {} });
          void hold.then(() => {
            controlled.push(Buffer.from('CONTROLLED_DEMO_CHUNK'));
            controlled.push(null);
          });
          return { stream: controlled, size: 20 };
        };

        // Dispatch download 1 and download 2 under the same demo session
        const p1 = client.get('/api/games/949230/download?name=Saves/Cedar%20Valley.cok');
        const p2 = client.get('/api/games/949230/download?name=Settings.coc');

        // Microtask yield ensuring both handlers hit trackTransfer
        await new Promise((r) => setImmediate(r));

        // 3rd download request hits activeTransfers >= 2 -> 429 DOWNLOAD_LIMIT
        const res3 = await client.get('/api/games/949230/download?name=Saves/Old%20Town.cok');
        assert.equal(res3.statusCode, 429);
        assert.equal(res3.json().error.code, 'DOWNLOAD_LIMIT');

        // Unblock held downloads
        releaseDownloads();
        const [res1, res2] = await Promise.all([p1, p2]);
        assert.equal(res1.statusCode, 200);
        assert.equal(res2.statusCode, 200);
      } finally {
        releaseDownloads?.();
        DemoCloudDriver.prototype.downloadFile = origDownload;
      }
    });

    it('T2-BOUND-F4-07: Empty Selection Array Rejection (names: [] Boundary)', async (t) => {
      const { app } = await createTestApp();
      t.after(() => app.close());
      const client = createTestClient(app);
      await client.demoLogin();

      const filesRes = await client.get('/api/games/949230/files');
      const { revision } = filesRes.json();

      const resExport = await client.post('/api/games/949230/exports', {
        names: [],
        revision,
      });
      assert.equal(resExport.statusCode, 400);
      assert.equal(resExport.json().error.code, 'INVALID_INPUT');

      const resPlan = await client.post('/api/games/949230/delete-plan', {
        names: [],
        revision,
      });
      assert.equal(resPlan.statusCode, 400);
      assert.equal(resPlan.json().error.code, 'INVALID_INPUT');
    });

    it('T2-BOUND-F4-08: Zero-Byte Cloud Save Streaming Download & SHA-1 Verification', async (t) => {
      const { app } = await createTestApp();
      t.after(() => app.close());
      const client = createTestClient(app);
      await client.demoLogin();

      const origList = DemoCloudDriver.prototype.listFiles;
      const origDownload = DemoCloudDriver.prototype.downloadFile;
      try {
        DemoCloudDriver.prototype.listFiles = async function (appId) {
          const res = await origList.call(this, appId);
          if (appId === 949230) {
            res.files.push({
              name: 'ZeroByte.sav',
              size: 0,
              modifiedAt: 1793574000,
              sha: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
            });
          }
          return res;
        };

        DemoCloudDriver.prototype.downloadFile = async function (appId, file) {
          if (file.name === 'ZeroByte.sav') {
            return { stream: Readable.from(Buffer.alloc(0)), size: 0 };
          }
          return origDownload.call(this, appId, file);
        };

        const res = await client.get('/api/games/949230/download?name=ZeroByte.sav');
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['content-length'], '0');
        assert.equal(res.rawPayload.length, 0);

        const sha = createHash('sha1').update(res.rawPayload).digest('hex');
        assert.equal(sha, 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
      } finally {
        DemoCloudDriver.prototype.listFiles = origList;
        DemoCloudDriver.prototype.downloadFile = origDownload;
      }
    });
  });

  describe('Tier 3: Pairwise Combinations — EF4 Demo Combinatorial Scenarios', () => {
    it('T3-COMB-03: Encrypted Token + Demo Mode Lifecycle', async (t) => {
      const rawKey = randomBytes(KEY_BYTES);
      const sessionKey = rawKey.toString('base64url');
      const prev = process.env.SCM_SESSION_KEY;
      process.env.SCM_SESSION_KEY = sessionKey;

      const { app } = await createTestApp({ sessionKey });
      t.after(() => {
        if (prev) process.env.SCM_SESSION_KEY = prev;
        else delete process.env.SCM_SESSION_KEY;
        resetEphemeralKeyForTesting();
        return app.close();
      });

      const client = createTestClient(app);
      const loginRes = await client.demoLogin();
      assert.equal(loginRes.statusCode, 200);

      assert.ok(client.cookie);
      const tokenVal = client.cookie.split('=')[1];
      const payload = decryptToken<SessionTokenPayload>(tokenVal, rawKey, 'scm-session');
      assert.ok(payload);
      assert.equal(payload.purpose, 'scm-session');
      assert.equal(payload.mode, 'demo');
      assert.equal(payload.steamId, '76561198000000000');
      assert.equal(payload.displayName, 'Demo Account');
      assert.equal(payload.refreshToken, undefined);
      assert.ok(payload.issuedAt <= Date.now());
      assert.ok(payload.expiresAt > Date.now());
    });

    it('T3-COMB-05: Cold Start Rehydration + Demo Deletion Revision Lock', async (t) => {
      const rawKey = randomBytes(KEY_BYTES);
      const sessionKey = rawKey.toString('base64url');
      const prev = process.env.SCM_SESSION_KEY;
      process.env.SCM_SESSION_KEY = sessionKey;

      const { app: app1 } = await createTestApp({ sessionKey });
      const { app: app2 } = await createTestApp({ sessionKey });
      t.after(async () => {
        if (prev) process.env.SCM_SESSION_KEY = prev;
        else delete process.env.SCM_SESSION_KEY;
        resetEphemeralKeyForTesting();
        await app1.close();
        await app2.close();
      });

      const client1 = createTestClient(app1);
      await client1.demoLogin();

      const filesRes = await client1.get('/api/games/1245620/files');
      const { revision } = filesRes.json();

      const planRes = await client1.post('/api/games/1245620/delete-plan', {
        names: ['ER0000.sl2.bak'],
        revision,
      });
      assert.equal(planRes.statusCode, 200);
      const { planId, confirmation } = planRes.json();

      // Simulate save revision mutation in app2:
      // When app2 executes selectFiles, revision mismatch is caught
      const origList = DemoCloudDriver.prototype.listFiles;
      try {
        DemoCloudDriver.prototype.listFiles = async function (appId) {
          const res = await origList.call(this, appId);
          return { ...res, changeNumber: '999_altered_revision' };
        };

        const delResAltered = await app2.inject({
          method: 'POST',
          url: '/api/games/1245620/delete',
          headers: {
            host: client1.host,
            origin: client1.origin,
            cookie: client1.cookie,
            'x-csrf-token': client1.csrf,
          },
          payload: { planId, confirmation, gamesClosed: true },
        });

        assert.equal(delResAltered.statusCode, 409);
        assert.equal(delResAltered.json().error.code, 'FILES_CHANGED');
      } finally {
        DemoCloudDriver.prototype.listFiles = origList;
      }

      // Without revision mismatch, app2 decrypts token and completes delete cleanly across instances
      const planResClean = await client1.post('/api/games/1245620/delete-plan', {
        names: ['ER0000.sl2.bak'],
        revision,
      });
      const { planId: cleanPlanId } = planResClean.json();

      const delResClean = await app2.inject({
        method: 'POST',
        url: '/api/games/1245620/delete',
        headers: {
          host: client1.host,
          origin: client1.origin,
          cookie: client1.cookie,
          'x-csrf-token': client1.csrf,
        },
        payload: { planId: cleanPlanId, confirmation, gamesClosed: true },
      });

      assert.equal(delResClean.statusCode, 200);
      assert.equal(delResClean.json().batchCompleted, true);
      assert.deepEqual(delResClean.json().deleted, ['ER0000.sl2.bak']);
    });

    it('T3-COMB-06: Hosted Vercel Origin + Demo Mode API Operations', async (t) => {
      const { app } = await createTestApp({
        secure: true,
        sessionKey: 'k'.repeat(43),
      });
      t.after(() => app.close());

      const client = createTestClient(app, { secure: true });

      // Step 1: GET /api/session
      const s1 = await client.get('/api/session', { 'sec-fetch-site': 'same-origin' });
      assert.equal(s1.statusCode, 200);
      assert.match(s1.headers['set-cookie'] as string, /^__Host-scm=/);
      assert.ok(s1.headers['set-cookie'].includes('SameSite=Strict'));
      assert.ok(s1.headers['set-cookie'].includes('Secure'));
      assert.ok(s1.headers['set-cookie'].includes('HttpOnly'));
      assert.ok(s1.headers['strict-transport-security']);
      assert.ok(s1.headers['content-security-policy']);

      // Step 2: POST /api/auth/demo
      const s2 = await client.post('/api/auth/demo', {}, { 'sec-fetch-site': 'same-origin' });
      assert.equal(s2.statusCode, 200);
      assert.equal(s2.json().mode, 'demo');
      assert.match(s2.headers['set-cookie'] as string, /^__Host-scm=/);

      // Step 3: GET /api/games
      const s3 = await client.get('/api/games', { 'sec-fetch-site': 'same-origin' });
      assert.equal(s3.statusCode, 200);
      assert.equal(s3.json().games.length, 3);

      // Step 4: GET /api/games/949230/files
      const s4 = await client.get('/api/games/949230/files', { 'sec-fetch-site': 'same-origin' });
      assert.equal(s4.statusCode, 200);
      assert.equal(s4.json().files.length, 6);
      const { revision } = s4.json();

      // Step 5: POST /api/games/949230/exports
      const s5 = await client.post(
        '/api/games/949230/exports',
        { names: ['Settings.coc'], revision },
        { 'sec-fetch-site': 'same-origin' },
      );
      assert.equal(s5.statusCode, 200);
      const { downloadUrl } = s5.json();

      // Step 6: GET <downloadUrl> (ZIP export)
      const s6 = await client.get(downloadUrl, { 'sec-fetch-site': 'same-origin' });
      assert.equal(s6.statusCode, 200);
      assert.equal(s6.headers['content-type'], 'application/zip');
      assert.equal(s6.rawPayload.subarray(0, 2).toString('latin1'), 'PK');

      // Step 7: POST /api/auth/logout
      const s7 = await client.post('/api/auth/logout', {}, { 'sec-fetch-site': 'same-origin' });
      assert.equal(s7.statusCode, 200);
      assert.equal(s7.json().mode, 'live');
      assert.equal(s7.json().login.status, 'disconnected');
    });
  });
});

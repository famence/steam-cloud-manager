import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
import type { CloudDriver } from './steam/contracts.js';
import type { CloudFile, DeleteResult, LoginInfo } from '../shared/types.js';
import handler, { closeAppForTesting } from '../../api/index.js';

const bytes = Buffer.from('A real test fixture, not a Steam save.');
const file: CloudFile = { name: '%WinAppDataLocal%/Saves/Город.save', size: bytes.length, modifiedAt: 1_790_000_000, sha: createHash('sha1').update(bytes).digest('hex') };
class FakeDriver implements CloudDriver {
  connected = false; closed = false; files = [{ ...file }]; change = 1;
  deleteCalls = 0; result: DeleteResult | null = null;
  downloadError = false;
  async startLogin() { this.connected = true; }
  getLogin(): LoginInfo { return { status: this.connected ? 'connected' : 'disconnected' }; }
  async listGames() { return [{ appId: 949230, name: 'Cities: Skylines II', fileCount: this.files.length, totalBytes: this.files.reduce((n, f) => n + f.size, 0) }]; }
  async listFiles(appId: number) { return { appId, files: this.files.map((f) => ({ ...f })), changeNumber: String(this.change) }; }
  async downloadFile() {
    if (this.downloadError) throw new Error('simulated Steam download failure');
    return { stream: Readable.from(bytes), size: bytes.length };
  }
  async deleteFiles(_appId: number, files: CloudFile[]) {
    this.deleteCalls++;
    if (this.result) return this.result;
    this.files = this.files.filter((f) => !files.some((selected) => selected.name === f.name)); this.change++;
    return { deleted: files.map((f) => f.name), failed: [], batchCompleted: true };
  }
  close() { this.closed = true; this.connected = false; }
}

async function setup(t: TestContext) {
  const drivers: FakeDriver[] = [];
  let clock = Date.now();
  const config = readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000' });
  const app = await buildApp({ config, now: () => clock, driverFactory: () => { const driver = new FakeDriver(); drivers.push(driver); return driver; } });
  t.after(() => app.close());
  async function browser() {
    const response = await app.inject({ url: '/api/session', headers: { host: '127.0.0.1:3000' } });
    const setCookie = response.headers['set-cookie'] as string;
    const cookie = setCookie.split(';')[0];
    const csrf = response.json().csrfToken as string;
    const headers = { host: '127.0.0.1:3000', cookie, origin: config.appOrigin, 'x-csrf-token': csrf };
    const get = (url: string) => app.inject({ url, headers });
    const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, headers, payload: payload as Record<string, unknown> });
    return { get, post, headers, cookie, csrf, driver: drivers.at(-1)!, initial: response };
  }
  return { app, browser, advance: (ms: number) => { clock += ms; } };
}

test('authentication, exact origin and CSRF are required; session tokens stay in HttpOnly cookies', async (t) => {
  const { app, browser } = await setup(t);
  const user = await browser();
  assert.match(user.initial.headers['set-cookie'] as string, /HttpOnly/);
  assert.match(user.initial.headers['set-cookie'] as string, /SameSite=Strict/);
  assert.equal(user.initial.json().login.status, 'disconnected');
  assert.equal((await user.get('/api/games')).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/steam', headers: { host: '127.0.0.1:3000', cookie: user.cookie }, payload: {} })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/steam', headers: { ...user.headers, origin: 'https://attacker.example' }, payload: {} })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/steam', headers: { ...user.headers, 'x-csrf-token': 'wrong' }, payload: {} })).statusCode, 403);
  assert.equal((await user.post('/api/auth/steam', {})).statusCode, 200);
  assert.equal((await user.get('/api/games')).json().games[0].appId, 949230);
  assert.equal((await app.inject({ url: '/api/session', headers: { host: 'attacker.example' } })).statusCode, 403);
});

test('delete requires a fresh, account-bound plan and exact confirmation; replay never deletes twice', async (t) => {
  const { browser } = await setup(t);
  const user = await browser(); const other = await browser();
  await user.post('/api/auth/steam', {}); await other.post('/api/auth/steam', {});
  const listing = (await user.get('/api/games/949230/files')).json();
  const planResponse = await user.post('/api/games/949230/delete-plan', { names: [file.name], revision: listing.revision });
  assert.equal(planResponse.statusCode, 200, planResponse.body);
  const plan = planResponse.json();
  const command = { planId: plan.planId, confirmation: plan.confirmation, gamesClosed: true };
  assert.equal((await other.post('/api/games/949230/delete', command)).statusCode, 409);
  assert.equal((await user.post('/api/games/949230/delete', { ...command, confirmation: 'yes' })).statusCode, 400);
  assert.equal((await user.post('/api/games/949230/delete', { ...command, gamesClosed: false })).statusCode, 400);
  assert.equal((await user.post('/api/games/255710/delete', command)).statusCode, 409);
  assert.equal(user.driver.deleteCalls, 0);
  const deleted = await user.post('/api/games/949230/delete', command);
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.deepEqual(deleted.json().deleted, [file.name]);
  assert.equal((await user.post('/api/games/949230/delete', command)).statusCode, 409);
  assert.equal(user.driver.deleteCalls, 1);
});

test('changed or missing saves invalidate review without sending any Steam delete', async (t) => {
  const { browser } = await setup(t); const user = await browser();
  await user.post('/api/auth/steam', {});
  const listing = (await user.get('/api/games/949230/files')).json();
  const plan = (await user.post('/api/games/949230/delete-plan', { names: [file.name], revision: listing.revision })).json();
  user.driver.files[0].sha = 'a'.repeat(40);
  const response = await user.post('/api/games/949230/delete', { planId: plan.planId, confirmation: plan.confirmation, gamesClosed: true });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, 'FILES_CHANGED');
  assert.equal(user.driver.deleteCalls, 0);
});

test('expired plans and expired sessions cannot delete; logout rotates identity and destroys Steam session', async (t) => {
  const { app, browser, advance } = await setup(t); const user = await browser();
  await user.post('/api/auth/steam', {});
  const listing = (await user.get('/api/games/949230/files')).json();
  const plan = (await user.post('/api/games/949230/delete-plan', { names: [file.name], revision: listing.revision })).json();
  advance(5 * 60_000 + 1);
  assert.equal((await user.post('/api/games/949230/delete', { planId: plan.planId, confirmation: plan.confirmation, gamesClosed: true })).statusCode, 409);
  const logout = await user.post('/api/auth/logout', {});
  assert.equal(logout.statusCode, 200);
  assert.notEqual(logout.json().csrfToken, user.csrf);
  assert.ok(user.driver.closed);
  assert.equal((await user.get('/api/games')).statusCode, 401);
  const fresh = await browser(); await fresh.post('/api/auth/steam', {});
  advance(60 * 60_000 + 1);
  assert.equal((await fresh.get('/api/games')).statusCode, 401);
  assert.ok(fresh.driver.closed);
  assert.equal((await app.inject({ url: '/api/games', headers: { host: '127.0.0.1:3000' } })).statusCode, 401);
});

test('partial deletion is reported explicitly and is not automatically retried', async (t) => {
  const { browser } = await setup(t); const user = await browser();
  await user.post('/api/auth/steam', {});
  user.driver.result = { deleted: [], failed: [{ name: file.name, message: 'Не подтверждено Steam' }], batchCompleted: false };
  const listing = (await user.get('/api/games/949230/files')).json();
  const plan = (await user.post('/api/games/949230/delete-plan', { names: [file.name], revision: listing.revision })).json();
  const response = await user.post('/api/games/949230/delete', { planId: plan.planId, confirmation: plan.confirmation, gamesClosed: true });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().failed.length, 1);
  assert.equal(response.json().batchCompleted, false);
  assert.equal(user.driver.deleteCalls, 1);
});

test('validates file selections, AppID and duplicate names before preparing a destructive operation', async (t) => {
  const { browser } = await setup(t); const user = await browser();
  await user.post('/api/auth/steam', {});
  const { revision } = (await user.get('/api/games/949230/files')).json();
  for (const names of [[], [file.name, file.name], Array.from({ length: 501 }, (_, i) => `file-${i}`)]) {
    assert.equal((await user.post('/api/games/949230/delete-plan', { names, revision })).statusCode, 400);
  }
  assert.equal((await user.get('/api/games/NaN/files')).statusCode, 400);
  assert.equal((await user.get('/api/games/0/files')).statusCode, 400);
  assert.equal((await user.post('/api/games/949230/delete-plan', { names: ['missing'], revision })).statusCode, 409);
});

test('single-file download and ZIP export stream authenticated contents; tickets are private and single use', async (t) => {
  const { browser } = await setup(t); const user = await browser(); const other = await browser();
  await user.post('/api/auth/steam', {}); await other.post('/api/auth/steam', {});
  const download = await user.get(`/api/games/949230/download?name=${encodeURIComponent(file.name)}`);
  assert.equal(download.statusCode, 200, download.body);
  assert.deepEqual(download.rawPayload, bytes);
  assert.match(download.headers['content-disposition'] as string, /attachment/);
  assert.equal(download.headers['cache-control'], 'no-store');
  const { revision } = (await user.get('/api/games/949230/files')).json();
  const ticket = (await user.post('/api/games/949230/exports', { names: [file.name], revision })).json();
  assert.equal((await other.get(ticket.downloadUrl)).statusCode, 404);
  const zip = await user.get(ticket.downloadUrl);
  assert.equal(zip.statusCode, 200, zip.body);
  assert.equal(zip.headers['content-type'], 'application/zip');
  assert.equal(zip.rawPayload.subarray(0, 2).toString(), 'PK');
  assert.ok(zip.rawPayload.includes(bytes));
  assert.ok(zip.rawPayload.includes(Buffer.from('manifest.json')));
  assert.equal((await user.get(ticket.downloadUrl)).statusCode, 404);
});

test('a changed file invalidates a prepared ZIP export', async (t) => {
  const { browser } = await setup(t); const user = await browser();
  await user.post('/api/auth/steam', {});
  const { revision } = (await user.get('/api/games/949230/files')).json();
  const ticket = (await user.post('/api/games/949230/exports', { names: [file.name], revision })).json();
  user.driver.change++;
  assert.equal((await user.get(ticket.downloadUrl)).statusCode, 409);
});

test('reconnecting Steam invalidates all prior reviews and exports, even for identical files', async (t) => {
  const { browser } = await setup(t); const user = await browser();
  await user.post('/api/auth/steam', {});
  const { revision } = (await user.get('/api/games/949230/files')).json();
  const plan = (await user.post('/api/games/949230/delete-plan', { names: [file.name], revision })).json();
  const ticket = (await user.post('/api/games/949230/exports', { names: [file.name], revision })).json();
  user.driver.connected = false;
  await user.post('/api/auth/steam', {});
  assert.equal((await user.post('/api/games/949230/delete', { planId: plan.planId, confirmation: plan.confirmation, gamesClosed: true })).statusCode, 409);
  assert.equal((await user.get(ticket.downloadUrl)).statusCode, 404);
  assert.equal(user.driver.deleteCalls, 0);
});

test('ZIP export preparation fails visibly when Steam does not provide a downloadable file', async (t) => {
  const { browser } = await setup(t);
  const user = await browser();
  await user.post('/api/auth/steam', {});
  const listing = (await user.get('/api/games/949230/files')).json();
  user.driver.downloadError = true;
  const result = await user.post('/api/games/949230/exports', {
    names: [file.name], revision: listing.revision,
  });
  assert.equal(result.statusCode, 502);
  assert.equal(typeof result.json().error.message, 'string');
  assert.equal(result.json().downloadUrl, undefined);
  assert.equal(user.driver.deleteCalls, 0);
});

test('1-click Demo Mode: POST /api/auth/demo connects isolated DemoCloudDriver, lists games, files, downloads, and deletes', async (t) => {
  const { browser } = await setup(t);
  const user = await browser();

  const demoAuth = await user.post('/api/auth/demo', {});
  assert.equal(demoAuth.statusCode, 200);
  const demoBody = demoAuth.json();
  assert.equal(demoBody.mode, 'demo');
  assert.equal(demoBody.login.status, 'connected');
  assert.equal(demoBody.login.user.steamId, '76561198000000000');
  assert.equal(demoBody.login.user.displayName, 'Demo Account');

  // Verify cookie was updated
  assert.match(demoAuth.headers['set-cookie'] as string, /HttpOnly/);

  // List games in demo mode
  const gamesRes = await user.get('/api/games');
  assert.equal(gamesRes.statusCode, 200);
  const games = gamesRes.json().games;
  assert.equal(games.length, 3);
  const appIds = games.map((g: { appId: number }) => g.appId);
  assert.ok(appIds.includes(949230)); // Cities: Skylines II
  assert.ok(appIds.includes(1086940)); // Baldur's Gate 3
  assert.ok(appIds.includes(1245620)); // ELDEN RING

  // List files for Baldur's Gate 3
  const filesRes = await user.get('/api/games/1086940/files');
  assert.equal(filesRes.statusCode, 200);
  const fileNames = filesRes.json().files.map((f: { name: string }) => f.name);
  assert.ok(fileNames.includes('Save_01.lsv'));
  assert.ok(fileNames.includes('Save_02.lsv'));

  // Download demo save file
  const downloadRes = await user.get('/api/games/1086940/download?name=Save_01.lsv');
  assert.equal(downloadRes.statusCode, 200);
  assert.match(downloadRes.headers['content-disposition'] as string, /attachment/);
  assert.ok(downloadRes.rawPayload.length > 0);

  // Create delete plan and execute deletion in demo mode
  const planRes = await user.post('/api/games/1086940/delete-plan', {
    names: ['Save_01.lsv'],
    revision: filesRes.json().revision,
  });
  assert.equal(planRes.statusCode, 200);
  const plan = planRes.json();
  assert.ok(plan.planId);

  const deleteRes = await user.post('/api/games/1086940/delete', {
    planId: plan.planId,
    confirmation: plan.confirmation,
    gamesClosed: true,
  });
  assert.equal(deleteRes.statusCode, 200);
  assert.deepEqual(deleteRes.json().deleted, ['Save_01.lsv']);

  // Clean transition to Steam QR login
  const steamSwitch = await user.post('/api/auth/steam', {});
  assert.equal(steamSwitch.statusCode, 200);
  assert.equal(steamSwitch.json().mode, 'live');

  // Logout resets identity
  const logout = await user.post('/api/auth/logout', {});
  assert.equal(logout.statusCode, 200);
  assert.equal(logout.json().mode, 'live');
  assert.equal(logout.json().login.status, 'disconnected');
});

test('hosted security: Vercel preview/production hosts, allowed origin matching, and cross-site rejection', async (t) => {
  const sessionKey = 'k'.repeat(43);
  const config = readConfig({
    VERCEL: '1',
    APP_ORIGIN: 'https://steam-cloud-manager.vercel.app',
    SCM_SESSION_KEY: sessionKey,
  });
  const app = await buildApp({ config });
  t.after(() => app.close());

  // Allowed production host
  const prodRes = await app.inject({
    url: '/api/session',
    headers: { host: 'steam-cloud-manager.vercel.app' },
  });
  assert.equal(prodRes.statusCode, 200);

  // Allowed preview host
  const previewHost = 'steam-cloud-manager-preview-abc123.vercel.app';
  const previewRes = await app.inject({
    url: '/api/session',
    headers: { host: previewHost },
  });
  assert.equal(previewRes.statusCode, 200);
  const previewCookie = (previewRes.headers['set-cookie'] as string).split(';')[0];
  const previewCsrf = previewRes.json().csrfToken as string;

  // Allowed POST with preview origin matching preview host
  const postPreview = await app.inject({
    method: 'POST',
    url: '/api/auth/demo',
    headers: {
      host: previewHost,
      origin: `https://${previewHost}`,
      cookie: previewCookie,
      'x-csrf-token': previewCsrf,
    },
    payload: {},
  });
  assert.equal(postPreview.statusCode, 200);
  assert.equal(postPreview.json().mode, 'demo');

  // Disallowed attacker host
  const evilHostRes = await app.inject({
    url: '/api/session',
    headers: { host: 'attacker.example' },
  });
  assert.equal(evilHostRes.statusCode, 403);
  assert.equal(evilHostRes.json().error.code, 'INVALID_HOST');

  // Disallowed attacker origin
  const evilOriginRes = await app.inject({
    method: 'POST',
    url: '/api/auth/demo',
    headers: {
      host: previewHost,
      origin: 'https://evil-attacker.example',
      cookie: previewCookie,
      'x-csrf-token': previewCsrf,
    },
    payload: {},
  });
  assert.equal(evilOriginRes.statusCode, 403);
  assert.equal(evilOriginRes.json().error.code, 'INVALID_ORIGIN');

  // Cross-site request rejected
  const crossSiteRes = await app.inject({
    url: '/api/session',
    headers: {
      host: 'steam-cloud-manager.vercel.app',
      'sec-fetch-site': 'cross-site',
    },
  });
  assert.equal(crossSiteRes.statusCode, 403);
  assert.equal(crossSiteRes.json().error.code, 'CROSS_SITE_REQUEST');
});

test('stateless cold-instance session rehydration recovers demo session across independent app instances', async (t) => {
  const sessionKey = 'c'.repeat(43);
  const config = readConfig({
    VERCEL: '1',
    APP_ORIGIN: 'https://steam-cloud-manager.vercel.app',
    SCM_SESSION_KEY: sessionKey,
  });

  // Instance 1: establishes session and logs into demo mode
  const app1 = await buildApp({ config });
  t.after(() => app1.close());

  const init1 = await app1.inject({
    url: '/api/session',
    headers: { host: 'steam-cloud-manager.vercel.app' },
  });
  const cookie1 = (init1.headers['set-cookie'] as string).split(';')[0];
  const csrf1 = init1.json().csrfToken as string;

  const demoAuth1 = await app1.inject({
    method: 'POST',
    url: '/api/auth/demo',
    headers: {
      host: 'steam-cloud-manager.vercel.app',
      origin: 'https://steam-cloud-manager.vercel.app',
      cookie: cookie1,
      'x-csrf-token': csrf1,
    },
    payload: {},
  });
  assert.equal(demoAuth1.statusCode, 200);
  const cookieAfterDemo = (demoAuth1.headers['set-cookie'] as string).split(';')[0];

  // Instance 2: completely separate cold instance with empty memory store
  const app2 = await buildApp({ config });
  t.after(() => app2.close());

  // Instance 2 receives request with the encrypted cookie issued by Instance 1
  const gamesCold = await app2.inject({
    url: '/api/games',
    headers: {
      host: 'steam-cloud-manager.vercel.app',
      cookie: cookieAfterDemo,
    },
  });
  assert.equal(gamesCold.statusCode, 200);
  assert.equal(gamesCold.json().games.length, 3);

  // Instance 2 session check confirms connected demo mode
  const sessionCold = await app2.inject({
    url: '/api/session',
    headers: {
      host: 'steam-cloud-manager.vercel.app',
      cookie: cookieAfterDemo,
    },
  });
  assert.equal(sessionCold.statusCode, 200);
  assert.equal(sessionCold.json().mode, 'demo');
  assert.equal(sessionCold.json().login.status, 'connected');
  assert.equal(sessionCold.json().login.user.displayName, 'Demo Account');
});

test('Vercel serverless handler (api/index.ts) processes requests and returns HTTP 200', async (t) => {
  const prevVercel = process.env.VERCEL;
  const prevKey = process.env.SCM_SESSION_KEY;
  process.env.VERCEL = '1';
  process.env.SCM_SESSION_KEY = 'k'.repeat(43);
  t.after(async () => {
    await closeAppForTesting();
    if (prevVercel !== undefined) process.env.VERCEL = prevVercel;
    else delete process.env.VERCEL;
    if (prevKey !== undefined) process.env.SCM_SESSION_KEY = prevKey;
    else delete process.env.SCM_SESSION_KEY;
  });

  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const addr = server.address() as { port: number };
  const res = await fetch(`http://127.0.0.1:${addr.port}/api/health`, {
    headers: {
      host: 'steam-cloud-manager.vercel.app',
      'x-forwarded-host': 'steam-cloud-manager.vercel.app',
    },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string };
  assert.equal(body.status, 'ok');
});

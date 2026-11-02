import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
import type { CloudDriver } from './steam/contracts.js';
import type { CloudFile, DeleteResult, LoginInfo } from '../shared/types.js';

const bytes = Buffer.from('A real test fixture, not a Steam save.');
const file: CloudFile = { name: '%WinAppDataLocal%/Saves/Город.save', size: bytes.length, modifiedAt: 1_790_000_000, sha: createHash('sha1').update(bytes).digest('hex') };
class FakeDriver implements CloudDriver {
  connected = false; closed = false; files = [{ ...file }]; change = 1;
  deleteCalls = 0; result: DeleteResult | null = null;
  async startLogin() { this.connected = true; }
  getLogin(): LoginInfo { return { status: this.connected ? 'connected' : 'disconnected' }; }
  async listGames() { return [{ appId: 949230, name: 'Cities: Skylines II', fileCount: this.files.length, totalBytes: this.files.reduce((n, f) => n + f.size, 0) }]; }
  async listFiles(appId: number) { return { appId, files: this.files.map((f) => ({ ...f })), changeNumber: String(this.change) }; }
  async downloadFile() { return { stream: Readable.from(bytes), size: bytes.length }; }
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

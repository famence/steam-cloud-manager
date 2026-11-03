import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from './config.js';
import { cloudSupport } from './steam/game-metadata.js';
import { isInactive, orderGames } from '../client/library-order.js';
import { en, ru, countFiles, formatBytes, errorText } from '../client/i18n.js';
import type { CloudGame } from '../shared/types.js';
import { LibrarySummaryCache } from './library-summary.js';
import { DemoCloudDriver } from './demo-driver.js';

test('Steam backend is loopback-only and refuses a hosted runtime', () => {
  assert.throws(() => readConfig({ VERCEL: '1' }));
  assert.throws(() => readConfig({ HOST: '0.0.0.0' }));
  assert.throws(() => readConfig({ HOST: '::' }));
  assert.throws(() => readConfig({ APP_ORIGIN: 'https://example.com' }));
  assert.equal(readConfig({}).host, '127.0.0.1');
  assert.equal(readConfig({ NODE_ENV: 'production' }).appOrigin, 'http://127.0.0.1:3000');
});
test('missing PICS metadata is unknown while zero quotas are explicit', () => {
  assert.equal(cloudSupport(undefined), 'unknown');
  assert.equal(cloudSupport({ appinfo: { common: { category: {} } } }), 'unknown');
  assert.equal(cloudSupport({ appinfo: { ufs: { quota: '0', maxnumfiles: '0' } } }), 'unsupported');
  assert.equal(cloudSupport({ appinfo: { ufs: { quota: '100000', maxnumfiles: '20' } } }), 'supported');
  assert.equal(cloudSupport({ appinfo: { common: { category: { category_23: '1' } } } }), 'supported');
});
test('favorites precede available games, inactive games last, unknown is not empty', () => {
  const g = (id: number, count: number | null, support?: CloudGame['cloudSupport']): CloudGame => ({ appId: id, name: `Game ${id}`, fileCount: count, totalBytes: count, cloudSupport: support });
  const games = [g(1, 0), g(2, null), g(3, 8), g(4, null, 'unsupported'), g(5, 10)];
  assert.deepEqual(orderGames(games, new Set([1, 5]), 'en').map(x => x.appId), [5, 2, 3, 1, 4]);
  assert.equal(isInactive(g(9, null)), false);
  assert.equal(isInactive(g(9, 2, 'unsupported')), false);
});
test('both locales are complete and counts are localized', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
  assert.equal(countFiles(22, 'ru'), '22 файла'); assert.equal(countFiles(1, 'en'), '1 file');
  assert.match(formatBytes(1024, 'en'), /KiB/); assert.match(formatBytes(1024, 'ru'), /КиБ/);
  assert.match(errorText({ code: 'DOWNLOAD_REJECTED' }, 'en'), /backup/);
});
test('summary cache coalesces reads, expires and isolates accounts', async () => {
  let now = 0; const cache = new LibrarySummaryCache(() => now);
  const driver = new DemoCloudDriver(); await driver.startLogin();
  let reads = 0; const original = driver.listFiles.bind(driver);
  driver.listFiles = async appId => { reads++; return original(appId); };
  const [a, b] = await Promise.all([cache.get(driver, 949230), cache.get(driver, 949230)]);
  assert.deepEqual(a, b); assert.equal(reads, 1); assert.equal(a.fileCount, 6);
  await cache.get(driver, 949230); assert.equal(reads, 1);
  cache.invalidate(driver, 949230); await cache.get(driver, 949230); assert.equal(reads, 2);
  now = 61_000; await cache.get(driver, 949230); assert.equal(reads, 3);
  const other = new DemoCloudDriver(); await other.startLogin();
  await other.deleteFiles(949230, (await other.listFiles(949230)).files);
  assert.equal((await cache.get(other, 949230)).fileCount, 0);
  assert.equal((await cache.get(driver, 949230)).fileCount, 6);
  driver.close(); other.close();
});

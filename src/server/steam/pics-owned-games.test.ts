import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { listPicsOwnedGames, type PicsClient } from './pics-owned-games.js';
import { SteamServiceError } from './protocol.js';

class FixtureClient extends EventEmitter implements PicsClient {
  ids = [949230, 255710];
  picsCache: PicsClient['picsCache'] = {};
  getOwnedApps(): number[] {
    if (!this.picsCache?.ownershipModified) throw new Error('PICS cache not ready');
    return this.ids;
  }
}

test('PICS provides game titles without claiming Cloud usage', async () => {
  const client = new FixtureClient();
  client.picsCache = {
    ownershipModified: Date.now(),
    apps: {
      '949230': { appinfo: { common: { name: 'Cities: Skylines II' } } },
      '255710': { appinfo: { common: { name: 'Cities: Skylines' } } },
    },
  };
  const games = await listPicsOwnedGames(client, new AbortController().signal);
  assert.deepEqual(games, [
    { appId: 255710, name: 'Cities: Skylines', fileCount: null, totalBytes: null },
    { appId: 949230, name: 'Cities: Skylines II', fileCount: null, totalBytes: null },
  ]);
});

test('PICS waits for ownershipCached even after Steam login', async () => {
  const client = new FixtureClient();
  const pending = listPicsOwnedGames(client, new AbortController().signal, 500);
  assert.equal(client.listenerCount('ownershipCached'), 1);
  client.picsCache = { ownershipModified: Date.now(), apps: {} };
  client.emit('ownershipCached');
  const games = await pending;
  assert.equal(games.length, 2);
  assert.equal(games[0].name, 'App 255710');
  assert.equal(client.listenerCount('ownershipCached'), 0);
});

test('PICS timeout is actionable and cleans listeners', async () => {
  const client = new FixtureClient();
  await assert.rejects(listPicsOwnedGames(client, new AbortController().signal, 5), {
    code: 'LIBRARY_NOT_READY',
    statusCode: 503,
  });
  assert.equal(client.listenerCount('ownershipCached'), 0);
});

test('PICS aborts promptly on Steam disconnect', async () => {
  const client = new FixtureClient();
  const controller = new AbortController();
  const pending = listPicsOwnedGames(client, controller.signal, 30_000);
  controller.abort();
  await assert.rejects(pending, { code: 'NOT_CONNECTED' });
  assert.equal(client.listenerCount('ownershipCached'), 0);
});

test('PICS rejects impossible app IDs rather than inventing files', async () => {
  const client = new FixtureClient();
  client.ids = [949230, 949230];
  client.picsCache = { ownershipModified: Date.now() };
  await assert.rejects(listPicsOwnedGames(client, new AbortController().signal), SteamServiceError);
});

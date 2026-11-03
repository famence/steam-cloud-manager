import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { listPicsOwnedGames, type PicsClient } from './pics-owned-games.js';
import { isBaseGame, filterBaseGames } from './game-metadata.js';
import { SteamServiceError } from './protocol.js';

class FixtureClient extends EventEmitter implements PicsClient {
  ids = [949230, 255710];
  picsCache: PicsClient['picsCache'] = {};
  getOwnedApps() {
    if (!this.picsCache?.ownershipModified) throw new Error('PICS not ready');
    return this.ids;
  }
}
const apps = {
  '949230': { appinfo: { common: { name: 'Cities: Skylines II', type: 'Game' } } },
  '255710': { appinfo: { common: { name: 'Cities: Skylines', type: 'game' } } },
};
test('PICS returns base games without claiming unknown Cloud usage', async () => {
  const client = new FixtureClient(); client.picsCache = { ownershipModified: 1, apps };
  assert.deepEqual(await listPicsOwnedGames(client, new AbortController().signal), [
    { appId: 255710, name: 'Cities: Skylines', fileCount: null, totalBytes: null },
    { appId: 949230, name: 'Cities: Skylines II', fileCount: null, totalBytes: null },
  ]);
});
test('DLC, tools, demos, soundtracks and missing types are excluded, regardless of their names', async () => {
  const client = new FixtureClient(); client.ids = [1,2,3,4,5,6,7];
  client.picsCache = { ownershipModified: 1, apps: {
    '1': { appinfo: { common: { type: 'Game', name: 'A game: Deluxe Edition' } } },
    '2': { appinfo: { common: { type: 'DLC', name: 'Anno 1800 - The Passage' } } },
    '3': { appinfo: { common: { type: 'Tool', name: 'Dedicated server' } } },
    '4': { appinfo: { common: { type: 'Music', name: 'Soundtrack' } } },
    '5': { appinfo: { common: { type: 'Demo', name: 'Trial' } } },
    '6': { appinfo: { common: { name: 'Not classified' } } },
  }};
  const games = await listPicsOwnedGames(client, new AbortController().signal);
  assert.deepEqual(games.map(game => game.appId), [1]);
});
test('type matching is exact and case-insensitive; names never determine type', () => {
  assert.equal(isBaseGame({ appinfo: { common: { type: ' GAME ' } } }), true);
  for (const type of ['DLC','game_dlc','Application','Beta','Mod','']) {
    assert.equal(isBaseGame({ appinfo: { common: { type, name: 'Great Game' } } }), false);
  }
  assert.equal(isBaseGame(undefined), false);
});
test('metadata filter covers remote-library path, preserves Cloud stats, sanitizes names', () => {
  const games = [{ appId: 1, name: 'App 1', fileCount: 2, totalBytes: 100 }, { appId: 2, name: 'DLC', fileCount: 0, totalBytes: 0 }];
  assert.deepEqual(filterBaseGames(games, {
    '1': { appinfo: { common: { type: 'game', name: 'Game\u0000 Name' } } },
    '2': { appinfo: { common: { type: 'dlc' } } },
  }), [{ appId: 1, name: 'Game Name', fileCount: 2, totalBytes: 100 }]);
});
test('PICS waits for ownershipCached and cleans listeners', async () => {
  const client = new FixtureClient(); const pending = listPicsOwnedGames(client, new AbortController().signal, 500);
  assert.equal(client.listenerCount('ownershipCached'), 1);
  client.picsCache = { ownershipModified: 1, apps }; client.emit('ownershipCached');
  assert.equal((await pending).length, 2); assert.equal(client.listenerCount('ownershipCached'), 0);
});
test('PICS timeout is actionable and cleans listeners', async () => {
  const client = new FixtureClient();
  await assert.rejects(listPicsOwnedGames(client, new AbortController().signal, 5), { code: 'LIBRARY_NOT_READY', statusCode: 503 });
  assert.equal(client.listenerCount('ownershipCached'), 0);
});
test('PICS aborts on disconnect', async () => {
  const client = new FixtureClient(); const controller = new AbortController();
  const pending = listPicsOwnedGames(client, controller.signal); controller.abort();
  await assert.rejects(pending, { code: 'NOT_CONNECTED' }); assert.equal(client.listenerCount('ownershipCached'), 0);
});
test('duplicate IDs fail closed even for unclassified apps', async () => {
  const client = new FixtureClient(); client.ids = [949230,949230]; client.picsCache = { ownershipModified: 1, apps };
  await assert.rejects(listPicsOwnedGames(client, new AbortController().signal), SteamServiceError);
});

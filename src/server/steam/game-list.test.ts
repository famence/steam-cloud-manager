import test from 'node:test';
import assert from 'node:assert/strict';
import { listRemoteGames } from './game-list.js';
import { SteamServiceError, type CloudMethod, type RpcCaller } from './protocol.js';

const steamId = '76561198000000000';

function makeRpc(
  respond: (method: CloudMethod, payload: Record<string, unknown>) => unknown,
): { rpc: RpcCaller; calls: { method: CloudMethod; payload: Record<string, unknown> }[] } {
  const calls: { method: CloudMethod; payload: Record<string, unknown> }[] = [];
  const rpc: RpcCaller = {
    async call<T>(method: CloudMethod, payload: object): Promise<T> {
      const input = payload as Record<string, unknown>;
      calls.push({ method, payload: input });
      return respond(method, input) as T;
    },
  };
  return { rpc, calls };
}

test('uses Cloud inventory and exact sizes when the legacy method still works', async () => {
  const { rpc, calls } = makeRpc((method) => {
    assert.equal(method, 'EnumerateUserApps');
    return { apps: [
      { appid: 949230, totalcount: 7, totalsize: '4294967296' },
      { appid: 255710, totalcount: 2, totalsize: '12000' },
    ] };
  });
  assert.deepEqual(await listRemoteGames(rpc, steamId), [
    { appId: 949230, name: 'App 949230', fileCount: 7, totalBytes: 4294967296 },
    { appId: 255710, name: 'App 255710', fileCount: 2, totalBytes: 12000 },
  ]);
  assert.deepEqual(calls.map(x => x.method), ['EnumerateUserApps']);
});

test('EResult 2 switches to owned-game titles without inventing Cloud usage', async () => {
  const { rpc, calls } = makeRpc((method, payload) => {
    if (method === 'EnumerateUserApps') throw new SteamServiceError('generic failure', 'STEAM_RESULT_2');
    assert.equal(method, 'GetOwnedGames');
    assert.equal(payload.steamid, steamId);
    assert.equal(payload.include_appinfo, true);
    return { game_count: 2, games: [
      { appid: 255710, name: 'Cities: Skylines', rtime_last_played: 50 },
      { appid: 949230, name: 'Cities: Skylines II', rtime_last_played: 500 },
    ] };
  });
  assert.deepEqual(await listRemoteGames(rpc, steamId), [
    { appId: 949230, name: 'Cities: Skylines II', fileCount: null, totalBytes: null },
    { appId: 255710, name: 'Cities: Skylines', fileCount: null, totalBytes: null },
  ]);
  assert.deepEqual(calls.map(x => x.method), ['EnumerateUserApps', 'GetOwnedGames']);
});

test('does not mask protocol corruption as an empty owned library', async () => {
  const { rpc, calls } = makeRpc(method => {
    assert.equal(method, 'EnumerateUserApps');
    return { apps: [{ appid: 949230, totalcount: 1, totalsize: '9999999999999999999999' }] };
  });
  await assert.rejects(listRemoteGames(rpc, steamId), { code: 'INVALID_STEAM_RESPONSE' });
  assert.equal(calls.length, 1);
});

test('a fallback failure is actionable without exposing authentication details', async () => {
  const { rpc } = makeRpc(method => {
    throw new SteamServiceError('sensitive server detail TOKEN', 'STEAM_RESULT_2', 502, method);
  });
  await assert.rejects(listRemoteGames(rpc, steamId), (error: unknown) => {
    assert.ok(error instanceof SteamServiceError);
    assert.equal(error.code, 'GAME_LIST_UNAVAILABLE');
    assert.match(error.message, /AppID/);
    assert.equal(error.message.includes('TOKEN'), false);
    return true;
  });
});

test('an invalid SteamID cannot trigger library enumeration', async () => {
  const { rpc, calls } = makeRpc(method => {
    if (method === 'EnumerateUserApps') throw new SteamServiceError('legacy', 'STEAM_RESULT_2');
    throw new Error('must not attempt owned game query with invalid SteamID');
  });
  await assert.rejects(listRemoteGames(rpc, 'not-a-steamid'), { code: 'NOT_CONNECTED' });
  assert.deepEqual(calls.map(x => x.method), ['EnumerateUserApps']);
});

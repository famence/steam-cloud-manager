import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { SteamRpcTransport, SteamServiceError, type SteamWireClient } from './protocol.js';
import { normalizeListing, type ChangelistResponse } from './cloud-operations.js';

const require = createRequire(import.meta.url);
interface TestProto {
  encode(value: object): { finish(): Uint8Array };
  decode(value: Buffer): Record<string, unknown>;
  fromObject(value: object): object;
}
const schema = require('steam-user/protobufs/generated/_load.js') as Record<string, TestProto>;
const steamID = { getSteamID64: () => '76561198000000000' };

test('Cloud RPC uses the pinned upstream protobufs and preserves uint64 values', async () => {
  const client: SteamWireClient = {
    steamID,
    _send(header, body, callback) {
      assert.equal(header.msg, 151);
      assert.equal(header.proto.target_job_name, 'Cloud.BeginAppUploadBatch#1');
      const request = schema.CCloud_BeginAppUploadBatch_Request.decode(body);
      assert.equal(request.appid, 949230);
      assert.deepEqual(request.files_to_delete, ['%WinAppDataLocal%Cities/save.cok']);
      const response = schema.CCloud_BeginAppUploadBatch_Response.fromObject({ batch_id: '18446744073709551614' });
      callback(Buffer.from(schema.CCloud_BeginAppUploadBatch_Response.encode(response).finish()), { proto: { eresult: 1 } });
    },
  };
  const rpc = new SteamRpcTransport(client, new AbortController().signal);
  const response = await rpc.call<{ batch_id: string }>('BeginAppUploadBatch', {
    appid: 949230, machine_name: 'Test', files_to_upload: [], files_to_delete: ['%WinAppDataLocal%Cities/save.cok'],
  });
  assert.equal(response.batch_id, '18446744073709551614');
});

test('RPC decodes ByteBuffer responses and keeps empty file lists', async () => {
  const client: SteamWireClient = {
    steamID,
    _send(_header, _body, callback) {
      callback({ toBuffer: () => Buffer.alloc(0) }, { proto: { eresult: 1 } });
    },
  };
  const rpc = new SteamRpcTransport(client, new AbortController().signal);
  assert.deepEqual(await rpc.call('EnumerateUserApps', {}), { apps: [] });
});

test('upstream changelist schema preserves bytes, uint64 and default persisted state', async () => {
  const client: SteamWireClient = {
    steamID,
    _send(_header, _body, callback) {
      const response = schema.CCloud_GetAppFileChangelist_Response.fromObject({
        current_change_number: '9007199254740993', path_prefixes: ['%WinAppDataLocal%Cities/'],
        files: [{ file_name: 'save.cok', sha_file: Buffer.alloc(20, 1), time_stamp: '1700000000', raw_file_size: 123 }],
      });
      callback(Buffer.from(schema.CCloud_GetAppFileChangelist_Response.encode(response).finish()), { proto: { eresult: 1 } });
    },
  };
  const rpc = new SteamRpcTransport(client, new AbortController().signal);
  const response = await rpc.call<ChangelistResponse>('GetAppFileChangelist', { appid: 949230, synced_change_number: '0' });
  const result = normalizeListing(949230, response);
  assert.equal(result.changeNumber, '9007199254740993');
  assert.deepEqual(result.files, [{
    name: '%WinAppDataLocal%Cities/save.cok', sha: '01'.repeat(20), size: 123, modifiedAt: 1700000000,
  }]);
});

test('RPC rejects error and missing EResult instead of treating HTTP/protocol success as deletion', async () => {
  for (const eresult of [undefined, 0, 2, 15, 84]) {
    const client: SteamWireClient = {
      steamID,
      _send(_header, _body, callback) { callback(Buffer.alloc(0), { proto: { eresult } }); },
    };
    const rpc = new SteamRpcTransport(client, new AbortController().signal);
    await assert.rejects(rpc.call('ClientDeleteFile', { appid: 1, filename: 'save' }), SteamServiceError);
  }
});

test('RPC timeout and disconnect settle pending calls without leaking transport details', async () => {
  const client: SteamWireClient = { steamID, _send() {} };
  const controller = new AbortController();
  const rpc = new SteamRpcTransport(client, controller.signal, 5);
  await assert.rejects(rpc.call('EnumerateUserApps', {}), { code: 'STEAM_TIMEOUT' });
  const pending = rpc.call('EnumerateUserApps', {});
  controller.abort();
  await assert.rejects(pending, { code: 'NOT_CONNECTED' });
  await assert.rejects(rpc.call('EnumerateUserApps', {}), { code: 'NOT_CONNECTED' });
});

test('unexpected transport exceptions are redacted', async () => {
  const client: SteamWireClient = {
    steamID,
    _send() { throw new Error('SECRET_TOKEN and signed-download-url'); },
  };
  const rpc = new SteamRpcTransport(client, new AbortController().signal);
  await assert.rejects(rpc.call('EnumerateUserApps', {}), (error: unknown) => {
    assert.ok(error instanceof SteamServiceError);
    assert.equal(error.code, 'STEAM_TRANSPORT_ERROR');
    assert.equal(error.message.includes('SECRET_TOKEN'), false);
    return true;
  });
});

test('owned-game fallback uses the Player service and never Cloud namespace', async () => {
  const client: SteamWireClient = {
    steamID,
    _send(header, body, callback) {
      assert.equal(header.proto.target_job_name, 'Player.GetOwnedGames#1');
      const request = schema.CPlayer_GetOwnedGames_Request.decode(body);
      assert.equal(String(request.steamid), steamID.getSteamID64());
      assert.equal(request.include_appinfo, true);
      const response = schema.CPlayer_GetOwnedGames_Response.fromObject({
        game_count: 1, games: [{ appid: 949230, name: 'Cities: Skylines II' }],
      });
      callback(Buffer.from(schema.CPlayer_GetOwnedGames_Response.encode(response).finish()), { proto: { eresult: 1 } });
    },
  };
  const rpc = new SteamRpcTransport(client, new AbortController().signal);
  const response = await rpc.call<{ games: { appid: number; name: string }[] }>('GetOwnedGames', {
    steamid: steamID.getSteamID64(), include_appinfo: true,
  });
  assert.deepEqual(response.games.map(game => game.name), ['Cities: Skylines II']);
});

test('Steam generic failure names the read method without claiming a delete happened', async () => {
  const client: SteamWireClient = {
    steamID,
    _send(_header, _body, callback) {
      callback(Buffer.alloc(0), { proto: { eresult: 2 } });
    },
  };
  const rpc = new SteamRpcTransport(client, new AbortController().signal);
  await assert.rejects(rpc.call('EnumerateUserApps', {}), (error: unknown) => {
    assert.ok(error instanceof SteamServiceError);
    assert.equal(error.code, 'STEAM_RESULT_2');
    assert.equal(error.method, 'EnumerateUserApps');
    assert.match(error.message, /Cloud\.EnumerateUserApps/);
    assert.doesNotMatch(error.message, /подтвердил выполнение операции/);
    return true;
  });
});

test('Cloud.EnumerateUserFiles request and response preserve paginated names and SHA metadata', async () => {
  const client: SteamWireClient = {
    steamID,
    _send(header, body, callback) {
      assert.equal(header.proto.target_job_name, 'Cloud.EnumerateUserFiles#1');
      const request = schema.CCloud_EnumerateUserFiles_Request.decode(body);
      assert.equal(request.appid, 949230);
      assert.equal(request.extended_details, true);
      assert.equal(request.start_index, 500);
      assert.equal(request.count, 500);
      const response = schema.CCloud_EnumerateUserFiles_Response.fromObject({
        total_files: 501,
        files: [{
          appid: 949230,
          filename: '%WinAppDataLocal%Cities/save.cok',
          timestamp: '1700000000',
          file_size: 1234,
          file_sha: 'ab'.repeat(20),
        }],
      });
      callback(Buffer.from(schema.CCloud_EnumerateUserFiles_Response.encode(response).finish()),
        { proto: { eresult: 1 } });
    },
  };
  const rpc = new SteamRpcTransport(client, new AbortController().signal);
  const response = await rpc.call<{ total_files: number; files: { filename: string; file_sha: string; timestamp: string }[] }>(
    'EnumerateUserFiles', { appid: 949230, extended_details: true, start_index: 500, count: 500 },
  );
  assert.equal(response.total_files, 501);
  assert.equal(response.files[0].timestamp, '1700000000');
  assert.equal(response.files[0].file_sha, 'ab'.repeat(20));
});

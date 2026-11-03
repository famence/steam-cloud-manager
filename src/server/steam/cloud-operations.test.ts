import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeListing, performDeleteBatch, readFileListing, readEnumeratedFileListing, type ChangelistResponse } from './cloud-operations.js';
import type { CloudFile } from '../../shared/types.js';
import { SteamServiceError, type CloudMethod, type RpcCaller } from './protocol.js';

const appId = 949230;
const first: CloudFile = { name: '%WinAppDataLocal%Cities/Город.cok', sha: '01'.repeat(20), size: 1234, modifiedAt: 1_700_000_000 };
const second: CloudFile = { name: '%WinAppDataLocal%Cities/autosave.cok', sha: '02'.repeat(20), size: 5678, modifiedAt: 1_700_000_001 };

function listing(files: CloudFile[]): ChangelistResponse {
  return {
    current_change_number: '18446744073709551614', is_only_delta: false, path_prefixes: [],
    files: files.map(file => ({
      file_name: file.name, sha_file: Buffer.from(file.sha, 'hex'), time_stamp: String(file.modifiedAt),
      raw_file_size: file.size, persist_state: 0, path_prefix_index: 0,
    })),
  };
}

test('listing combines exact prefixes, preserves Unicode and returns seconds', () => {
  const response = listing([first]);
  response.path_prefixes = ['%WinAppDataLocal%Cities/'];
  response.files[0].file_name = 'Город.cok';
  assert.deepEqual(normalizeListing(appId, response), {
    appId, changeNumber: '18446744073709551614', files: [first],
  });
});

test('forgotten and deleted entries never appear as active cloud files', () => {
  const response = listing([first, second]);
  response.files[0].persist_state = 1;
  response.files[1].persist_state = 2;
  assert.deepEqual(normalizeListing(appId, response).files, []);
});

test('partial listings, invalid prefix indexes, duplicate keys and absent hashes fail closed', () => {
  const partial = listing([first]); partial.is_only_delta = true;
  const invalidPrefix = listing([first]); invalidPrefix.files[0].path_prefix_index = 8;
  const duplicate = listing([first, first]);
  const missingSha = listing([first]); missingSha.files[0].sha_file = Buffer.alloc(0);
  for (const response of [partial, invalidPrefix, duplicate, missingSha]) {
    assert.throws(() => normalizeListing(appId, response), SteamServiceError);
  }
});

class FakeRpc implements RpcCaller {
  readonly calls: { method: CloudMethod; payload: Record<string, unknown> }[] = [];
  files = [first, second];
  deleteFailure?: string;
  deleteError = new SteamServiceError('Steam временно занят.', 'BUSY');
  completionFailure = false;
  verificationFailure = false;
  private reads = 0;
  async call<T>(method: CloudMethod, payload: object): Promise<T> {
    const input = payload as Record<string, unknown>;
    this.calls.push({ method, payload: input });
    if (method === 'GetAppFileChangelist') {
      this.reads++;
      if (this.verificationFailure && this.reads > 1) throw new Error('token never shown');
      return listing(this.files) as T;
    }
    if (method === 'BeginAppUploadBatch') return { batch_id: '18446744073709551614' } as T;
    if (method === 'ClientDeleteFile') {
      assert.equal(input.is_explicit_delete, true);
      assert.equal(input.upload_batch_id, '18446744073709551614');
      if (input.filename === this.deleteFailure) throw this.deleteError;
      this.files = this.files.filter(file => file.name !== input.filename);
      return {} as T;
    }
    if (method === 'CompleteAppUploadBatchBlocking') {
      if (this.completionFailure) throw new Error('connection closed');
      return {} as T;
    }
    throw new Error('Unexpected RPC');
  }
}

test('batch always completes after partial failure and verifies actual files', async () => {
  const rpc = new FakeRpc(); rpc.deleteFailure = second.name;
  const result = await performDeleteBatch(rpc, appId, [first, second]);
  assert.deepEqual(result, {
    deleted: [first.name], failed: [{ name: second.name, message: 'Steam временно занят.' }], batchCompleted: true,
  });
  assert.deepEqual(rpc.calls.map(call => call.method), [
    'GetAppFileChangelist', 'BeginAppUploadBatch', 'ClientDeleteFile', 'ClientDeleteFile',
    'CompleteAppUploadBatchBlocking', 'GetAppFileChangelist',
  ]);
  assert.equal(rpc.calls[4].payload.batch_eresult, 2);
});

test('changed file aborts deletion before starting any upload batch', async () => {
  const rpc = new FakeRpc();
  await assert.rejects(performDeleteBatch(rpc, appId, [{ ...first, sha: 'ff'.repeat(20) }]), { code: 'FILES_CHANGED' });
  assert.deepEqual(rpc.calls.map(call => call.method), ['GetAppFileChangelist']);
});

test('successful deletion retains a failed completion status instead of hiding it', async () => {
  const rpc = new FakeRpc(); rpc.completionFailure = true;
  const result = await performDeleteBatch(rpc, appId, [first]);
  assert.deepEqual(result, { deleted: [first.name], failed: [], batchCompleted: false });
});

test('unverifiable deletion never claims a confirmed successful result', async () => {
  const rpc = new FakeRpc(); rpc.verificationFailure = true;
  const result = await performDeleteBatch(rpc, appId, [first]);
  assert.equal(result.batchCompleted, true);
  assert.deepEqual(result.deleted, []);
  assert.equal(result.failed[0].name, first.name);
  assert.match(result.failed[0].message, /мог быть удалён/);
  assert.equal(JSON.stringify(result).includes('token'), false);
});

test('duplicate selection cannot send duplicate destructive requests', async () => {
  const rpc = new FakeRpc();
  await assert.rejects(performDeleteBatch(rpc, appId, [first, first]), { code: 'INVALID_SELECTION' });
  assert.deepEqual(rpc.calls, []);
});

test('systemic failure skips remaining deletes but still finalizes and verifies the batch', async () => {
  for (const code of ['STEAM_TIMEOUT', 'NOT_CONNECTED', 'STEAM_TRANSPORT_ERROR', 'STEAM_RESULT_84', 'STEAM_RESULT_25', 'STEAM_RESULT_15']) {
    const rpc = new FakeRpc();
    rpc.deleteFailure = first.name;
    rpc.deleteError = new SteamServiceError('Steam недоступен.', code);
    const result = await performDeleteBatch(rpc, appId, [first, second]);
    assert.deepEqual(rpc.calls.map(call => call.method), [
      'GetAppFileChangelist', 'BeginAppUploadBatch', 'ClientDeleteFile',
      'CompleteAppUploadBatchBlocking', 'GetAppFileChangelist',
    ]);
    assert.equal(rpc.calls[3].payload.batch_eresult, 2);
    assert.equal(result.batchCompleted, true);
    assert.deepEqual(result.deleted, []);
    assert.equal(result.failed[0].message, 'Steam недоступен.');
    assert.match(result.failed[1].message, /не отправлялся на удаление/);
  }
});

test('EResult 2 in GetAppFileChangelist falls back to paginated user files without losing hashes', async () => {
  const methods: CloudMethod[] = [];
  const rpc: RpcCaller = { async call<T>(method, payload): Promise<T> {
    methods.push(method);
    if (method === 'GetAppFileChangelist') {
      throw new SteamServiceError('generic fail', 'STEAM_RESULT_2', 502, method);
    }
    assert.equal(method, 'EnumerateUserFiles');
    assert.deepEqual(payload, { appid: appId, extended_details: true, start_index: 0, count: 500 });
    return {
      total_files: 2,
      files: [
        { appid: appId, filename: first.name, timestamp: String(first.modifiedAt),
          file_size: first.size, file_sha: first.sha.toUpperCase() },
        { appid: appId, filename: second.name, timestamp: String(second.modifiedAt),
          file_size: second.size, file_sha: second.sha },
      ],
    } as T;
  }};
  assert.deepEqual(await readFileListing(rpc, appId), {
    appId, changeNumber: 'enumerated', files: [first, second],
  });
  assert.deepEqual(methods, ['GetAppFileChangelist', 'EnumerateUserFiles']);
});

test('paginated user-file enumeration traverses more than 500 files', async () => {
  const calls: number[] = [];
  const rpc: RpcCaller = { async call<T>(method, payload): Promise<T> {
    assert.equal(method, 'EnumerateUserFiles');
    const start = (payload as { start_index: number }).start_index;
    calls.push(start);
    const count = Math.min(500, 507 - start);
    return {
      total_files: 507,
      files: Array.from({ length: count }, (_, index) => ({
        appid: appId, filename: `save-${start + index}.cok`,
        timestamp: String(first.modifiedAt),
        file_size: 42, file_sha: first.sha,
      })),
    } as T;
  }};
  const result = await readEnumeratedFileListing(rpc, appId);
  assert.equal(result.files.length, 507);
  assert.deepEqual(calls, [0, 500]);
});

test('read-only enumeration rejects missing hashes and inconsistent pagination', async () => {
  for (const response of [
    { total_files: 1, files: [{ appid: appId, filename: 'save.cok',
      timestamp: String(first.modifiedAt), file_size: 1, file_sha: '' }] },
    { total_files: 10, files: [] },
    { total_files: 1, files: [{ appid: appId + 1, filename: 'save.cok',
      timestamp: String(first.modifiedAt), file_size: 1, file_sha: first.sha }] },
  ]) {
    const rpc: RpcCaller = { async call<T>(): Promise<T> { return response as T; } };
    await assert.rejects(readEnumeratedFileListing(rpc, appId), SteamServiceError);
  }
});

test('authentication and transport failures never trigger unverified listing fallbacks', async () => {
  const methods: CloudMethod[] = [];
  const rpc: RpcCaller = { async call<T>(method): Promise<T> {
    methods.push(method);
    throw new SteamServiceError('no access', 'STEAM_RESULT_15', 502, method);
  }};
  await assert.rejects(readFileListing(rpc, appId), { code: 'STEAM_RESULT_15' });
  assert.deepEqual(methods, ['GetAppFileChangelist']);
});

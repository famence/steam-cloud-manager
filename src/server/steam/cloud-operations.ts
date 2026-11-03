import type { CloudFile, DeleteResult } from '../../shared/types.js';
import type { DriverListing } from './contracts.js';
import { SteamServiceError, safeSteamError, type RpcCaller } from './protocol.js';

export interface ChangelistResponse {
  current_change_number: string;
  is_only_delta: boolean;
  path_prefixes: string[];
  files: {
    file_name: string;
    sha_file: Buffer;
    time_stamp: string;
    raw_file_size: number;
    persist_state: number;
    path_prefix_index: number;
  }[];
}

export function assertAppId(appId: number): void {
  if (!Number.isInteger(appId) || appId <= 0 || appId > 0xffff_ffff) {
    throw new SteamServiceError('Некорректный App ID.', 'INVALID_APP_ID', 400);
  }
}

export function safeInteger(value: unknown, label = 'размер'): number {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new SteamServiceError(`Steam вернул некорректный ${label}.`, 'INVALID_STEAM_RESPONSE');
  }
  if (typeof value === 'string' && !/^\d+$/.test(value)) {
    throw new SteamServiceError(`Steam вернул некорректный ${label}.`, 'INVALID_STEAM_RESPONSE');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new SteamServiceError(`Steam вернул некорректный ${label}.`, 'INVALID_STEAM_RESPONSE');
  }
  return parsed;
}

export function sameFile(left: CloudFile, right: CloudFile): boolean {
  return left.name === right.name && left.sha === right.sha
    && left.size === right.size && left.modifiedAt === right.modifiedAt;
}

export function normalizeListing(appId: number, response: ChangelistResponse): DriverListing {
  assertAppId(appId);
  if (response.is_only_delta || !Array.isArray(response.files) || !Array.isArray(response.path_prefixes)
    || !/^\d+$/.test(response.current_change_number) || response.files.length > 100_000) {
    throw new SteamServiceError('Steam не вернул полный список сохранений. Обновите подключение.', 'INCOMPLETE_LISTING');
  }
  const names = new Set<string>();
  const files: CloudFile[] = [];
  for (const item of response.files) {
    if (item.persist_state === 1 || item.persist_state === 2) continue;
    if (item.persist_state !== 0) {
      throw new SteamServiceError('Steam вернул неизвестное состояние файла.', 'INVALID_STEAM_RESPONSE');
    }
    const index = safeInteger(item.path_prefix_index, 'индекс пути');
    // With no prefix table, Steam transmits complete filenames and the default index is zero.
    const prefix = response.path_prefixes.length === 0 && index === 0 ? '' : response.path_prefixes[index];
    if (typeof prefix !== 'string' || typeof item.file_name !== 'string') {
      throw new SteamServiceError('Steam вернул некорректный путь файла.', 'INVALID_STEAM_RESPONSE');
    }
    const name = prefix + item.file_name;
    if (!name || /[\u0000-\u001f\u007f]/u.test(name) || Buffer.byteLength(name) > 4096 || names.has(name)) {
      throw new SteamServiceError('Steam вернул неоднозначный список файлов.', 'INVALID_STEAM_RESPONSE');
    }
    const hash = item.sha_file;
    if (!Buffer.isBuffer(hash) || hash.length !== 20) {
      throw new SteamServiceError('Steam не вернул контрольную сумму файла.', 'INVALID_STEAM_RESPONSE');
    }
    const modifiedAt = safeInteger(item.time_stamp, 'время изменения');
    if (modifiedAt > 8.64e12) {
      throw new SteamServiceError('Steam вернул некорректное время изменения.', 'INVALID_STEAM_RESPONSE');
    }
    names.add(name);
    files.push({ name, sha: hash.toString('hex'), size: safeInteger(item.raw_file_size), modifiedAt });
  }
  return { appId, files, changeNumber: response.current_change_number };
}

interface EnumeratedCloudFile {
  appid: number;
  filename: string;
  timestamp: string;
  file_size: number;
  file_sha: string;
}
interface EnumerateUserFilesResponse {
  total_files: number;
  files: EnumeratedCloudFile[];
}

export async function readEnumeratedFileListing(rpc: RpcCaller, appId: number): Promise<DriverListing> {
  assertAppId(appId);
  const maxFiles = 100_000;
  const pageSize = 500;
  const files: CloudFile[] = [];
  const seen = new Set<string>();
  let totalFiles: number | null = null;

  while (totalFiles === null || files.length < totalFiles) {
    const response = await rpc.call<EnumerateUserFilesResponse>('EnumerateUserFiles', {
      appid: appId,
      extended_details: true,
      start_index: files.length,
      count: pageSize,
    });
    if (!response || !Array.isArray(response.files) || response.files.length > pageSize) {
      throw new SteamServiceError('Steam вернул некорректную страницу файлов.', 'INVALID_STEAM_RESPONSE');
    }
    const count = safeInteger(response.total_files, 'количество файлов');
    if (count > maxFiles || (totalFiles !== null && count !== totalFiles) || files.length + response.files.length > count
      || (response.files.length === 0 && files.length < count)) {
      throw new SteamServiceError('Steam не вернул полный список файлов.', 'INCOMPLETE_LISTING');
    }
    totalFiles = count;
    for (const item of response.files) {
      if (!item || (item.appid !== 0 && item.appid !== appId) || typeof item.filename !== 'string'
        || !item.filename || /[\u0000-\u001f\u007f]/u.test(item.filename)
        || Buffer.byteLength(item.filename) > 4096 || seen.has(item.filename)
        || typeof item.file_sha !== 'string' || !/^[0-9a-f]{40}$/i.test(item.file_sha)) {
        throw new SteamServiceError('Steam вернул некорректные сведения о файле.', 'INVALID_STEAM_RESPONSE');
      }
      const size = safeInteger(item.file_size);
      const modifiedAt = safeInteger(item.timestamp, 'время изменения');
      if (modifiedAt > 8.64e12) {
        throw new SteamServiceError('Steam вернул некорректное время изменения.', 'INVALID_STEAM_RESPONSE');
      }
      seen.add(item.filename);
      files.push({ name: item.filename, sha: item.file_sha.toLowerCase(), size, modifiedAt });
    }
  }
  // Steam's UserFiles endpoint has no changelist number. The HTTP revision
  // hashes file names, SHA, sizes and timestamps and revalidates before deletion.
  return { appId, changeNumber: 'enumerated', files };
}

const canFallbackToEnumerated = new Set(['STEAM_RESULT_2', 'STEAM_RESULT_20', 'STEAM_RESULT_42']);

export async function readFileListing(rpc: RpcCaller, appId: number): Promise<DriverListing> {
  assertAppId(appId);
  try {
    const response = await rpc.call<ChangelistResponse>('GetAppFileChangelist', {
      appid: appId, synced_change_number: '0',
    });
    return normalizeListing(appId, response);
  } catch (error) {
    if (!(error instanceof SteamServiceError) || !canFallbackToEnumerated.has(error.code)) throw error;
    return readEnumeratedFileListing(rpc, appId);
  }
}


/**
 * Steam's EnumerateUserFiles returns a per-file download URL, documented by
 * ICloudService. Use it only when the client download RPC cannot serve a file.
 * The URL remains server-side; openSignedStorageDownload validates host and
 * pins a public IP before making the HTTPS request.
 */
export async function findEnumeratedDownloadUrl(
  rpc: RpcCaller, appId: number, expected: CloudFile,
): Promise<string> {
  assertAppId(appId);
  const pageSize = 500;
  const seen = new Set<string>();
  let start = 0;
  let total: number | null = null;
  while (total === null || start < total) {
    const response = await rpc.call<{
      total_files: number;
      files: Array<{ appid: number; filename: string; file_sha: string;
        file_size: number; timestamp: string; url?: string }>;
    }>('EnumerateUserFiles', {
      appid: appId, extended_details: true, count: pageSize, start_index: start,
    });
    if (!response || !Array.isArray(response.files) || response.files.length > pageSize) {
      throw new SteamServiceError('Steam вернул некорректный список файлов.', 'INVALID_STEAM_RESPONSE');
    }
    const count = safeInteger(response.total_files, 'количество файлов');
    if (count > 100_000 || (total !== null && total !== count)
      || start + response.files.length > count || (start < count && response.files.length === 0)) {
      throw new SteamServiceError('Steam вернул неполный список файлов.', 'INCOMPLETE_LISTING');
    }
    total = count;
    for (const item of response.files) {
      if (!item || (item.appid !== 0 && item.appid !== appId)
        || typeof item.filename !== 'string' || !item.filename
        || seen.has(item.filename)) {
        throw new SteamServiceError('Steam вернул неоднозначный список файлов.', 'INVALID_STEAM_RESPONSE');
      }
      seen.add(item.filename);
      if (item.filename !== expected.name) continue;
      if (typeof item.file_sha !== 'string' || item.file_sha.toLowerCase() !== expected.sha
        || safeInteger(item.file_size) !== expected.size
        || safeInteger(item.timestamp, 'время изменения') !== expected.modifiedAt) {
        throw new SteamServiceError('Сохранение изменилось. Обновите список файлов.', 'FILES_CHANGED', 409);
      }
      if (typeof item.url !== 'string' || !item.url) {
        throw new SteamServiceError('Steam не предоставил ссылку скачивания файла.', 'DOWNLOAD_URL_UNAVAILABLE');
      }
      return item.url;
    }
    start += response.files.length;
  }
  throw new SteamServiceError('Файл больше не найден. Обновите список сохранений.', 'FILES_CHANGED', 409);
}

// Stop the batch after a session/transport/rate-limit failure. Retrying every remaining
// filename could hold one HTTP request open for hours and amplify a Steam outage.
const batchStoppingErrors = new Set([
  'STEAM_TIMEOUT', 'NOT_CONNECTED', 'STEAM_TRANSPORT_ERROR', 'STEAM_NETWORK_ERROR', 'STEAM_ERROR',
  'INVALID_STEAM_RESPONSE', 'PROTOCOL_MISMATCH',
  'STEAM_RESULT_5', 'STEAM_RESULT_15', 'STEAM_RESULT_16',
  'STEAM_RESULT_25', 'STEAM_RESULT_29', 'STEAM_RESULT_84', 'STEAM_RESULT_UNKNOWN',
]);

export async function performDeleteBatch(
  rpc: RpcCaller,
  appId: number,
  requestedFiles: CloudFile[],
): Promise<DeleteResult> {
  assertAppId(appId);
  const files = requestedFiles.map(file => ({ ...file }));
  if (files.length < 1 || files.length > 500 || new Set(files.map(file => file.name)).size !== files.length) {
    throw new SteamServiceError('Выберите от 1 до 500 разных файлов.', 'INVALID_SELECTION', 400);
  }
  const latest = await readFileListing(rpc, appId);
  const current = new Map(latest.files.map(file => [file.name, file]));
  if (files.some(file => !current.has(file.name) || !sameFile(file, current.get(file.name)!))) {
    throw new SteamServiceError('Выбранные сохранения изменились. Обновите список и подтвердите удаление снова.', 'FILES_CHANGED', 409);
  }

  const batch = await rpc.call<{ batch_id: string }>('BeginAppUploadBatch', {
    appid: appId,
    machine_name: 'Steam Cloud Manager',
    files_to_upload: [],
    files_to_delete: files.map(file => file.name),
  });
  if (typeof batch.batch_id !== 'string' || !/^\d+$/.test(batch.batch_id) || batch.batch_id === '0') {
    throw new SteamServiceError('Steam не подтвердил начало удаления.', 'INVALID_STEAM_RESPONSE');
  }

  const errors = new Map<string, string>();
  let batchCompleted = false;
  try {
    for (const [index, file] of files.entries()) {
      try {
        await rpc.call('ClientDeleteFile', {
          appid: appId, filename: file.name, is_explicit_delete: true, upload_batch_id: batch.batch_id,
        });
      } catch (error) {
        const safeError = safeSteamError(error);
        errors.set(file.name, safeError.message);
        if (batchStoppingErrors.has(safeError.code)) {
          for (const skipped of files.slice(index + 1)) {
            errors.set(skipped.name, 'Операция остановлена после ошибки Steam. Этот файл не отправлялся на удаление.');
          }
          break;
        }
      }
    }
  } finally {
    try {
      await rpc.call('CompleteAppUploadBatchBlocking', {
        appid: appId, batch_id: batch.batch_id, batch_eresult: errors.size === 0 ? 1 : 2,
      });
      batchCompleted = true;
    } catch {
      // File operations may already have succeeded. Verification below determines their status.
    }
  }

  let remaining: Set<string>;
  try {
    remaining = new Set((await readFileListing(rpc, appId)).files.map(file => file.name));
  } catch {
    return {
      deleted: [], batchCompleted,
      failed: files.map(file => ({
        name: file.name,
        message: 'Не удалось проверить результат. Файл мог быть удалён; обновите список перед повторной попыткой.',
      })),
    };
  }
  const deleted: string[] = [];
  const failed: DeleteResult['failed'] = [];
  for (const file of files) {
    if (!remaining.has(file.name)) deleted.push(file.name);
    else failed.push({ name: file.name, message: errors.get(file.name) ?? 'Steam пока возвращает этот файл. Обновите список.' });
  }
  return { deleted, failed, batchCompleted };
}

import type { EventEmitter } from 'node:events';
import type { CloudGame } from '../../shared/types.js';
import { SteamServiceError } from './protocol.js';

interface PicsApp {
  appinfo?: { common?: { name?: string } };
}
export interface PicsClient extends EventEmitter {
  getOwnedApps(): number[];
  picsCache?: {
    ownershipModified?: number;
    apps?: Record<string, PicsApp>;
  };
}

function safeName(raw: unknown, appId: number): string {
  if (typeof raw !== 'string') return `App ${appId}`;
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 160);
  return cleaned || `App ${appId}`;
}

/**
 * PICS ownership is built from Steam's license and product-info messages,
 * not from either of the Cloud.EnumerateUserApps or Player.GetOwnedGames RPCs.
 * It does NOT imply that any given game has cloud files.
 */
export async function listPicsOwnedGames(
  client: PicsClient,
  signal: AbortSignal,
  timeoutMs = 30_000,
): Promise<CloudGame[]> {
  if (signal.aborted) throw new SteamServiceError('Сессия Steam завершена.', 'NOT_CONNECTED', 401);

  if (!client.picsCache?.ownershipModified) {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timer);
        client.removeListener('ownershipCached', ready);
        signal.removeEventListener('abort', aborted);
      };
      const finish = (error?: SteamServiceError) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const ready = () => finish();
      const aborted = () => finish(new SteamServiceError('Сессия Steam завершена.', 'NOT_CONNECTED', 401));
      client.on('ownershipCached', ready);
      signal.addEventListener('abort', aborted, { once: true });
      timer = setTimeout(() => finish(new SteamServiceError(
        'Steam ещё загружает данные о приобретённых играх. Повторите обновление библиотеки чуть позже.',
        'LIBRARY_NOT_READY', 503,
      )), timeoutMs);
      // Account for a race between checking the cache and subscribing.
      if (client.picsCache?.ownershipModified) finish();
      if (signal.aborted) aborted();
    });
  }

  let appIds: number[];
  try {
    appIds = client.getOwnedApps();
  } catch {
    throw new SteamServiceError(
      'Steam не смог подготовить список приобретённых игр. Повторите обновление библиотеки.',
      'GAME_LIST_UNAVAILABLE', 502,
    );
  }
  if (!Array.isArray(appIds) || appIds.length > 20_000) {
    throw new SteamServiceError('Steam вернул некорректный список игр.', 'INVALID_STEAM_RESPONSE');
  }

  const seen = new Set<number>();
  const games: CloudGame[] = [];
  for (const appId of appIds) {
    if (!Number.isInteger(appId) || appId <= 0 || appId > 0xffffffff || seen.has(appId)) {
      throw new SteamServiceError('Steam вернул неоднозначный список игр.', 'INVALID_STEAM_RESPONSE');
    }
    seen.add(appId);
    games.push({
      appId,
      name: safeName(client.picsCache?.apps?.[appId]?.appinfo?.common?.name, appId),
      fileCount: null,
      totalBytes: null,
    });
  }
  return games.sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.appId - b.appId);
}

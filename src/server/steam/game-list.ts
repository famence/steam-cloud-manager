import type { CloudGame } from '../../shared/types.js';
import { assertAppId, safeInteger } from './cloud-operations.js';
import { SteamServiceError, type RpcCaller } from './protocol.js';

interface CloudApp {
  appid: number;
  totalcount: number;
  totalsize: string;
}
interface OwnedGame {
  appid: number;
  name?: string;
  rtime_last_played?: number;
}
const legacyUnavailable = new Set(['STEAM_RESULT_2', 'STEAM_RESULT_20', 'STEAM_RESULT_42']);

function cleanName(value: unknown, appId: number): string {
  return typeof value === 'string' && value.trim()
    ? value.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 160) || `App ${appId}`
    : `App ${appId}`;
}

/**
 * EnumerateUserApps is absent from recent Steam client protobufs, though older
 * versions of steam-user still expose it. If Steam rejects this old RPC,
 * return the owned-game library instead. Unknown Cloud sizes/counts must be
 * null, NEVER zero: owning a game does not imply having Cloud saves.
 *
 * Per-app reads still use Cloud.GetAppFileChangelist. No mutation fallback.
 */
export async function listRemoteGames(rpc: RpcCaller, steamId: string): Promise<CloudGame[]> {
  try {
    const response = await rpc.call<{ apps: CloudApp[] }>('EnumerateUserApps', {});
    if (!Array.isArray(response.apps) || response.apps.length > 20_000) {
      throw new SteamServiceError('Steam вернул некорректный список игр.', 'INVALID_STEAM_RESPONSE');
    }
    const seen = new Set<number>();
    return response.apps.map(app => {
      assertAppId(app.appid);
      if (seen.has(app.appid)) {
        throw new SteamServiceError('Steam вернул неоднозначный список игр.', 'INVALID_STEAM_RESPONSE');
      }
      seen.add(app.appid);
      return {
        appId: app.appid, name: `App ${app.appid}`,
        fileCount: safeInteger(app.totalcount, 'количество файлов'),
        totalBytes: safeInteger(app.totalsize),
      };
    }).sort((a, b) => (b.totalBytes ?? 0) - (a.totalBytes ?? 0));
  } catch (error) {
    // Never silently reinterpret malformed data or transport failures as an empty library.
    if (!(error instanceof SteamServiceError) || !legacyUnavailable.has(error.code)) throw error;
  }

  if (!/^[1-9]\d{16}$/.test(steamId)) {
    throw new SteamServiceError('Steam не подтвердил идентификатор аккаунта.', 'NOT_CONNECTED', 401);
  }

  let response: { games: OwnedGame[]; game_count: number };
  try {
    response = await rpc.call('GetOwnedGames', {
      steamid: steamId,
      include_appinfo: true,
      include_played_free_games: true,
      include_free_sub: true,
    });
  } catch (error) {
    if (error instanceof SteamServiceError) {
      throw new SteamServiceError(
        'Steam отклонил получение списка Cloud-игр и резервного списка библиотеки. ' +
        'Можно проверить конкретную игру, указав её AppID вручную.',
        'GAME_LIST_UNAVAILABLE', 502,
      );
    }
    throw error;
  }

  if (!Array.isArray(response.games) || response.games.length > 20_000) {
    throw new SteamServiceError('Steam вернул некорректный список игр в библиотеке.', 'INVALID_STEAM_RESPONSE');
  }
  const seen = new Set<number>();
  return response.games.map(game => {
    assertAppId(game.appid);
    if (seen.has(game.appid)) {
      throw new SteamServiceError('Steam вернул повторяющиеся AppID.', 'INVALID_STEAM_RESPONSE');
    }
    seen.add(game.appid);
    return {
      game: {
        appId: game.appid, name: cleanName(game.name, game.appid),
        fileCount: null, totalBytes: null,
      } satisfies CloudGame,
      lastPlayed: Number.isSafeInteger(game.rtime_last_played) ? game.rtime_last_played! : 0,
    };
  }).sort((a, b) => b.lastPlayed - a.lastPlayed || a.game.name.localeCompare(b.game.name))
    .map(entry => entry.game);
}

import type { CloudGame } from '../../shared/types.js';

export interface PicsApp {
  appinfo?: { common?: { name?: string; type?: string } };
}

/** PICS ownership includes DLC, tools and soundtracks. Never guess a type from the title. */
export function isBaseGame(app: PicsApp | undefined): boolean {
  return typeof app?.appinfo?.common?.type === 'string'
    && app.appinfo.common.type.trim().toLowerCase() === 'game';
}

export function filterBaseGames(games: CloudGame[], metadata: Record<string, PicsApp>): CloudGame[] {
  return games.filter(game => isBaseGame(metadata[game.appId])).map(game => {
    const name = metadata[game.appId]?.appinfo?.common?.name;
    const cleaned = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 160) : '';
    return { ...game, name: cleaned || game.name };
  });
}

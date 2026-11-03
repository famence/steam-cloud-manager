import type { CloudGame } from '../shared/types';
import type { Locale } from './i18n';
export function isInactive(game: CloudGame): boolean {
  return game.fileCount === 0 || (game.cloudSupport === 'unsupported' && (game.fileCount === null || game.fileCount === 0));
}
/** Available/unknown games first, favorites within that group, then confirmed empty/unsupported games. */
export function orderGames(games: CloudGame[], favorites: ReadonlySet<number>, locale: Locale): CloudGame[] {
  return [...games].sort((a, b) => Number(isInactive(a)) - Number(isInactive(b))
    || Number(favorites.has(b.appId)) - Number(favorites.has(a.appId))
    || a.name.localeCompare(b.name, locale) || a.appId - b.appId);
}

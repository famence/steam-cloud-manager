import type { CloudGame, CloudSupport } from '../../shared/types.js';
export interface PicsApp {
  appinfo?: {
    common?: { name?: string; type?: string; category?: Record<string, string | number> };
    ufs?: { maxnumfiles?: string | number; quota?: string | number };
  };
}
export function isBaseGame(app: PicsApp | undefined): boolean {
  return typeof app?.appinfo?.common?.type === 'string'
    && app.appinfo.common.type.trim().toLowerCase() === 'game';
}
/** Missing metadata is not proof that Cloud is unsupported. */
export function cloudSupport(app: PicsApp | undefined): CloudSupport {
  const ufs = app?.appinfo?.ufs;
  const category = app?.appinfo?.common?.category?.category_23;
  const positive = (value: unknown) => (typeof value === 'string' || typeof value === 'number')
    && /^\d+$/.test(String(value)) && Number(value) > 0;
  if (String(category) === '1' || positive(ufs?.maxnumfiles) || positive(ufs?.quota)) return 'supported';
  // Only explicit zero quotas are classified as unsupported, never an absent category/ufs object.
  if (ufs && String(ufs.maxnumfiles) === '0' && String(ufs.quota) === '0') return 'unsupported';
  return 'unknown';
}
export function filterBaseGames(games: CloudGame[], metadata: Record<string, PicsApp>): CloudGame[] {
  return games.filter(game => isBaseGame(metadata[game.appId])).map(game => {
    const app = metadata[game.appId];
    const name = app?.appinfo?.common?.name;
    const cleaned = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 160) : '';
    return { ...game, name: cleaned || game.name,
      cloudSupport: game.fileCount !== null && game.fileCount > 0 ? 'supported' : cloudSupport(app) };
  });
}

export interface Config {
  host: string; port: number; appOrigin: string; secureCookies: boolean;
  demoMode: boolean; allowedSteamIds: string[]; sessionTtlMs: number;
  maxSessions: number; production: boolean;
}
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
/** Steam sessions are allowed only in an explicitly local process, never on Vercel. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env.VERCEL) throw new Error('The Steam backend cannot run on Vercel. Deploy the static public build instead.');
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const host = env.HOST || '127.0.0.1';
  // A hostname is not accepted for binding: DNS must never turn a local app into a public listener.
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('HOST must be a literal loopback address');
  const appOrigin = new URL(env.APP_ORIGIN || `http://127.0.0.1:${production ? port : 5173}`);
  if (!['http:', 'https:'].includes(appOrigin.protocol) || !loopbackHosts.has(appOrigin.hostname)
    || appOrigin.username || appOrigin.password || appOrigin.pathname !== '/' || appOrigin.search || appOrigin.hash) {
    throw new Error('APP_ORIGIN must be an exact loopback HTTP(S) origin');
  }
  const allowedSteamIds = (env.ALLOWED_STEAM_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowedSteamIds.some(id => !/^7656119\d{10}$/.test(id))) throw new Error('Invalid ALLOWED_STEAM_IDS');
  const ttlMinutes = Number(env.SESSION_TTL_MINUTES || 60);
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 5 || ttlMinutes > 240) throw new Error('SESSION_TTL_MINUTES must be 5..240');
  if (env.DEMO_MODE && !['true', 'false'].includes(env.DEMO_MODE)) throw new Error('DEMO_MODE must be true or false');
  return { host, port, appOrigin: appOrigin.origin, production,
    secureCookies: appOrigin.protocol === 'https:', demoMode: env.DEMO_MODE === 'true',
    allowedSteamIds, sessionTtlMs: ttlMinutes * 60_000, maxSessions: 25 };
}

export interface Config {
  host: string;
  port: number;
  appOrigin: string;
  secureCookies: boolean;
  demoMode: boolean;
  allowedSteamIds: string[];
  sessionTtlMs: number;
  maxSessions: number;
  production: boolean;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const appOrigin = new URL(env.APP_ORIGIN || `http://127.0.0.1:${production ? port : 5173}`);
  if (!['https:', 'http:'].includes(appOrigin.protocol) || appOrigin.username || appOrigin.password || appOrigin.pathname !== '/' || appOrigin.search || appOrigin.hash) {
    throw new Error('APP_ORIGIN must be an HTTP(S) origin without path, credentials, query or fragment');
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(appOrigin.hostname);
  const allowedSteamIds = (env.ALLOWED_STEAM_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowedSteamIds.some((id) => !/^7656119\d{10}$/.test(id))) throw new Error('Invalid ALLOWED_STEAM_IDS');
  if (!local && appOrigin.protocol !== 'https:') throw new Error('A remote APP_ORIGIN requires HTTPS');
  if (!local && allowedSteamIds.length === 0) throw new Error('A remote APP_ORIGIN requires ALLOWED_STEAM_IDS');
  const ttlMinutes = Number(env.SESSION_TTL_MINUTES || 60);
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 5 || ttlMinutes > 240) throw new Error('SESSION_TTL_MINUTES must be 5..240');
  if (env.DEMO_MODE && !['true', 'false'].includes(env.DEMO_MODE)) throw new Error('DEMO_MODE must be true or false');
  return {
    host: env.HOST || '127.0.0.1', port, appOrigin: appOrigin.origin,
    secureCookies: appOrigin.protocol === 'https:', demoMode: env.DEMO_MODE === 'true',
    allowedSteamIds, sessionTtlMs: ttlMinutes * 60_000, maxSessions: 25, production,
  };
}

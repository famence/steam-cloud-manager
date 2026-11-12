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

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

function resolveAppOrigin(
  env: NodeJS.ProcessEnv,
  production: boolean,
  port: number,
  isVercel: boolean,
): URL {
  if (isVercel) {
    const raw =
      env.APP_ORIGIN ||
      (env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
        : undefined) ||
      (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined) ||
      'https://steam-cloud-manager.vercel.app';
    const normalized =
      raw.startsWith('http://') || raw.startsWith('https://')
        ? raw
        : `https://${raw}`;
    const url = new URL(normalized);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('APP_ORIGIN must be an exact HTTP(S) origin');
    }
    return url;
  }

  const raw = env.APP_ORIGIN || `http://127.0.0.1:${production ? port : 5173}`;
  const url = new URL(raw);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !loopbackHosts.has(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('APP_ORIGIN must be an exact loopback HTTP(S) origin');
  }
  return url;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isVercel = Boolean(env.VERCEL);
  const production = isVercel || env.NODE_ENV === 'production';
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid PORT');
  }

  const host = env.HOST || (isVercel ? '0.0.0.0' : '127.0.0.1');
  if (!isVercel && !['127.0.0.1', '::1'].includes(host)) {
    throw new Error('HOST must be a literal loopback address');
  }

  const appOrigin = resolveAppOrigin(env, production, port, isVercel);

  const allowedSteamIds = (env.ALLOWED_STEAM_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowedSteamIds.some((id) => !/^7656119\d{10}$/.test(id))) {
    throw new Error('Invalid ALLOWED_STEAM_IDS');
  }

  const ttlMinutes = Number(env.SESSION_TTL_MINUTES || 60);
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 5 || ttlMinutes > 240) {
    throw new Error('SESSION_TTL_MINUTES must be 5..240');
  }

  if (env.DEMO_MODE && !['true', 'false'].includes(env.DEMO_MODE)) {
    throw new Error('DEMO_MODE must be true or false');
  }

  return {
    host,
    port,
    appOrigin: appOrigin.origin,
    production,
    secureCookies: isVercel || appOrigin.protocol === 'https:',
    demoMode: env.DEMO_MODE === 'true',
    allowedSteamIds,
    sessionTtlMs: ttlMinutes * 60_000,
    maxSessions: 25,
  };
}

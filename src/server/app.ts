import Fastify, { LogController, type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZipArchive } from 'archiver';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import type { Config } from './config.js';
import type { CloudDriver } from './steam/contracts.js';
import { SteamCloudDriver } from './steam/steam-driver.js';
import { SteamServiceError } from './steam/protocol.js';
import { LibrarySummaryCache } from './library-summary.js';
import { DemoCloudDriver } from './demo-driver.js';
import { AppError } from './errors.js';
import { SessionStore, randomId, type Session } from './sessions.js';
import { archiveEntryName, contentDisposition, fileRevision, selectFiles } from './files.js';

const selectionSchema = z.object({
  names: z.array(z.string().min(1).max(4096)).min(1).max(500)
    .refine((names) => new Set(names).size === names.length, 'Duplicate names'),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const appIdSchema = z.coerce.number().int().min(1).max(0xffffffff);
const deleteSchema = z.object({ planId: z.string().regex(/^[\w-]{43}$/), confirmation: z.string().max(100), gamesClosed: z.literal(true) }).strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'INVALID_INPUT', 'Некорректный запрос. Выберите от 1 до 500 файлов и проверьте подтверждение.');
  return result.data;
}
function sameToken(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function assertActive(session: Session) {
  if (session.revoked) throw new AppError(401, 'SESSION_EXPIRED', 'Сессия завершена. Подключите Steam заново.');
}

export async function buildApp(options: {
  config: Config;
  driverFactory?: () => CloudDriver;
  now?: () => number;
  serveStatic?: boolean;
  logger?: boolean;
}) {
  const { config } = options;
  const now = options.now || Date.now;
  const summaries = new LibrarySummaryCache(now);
  const factory = options.driverFactory || (() => config.demoMode ? new DemoCloudDriver() : new SteamCloudDriver({ allowedSteamIds: config.allowedSteamIds }));
  const store = new SessionStore(factory, config.sessionTtlMs, config.maxSessions, now);
  const app = Fastify({
    logger: options.logger ? { redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]'] } : false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 3 * 1024 * 1024,
    requestTimeout: 30_000,
    connectionTimeout: 0,
    trustProxy: false,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 240, timeWindow: '1 minute' });
  const cookieName = config.secureCookies ? '__Host-scm' : 'scm-session';
  const cookieOptions = { path: '/', httpOnly: true, sameSite: 'strict' as const, secure: config.secureCookies };
  const allowedHosts = new Set([new URL(config.appOrigin).host, `127.0.0.1:${config.port}`, `localhost:${config.port}`]);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://shared.fastly.steamstatic.com; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    if (config.secureCookies) reply.header('Strict-Transport-Security', 'max-age=31536000');
    if (!allowedHosts.has(request.headers.host || '')) throw new AppError(403, 'INVALID_HOST', 'Недопустимый адрес сервера.');
    if (request.url.startsWith('/api/') && request.headers['sec-fetch-site'] === 'cross-site') {
      throw new AppError(403, 'CROSS_SITE_REQUEST', 'Откройте приложение напрямую.');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (request.headers.origin !== config.appOrigin) throw new AppError(403, 'INVALID_ORIGIN', 'Источник запроса не совпадает с адресом приложения.');
      const session = store.get(request.cookies[cookieName]);
      const token = request.headers['x-csrf-token'];
      if (!session || typeof token !== 'string' || !sameToken(token, session.csrfToken)) {
        throw new AppError(403, 'CSRF_FAILED', 'Сессия страницы устарела. Обновите страницу.');
      }
    }
  });

  function sessionOf(request: FastifyRequest, connected = true) {
    const session = store.get(request.cookies[cookieName]);
    if (!session) throw new AppError(401, 'SESSION_REQUIRED', 'Сессия завершена. Обновите страницу и подключите Steam.');
    if (connected && session.driver.getLogin().status !== 'connected') throw new AppError(401, 'STEAM_REQUIRED', 'Сначала подключите Steam.');
    return session;
  }
  function sessionResponse(session: Session) { return { csrfToken: session.csrfToken, mode: config.demoMode ? 'demo' as const : 'live' as const, login: session.driver.getLogin() }; }
  function assertIdle(session: Session) {
    if (session.busy) throw new AppError(409, 'OPERATION_RUNNING', 'Дождитесь завершения текущей операции.');
  }
  function appIdOf(request: FastifyRequest) { return parse(appIdSchema, (request.params as { appId: string }).appId); }

  app.get('/api/health', async () => ({ status: 'ok', mode: config.demoMode ? 'demo' : 'live' }));
  app.get('/api/session', async (request, reply) => {
    let session = store.get(request.cookies[cookieName]);
    if (!session) {
      session = store.create();
      reply.setCookie(cookieName, session.id, cookieOptions);
    }
    return sessionResponse(session);
  });

  app.post('/api/auth/steam', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const session = sessionOf(request, false);
    parse(z.object({}).strict(), request.body || {});
    assertIdle(session);
    const state = session.driver.getLogin().status;
    if (!['connected', 'connecting', 'awaiting_confirmation'].includes(state)) {
      // A new QR attempt can connect a different allowed Steam account. Reviews
      // and download tickets from the previous account must never cross that boundary.
      session.plans.clear(); session.exports.clear();
      session.busy = true;
      try { await session.driver.startLogin(); } finally { session.busy = false; }
    }
    return sessionResponse(session);
  });
  app.post('/api/auth/logout', async (request, reply) => {
    const session = sessionOf(request, false);
    // Finish an in-flight mutation so its Steam batch can be closed cleanly.
    assertIdle(session);
    store.destroy(session);
    const next = store.create();
    reply.setCookie(cookieName, next.id, cookieOptions);
    return sessionResponse(next);
  });
  app.get('/api/games', async (request) => {
    const session = sessionOf(request);
    return { games: await session.driver.listGames() };
  });
  app.get('/api/games/:appId/summary', async (request) => {
    const session = sessionOf(request);
    return summaries.get(session.driver, appIdOf(request));
  });
  app.get('/api/games/:appId/files', async (request) => {
    const session = sessionOf(request);
    const listing = await session.driver.listFiles(appIdOf(request));
    return { appId: listing.appId, files: listing.files, revision: fileRevision(listing) };
  });

  app.post('/api/games/:appId/delete-plan', async (request) => {
    const session = sessionOf(request); assertIdle(session);
    const appId = appIdOf(request);
    const { names, revision } = parse(selectionSchema, request.body);
    const listing = await session.driver.listFiles(appId);
    assertActive(session);
    const files = selectFiles(listing, names, revision);
    const plan = { planId: randomId(), appId, files, revision,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0), expiresAt: now() + 5 * 60_000,
      confirmation: `${request.headers['accept-language']?.startsWith('ru') ? 'УДАЛИТЬ' : 'DELETE'} ${files.length}` };
    // One active review per browser session; opening a new review invalidates the old one.
    session.plans.clear(); session.plans.set(plan.planId, plan);
    const { revision: _, ...review } = plan;
    return review;
  });
  app.post('/api/games/:appId/delete', async (request) => {
    const session = sessionOf(request); assertIdle(session);
    if (session.activeTransfers > 0) throw new AppError(409, 'DOWNLOAD_RUNNING', 'Дождитесь завершения скачивания перед удалением.');
    const appId = appIdOf(request);
    const body = parse(deleteSchema, request.body);
    const plan = session.plans.get(body.planId);
    if (!plan || plan.appId !== appId || plan.expiresAt <= now()) throw new AppError(409, 'PLAN_EXPIRED', 'Подтверждение истекло. Выберите файлы заново.');
    if (body.confirmation !== plan.confirmation) throw new AppError(400, 'CONFIRMATION_MISMATCH', 'Введите фразу подтверждения точно как показано.');
    session.busy = true;
    // Consume before awaiting anything: retries never replay a destructive batch.
    session.plans.delete(plan.planId);
    try {
      const current = await session.driver.listFiles(appId);
      const files = selectFiles(current, plan.files.map((f) => f.name), plan.revision);
      assertActive(session);
      const result = await session.driver.deleteFiles(appId, files);
      summaries.invalidate(session.driver, appId);
      return result;
    } finally { session.busy = false; }
  });

  function trackTransfer(session: Session, reply: FastifyReply, abort: () => void) {
    session.activeTransfers++;
    session.abortTransfers.add(abort);
    let released = false;
    const cleanup = () => {
      if (released) return;
      released = true;
      session.activeTransfers--;
      session.abortTransfers.delete(abort);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => { abort(); cleanup(); }, 2 * 60 * 60_000);
    timer.unref();
    reply.raw.once('close', () => { abort(); cleanup(); });
    reply.raw.once('finish', cleanup);
    return cleanup;
  }

  app.get('/api/games/:appId/download', async (request, reply) => {
    const session = sessionOf(request); assertIdle(session);
    if (session.activeTransfers >= 2) throw new AppError(429, 'DOWNLOAD_LIMIT', 'Одновременно доступны два скачивания.');
    const appId = appIdOf(request);
    const { name } = parse(z.object({ name: z.string().min(1).max(4096) }).strict(), request.query);
    let stream: Readable | undefined;
    let cancelled = false;
    const cleanup = trackTransfer(session, reply, () => { cancelled = true; stream?.destroy(); });
    try {
      const listing = await session.driver.listFiles(appId);
      const file = listing.files.find((f) => f.name === name);
      if (!file) throw new AppError(404, 'FILE_NOT_FOUND', 'Файл не найден. Обновите список.');
      assertActive(session);
      const downloaded = await session.driver.downloadFile(appId, file);
      stream = downloaded.stream;
      if (cancelled || session.revoked) { stream.destroy(); throw new AppError(401, 'SESSION_EXPIRED', 'Сессия завершена.'); }
      reply.type('application/octet-stream').header('Content-Disposition', contentDisposition(file.name));
      reply.header('Content-Length', downloaded.size);
      return reply.send(stream);
    } catch (error) { stream?.destroy(); cleanup(); throw error; }
  });

  app.post('/api/games/:appId/exports', async (request) => {
    const session = sessionOf(request); assertIdle(session);
    const appId = appIdOf(request);
    const { names, revision } = parse(selectionSchema, request.body);
    const listing = await session.driver.listFiles(appId);
    assertActive(session);
    const files = selectFiles(listing, names, revision);
    // Validate the first Steam download before handing a link to the browser.
    // Otherwise an unsupported storage URL or Steam RPC failure shows as a
    // silent failed navigation instead of an API error in the application.
    const initial = await session.driver.downloadFile(appId, files[0]);
    initial.stream.destroy();
    assertActive(session);
    const ticket = randomId();
    if (session.exports.size >= 5) session.exports.clear();
    session.exports.set(ticket, { appId, files, revision, expiresAt: now() + 5 * 60_000 });
    return { downloadUrl: `/api/exports/${ticket}` };
  });

  app.get('/api/exports/:ticket', async (request, reply) => {
    const session = sessionOf(request); assertIdle(session);
    if (session.activeTransfers >= 2) throw new AppError(429, 'DOWNLOAD_LIMIT', 'Одновременно доступны два скачивания.');
    const key = parse(z.string().regex(/^[\w-]{43}$/), (request.params as { ticket: string }).ticket);
    const ticket = session.exports.get(key);
    if (!ticket || ticket.expiresAt <= now()) throw new AppError(404, 'EXPORT_EXPIRED', 'Ссылка на архив истекла. Подготовьте архив заново.');
    session.exports.delete(key);
    let source: Readable | undefined;
    let cancelled = false;
    const archive = new ZipArchive({ store: true, forceZip64: true });
    const abort = () => { cancelled = true; source?.destroy(); archive.abort(); archive.destroy(); };
    const cleanup = trackTransfer(session, reply, abort);
    try {
      const current = await session.driver.listFiles(ticket.appId);
      selectFiles(current, ticket.files.map((f) => f.name), ticket.revision);
      assertActive(session);
      // Preflight the first file before sending HTTP headers so unsupported Steam
      // formats fail visibly instead of creating a broken archive immediately.
      source = (await session.driver.downloadFile(ticket.appId, ticket.files[0])).stream;
      if (cancelled || session.revoked) throw new AppError(401, 'SESSION_EXPIRED', 'Сессия завершена.');
      const firstSource = source;
      reply.type('application/zip').header('Content-Disposition', contentDisposition(`steam-cloud-${ticket.appId}.zip`));
      // Archiver emits errors asynchronously; terminate the HTTP transfer on error,
      // never serve an apparently complete ZIP which silently omits failed files.
      archive.on('error', () => { source?.destroy(); reply.raw.destroy(); cleanup(); });
      archive.on('warning', () => archive.destroy(new Error('Archive input failed')));
      reply.send(archive);
      void (async () => {
        const manifest = { appId: ticket.appId, exportedAt: new Date(now()).toISOString(), demo: config.demoMode,
          files: ticket.files.map((file, index) => ({ ...file, archivePath: archiveEntryName(file, index) })) };
        archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
        for (const [index, file] of ticket.files.entries()) {
          if (cancelled || session.revoked) throw new Error('Transfer cancelled');
          source = index === 0 ? firstSource : (await session.driver.downloadFile(ticket.appId, file)).stream;
          if (cancelled || session.revoked) { source.destroy(); throw new Error('Transfer cancelled'); }
          source.once('error', () => archive.destroy(new Error('Download failed')));
          const ended = finished(source, { cleanup: true });
          archive.append(source, { name: archiveEntryName(file, index), date: new Date(file.modifiedAt * 1000) });
          await ended;
        }
        await archive.finalize();
      })().catch(() => { archive.destroy(new Error('Archive transfer failed')); abort(); cleanup(); reply.raw.destroy(); });
      return reply;
    } catch (error) { abort(); cleanup(); throw error; }
  });

  if (options.serveStatic) {
    await app.register(fastifyStatic, { root: resolve('dist/client'), wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Маршрут не найден.' } });
      if (request.method !== 'GET' && request.method !== 'HEAD') return reply.code(404).send();
      return reply.sendFile('index.html');
    });
  }
  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof Error ? error as Error & { statusCode?: number; code?: string } : undefined;
    let statusCode = 502;
    let code = 'STEAM_UNAVAILABLE';
    let message = 'Не удалось выполнить запрос к Steam. Проверьте подключение и повторите попытку.';
    if (known instanceof AppError || known?.name === 'SteamServiceError') {
      statusCode = known.statusCode || 502;
      code = known.code || 'STEAM_ERROR'; message = known.message;
    } else if (known?.statusCode && known.statusCode >= 400 && known.statusCode < 500) {
      statusCode = known.statusCode;
      code = statusCode === 429 ? 'RATE_LIMIT' : 'INVALID_REQUEST';
      message = statusCode === 429 ? 'Слишком много запросов. Подождите немного.' : 'Некорректный запрос.';
    }
    // A method identifier is safe to log; never print Steam tokens, cookies, request bodies or file names.
    app.log.warn({ requestId: request.id, code, statusCode,
      ...(known instanceof SteamServiceError && known.method ? { steamMethod: known.method } : {}),
    }, 'Request failed');
    reply.code(statusCode).send({ error: { code, message } });
  });
  app.addHook('onClose', async () => store.close());
  return app;
}

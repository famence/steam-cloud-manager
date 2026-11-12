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
import {
  encryptToken,
  decryptToken,
  type ReviewPlanTokenPayload,
  type ExportTicketTokenPayload,
} from './session-token.js';

const selectionSchema = z
  .object({
    names: z
      .array(z.string().min(1).max(4096))
      .min(1)
      .max(500)
      .refine((names) => new Set(names).size === names.length, 'Duplicate names'),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const appIdSchema = z.coerce.number().int().min(1).max(0xffffffff);

const deleteSchema = z
  .object({
    planId: z.string().min(20).max(16384).regex(/^[\w-]+$/),
    confirmation: z.string().max(100),
    gamesClosed: z.literal(true),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      400,
      'INVALID_INPUT',
      'Некорректный запрос. Выберите от 1 до 500 файлов и проверьте подтверждение.',
    );
  }
  return result.data;
}

function sameToken(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function assertActive(session: Session) {
  if (session.revoked) {
    throw new AppError(401, 'SESSION_EXPIRED', 'Сессия завершена. Подключите Steam заново.');
  }
}

function isAllowedHost(hostHeader: string | undefined, config: Config): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.toLowerCase().trim();
  if (
    !host ||
    host.includes(' ') ||
    host.includes('\t') ||
    host.includes('\r') ||
    host.includes('\n')
  ) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL('http://' + host);
  } catch {
    return false;
  }

  if (
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    return false;
  }

  let canonicalHost = '';
  try {
    const canonicalUrl = new URL(config.appOrigin);
    canonicalHost = canonicalUrl.host.toLowerCase();
    if (host === canonicalHost || parsed.host === canonicalHost) return true;
    if (!canonicalUrl.port) {
      if (
        canonicalUrl.protocol === 'https:' &&
        (host === `${canonicalHost}:443` || parsed.host === `${canonicalHost}:443`)
      ) {
        return true;
      }
      if (
        canonicalUrl.protocol === 'http:' &&
        (host === `${canonicalHost}:80` || parsed.host === `${canonicalHost}:80`)
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }

  const isCloud = Boolean(process.env.VERCEL || config.production);
  if (isCloud) {
    if (
      parsed.hostname === 'steam-cloud-manager.vercel.app' ||
      (parsed.hostname.endsWith('.vercel.app') &&
        parsed.hostname.length > '.vercel.app'.length &&
        !parsed.hostname.startsWith('.') &&
        !parsed.hostname.includes('..') &&
        parsed.hostname !== 'vercel.app')
    ) {
      if (!parsed.port || parsed.port === '80' || parsed.port === '443') {
        return true;
      }
    }
    return false;
  }

  const isLoopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(
    parsed.hostname,
  );
  if (isLoopback) {
    if (parsed.port) {
      return Number(parsed.port) === config.port;
    }
    return true;
  }

  return false;
}

function isAllowedOrigin(
  originHeader: string | undefined,
  hostHeader: string | undefined,
  config: Config,
): boolean {
  if (!originHeader || originHeader === 'null') return false;
  if (originHeader === config.appOrigin) return true;
  if (
    (process.env.VERCEL || config.production) &&
    hostHeader &&
    isAllowedHost(hostHeader, config)
  ) {
    const cleanHost = hostHeader
      .toLowerCase()
      .trim()
      .replace(/:(?:80|443)$/, '');
    if (
      originHeader === `https://${cleanHost}` ||
      originHeader === `https://${hostHeader.toLowerCase().trim()}`
    ) {
      return true;
    }
  }
  return false;
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
  const factory = (mode?: 'live' | 'demo') => {
    if (options.driverFactory) {
      return options.driverFactory();
    }
    return mode === 'demo'
      ? new DemoCloudDriver()
      : new SteamCloudDriver({ allowedSteamIds: config.allowedSteamIds });
  };
  const store = new SessionStore(factory, config.sessionTtlMs, config.maxSessions, now);

  const app = Fastify({
    logger: options.logger
      ? {
          redact: [
            'req.headers.cookie',
            'req.headers.authorization',
            'req.headers["x-csrf-token"]',
          ],
        }
      : false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 3 * 1024 * 1024,
    requestTimeout: 30_000,
    connectionTimeout: 0,
    trustProxy: Boolean(config.production || process.env.VERCEL),
  });

  await app.register(cookie);
  await app.register(rateLimit, { max: 240, timeWindow: '1 minute' });

  const cookieName = config.secureCookies ? '__Host-scm' : 'scm-session';
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.secureCookies,
  };

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://shared.fastly.steamstatic.com; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    if (config.secureCookies) reply.header('Strict-Transport-Security', 'max-age=31536000');

    const reqHost = request.host || request.hostname;
    if (!isAllowedHost(reqHost, config)) {
      throw new AppError(403, 'INVALID_HOST', 'Недопустимый адрес сервера.');
    }
    if (request.url.startsWith('/api/') && request.headers['sec-fetch-site'] === 'cross-site') {
      throw new AppError(403, 'CROSS_SITE_REQUEST', 'Откройте приложение напрямую.');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (!isAllowedOrigin(request.headers.origin, reqHost, config)) {
        throw new AppError(403, 'INVALID_ORIGIN', 'Источник запроса не совпадает с адресом приложения.');
      }
      const session = store.get(request.cookies[cookieName]);
      const token = request.headers['x-csrf-token'];
      if (!session || typeof token !== 'string' || !sameToken(token, session.csrfToken)) {
        throw new AppError(403, 'CSRF_FAILED', 'Сессия страницы устарела. Обновите страницу.');
      }
    }
  });

  function sessionOf(request: FastifyRequest, connected = true) {
    const session = store.get(request.cookies[cookieName]);
    if (!session) {
      throw new AppError(
        401,
        'SESSION_REQUIRED',
        'Сессия завершена. Обновите страницу и подключите Steam.',
      );
    }
    if (connected && session.driver.getLogin().status !== 'connected') {
      throw new AppError(401, 'STEAM_REQUIRED', 'Сначала подключите Steam.');
    }
    return session;
  }

  function sessionResponse(session: Session) {
    return {
      csrfToken: session.csrfToken,
      mode: session.mode,
      login: session.driver.getLogin(),
    };
  }

  function assertIdle(session: Session) {
    if (session.busy) {
      throw new AppError(409, 'OPERATION_RUNNING', 'Дождитесь завершения текущей операции.');
    }
  }

  function appIdOf(request: FastifyRequest) {
    return parse(appIdSchema, (request.params as { appId: string }).appId);
  }

  app.get('/api/health', async () => ({
    status: 'ok',
    mode: config.demoMode ? 'demo' : 'live',
  }));

  app.get('/api/session', async (request, reply) => {
    let session = store.get(request.cookies[cookieName]);
    if (!session) {
      session = store.create({ mode: config.demoMode ? 'demo' : 'live' });
      reply.setCookie(cookieName, store.issueToken(session), cookieOptions);
    }
    return sessionResponse(session);
  });

  app.post(
    '/api/auth/demo',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const session = sessionOf(request, false);
      parse(z.object({}).strict(), request.body || {});
      assertIdle(session);
      if (session.driver) {
        session.driver.close();
      }
      session.plans.clear();
      session.exports.clear();
      session.connectionId = randomId();
      const demoDriver = new DemoCloudDriver();
      session.driver = demoDriver;
      session.mode = 'demo';
      session.steamId = '76561198000000000';
      session.displayName = 'Demo Account';
      delete session.refreshToken;
      session.busy = true;
      try {
        await demoDriver.startLogin();
      } finally {
        session.busy = false;
      }
      reply.setCookie(cookieName, store.issueToken(session), cookieOptions);
      return sessionResponse(session);
    },
  );

  app.post(
    '/api/auth/steam',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const session = sessionOf(request, false);
      parse(z.object({}).strict(), request.body || {});
      assertIdle(session);
      if (session.mode === 'demo') {
        session.driver.close();
        session.driver = factory('live');
        session.mode = 'live';
        session.connectionId = randomId();
        delete session.steamId;
        delete session.displayName;
        delete session.refreshToken;
        session.plans.clear();
        session.exports.clear();
      }
      const state = session.driver.getLogin().status;
      if (!['connected', 'connecting', 'awaiting_confirmation'].includes(state)) {
        session.plans.clear();
        session.exports.clear();
        session.connectionId = randomId();
        session.busy = true;
        try {
          await session.driver.startLogin();
        } finally {
          session.busy = false;
        }
      }
      reply.setCookie(cookieName, store.issueToken(session), cookieOptions);
      return sessionResponse(session);
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    const session = sessionOf(request, false);
    assertIdle(session);
    store.destroy(session);
    const next = store.create({ mode: config.demoMode ? 'demo' : 'live' });
    reply.setCookie(cookieName, store.issueToken(next), cookieOptions);
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
    const session = sessionOf(request);
    assertIdle(session);
    const appId = appIdOf(request);
    const { names, revision } = parse(selectionSchema, request.body);
    const listing = await session.driver.listFiles(appId);
    assertActive(session);
    const files = selectFiles(listing, names, revision);
    const planPayload: ReviewPlanTokenPayload = {
      purpose: 'review-plan',
      appId,
      names,
      revision,
      confirmation: `${request.headers['accept-language']?.startsWith('ru') ? 'УДАЛИТЬ' : 'DELETE'} ${files.length}`,
      binding: `${session.id}:${session.connectionId}`,
      issuedAt: now(),
      expiresAt: now() + 5 * 60_000,
    };
    const planId = encryptToken(planPayload, store.getKey());
    const plan = {
      planId,
      appId,
      files,
      revision,
      names,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      expiresAt: planPayload.expiresAt,
      confirmation: planPayload.confirmation!,
    };
    // One active review per browser session; opening a new review invalidates the old one.
    session.plans.clear();
    session.plans.set(plan.planId, plan);
    const { revision: _, ...review } = plan;
    return review;
  });

  app.post('/api/games/:appId/delete', async (request) => {
    const session = sessionOf(request);
    assertIdle(session);
    if (session.activeTransfers > 0) {
      throw new AppError(
        409,
        'DOWNLOAD_RUNNING',
        'Дождитесь завершения скачивания перед удалением.',
      );
    }
    const appId = appIdOf(request);
    const body = parse(deleteSchema, request.body);
    let plan = session.plans.get(body.planId);
    if (!plan) {
      const payload = decryptToken<ReviewPlanTokenPayload>(
        body.planId,
        store.getKey(),
        'review-plan',
        now(),
      );
      if (
        !payload ||
        payload.appId !== appId ||
        payload.binding !== `${session.id}:${session.connectionId}`
      ) {
        throw new AppError(409, 'PLAN_EXPIRED', 'Подтверждение истекло. Выберите файлы заново.');
      }
      plan = {
        planId: body.planId,
        appId: payload.appId,
        files: [],
        names: payload.names,
        revision: payload.revision,
        totalBytes: 0,
        expiresAt: payload.expiresAt,
        confirmation:
          payload.confirmation ||
          `${request.headers['accept-language']?.startsWith('ru') ? 'УДАЛИТЬ' : 'DELETE'} ${payload.names.length}`,
      };
    }
    if (plan.appId !== appId || plan.expiresAt <= now()) {
      throw new AppError(409, 'PLAN_EXPIRED', 'Подтверждение истекло. Выберите файлы заново.');
    }
    if (body.confirmation !== plan.confirmation) {
      throw new AppError(
        400,
        'CONFIRMATION_MISMATCH',
        'Введите фразу подтверждения точно как показано.',
      );
    }
    session.busy = true;
    // Consume before awaiting anything: retries never replay a destructive batch.
    session.plans.delete(plan.planId);
    try {
      const current = await session.driver.listFiles(appId);
      const targetNames = plan.names || plan.files.map((f) => f.name);
      const files = selectFiles(current, targetNames, plan.revision);
      assertActive(session);
      const result = await session.driver.deleteFiles(appId, files);
      summaries.invalidate(session.driver, appId);
      return result;
    } finally {
      session.busy = false;
    }
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
    const timer = setTimeout(() => {
      abort();
      cleanup();
    }, 2 * 60 * 60_000);
    timer.unref();
    reply.raw.once('close', () => {
      abort();
      cleanup();
    });
    reply.raw.once('finish', cleanup);
    return cleanup;
  }

  app.get('/api/games/:appId/download', async (request, reply) => {
    const session = sessionOf(request);
    assertIdle(session);
    if (session.activeTransfers >= 2) {
      throw new AppError(429, 'DOWNLOAD_LIMIT', 'Одновременно доступны два скачивания.');
    }
    const appId = appIdOf(request);
    const { name } = parse(
      z.object({ name: z.string().min(1).max(4096) }).strict(),
      request.query,
    );
    let stream: Readable | undefined;
    let cancelled = false;
    const cleanup = trackTransfer(session, reply, () => {
      cancelled = true;
      stream?.destroy();
    });
    try {
      const listing = await session.driver.listFiles(appId);
      const file = listing.files.find((f) => f.name === name);
      if (!file) {
        throw new AppError(404, 'FILE_NOT_FOUND', 'Файл не найден. Обновите список.');
      }
      assertActive(session);
      const downloaded = await session.driver.downloadFile(appId, file);
      stream = downloaded.stream;
      if (cancelled || session.revoked) {
        stream.destroy();
        throw new AppError(401, 'SESSION_EXPIRED', 'Сессия завершена.');
      }
      reply
        .type('application/octet-stream')
        .header('Content-Disposition', contentDisposition(file.name));
      reply.header('Content-Length', downloaded.size);
      return reply.send(stream);
    } catch (error) {
      stream?.destroy();
      cleanup();
      throw error;
    }
  });

  app.post('/api/games/:appId/exports', async (request) => {
    const session = sessionOf(request);
    assertIdle(session);
    const appId = appIdOf(request);
    const { names, revision } = parse(selectionSchema, request.body);
    const listing = await session.driver.listFiles(appId);
    assertActive(session);
    const files = selectFiles(listing, names, revision);
    // Validate the first Steam download before handing a link to the browser.
    const initial = await session.driver.downloadFile(appId, files[0]);
    initial.stream.destroy();
    assertActive(session);
    const ticket = randomId();
    if (session.exports.size >= 5) session.exports.clear();
    session.exports.set(ticket, { appId, files, revision, expiresAt: now() + 5 * 60_000 });
    return { downloadUrl: `/api/exports/${ticket}` };
  });

  app.get('/api/exports/:ticket', async (request, reply) => {
    const session = sessionOf(request);
    assertIdle(session);
    if (session.activeTransfers >= 2) {
      throw new AppError(429, 'DOWNLOAD_LIMIT', 'Одновременно доступны два скачивания.');
    }
    const key = parse(z.string().regex(/^[\w-]{43}$/), (request.params as { ticket: string }).ticket);
    const ticket = session.exports.get(key);
    if (!ticket || ticket.expiresAt <= now()) {
      throw new AppError(
        404,
        'EXPORT_EXPIRED',
        'Ссылка на архив истекла. Подготовьте архив заново.',
      );
    }
    session.exports.delete(key);
    let source: Readable | undefined;
    let cancelled = false;
    const archive = new ZipArchive({ store: true, forceZip64: true });
    const abort = () => {
      cancelled = true;
      source?.destroy();
      archive.abort();
      archive.destroy();
    };
    const cleanup = trackTransfer(session, reply, abort);
    try {
      const current = await session.driver.listFiles(ticket.appId);
      const targetNames = ticket.names || ticket.files.map((f) => f.name);
      ticket.files = selectFiles(current, targetNames, ticket.revision);
      assertActive(session);
      // Preflight the first file before sending HTTP headers
      source = (await session.driver.downloadFile(ticket.appId, ticket.files[0])).stream;
      if (cancelled || session.revoked) throw new AppError(401, 'SESSION_EXPIRED', 'Сессия завершена.');
      const firstSource = source;
      reply
        .type('application/zip')
        .header('Content-Disposition', contentDisposition(`steam-cloud-${ticket.appId}.zip`));
      archive.on('error', () => {
        source?.destroy();
        reply.raw.destroy();
        cleanup();
      });
      archive.on('warning', () => archive.destroy(new Error('Archive input failed')));
      reply.send(archive);
      void (async () => {
        const manifest = {
          appId: ticket.appId,
          exportedAt: new Date(now()).toISOString(),
          demo: session.mode === 'demo',
          files: ticket.files.map((file, index) => ({
            ...file,
            archivePath: archiveEntryName(file, index),
          })),
        };
        archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
        for (const [index, file] of ticket.files.entries()) {
          if (cancelled || session.revoked) throw new Error('Transfer cancelled');
          source = index === 0 ? firstSource : (await session.driver.downloadFile(ticket.appId, file)).stream;
          if (cancelled || session.revoked) {
            source.destroy();
            throw new Error('Transfer cancelled');
          }
          source.once('error', () => archive.destroy(new Error('Download failed')));
          const ended = finished(source, { cleanup: true });
          archive.append(source, {
            name: archiveEntryName(file, index),
            date: new Date(file.modifiedAt * 1000),
          });
          await ended;
        }
        await archive.finalize();
      })().catch(() => {
        archive.destroy(new Error('Archive transfer failed'));
        abort();
        cleanup();
        reply.raw.destroy();
      });
      return reply;
    } catch (error) {
      abort();
      cleanup();
      throw error;
    }
  });

  if (options.serveStatic) {
    await app.register(fastifyStatic, { root: resolve('dist/client'), wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Маршрут не найден.' } });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return reply.code(404).send();
      return reply.sendFile('index.html');
    });
  }

  app.setErrorHandler((error, request, reply) => {
    const known =
      error instanceof Error ? (error as Error & { statusCode?: number; code?: string }) : undefined;
    let statusCode = 502;
    let code = 'STEAM_UNAVAILABLE';
    let message = 'Не удалось выполнить запрос к Steam. Проверьте подключение и повторите попытку.';
    if (known instanceof AppError || known?.name === 'SteamServiceError') {
      statusCode = known.statusCode || 502;
      code = known.code || 'STEAM_ERROR';
      message = known.message;
    } else if (known?.statusCode && known.statusCode >= 400 && known.statusCode < 500) {
      statusCode = known.statusCode;
      code = statusCode === 429 ? 'RATE_LIMIT' : 'INVALID_REQUEST';
      message =
        statusCode === 429
          ? 'Слишком много запросов. Подождите немного.'
          : 'Некорректный запрос.';
    }
    app.log.warn(
      {
        requestId: request.id,
        code,
        statusCode,
        ...(known instanceof SteamServiceError && known.method
          ? { steamMethod: known.method }
          : {}),
      },
      'Request failed',
    );
    reply.code(statusCode).send({ error: { code, message } });
  });

  app.addHook('onClose', async () => store.close());
  return app;
}

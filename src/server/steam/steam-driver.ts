import { randomBytes } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { LoginSession, EAuthTokenPlatformType } from 'steam-session';
import QRCode from 'qrcode';
import type { CloudFile, CloudGame, DeleteResult, LoginInfo } from '../../shared/types.js';
import type { CloudDriver, DriverListing } from './contracts.js';
import { assertAppId, performDeleteBatch, readFileListing, safeInteger } from './cloud-operations.js';
import { openStorageDownload, type DownloadResponse } from './download.js';
import { listRemoteGames } from './game-list.js';
import { listPicsOwnedGames, type PicsClient } from './pics-owned-games.js';
import { filterBaseGames, type PicsApp } from './game-metadata.js';
import { SteamRpcTransport, SteamServiceError, safeSteamError, type SteamWireClient } from './protocol.js';

const require = createRequire(import.meta.url);

interface SteamClient extends SteamWireClient, PicsClient, EventEmitter {
  accountInfo?: { name?: string } | null;
  logOn(details: { refreshToken: string; machineName: string; logonID: number }): void;
  logOff(): void;
  getProductInfo(
    apps: number[], packages: number[], includeTokens: boolean,
    callback: (error: Error | null, apps: Record<string, PicsApp>) => void,
  ): void;
  _logOnDetails?: { access_token?: string };
  _loginSession?: { refreshToken: string; accessToken: string; cancelLoginAttempt(): void };
}

const SteamUser = require('steam-user') as new (options: object) => SteamClient;
const connectionProtocol = require('steam-user/resources/EConnectionProtocol.js') as { WebSocket: number };
const LOGIN_LIFETIME_MS = 120_000;
const CONNECTION_TIMEOUT_MS = 30_000;

export interface SteamCloudDriverOptions {
  allowedSteamIds?: string[];
  /** Proxy for Steam authentication and CM traffic; storage downloads use their own pinned HTTPS transport. */
  httpProxy?: string;
}

function clearLoginSession(session: LoginSession): void {
  try { session.cancelLoginAttempt(); } catch { /* already closed */ }
  session.refreshToken = '';
  session.accessToken = '';
}

function displayName(value: unknown): string {
  return typeof value === 'string' && value.trim()
    ? value.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 160)
    : 'Steam account';
}

export class SteamCloudDriver implements CloudDriver {
  private readonly allowed: Set<string>;
  private readonly httpProxy?: string;
  private info: LoginInfo = { status: 'disconnected' };
  private auth?: LoginSession;
  private client?: SteamClient;
  private rpc?: SteamRpcTransport;
  private lifetime = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private epoch = 0;
  private closed = false;
  private deleting = false;
  private usePicsGameList = false;

  constructor(options: SteamCloudDriverOptions = {}) {
    this.allowed = new Set(options.allowedSteamIds ?? []);
    // Both Steam libraries require an explicit option; they do not read proxy env vars themselves.
    this.httpProxy = options.httpProxy ?? process.env.STEAM_HTTP_PROXY
      ?? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  }

  getLogin(): LoginInfo {
    // This DTO is the only authentication data returned to HTTP callers.
    return { ...this.info, ...(this.info.user ? { user: { ...this.info.user } } : {}) };
  }

  async startLogin(): Promise<void> {
    if (this.closed) throw new SteamServiceError('Сессия завершена. Обновите страницу.', 'NOT_CONNECTED', 401);
    if (['awaiting_confirmation', 'connecting', 'connected'].includes(this.info.status)) return;
    this.release();
    const epoch = this.epoch;
    this.lifetime = new AbortController();
    this.info = { status: 'connecting' };
    let session: LoginSession;
    try {
      session = new LoginSession(EAuthTokenPlatformType.SteamClient, {
        machineFriendlyName: 'Steam Cloud Manager', machineId: true,
        ...(this.httpProxy ? { httpProxy: this.httpProxy } : {}),
      });
      session.loginTimeout = LOGIN_LIFETIME_MS;
      this.auth = session;
    } catch {
      this.fail('Не удалось начать подключение к Steam. Проверьте доступ к сети.');
      throw new SteamServiceError(this.info.error!, 'STEAM_AUTH_ERROR');
    }

    session.on('error', () => {
      if (this.epoch === epoch) this.fail('Steam отклонил подключение или соединение прервалось. Создайте новый QR-код.');
    });
    session.on('timeout', () => {
      if (this.epoch !== epoch) return;
      this.release();
      this.info = { status: 'expired', error: 'Время подтверждения истекло. Создайте новый QR-код.' };
    });
    session.on('authenticated', () => {
      if (this.epoch !== epoch || this.closed) { clearLoginSession(session); return; }
      this.connectClient(session, epoch);
    });

    // Some network failures do not emit the session timeout until polling starts.
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const start = session.startWithQR().then(result => {
        if (this.epoch !== epoch || this.closed) clearLoginSession(session);
        return result;
      });
      const result = await Promise.race([
        start,
        new Promise<never>((_, reject) => {
          startupTimer = setTimeout(() => reject(new SteamServiceError('Steam не ответил при создании QR-кода.', 'STEAM_TIMEOUT', 504)), 20_000);
        }),
      ]);
      if (this.epoch !== epoch || this.closed) return;
      if (typeof result.qrChallengeUrl !== 'string' || !result.qrChallengeUrl) {
        throw new SteamServiceError('Steam не вернул QR-код для подтверждения.', 'STEAM_AUTH_ERROR');
      }
      const qrDataUrl = await QRCode.toDataURL(result.qrChallengeUrl, {
        type: 'image/png', width: 280, margin: 2, errorCorrectionLevel: 'M',
      });
      if (this.epoch !== epoch || this.closed || this.info.status === 'connected' || this.client) return;
      const expiresAt = Date.now() + LOGIN_LIFETIME_MS;
      this.info = { status: 'awaiting_confirmation', qrDataUrl, expiresAt };
      this.timer = setTimeout(() => {
        if (this.epoch !== epoch) return;
        this.release();
        this.info = { status: 'expired', error: 'Время подтверждения истекло. Создайте новый QR-код.' };
      }, LOGIN_LIFETIME_MS);
      this.timer.unref();
    } catch (error) {
      if (this.epoch === epoch && !this.closed) this.fail(safeSteamError(error).message);
      throw safeSteamError(error);
    } finally {
      clearTimeout(startupTimer);
    }
  }

  private connectClient(session: LoginSession, epoch: number): void {
    clearTimeout(this.timer);
    let steamId: string;
    try {
      steamId = session.steamID?.getSteamID64() ?? '';
      if (!/^[1-9]\d{16}$/.test(steamId) || !session.refreshToken) {
        throw new SteamServiceError('Steam не подтвердил аккаунт.', 'STEAM_AUTH_ERROR');
      }
      if (this.allowed.size && !this.allowed.has(steamId)) {
        throw new SteamServiceError('Этот Steam-аккаунт не разрешён владельцем сервиса.', 'ACCOUNT_NOT_ALLOWED', 403);
      }
      const client = new SteamUser({
        dataDirectory: null, autoRelogin: false, renewRefreshTokens: false,
        enablePicsCache: true, changelistUpdateInterval: 0,
        protocol: connectionProtocol.WebSocket,
        ...(this.httpProxy ? { httpProxy: this.httpProxy } : {}),
      });
      this.client = client;
      this.info = { status: 'connecting' };
      const current = () => this.epoch === epoch && this.client === client && !this.closed;
      client.on('error', () => {
        if (current()) this.fail('Соединение со Steam прервано. Подключите аккаунт снова.');
      });
      client.on('disconnected', () => {
        if (current()) this.fail('Steam завершил сессию. Подключите аккаунт снова.');
      });
      client.on('loggedOn', () => {
        if (!current()) { client.logOff(); return; }
        const confirmed = client.steamID?.getSteamID64();
        if (confirmed !== steamId || (this.allowed.size && !this.allowed.has(confirmed))) {
          this.fail('Steam не подтвердил разрешённый аккаунт.');
          return;
        }
        clearTimeout(this.timer);
        this.rpc = new SteamRpcTransport(client, this.lifetime.signal);
        this.info = { status: 'connected', user: { steamId, displayName: displayName(client.accountInfo?.name) } };
      });
      client.on('accountInfo', (name: unknown) => {
        if (current() && this.info.user) this.info.user.displayName = displayName(name);
      });
      this.timer = setTimeout(() => {
        if (current()) this.fail('Не удалось подключиться к Steam за отведённое время. Попробуйте снова.');
      }, CONNECTION_TIMEOUT_MS);
      this.timer.unref();
      client.logOn({
        refreshToken: session.refreshToken,
        machineName: 'Steam Cloud Manager',
        logonID: randomBytes(4).readUInt32LE(),
      });
    } catch (error) {
      this.fail(safeSteamError(error).message);
    } finally {
      clearLoginSession(session);
      if (this.auth === session) this.auth = undefined;
    }
  }

  async listGames(): Promise<CloudGame[]> {
    const rpc = this.requireRpc();
    if (this.usePicsGameList) {
      const client = this.client;
      if (!client) throw new SteamServiceError('Сессия Steam завершена.', 'NOT_CONNECTED', 401);
      return listPicsOwnedGames(client, this.lifetime.signal);
    }
    const steamId = this.client?.steamID?.getSteamID64() ?? '';
    let games: CloudGame[];
    try {
      games = await listRemoteGames(rpc, steamId);
    } catch (error) {
      // Steam can reject both old Cloud app enumeration and Player.GetOwnedGames.
      // PICS uses license/package messages instead of those unified RPCs.
      // Never report a fabricated zero Cloud size from a plain owned-game list.
      if (!(error instanceof SteamServiceError) || error.code !== 'GAME_LIST_UNAVAILABLE') throw error;
      const client = this.client;
      if (!client) throw new SteamServiceError('Сессия Steam завершена.', 'NOT_CONNECTED', 401);
      this.usePicsGameList = true;
      return listPicsOwnedGames(client, this.lifetime.signal);
    }

    // PICS classifies real games, unlike a Steam license's list of all apps.
    return filterBaseGames(games, await this.gameMetadata(games.map(game => game.appId)));
  }

  private async gameMetadata(appIds: number[]): Promise<Record<string, PicsApp>> {
    const client = this.client;
    if (!client) return {};
    const cached = { ...client.picsCache?.apps };
    const missing = appIds.filter(id => !cached[id]?.appinfo?.common?.type);
    if (!missing.length) return cached;
    const signal = this.lifetime.signal;
    return new Promise(resolve => {
      let done = false;
      const finish = (apps: Record<string, PicsApp> = {}) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        resolve({ ...cached, ...apps });
      };
      const cancel = () => finish();
      const timer = setTimeout(cancel, 10_000);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) { cancel(); return; }
      try {
        client.getProductInfo(missing, [], true, (error, apps) => finish(!error && apps ? apps : {}));
      } catch { finish(); }
    });
  }

  async listFiles(appId: number): Promise<DriverListing> {
    return await readFileListing(this.requireRpc(), appId);
  }

  async downloadFile(appId: number, file: CloudFile) {
    assertAppId(appId);
    const response = await this.requireRpc().call<DownloadResponse>('ClientFileDownload', { appid: appId, filename: file.name });
    if (response.is_explicit_delete) throw new SteamServiceError('Файл был удалён. Обновите список.', 'FILES_CHANGED', 409);
    if (response.encrypted || response.file_size !== response.raw_file_size) {
      throw new SteamServiceError(
        'Steam хранит этот файл в сжатом или зашифрованном формате. Его скачивание пока не поддерживается; просмотр и удаление доступны.',
        'UNSUPPORTED_STORAGE_ENCODING', 422,
      );
    }
    const sha = Buffer.isBuffer(response.sha_file) ? response.sha_file.toString('hex') : '';
    if (response.appid !== appId || response.raw_file_size !== file.size || sha !== file.sha
      || safeInteger(response.time_stamp, 'время изменения') !== file.modifiedAt) {
      throw new SteamServiceError('Файл изменился. Обновите список перед скачиванием.', 'FILES_CHANGED', 409);
    }
    const stream = await openStorageDownload(response, file.size, file.sha, this.lifetime.signal);
    return { stream, size: file.size };
  }

  async deleteFiles(appId: number, files: CloudFile[]): Promise<DeleteResult> {
    if (this.deleting) throw new SteamServiceError('Дождитесь завершения предыдущего удаления.', 'BATCH_IN_PROGRESS', 409);
    this.deleting = true;
    try { return await performDeleteBatch(this.requireRpc(), appId, files); }
    finally { this.deleting = false; }
  }

  private requireRpc(): SteamRpcTransport {
    if (this.info.status !== 'connected' || !this.rpc || this.lifetime.signal.aborted) {
      throw new SteamServiceError('Подключите Steam-аккаунт снова.', 'NOT_CONNECTED', 401);
    }
    return this.rpc;
  }

  private fail(message: string): void {
    this.release();
    this.info = { status: 'error', error: message };
  }

  private release(): void {
    this.epoch++;
    this.usePicsGameList = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.lifetime.abort();
    if (this.auth) { clearLoginSession(this.auth); this.auth = undefined; }
    const client = this.client;
    this.client = undefined;
    this.rpc = undefined;
    if (client) {
      try { client.logOff(); } catch { /* already disconnected */ }
      // Pinned steam-user keeps the refresh token in its in-memory logon details for reconnects.
      // Reconnects are disabled; remove that retained token as the session closes.
      if (client._logOnDetails) delete client._logOnDetails.access_token;
      if (client._loginSession) {
        try { client._loginSession.cancelLoginAttempt(); } catch { /* already closed */ }
        client._loginSession.refreshToken = '';
        client._loginSession.accessToken = '';
      }
    }
  }

  close(): void {
    this.closed = true;
    this.release();
    this.info = { status: 'disconnected' };
  }
}

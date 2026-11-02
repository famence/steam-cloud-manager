import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface ProtoType {
  fromObject(value: object): object;
  encode(value: object): { finish(): Uint8Array };
  decode(value: Uint8Array): object;
  toObject(value: object, options: object): unknown;
}

// This is the single compatibility boundary with the pinned steam-user 5.3.0.
// Upstream ships the Cloud protobufs, but does not expose public Cloud methods.
const schema = require('steam-user/protobufs/generated/_load.js') as Record<string, ProtoType>;
const { ServiceMethodCallFromClient } = require('steam-user/enums/EMsg.js') as Record<string, number>;

const methods = {
  EnumerateUserApps: ['CCloud_EnumerateUserApps_Request', 'CCloud_EnumerateUserApps_Response'],
  GetAppFileChangelist: ['CCloud_GetAppFileChangelist_Request', 'CCloud_GetAppFileChangelist_Response'],
  ClientFileDownload: ['CCloud_ClientFileDownload_Request', 'CCloud_ClientFileDownload_Response'],
  BeginAppUploadBatch: ['CCloud_BeginAppUploadBatch_Request', 'CCloud_BeginAppUploadBatch_Response'],
  ClientDeleteFile: ['CCloud_ClientDeleteFile_Request', 'CCloud_ClientDeleteFile_Response'],
  CompleteAppUploadBatchBlocking: ['CCloud_CompleteAppUploadBatch_Request', 'CCloud_CompleteAppUploadBatch_Response'],
} as const;

export type CloudMethod = keyof typeof methods;
export interface RpcCaller {
  call<T>(method: CloudMethod, payload: object): Promise<T>;
}
export interface SteamWireClient {
  steamID: { getSteamID64(): string } | null;
  _send(
    header: { msg: number; proto: { target_job_name: string; timeout_ms: number } },
    body: Buffer,
    callback: (body: Buffer | { toBuffer(): Buffer }, header: { proto?: { eresult?: number } }) => void,
  ): void;
}

export class SteamServiceError extends Error {
  constructor(
    message: string,
    public readonly code = 'STEAM_ERROR',
    public readonly statusCode = 502,
  ) {
    super(message);
    this.name = 'SteamServiceError';
  }
}

export function safeSteamError(error: unknown): SteamServiceError {
  if (error instanceof SteamServiceError) return error;
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    && ['EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH'].includes(error.code)) {
    return new SteamServiceError('Не удалось связаться со Steam. Проверьте DNS, интернет и настройку прокси сервиса.', 'STEAM_NETWORK_ERROR');
  }
  return new SteamServiceError('Не удалось выполнить запрос к Steam. Повторите подключение.');
}

export class SteamRpcTransport implements RpcCaller {
  constructor(
    private readonly client: SteamWireClient,
    private readonly signal: AbortSignal,
    private readonly timeoutMs = 20_000,
  ) {}

  call<T>(method: CloudMethod, payload: object): Promise<T> {
    if (!this.client.steamID || this.signal.aborted) {
      return Promise.reject(new SteamServiceError('Сессия Steam завершена. Подключитесь снова.', 'NOT_CONNECTED', 401));
    }
    const [requestName, responseName] = methods[method];
    const requestType = schema[requestName];
    const responseType = schema[responseName];
    if (!requestType || !responseType) {
      return Promise.reject(new SteamServiceError('Установленная версия Steam-библиотеки несовместима.', 'PROTOCOL_MISMATCH'));
    }

    return new Promise<T>((resolve, reject) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: SteamServiceError, result?: T) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.signal.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve(result as T);
      };
      const onAbort = () => finish(new SteamServiceError('Сессия Steam завершена.', 'NOT_CONNECTED', 401));
      timer = setTimeout(() => finish(new SteamServiceError(
        'Steam не ответил вовремя. Результат операции может быть неизвестен; обновите список файлов.',
        'STEAM_TIMEOUT', 504,
      )), this.timeoutMs);
      this.signal.addEventListener('abort', onAbort, { once: true });
      if (this.signal.aborted) return onAbort();

      try {
        const bytes = Buffer.from(requestType.encode(requestType.fromObject(payload)).finish());
        this.client._send({
          msg: ServiceMethodCallFromClient,
          proto: { target_job_name: `Cloud.${method}#1`, timeout_ms: this.timeoutMs },
        }, bytes, (body, header) => {
          if (done) return;
          const result = header.proto?.eresult;
          if (result !== 1) {
            const messages: Record<number, string> = {
              5: 'Сессия Steam недействительна. Подключитесь снова.',
              9: 'Файл больше не найден в Steam Cloud. Обновите список.',
              15: 'Steam отказал в доступе к этим сохранениям.',
              16: 'Steam не ответил вовремя. Обновите список файлов.',
              25: 'Steam превышен лимит запросов. Попробуйте позже.',
              27: 'Сохранения изменены другим устройством. Обновите список.',
              29: 'Steam занят другой операцией. Дождитесь её завершения.',
              84: 'Steam временно ограничил запросы. Попробуйте позже.',
            };
            return finish(new SteamServiceError(
              messages[result ?? 0] ?? 'Steam не подтвердил выполнение операции. Обновите список файлов.',
              `STEAM_RESULT_${Number.isInteger(result) ? result : 'UNKNOWN'}`,
            ));
          }
          try {
            const decoded = responseType.decode(Buffer.isBuffer(body) ? body : body.toBuffer());
            finish(undefined, responseType.toObject(decoded, { longs: String, bytes: Buffer, defaults: true }) as T);
          } catch {
            finish(new SteamServiceError('Steam вернул некорректный ответ.', 'INVALID_STEAM_RESPONSE'));
          }
        });
      } catch {
        finish(new SteamServiceError('Не удалось отправить запрос Steam.', 'STEAM_TRANSPORT_ERROR'));
      }
    });
  }
}

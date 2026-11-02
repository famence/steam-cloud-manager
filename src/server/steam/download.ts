import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { isIP, BlockList } from 'node:net';
import { pipeline, Transform, type TransformCallback, type Readable } from 'node:stream';
import { SteamServiceError } from './protocol.js';

export interface DownloadResponse {
  appid: number;
  file_size: number;
  raw_file_size: number;
  sha_file: Buffer;
  time_stamp: string;
  is_explicit_delete: boolean;
  url_host: string;
  url_path: string;
  use_https: boolean;
  request_headers: { name: string; value: string }[];
  encrypted: boolean;
}

const forbiddenIPv4 = new BlockList();
const forbiddenIPv6 = new BlockList();
for (const [base, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) forbiddenIPv4.addSubnet(base, prefix, 'ipv4');
for (const [base, prefix] of [
  ['::', 96], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48],
  ['100::', 64], ['2001:db8::', 32], ['2001::', 32], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) forbiddenIPv6.addSubnet(base, prefix, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !forbiddenIPv4.check(address, 'ipv4');
  // Accept ordinary global unicast only. Mapped, translated, local and multicast addresses are rejected.
  if (family === 6) return /^[23][0-9a-f]{0,3}:/i.test(address) && !forbiddenIPv6.check(address, 'ipv6');
  return false;
}

export function validateStorageUrl(url: URL): void {
  const host = url.hostname.toLowerCase();
  const allowed = host.endsWith('.steamusercontent.com') || host.endsWith('.steamcontent.com')
    || host === 'steamcloud.akamaized.net' || host === 'steamusercontent-a.akamaihd.net'
    || /^steamcloud-[a-z0-9-]+\.storage\.googleapis\.com$/.test(host)
    || /^steamcloud-[a-z0-9-]+\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(host);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash
    || (url.port && url.port !== '443') || !allowed) {
    throw new SteamServiceError('Steam вернул неподдерживаемый адрес хранилища.', 'UNSAFE_STORAGE_URL');
  }
}

export function storageUrl(response: DownloadResponse): URL {
  if (!response.use_https || typeof response.url_host !== 'string' || typeof response.url_path !== 'string'
    || !response.url_path.startsWith('/') || response.url_path.startsWith('//')
    || /[\\\u0000-\u0020\u007f]/u.test(response.url_host + response.url_path)
    || !/^[a-z0-9.-]+$/i.test(response.url_host)) {
    throw new SteamServiceError('Steam вернул неподдерживаемый адрес хранилища.', 'UNSAFE_STORAGE_URL');
  }
  let url: URL;
  try { url = new URL(`https://${response.url_host}${response.url_path}`); }
  catch { throw new SteamServiceError('Steam вернул некорректный адрес хранилища.', 'UNSAFE_STORAGE_URL'); }
  validateStorageUrl(url);
  return url;
}

function storageHeaders(headers: DownloadResponse['request_headers']): Record<string, string> {
  if (!Array.isArray(headers) || headers.length > 32) {
    throw new SteamServiceError('Steam вернул некорректные заголовки загрузки.', 'INVALID_STEAM_RESPONSE');
  }
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  const forbidden = new Set(['host', 'cookie', 'connection', 'transfer-encoding', 'content-length',
    'upgrade', 'proxy-authorization', 'proxy-connection', 'accept-encoding']);
  for (const { name, value } of headers) {
    if (typeof name !== 'string' || typeof value !== 'string' || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name)
      || /[\r\n\u0000]/u.test(value) || value.length > 8192 || forbidden.has(name.toLowerCase())) {
      throw new SteamServiceError('Steam вернул неподдерживаемые заголовки загрузки.', 'INVALID_STEAM_RESPONSE');
    }
    result[name.toLowerCase()] = value;
  }
  result['accept-encoding'] = 'identity';
  return result;
}

async function resolveStorageAddress(hostname: string, signal: AbortSignal): Promise<LookupAddress> {
  const records = await new Promise<LookupAddress[]>((resolve, reject) => {
    let done = false;
    const finish = (error?: SteamServiceError, addresses?: LookupAddress[]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(addresses ?? []);
    };
    const abort = () => finish(new SteamServiceError('Скачивание отменено.', 'DOWNLOAD_ABORTED', 409));
    const timer = setTimeout(() => finish(new SteamServiceError('Хранилище Steam не ответило вовремя.', 'DOWNLOAD_TIMEOUT', 504)), 10_000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) return abort();
    void lookup(hostname, { all: true, verbatim: true }).then(
      addresses => finish(undefined, addresses),
      () => finish(new SteamServiceError('Хранилище Steam недоступно.', 'DOWNLOAD_NETWORK_ERROR')),
    );
  });
  if (!records.length || records.some(record => !isPublicAddress(record.address))) {
    throw new SteamServiceError('Хранилище Steam вернуло недопустимый сетевой адрес.', 'UNSAFE_STORAGE_ADDRESS');
  }
  return records.find(record => record.family === 4) ?? records[0];
}

export class IntegrityStream extends Transform {
  private received = 0;
  private readonly hash = createHash('sha1');
  private tail = Buffer.alloc(0);
  private static readonly TAIL_BYTES = 64 * 1024;
  constructor(private readonly size: number, private readonly sha: string) { super(); }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.received += chunk.length;
    if (this.received > this.size) {
      callback(new SteamServiceError('Размер скачиваемого файла не совпал с данными Steam.', 'DOWNLOAD_INTEGRITY_ERROR'));
      return;
    }
    this.hash.update(chunk);
    // Retain a bounded tail until integrity passes. Even with Content-Length, a browser
    // cannot finish a corrupt same-size file before the final SHA1 check reports failure.
    const buffered = Buffer.concat([this.tail, chunk]);
    const releaseLength = Math.max(0, buffered.length - IntegrityStream.TAIL_BYTES);
    this.tail = Buffer.from(buffered.subarray(releaseLength));
    callback(null, releaseLength ? buffered.subarray(0, releaseLength) : undefined);
  }

  override _flush(callback: TransformCallback): void {
    if (this.received !== this.size || this.hash.digest('hex') !== this.sha) {
      callback(new SteamServiceError('Контрольная сумма скачанного файла не совпала. Скачайте файл заново.', 'DOWNLOAD_INTEGRITY_ERROR'));
      return;
    }
    this.push(this.tail);
    this.tail = Buffer.alloc(0);
    callback();
  }
}

export async function openStorageDownload(
  response: DownloadResponse,
  expectedSize: number,
  expectedSha: string,
  sessionSignal: AbortSignal,
): Promise<Readable> {
  const url = storageUrl(response);
  const headers = storageHeaders(response.request_headers);
  const signal = AbortSignal.any([sessionSignal, AbortSignal.timeout(30 * 60_000)]);
  if (signal.aborted) throw new SteamServiceError('Сессия завершена.', 'NOT_CONNECTED', 401);

  // Pin a public DNS answer for the request, while preserving the original hostname for TLS verification.
  const address = await resolveStorageAddress(url.hostname, signal);
  return await new Promise<Readable>((resolve, reject) => {
    let resolved = false;
    const fail = (error: SteamServiceError) => {
      if (!resolved) reject(error);
    };
    const req = request(url, {
      method: 'GET', headers, signal, rejectUnauthorized: true,
      servername: url.hostname, family: address.family,
      lookup: (_host, _options, callback) => callback(null, address.address, address.family),
    }, incoming => {
      // Never follow redirects with signed storage headers. A new Steam download request is safer.
      if (incoming.statusCode !== 200) {
        incoming.destroy();
        fail(new SteamServiceError('Хранилище Steam не отдало файл. Обновите список и повторите скачивание.', 'DOWNLOAD_REJECTED'));
        return;
      }
      const encoding = incoming.headers['content-encoding'];
      const length = incoming.headers['content-length'];
      if ((encoding && encoding !== 'identity') || (length !== undefined && Number(length) !== expectedSize)) {
        incoming.destroy();
        fail(new SteamServiceError('Формат файла в хранилище не совпал с данными Steam.', 'DOWNLOAD_INTEGRITY_ERROR'));
        return;
      }
      incoming.setTimeout(60_000, () => incoming.destroy(new SteamServiceError('Хранилище Steam перестало отвечать.', 'DOWNLOAD_TIMEOUT', 504)));
      const integrity = new IntegrityStream(expectedSize, expectedSha);
      // The error listener exists before piping. Consumers still receive errors via iteration/pipeline.
      integrity.on('error', () => {});
      pipeline(incoming, integrity, () => {});
      resolved = true;
      resolve(integrity);
    });
    req.setTimeout(30_000, () => req.destroy(new SteamServiceError('Хранилище Steam не ответило вовремя.', 'DOWNLOAD_TIMEOUT', 504)));
    req.on('error', () => fail(new SteamServiceError('Соединение с хранилищем Steam прервано.', 'DOWNLOAD_NETWORK_ERROR')));
    req.end();
  });
}

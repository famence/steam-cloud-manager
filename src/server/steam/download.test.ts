import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { finished } from 'node:stream/promises';
import { IntegrityStream, isPublicAddress, validateStorageUrl } from './download.js';

test('storage address allowlist rejects credentials, redirects to other services and private hosts', () => {
  for (const address of [
    'https://steamcloud-us-west1.storage.googleapis.com/object?Signature=example',
    'https://cloud-3.steamusercontent.com/object',
    'https://steamusercontent-a.akamaihd.net/object',
  ]) assert.doesNotThrow(() => validateStorageUrl(new URL(address)));
  for (const address of [
    'http://cloud-3.steamusercontent.com/object',
    'https://cloud-3.steamusercontent.com.attacker.example/object',
    'https://attacker.storage.googleapis.com/object',
    'https://127.0.0.1/object',
    'https://metadata.google.internal/object',
    'https://name:password@cloud-3.steamusercontent.com/object',
    'https://cloud-3.steamusercontent.com:8443/object',
  ]) assert.throws(() => validateStorageUrl(new URL(address)));
});

test('DNS pinning rejects internal, link-local, mapped and translated addresses', () => {
  for (const address of [
    '127.0.0.1', '0.0.0.0', '10.0.0.5', '172.16.0.1', '192.168.1.4', '169.254.169.254',
    '100.64.0.1', '224.0.0.1', '198.18.0.1', '::1', '::', 'fc00::1', 'fe80::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', '2001:db8::1',
  ]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

async function read(stream: IntegrityStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

test('download integrity streams the exact bytes and validates SHA1 at EOF', async () => {
  const data = Buffer.from('test-save-content');
  const stream = new IntegrityStream(data.length, createHash('sha1').update(data).digest('hex'));
  const result = read(stream);
  stream.write(data.subarray(0, 3));
  stream.end(data.subarray(3));
  assert.deepEqual(await result, data);
});

test('truncated, oversized and corrupt downloads fail instead of producing a valid export', async () => {
  const data = Buffer.from('test-save-content');
  const sha = createHash('sha1').update(data).digest('hex');
  for (const [size, hash] of [[data.length + 1, sha], [data.length - 1, sha], [data.length, 'ff'.repeat(20)]] as const) {
    const stream = new IntegrityStream(size, hash);
    const result = read(stream);
    stream.end(data);
    await assert.rejects(result, { code: 'DOWNLOAD_INTEGRITY_ERROR' });
  }
});

test('same-size corrupt download cannot emit the full advertised Content-Length', async () => {
  const data = Buffer.alloc(256 * 1024, 0x61);
  const stream = new IntegrityStream(data.length, 'ff'.repeat(20));
  let emitted = 0;
  stream.on('data', (chunk: Buffer) => { emitted += chunk.length; });
  const completion = finished(stream);
  stream.write(data.subarray(0, 128 * 1024));
  stream.end(data.subarray(128 * 1024));
  await assert.rejects(completion, { code: 'DOWNLOAD_INTEGRITY_ERROR' });
  assert.equal(emitted, data.length - 64 * 1024);
  assert.ok(emitted < data.length);
});

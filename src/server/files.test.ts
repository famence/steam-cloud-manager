import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveEntryName, contentDisposition, fileRevision } from './files.js';
import { readConfig } from './config.js';

test('archive names cannot traverse directories or collide even with identical save basenames', () => {
  const base = { size: 1, modifiedAt: 1, sha: 'a'.repeat(40) };
  const names = ['../../etc/passwd', 'C:\\Users\\me\\save.dat', '%WinAppDataLocal%/..\\save.dat', '../\r\n.bad', 'nul\x00save'];
  const entries = names.map((name, index) => archiveEntryName({ ...base, name }, index));
  for (const entry of entries) {
    assert.ok(entry.startsWith('saves/'));
    assert.equal(entry.split('/').length, 2);
    assert.ok(!entry.includes('..') && !entry.includes('\\') && !entry.includes('\r') && !entry.includes('\n') && !entry.includes('\x00'));
  }
  assert.equal(new Set(entries).size, names.length);
});
test('download headers cannot contain CRLF and preserve Unicode via RFC 5987', () => {
  const header = contentDisposition('Saves/Город\r\nInjected: yes.save');
  assert.ok(!header.includes('\r') && !header.includes('\n'));
  assert.match(header, /filename\*=UTF-8''/);
});
test('revision is order independent and covers file contents and Steam change number', () => {
  const a = { name: 'a', size: 1, modifiedAt: 1, sha: 'a'.repeat(40) };
  const b = { ...a, name: 'b' };
  const first = { appId: 12, changeNumber: '9007199254740993', files: [a, b] };
  assert.equal(fileRevision(first), fileRevision({ ...first, files: [b, a] }));
  assert.notEqual(fileRevision(first), fileRevision({ ...first, changeNumber: '9007199254740994' }));
  assert.notEqual(fileRevision(first), fileRevision({ ...first, files: [{ ...a, sha: 'b'.repeat(40) }, b] }));
});
test('remote hosting is rejected even with an account allowlist', () => {
  assert.throws(() => readConfig({ APP_ORIGIN: 'https://cloud.example.com', ALLOWED_STEAM_IDS: '76561198000000000' }));
  assert.throws(() => readConfig({ HOST: '0.0.0.0' }));
});

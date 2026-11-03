import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAppId, fileCountLabel } from '../client/library.js';

test('manual game opening accepts AppID and canonical Steam store URL', () => {
  for (const input of ['949230',' 949230 ', 'https://store.steampowered.com/app/949230/Cities_Skylines_II/?l=russian', 'https://store.steampowered.com/app/949230']) assert.equal(parseAppId(input),949230);
});
test('manual opening rejects package links, arbitrary hosts and invalid identifiers', () => {
  for (const input of ['','0','-1','4294967296','1.5','1e3','https://store.steampowered.com/sub/949230/','https://store.steampowered.com.evil.test/app/949230/','javascript:alert(1)','https://user:password@store.steampowered.com/app/949230','https://store.steampowered.com/app/949230bad']) assert.equal(parseAppId(input),null,input);
});
test('file counts use predictable Russian plurals', () => {
  assert.deepEqual([0,1,2,5,11,21,24].map(fileCountLabel), ['0 файлов','1 файл','2 файла','5 файлов','11 файлов','21 файл','24 файла']);
});

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : path.join(dir, entry.name)))).flat();
}
const output = await files('dist/public');
assert(!output.some(file => /\.(?:ts|tsx|map|env)$/.test(file)), 'Sources and source maps must not be public assets');
for (const locale of ['en', 'ru']) {
  const html = await readFile(`dist/public/${locale}/index.html`, 'utf8');
  assert(html.includes(`<html lang="${locale}">`));
  assert(html.includes('<h1>') && html.includes('made by '), 'Public HTML must be prerendered');
  assert(html.includes('name="description"') && html.includes('schema.org/SoftwareApplication'));
  assert(!html.includes('<!--APP-->'), 'Prerender placeholder was not replaced');
}
for (const file of output.filter(file => file.endsWith('.js'))) {
  const js = await readFile(file, 'utf8');
  for (const privatePath of ['/api/auth/steam', '/api/session', '/api/games/', 'ClientFileDownload', 'steam-session', 'steam-user']) {
    assert(!js.includes(privatePath), `Public bundle contains local backend code: ${privatePath}`);
  }
}
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
assert.equal(config.outputDirectory, 'dist/public');
assert(!config.rewrites && !config.functions, 'The public site must not proxy account traffic');
const csp = config.headers.flatMap(x => x.headers).find(x => x.key === 'Content-Security-Policy')?.value ?? '';
assert(csp.includes("connect-src 'none'") && csp.includes("frame-ancestors 'none'"));
console.log('Public-site contract passed: prerendered en/ru, no hosted Steam session or proxy.');

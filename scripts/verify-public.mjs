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
const privatePage=await readFile('dist/public/app/index.html','utf8');
assert(privatePage.includes('noindex,nofollow'));
const landingBundle=output.filter(file=>/\/assets\/landing-[\w-]+\.js$/.test(file));
assert.equal(landingBundle.length,1);
const js=await readFile(landingBundle[0],'utf8');
for(const name of ['/api/auth/steam','steam-user','ClientFileDownload']) {
  assert(!js.includes(name),'SEO landing must not load the account API');
}
const {config}=await import('../vercel.ts');
assert.equal(config.outputDirectory,'dist/public');
assert(config.rewrites.some(r=>r.source==='/api/:path*'&&r.destination.startsWith('/api/index')));
assert(config.functions['api/index.ts'].maxDuration>=120);
const appCsp=config.headers.find(x=>x.source==='/app/(.*)')
  ?.headers.find(x=>x.key==='Content-Security-Policy')?.value||'';
assert(appCsp.includes("connect-src 'self'") && appCsp.includes("frame-ancestors 'none'"));
const landingCsp=config.headers.find(x=>x.source==='/en/(.*)')
  ?.headers.find(x=>x.key==='Content-Security-Policy')?.value||'';
assert(landingCsp.includes("connect-src 'none'"));
console.log('Vercel-only build verified: landing SEO, /app/, same-origin /api/ Node Functions.');

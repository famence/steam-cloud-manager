import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : path.join(dir, entry.name)))).flat();
}

function resolveExpectedBase() {
  const raw = process.env.BASE_PATH?.trim();
  if (raw) {
    if (raw === '/') return '/';
    const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
    return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
  }
  const siteUrl = process.env.SITE_URL?.trim();
  if (siteUrl) {
    try {
      const url = new URL(siteUrl);
      if (url.pathname && url.pathname !== '/') {
        const path = url.pathname.startsWith('/') ? url.pathname : `/${url.pathname}`;
        return path.endsWith('/') ? path : `${path}/`;
      }
    } catch {
      // ignore invalid URL
    }
  }
  return '/';
}

const expectedBase = resolveExpectedBase();
const output = await files('dist/public');

// 1. Prohibit sources, sourcemaps, and env files
assert(!output.some(file => /\.(?:ts|tsx|map|env)$/.test(file)), 'Sources and source maps must not be public assets');

// 2. Assert .nojekyll presence for GitHub Pages
const hasNoJekyll = await stat('dist/public/.nojekyll').then(s => s.isFile()).catch(() => false);
assert(hasNoJekyll, 'dist/public/.nojekyll must exist for GitHub Pages static serving');

// 3. Assert static CSP meta tag and base paths in localized HTML
for (const locale of ['en', 'ru']) {
  const html = await readFile(`dist/public/${locale}/index.html`, 'utf8');
  assert(html.includes(`<html lang="${locale}">`), `HTML missing <html lang="${locale}">`);
  assert(html.includes('<h1>') && html.includes('made by '), 'Public HTML must be prerendered');
  assert(html.includes('name="description"') && html.includes('schema.org/SoftwareApplication'), 'SEO metadata missing');
  assert(!html.includes('<!--APP-->'), 'Prerender placeholder was not replaced');

  // Static CSP meta check
  assert(html.includes('<meta http-equiv="Content-Security-Policy"'), `dist/public/${locale}/index.html must contain static CSP meta tag`);
  assert(html.includes("connect-src 'none'"), `dist/public/${locale}/index.html static CSP must enforce connect-src 'none'`);

  // Brand link and language switcher base path check
  assert(html.includes(`href="${expectedBase}${locale}/"`), `Brand link in ${locale} must use base path "${expectedBase}"`);
  assert(html.includes(`href="${expectedBase}en/"`) && html.includes(`href="${expectedBase}ru/"`), `Language links in ${locale} must use base path "${expectedBase}"`);

  // Assets in localized HTML
  assert(html.includes(`src="${expectedBase}theme-init.js"`), `theme-init.js in ${locale} must use base path "${expectedBase}"`);
  assert(html.includes(`href="${expectedBase}favicon.svg"`), `favicon.svg in ${locale} must use base path "${expectedBase}"`);
  assert(html.includes(`src="${expectedBase}assets/`) || html.includes(`href="${expectedBase}assets/`), `Bundle assets in ${locale} must use base path "${expectedBase}"`);
}

// 4. Root index.html check
const rootHtml = await readFile('dist/public/index.html', 'utf8');
assert(rootHtml.includes('<meta http-equiv="Content-Security-Policy"'), 'dist/public/index.html must contain static CSP meta tag');
assert(rootHtml.includes("connect-src 'none'"), "dist/public/index.html static CSP must enforce connect-src 'none'");
assert(rootHtml.includes(`href="${expectedBase}en/"`) && rootHtml.includes(`href="${expectedBase}ru/"`), `Root index.html language links must use base path "${expectedBase}"`);
assert(rootHtml.includes(`src="${expectedBase}theme-init.js"`), `Root index.html theme-init.js must use base path "${expectedBase}"`);
assert(rootHtml.includes(`href="${expectedBase}favicon.svg"`), `Root index.html favicon.svg must use base path "${expectedBase}"`);

// 5. Verify local asset resolution on disk
const allHtml = [rootHtml];
for (const locale of ['en', 'ru']) {
  allHtml.push(await readFile(`dist/public/${locale}/index.html`, 'utf8'));
}
for (const html of allHtml) {
  const matches = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
  for (const ref of matches) {
    if (ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('#') || ref.startsWith('mailto:')) continue;
    if (expectedBase !== '/') {
      assert(ref.startsWith(expectedBase) || ref.startsWith('/#'), `Asset path "${ref}" does not start with expected base path "${expectedBase}"`);
    }
    const relative = ref.startsWith(expectedBase) ? ref.slice(expectedBase.length) : ref.replace(/^\/+/, '');
    if (!relative || relative.endsWith('/')) continue;
    const onDisk = path.resolve('dist/public', relative);
    const exists = await stat(onDisk).then(s => s.isFile()).catch(() => false);
    assert(exists, `Referenced asset "${ref}" (resolved to "${onDisk}") does not exist in dist/public`);
  }
}

// 6. Check canonical and sitemap when SITE_URL is configured
if (process.env.SITE_URL) {
  const siteUrl = new URL(process.env.SITE_URL);
  const expectedSiteBase = `${siteUrl.origin}${siteUrl.pathname}`.replace(/\/+$/, '');
  const enHtml = await readFile('dist/public/en/index.html', 'utf8');
  assert(enHtml.includes(`<link rel="canonical" href="${expectedSiteBase}/en/" />`), `Canonical URL in en must include site subpath "${expectedSiteBase}"`);
  const sitemap = await readFile('dist/public/sitemap.xml', 'utf8');
  assert(sitemap.includes(`<loc>${expectedSiteBase}/en/</loc>`), `Sitemap must include site subpath "${expectedSiteBase}"`);
}

// 7. Backend code exclusion in public bundles
for (const file of output.filter(file => file.endsWith('.js'))) {
  const js = await readFile(file, 'utf8');
  for (const privatePath of ['/api/auth/steam', '/api/session', '/api/games/', 'ClientFileDownload', 'steam-session', 'steam-user']) {
    assert(!js.includes(privatePath), `Public bundle contains local backend code: ${privatePath}`);
  }
}

// 8. Vercel config check
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
assert.equal(config.outputDirectory, 'dist/public');
assert(!config.rewrites && !config.functions, 'The public site must not proxy account traffic');
const csp = config.headers.flatMap(x => x.headers).find(x => x.key === 'Content-Security-Policy')?.value ?? '';
assert(csp.includes("connect-src 'none'") && csp.includes("frame-ancestors 'none'"));

console.log('Public-site contract passed: prerendered en/ru, .nojekyll, static CSP, asset integrity, no hosted Steam session.');

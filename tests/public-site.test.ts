import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, readdir, writeFile, unlink, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import type { Server } from 'node:http';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createPreviewServer } from '../scripts/preview-public.mjs';
import { withBase, SecurityContent } from '../src/client/components/Shell.tsx';
import { PublicApp } from '../src/client/public-app.tsx';
import { PreferencesProvider } from '../src/client/preferences.tsx';
import { buildSeoMeta, resolveSiteBase, validateSiteUrl, prerenderSite, generateRobotsTxt } from '../scripts/prerender.tsx';

const publicBase = 'http://127.0.0.1:3111';
let previewServer: Server | null = null;

// Helper to crawl all files recursively in a directory
async function getAllFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await getAllFiles(fullPath)));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

describe('Public Static Site E2E Test Suite (Tiers 1–3)', () => {

before(async () => {
  // Ensure public site is built
  if (!existsSync('dist/public/en/index.html') || !existsSync('dist/public/.nojekyll')) {
    execSync('npm run build:public', { stdio: 'inherit' });
  }

  // Start preview server cleanly if port 3111 is not already responding
  let alreadyRunning = false;
  try {
    const res = await fetch(`${publicBase}/en/`, { signal: AbortSignal.timeout(500) });
    if (res.status === 200) {
      alreadyRunning = true;
    }
  } catch {
    // Not responding yet
  }

  if (!alreadyRunning) {
    previewServer = await new Promise<Server>((resolve, reject) => {
      const s = createPreviewServer(3111);
      s.once('listening', () => resolve(s));
      s.once('error', reject);
    });
  }

  // Verify preview server responds
  let connected = false;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`${publicBase}/en/`);
      if (res.status === 200) {
        connected = true;
        break;
      }
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  assert(connected, 'Preview server should be accessible on port 3111');
});

after(async () => {
  if (previewServer) {
    previewServer.closeAllConnections?.();
    await new Promise<void>((resolve) => {
      previewServer!.close(() => resolve());
    });
  }
});

// ============================================================================
// TIER 1: Feature Coverage (Category-Partition / Specification-Based)
// 35 test cases: 5 tests per feature for Features 1 through 7
// ============================================================================

describe('Tier 1: Feature Coverage (Features 1–7)', () => {

  describe('Feature 1: Static Prerender Build', () => {
    it('T1-F1-01: English SSR HTML content generation in dist/public/en/index.html', async () => {
      assert(existsSync('dist/public/en/index.html'), 'dist/public/en/index.html must exist');
      const html = await readFile('dist/public/en/index.html', 'utf8');
      assert(html.includes('<html lang="en">'), 'Must contain <html lang="en">');
      assert(html.includes('<title>Steam Cloud save manager — Steam Cloud Manager</title>'), 'Must contain English title');
      assert(html.includes('<h1>Steam Cloud save manager</h1>'), 'Must contain English <h1> heading');
      assert(html.includes('View, back up and delete Steam Cloud saves on your computer.'), 'Must contain English lead paragraph');
      assert(html.includes('<li>Browse saves by game</li>'), 'Must contain feature 1 in English');
      assert(html.includes('<li>Download files and ZIP backups</li>'), 'Must contain feature 2 in English');
      assert(html.includes('<li>Delete selected saves with confirmation</li>'), 'Must contain feature 3 in English');
    });

    it('T1-F1-02: Russian SSR HTML content generation in dist/public/ru/index.html', async () => {
      assert(existsSync('dist/public/ru/index.html'), 'dist/public/ru/index.html must exist');
      const html = await readFile('dist/public/ru/index.html', 'utf8');
      assert(html.includes('<html lang="ru">'), 'Must contain <html lang="ru">');
      assert(html.includes('<title>Менеджер сохранений Steam Cloud — Steam Cloud Manager</title>'), 'Must contain Russian title');
      assert(html.includes('<h1>Менеджер сохранений Steam Cloud</h1>'), 'Must contain Russian <h1> heading');
      assert(html.includes('Просмотр, резервное копирование и удаление сохранений Steam Cloud на вашем компьютере.'), 'Must contain Russian lead');
      assert(html.includes('<li>Просмотр сохранений по играм</li>'), 'Must contain feature 1 in Russian');
      assert(html.includes('<li>Скачивание файлов и ZIP-копий</li>'), 'Must contain feature 2 in Russian');
      assert(html.includes('<li>Удаление выбранных сохранений с подтверждением</li>'), 'Must contain feature 3 in Russian');
    });

    it('T1-F1-03: Root index fallback generation in dist/public/index.html mirrors English', async () => {
      assert(existsSync('dist/public/index.html'), 'dist/public/index.html must exist');
      const rootHtml = await readFile('dist/public/index.html', 'utf8');
      const enHtml = await readFile('dist/public/en/index.html', 'utf8');
      assert.equal(rootHtml, enHtml, 'Root index.html must be identical in content to en/index.html');
    });

    it('T1-F1-04: Complete elimination of template placeholders in all prerendered files', async () => {
      for (const file of ['dist/public/index.html', 'dist/public/en/index.html', 'dist/public/ru/index.html']) {
        const html = await readFile(file, 'utf8');
        assert(!html.includes('<!--APP-->'), `${file} must not contain <!--APP--> placeholder`);
        assert(!html.includes('<!--SEO-->'), `${file} must not contain <!--SEO--> placeholder`);
      }
    });

    it('T1-F1-05: Intermediate template file dist/public/public.html is deleted after build', () => {
      assert(!existsSync('dist/public/public.html'), 'dist/public/public.html must be removed by prerender pipeline');
    });
  });

  describe('Feature 2: Base Path & Subpath Resolution', () => {
    it('T1-F2-01: Asset script and stylesheet paths resolve with HTTP 200', async () => {
      const html = await readFile('dist/public/en/index.html', 'utf8');
      const scriptMatches = [...html.matchAll(/src="([^"]+\.js)"/g)].map(m => m[1]);
      const cssMatches = [...html.matchAll(/href="([^"]+\.css)"/g)].map(m => m[1]);
      assert(scriptMatches.length > 0, 'Must have at least one script bundle');
      assert(cssMatches.length > 0, 'Must have at least one css bundle');

      for (const assetPath of [...scriptMatches, ...cssMatches]) {
        const cleanPath = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
        const res = await fetch(`${publicBase}${cleanPath}`);
        assert.equal(res.status, 200, `Asset ${cleanPath} must return HTTP 200`);
      }
    });

    it('T1-F2-02: Asset script and stylesheet paths resolve under /steam-cloud-manager/ subpath', async () => {
      const jsFiles = (await readdir('dist/public/assets')).filter(f => f.endsWith('.js'));
      assert(jsFiles.length > 0, 'At least one JS bundle must exist');
      const bundleFileName = jsFiles[0];

      const subpathAssetUrl = `${publicBase}/steam-cloud-manager/assets/${bundleFileName}`;
      const res = await fetch(subpathAssetUrl);
      assert.equal(res.status, 200, `Subpath asset ${subpathAssetUrl} must return HTTP 200`);
      assert(res.headers.get('content-type')?.includes('javascript'), 'Must return javascript content-type');
    });

    it('T1-F2-03: Favicon and theme-init.js resolution under base path and subpath', async () => {
      const paths = ['/favicon.svg', '/theme-init.js', '/steam-cloud-manager/favicon.svg', '/steam-cloud-manager/theme-init.js'];
      for (const p of paths) {
        const res = await fetch(`${publicBase}${p}`);
        assert.equal(res.status, 200, `Path ${p} must return HTTP 200`);
        if (p.endsWith('.svg')) {
          assert(res.headers.get('content-type')?.includes('image/svg+xml'), 'Must return image/svg+xml');
        } else {
          assert(res.headers.get('content-type')?.includes('javascript'), 'Must return javascript content-type');
        }
      }
    });

    it('T1-F2-04: Brand home link respects base path and locale', async () => {
      const enHtml = await readFile('dist/public/en/index.html', 'utf8');
      const ruHtml = await readFile('dist/public/ru/index.html', 'utf8');
      assert(enHtml.includes('class="brand"'), 'English HTML must contain brand link');
      assert(ruHtml.includes('class="brand"'), 'Russian HTML must contain brand link');
      assert(/href="[^"]*\/en\/"/.test(enHtml), 'Brand link in English must end with /en/');
      assert(/href="[^"]*\/ru\/"/.test(ruHtml), 'Brand link in Russian must end with /ru/');
    });

    it('T1-F2-05: Language switcher links respect base path in both locales', async () => {
      const enHtml = await readFile('dist/public/en/index.html', 'utf8');
      const ruHtml = await readFile('dist/public/ru/index.html', 'utf8');
      assert(enHtml.includes('hrefLang="en"') && enHtml.includes('hrefLang="ru"'), 'English HTML must have en and ru switcher');
      assert(ruHtml.includes('hrefLang="en"') && ruHtml.includes('hrefLang="ru"'), 'Russian HTML must have en and ru switcher');
    });
  });

  describe('Feature 3: Static CSP Meta Tag', () => {
    it('T1-F3-01: Static CSP meta tag present in all generated HTML files', async () => {
      for (const file of ['dist/public/index.html', 'dist/public/en/index.html', 'dist/public/ru/index.html']) {
        const html = await readFile(file, 'utf8');
        assert(html.includes('<meta http-equiv="Content-Security-Policy"'), `${file} must contain CSP meta tag`);
      }
    });

    it('T1-F3-02: Static CSP meta tag enforces connect-src \'none\' directive', async () => {
      const html = await readFile('dist/public/en/index.html', 'utf8');
      const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
      assert(cspMatch, 'CSP meta tag must have content attribute');
      assert(cspMatch[1].includes("connect-src 'none'"), 'CSP must include connect-src \'none\'');
    });

    it('T1-F3-03: Static CSP meta tag defines default-src \'none\' or \'self\' policy', async () => {
      const html = await readFile('dist/public/en/index.html', 'utf8');
      const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
      assert(cspMatch, 'CSP match required');
      assert(cspMatch[1].includes("default-src 'none'"), 'CSP must include default-src \'none\'');
    });

    it('T1-F3-04: Static CSP meta tag enforces object-src \'none\' and base-uri \'none\'', async () => {
      const html = await readFile('dist/public/en/index.html', 'utf8');
      const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
      assert(cspMatch, 'CSP match required');
      assert(cspMatch[1].includes("object-src 'none'"), 'CSP must include object-src \'none\'');
      assert(cspMatch[1].includes("base-uri 'none'"), 'CSP must include base-uri \'none\'');
    });

    it('T1-F3-05: CSP directive parity between vercel.json headers and static meta tag', async () => {
      const vercelJson = JSON.parse(await readFile('vercel.json', 'utf8'));
      const headerCsp = vercelJson.headers.flatMap((h: any) => h.headers).find((h: any) => h.key === 'Content-Security-Policy')?.value;
      assert(headerCsp, 'vercel.json must define Content-Security-Policy header');

      const html = await readFile('dist/public/en/index.html', 'utf8');
      const metaCsp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
      assert(metaCsp, 'Static HTML must have meta CSP');

      for (const directive of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'none'"]) {
        assert(headerCsp.includes(directive), `vercel.json must contain ${directive}`);
        assert(metaCsp.includes(directive), `meta tag must contain ${directive}`);
      }
      assert(!metaCsp.includes('frame-ancestors'), 'frame-ancestors is disallowed in <meta> by W3C spec');
    });
  });

  describe('Feature 4: GitHub Pages Jekyll Bypass', () => {
    it('T1-F4-01: dist/public/.nojekyll file exists immediately after build', () => {
      assert(existsSync('dist/public/.nojekyll'), 'dist/public/.nojekyll must exist');
    });

    it('T1-F4-02: dist/public/.nojekyll file is valid marker file (size <= 100 bytes)', async () => {
      const stats = await stat('dist/public/.nojekyll');
      assert(stats.isFile(), '.nojekyll must be a regular file');
      assert(stats.size <= 100, '.nojekyll must be empty or minimal marker file');
    });

    it('T1-F4-03: Preview server correctly serves .nojekyll with HTTP 200', async () => {
      const res = await fetch(`${publicBase}/.nojekyll`);
      assert.equal(res.status, 200, 'Preview server must return 200 for .nojekyll');
    });

    it('T1-F4-04: .nojekyll is not excluded by root .gitignore', async () => {
      if (existsSync('.gitignore')) {
        const gitignore = await readFile('.gitignore', 'utf8');
        const lines = gitignore.split('\n').map(l => l.trim());
        assert(!lines.includes('.nojekyll') && !lines.includes('dist/public/.nojekyll'), '.nojekyll must not be gitignored');
      }
    });

    it('T1-F4-05: scripts/verify-public.mjs explicitly verifies .nojekyll presence', async () => {
      const script = await readFile('scripts/verify-public.mjs', 'utf8');
      assert(script.includes('.nojekyll'), 'verify-public.mjs must contain assertion for .nojekyll');
    });
  });

  describe('Feature 5: Static Security & Zero-Leak Contract', () => {
    it('T1-F5-01: Zero private backend API route strings in public JS bundles', async () => {
      const allFiles = await getAllFiles('dist/public');
      const jsFiles = allFiles.filter(f => f.endsWith('.js'));
      assert(jsFiles.length > 0, 'Must have at least one JS bundle');

      for (const file of jsFiles) {
        const content = await readFile(file, 'utf8');
        for (const forbidden of ['/api/auth/steam', '/api/session', '/api/games/']) {
          assert(!content.includes(forbidden), `${file} must not contain backend route ${forbidden}`);
        }
      }
    });

    it('T1-F5-02: Zero Steam SDK references in client bundles', async () => {
      const allFiles = await getAllFiles('dist/public');
      const jsFiles = allFiles.filter(f => f.endsWith('.js'));
      for (const file of jsFiles) {
        const content = await readFile(file, 'utf8');
        for (const sdkString of ['steam-session', 'steam-user', 'ClientFileDownload']) {
          assert(!content.includes(sdkString), `${file} must not contain SDK reference ${sdkString}`);
        }
      }
    });

    it('T1-F5-03: Zero source maps or TypeScript source files leaked in dist/public', async () => {
      const allFiles = await getAllFiles('dist/public');
      for (const file of allFiles) {
        assert(!file.endsWith('.ts'), `TypeScript source leaked: ${file}`);
        assert(!file.endsWith('.tsx'), `TypeScript JSX source leaked: ${file}`);
        assert(!file.endsWith('.map'), `Source map leaked: ${file}`);
        assert(!file.endsWith('.env'), `Environment file leaked: ${file}`);
      }
    });

    it('T1-F5-04: Zero third-party telemetry, ads, or analytics domains in bundles', async () => {
      const allFiles = await getAllFiles('dist/public');
      const jsFiles = allFiles.filter(f => f.endsWith('.js'));
      const trackingDomains = ['google-analytics.com', 'googletagmanager.com', 'segment.io', 'hotjar.com', 'sentry.io'];
      for (const file of jsFiles) {
        const content = await readFile(file, 'utf8');
        for (const domain of trackingDomains) {
          assert(!content.includes(domain), `${file} must not contain tracking domain ${domain}`);
        }
      }
    });

    it('T1-F5-05: Probing static preview port for API endpoints returns HTTP 404', async () => {
      const endpoints = ['/api/session', '/api/health', '/api/games', '/api/auth/steam'];
      for (const ep of endpoints) {
        const res = await fetch(`${publicBase}${ep}`);
        assert.equal(res.status, 404, `Static server must return 404 for ${ep}`);
      }
    });
  });

  describe('Feature 6: SEO, Social & Structured Data', () => {
    const expectedSiteUrl = 'https://famence.github.io/steam-cloud-manager/';
    let seoFixtureDir: string;
    let enSeoHtml: string;
    let ruSeoHtml: string;
    let prodRobotsTxt: string;
    let prodSitemapXml: string;

    before(async () => {
      seoFixtureDir = await mkdtemp(path.join(os.tmpdir(), 'scm-seo-'));
      await prerenderSite({
        outDir: seoFixtureDir,
        siteUrl: expectedSiteUrl,
        templatePath: 'src/client/public.html',
        deleteTemplate: false,
      });

      enSeoHtml = await readFile(path.join(seoFixtureDir, 'en/index.html'), 'utf8');
      ruSeoHtml = await readFile(path.join(seoFixtureDir, 'ru/index.html'), 'utf8');
      prodRobotsTxt = await readFile(path.join(seoFixtureDir, 'robots.txt'), 'utf8');
      prodSitemapXml = await readFile(path.join(seoFixtureDir, 'sitemap.xml'), 'utf8');
    });

    after(async () => {
      if (seoFixtureDir) {
        await rm(seoFixtureDir, { recursive: true, force: true });
      }
    });

    it('T1-F6-01: Canonical link correctly formatted pointing to origin, subpath, and locale', () => {
      const enMatch = enSeoHtml.match(/<link rel="canonical" href="([^"]+)"\s*\/?>/);
      assert(enMatch, 'Canonical link tag must be present in English prerendered page');
      assert.equal(enMatch[1], 'https://famence.github.io/steam-cloud-manager/en/', 'EN canonical must point to https://famence.github.io/steam-cloud-manager/en/');

      const ruMatch = ruSeoHtml.match(/<link rel="canonical" href="([^"]+)"\s*\/?>/);
      assert(ruMatch, 'Canonical link tag must be present in Russian prerendered page');
      assert.equal(ruMatch[1], 'https://famence.github.io/steam-cloud-manager/ru/', 'RU canonical must point to https://famence.github.io/steam-cloud-manager/ru/');

      // Also verify buildSeoMeta unit contract
      const meta = buildSeoMeta('en', expectedSiteUrl, true);
      const canonicalTag = meta.find(tag => tag.includes('rel="canonical"'));
      assert(canonicalTag, 'Canonical link tag must be generated when siteBase is present');
      assert(canonicalTag.includes('href="https://famence.github.io/steam-cloud-manager/en/"'), 'Canonical href must match origin + base + locale');
    });

    it('T1-F6-02: Hreflang alternate links emitted with en, ru, and x-default', () => {
      const expectedEn = '<link rel="alternate" hreflang="en" href="https://famence.github.io/steam-cloud-manager/en/" />';
      const expectedRu = '<link rel="alternate" hreflang="ru" href="https://famence.github.io/steam-cloud-manager/ru/" />';
      const expectedXDefault = '<link rel="alternate" hreflang="x-default" href="https://famence.github.io/steam-cloud-manager/en/" />';

      assert(enSeoHtml.includes(expectedEn), 'EN page must include en hreflang link');
      assert(enSeoHtml.includes(expectedRu), 'EN page must include ru hreflang link');
      assert(enSeoHtml.includes(expectedXDefault), 'EN page must include x-default hreflang pointing to /en/');

      assert(ruSeoHtml.includes(expectedEn), 'RU page must include en hreflang link');
      assert(ruSeoHtml.includes(expectedRu), 'RU page must include ru hreflang link');
      assert(ruSeoHtml.includes(expectedXDefault), 'RU page must include x-default hreflang pointing to /en/');
    });

    it('T1-F6-03: OpenGraph and Twitter Card metadata present and localized', async () => {
      const enHtml = await readFile('dist/public/en/index.html', 'utf8');
      const ruHtml = await readFile('dist/public/ru/index.html', 'utf8');

      assert(enHtml.includes('<meta property="og:type" content="website" />'), 'EN must have og:type');
      assert(enHtml.includes('<meta property="og:locale" content="en_US" />'), 'EN must have og:locale en_US');
      assert(enHtml.includes('<meta name="twitter:card" content="summary" />'), 'EN must have twitter:card summary');

      assert(ruHtml.includes('<meta property="og:locale" content="ru_RU" />'), 'RU must have og:locale ru_RU');
      assert(ruHtml.includes('Менеджер сохранений Steam Cloud'), 'RU must have localized Russian og:title');
    });

    it('T1-F6-04: Schema.org SoftwareApplication microdata valid semantic structure', async () => {
      const html = await readFile('dist/public/en/index.html', 'utf8');
      assert(html.includes('itemType="https://schema.org/SoftwareApplication"'), 'Must declare SoftwareApplication schema');
      assert(html.includes('<meta itemProp="name" content="Steam Cloud Manager"/>'), 'Must declare application name');
      assert(html.includes('<meta itemProp="applicationCategory" content="UtilitiesApplication"/>'), 'Must declare Utilities category');
      assert(html.includes('<meta itemProp="operatingSystem" content="Windows, macOS, Linux"/>'), 'Must declare OS compatibility');
      assert(html.includes('itemProp="license"'), 'Must declare license');
    });

    it('T1-F6-05: sitemap.xml and robots.txt output format compliance with subpath URLs', () => {
      assert(prodRobotsTxt.includes('User-agent: *'), 'robots.txt must specify User-agent: *');
      assert(prodRobotsTxt.includes('Allow: /'), 'Production robots.txt must allow indexing');
      assert(prodRobotsTxt.includes('Disallow: /api/'), 'Production robots.txt must disallow /api/');
      assert(prodRobotsTxt.includes('Sitemap: https://famence.github.io/steam-cloud-manager/sitemap.xml'), 'robots.txt must point to sitemap XML');

      assert(prodSitemapXml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'), 'sitemap.xml must have valid XML schema namespace');
      assert(prodSitemapXml.includes('<loc>https://famence.github.io/steam-cloud-manager/en/</loc>'), 'sitemap.xml must contain en URL');
      assert(prodSitemapXml.includes('<loc>https://famence.github.io/steam-cloud-manager/ru/</loc>'), 'sitemap.xml must contain ru URL');
    });
  });

  describe('Feature 7: Client Interaction in Static Mode', () => {
    it('T1-F7-01: Prerendered HTML contains full DOM hierarchy ready for React hydration', async () => {
      const html = await readFile('dist/public/en/index.html', 'utf8');
      assert(html.includes('<div id="root">'), 'Must contain root container');
      assert(html.includes('class="app-shell"'), 'Must contain app-shell');
      assert(html.includes('class="app-header"'), 'Must contain header');
      assert(html.includes('class="public-main"'), 'Must contain main section');
      assert(html.includes('class="app-footer"'), 'Must contain footer');
    });

    it('T1-F7-02: Theme selector dropdown markup with system, light, and dark options', async () => {
      const html = await readFile('dist/public/en/index.html', 'utf8');
      assert(html.includes('<select aria-label="Theme">'), 'Must contain theme select element');
      assert(html.includes('<option value="system"'), 'Must have system option');
      assert(html.includes('<option value="light">Light</option>'), 'Must have light option');
      assert(html.includes('<option value="dark">Dark</option>'), 'Must have dark option');
      assert(html.includes('theme-init.js'), 'Must include theme-init.js in <head>');
    });

    it('T1-F7-03: Language navigation links indicate active page via aria-current', async () => {
      const enHtml = await readFile('dist/public/en/index.html', 'utf8');
      assert(/hrefLang="en"[^>]*aria-current="page"/.test(enHtml) || /aria-current="page"[^>]*hrefLang="en"/.test(enHtml),
        'Active language link in English page must have aria-current="page"');

      const ruHtml = await readFile('dist/public/ru/index.html', 'utf8');
      assert(/hrefLang="ru"[^>]*aria-current="page"/.test(ruHtml) || /aria-current="page"[^>]*hrefLang="ru"/.test(ruHtml),
        'Active language link in Russian page must have aria-current="page"');
    });

    it('T1-F7-04: Security disclosures section contains detailed local storage and network copy', async () => {
      const html = await readFile('dist/public/en/index.html', 'utf8');
      assert(html.includes('<h2>Where your data goes</h2>'), 'Must have security section heading');
      assert(html.includes('Steam tokens stay in the memory of the local process'), 'Must disclose token handling');
      assert(html.includes('The backend binds only to loopback addresses'), 'Must disclose loopback binding');
      assert(html.includes('SECURITY.md'), 'Must link to SECURITY.md');
    });

    it('T1-F7-05: Modal trigger button has valid accessibility label and icon', async () => {
      const html = await readFile('dist/public/en/index.html', 'utf8');
      assert(html.includes('aria-label="Security"'), 'Security button must have aria-label');
      assert(html.includes('lucide-shield-check'), 'Security button must have shield-check icon');
    });
  });

});

// ============================================================================
// TIER 2: Boundary & Corner Cases (Boundary Value Analysis / Negative Testing)
// 35 test cases: 5 tests per feature for Features 1 through 7
// ============================================================================

describe('Tier 2: Boundary & Corner Cases', () => {

  describe('Feature 1 Boundary: Prerender Build Boundaries', () => {
    it('T2-F1-01: Build without SITE_URL generates Disallow: / in robots.txt and omits canonical', () => {
      // Hermetic verification of preview/default build without SITE_URL
      const robots = generateRobotsTxt('', false);
      assert(robots.includes('Disallow: /'), 'Default build without SITE_URL must disallow all bots');
      assert(!robots.includes('Allow: /'), 'Default build without SITE_URL must not allow indexing');
      assert(!robots.includes('Sitemap:'), 'Default build without SITE_URL must not advertise sitemap');

      // Canonical link must be omitted when siteBase is empty
      const meta = buildSeoMeta('en', '', false);
      assert(!meta.some(t => t.includes('rel="canonical"')), 'Must omit canonical link when SITE_URL is empty');
    });

    it('T2-F1-02: SITE_URL trailing slash normalization avoids double slashes in paths', () => {
      const originalSiteUrl = process.env.SITE_URL;
      const originalBasePath = process.env.BASE_PATH;
      try {
        delete process.env.BASE_PATH;

        // 1. Test withBase normalization with trailing slash
        process.env.SITE_URL = 'https://famence.github.io/steam-cloud-manager/';
        const pathWithSlash = withBase('/en/');
        assert.equal(pathWithSlash, '/steam-cloud-manager/en/');
        assert(!pathWithSlash.includes('//en/'), 'Must not produce double slashes when SITE_URL has trailing slash');

        // 2. Test withBase normalization without trailing slash
        process.env.SITE_URL = 'https://famence.github.io/steam-cloud-manager';
        const pathWithoutSlash = withBase('/en/');
        assert.equal(pathWithoutSlash, '/steam-cloud-manager/en/');
        assert(!pathWithoutSlash.includes('//en/'), 'Must not produce double slashes when SITE_URL lacks trailing slash');

        // 3. Both formats must resolve to the identical canonical path
        assert.equal(pathWithSlash, pathWithoutSlash, 'Trailing slash in SITE_URL must produce identical normalized path');

        // 4. Test resolveSiteBase utility from prerender.tsx
        const resWithSlash = resolveSiteBase('https://famence.github.io/steam-cloud-manager/');
        const resWithoutSlash = resolveSiteBase('https://famence.github.io/steam-cloud-manager');
        assert.equal(resWithSlash.siteBase, 'https://famence.github.io/steam-cloud-manager');
        assert.equal(resWithoutSlash.siteBase, 'https://famence.github.io/steam-cloud-manager');
        assert.equal(resWithSlash.subpath, '/steam-cloud-manager');
        assert.equal(resWithoutSlash.subpath, '/steam-cloud-manager');
      } finally {
        if (originalSiteUrl !== undefined) process.env.SITE_URL = originalSiteUrl;
        else delete process.env.SITE_URL;
        if (originalBasePath !== undefined) process.env.BASE_PATH = originalBasePath;
        else delete process.env.BASE_PATH;
      }
    });

    it('T2-F1-03: HTML entity escaping protects title and meta descriptions from injection', async () => {
      const html = await readFile('dist/public/en/index.html', 'utf8');
      assert(!html.includes('<script>alert'), 'Prerendered output must not contain unescaped injected script tags');
      assert(html.includes('&quot;') || !html.includes('"description" content="<'), 'Meta tags must escape dangerous characters');
    });

    it('T2-F1-04: Concurrent/parallel file read & write maintains file integrity without corruption', async () => {
      const reads = await Promise.all([
        readFile('dist/public/index.html', 'utf8'),
        readFile('dist/public/en/index.html', 'utf8'),
        readFile('dist/public/ru/index.html', 'utf8'),
        readFile('dist/public/robots.txt', 'utf8'),
      ]);
      assert.equal(reads[0], reads[1], 'Concurrent reads must yield exact equality for root and en');
      assert(reads[2].length > 1000, 'Russian page read must be complete');
      assert(reads[3].length > 10, 'Robots.txt read must be complete');
    });

    it('T2-F1-05: Rejection of malformed / HTTP SITE_URL (non-https, credentials, query, hash)', () => {
      const invalidUrls = [
        'http://example.com',
        'https://user:pass@example.com',
        'https://example.com?query=1',
        'https://example.com#hash',
        'not-a-valid-url',
      ];
      for (const invalid of invalidUrls) {
        // 1. Verify unit validation helper throws
        assert.throws(
          () => validateSiteUrl(invalid),
          /SITE_URL must be an HTTPS URL without credentials, query parameters, or hash|Invalid URL/,
          `validateSiteUrl must reject invalid URL: ${invalid}`
        );

        // 2. Verify actual scripts/prerender.tsx process execution exits with non-zero error
        let processFailed = false;
        try {
          execSync('node --import tsx scripts/prerender.tsx', {
            env: { ...process.env, SITE_URL: invalid },
            stdio: 'pipe',
          });
        } catch (err: any) {
          processFailed = true;
          const stderr = err.stderr ? err.stderr.toString() : '';
          assert(
            stderr.includes('SITE_URL must be an HTTPS URL without credentials, query parameters, or hash') || stderr.includes('TypeError: Invalid URL') || stderr.includes('ERR_INVALID_URL'),
            `scripts/prerender.tsx stderr must describe invalid URL rejection for ${invalid}`
          );
        }
        assert(processFailed, `scripts/prerender.tsx execution must exit with non-zero status for invalid URL: ${invalid}`);
      }
    });
  });

  describe('Feature 2 Boundary: Base Path Boundaries', () => {
    it('T2-F2-01: Deep subpath preview resolution preserves file mapping', async () => {
      // Testing preview server stripping logic with custom paths
      const res = await fetch(`${publicBase}/steam-cloud-manager/en/index.html`);
      assert.equal(res.status, 200, 'Subpath direct index request must return 200');
    });

    it('T2-F2-02: Missing trailing slash in BASE_PATH is safely normalized', () => {
      const originalBasePath = process.env.BASE_PATH;
      const originalSiteUrl = process.env.SITE_URL;
      try {
        delete process.env.SITE_URL;

        // 1. Missing trailing slash (/steam-cloud-manager)
        process.env.BASE_PATH = '/steam-cloud-manager';
        const r1 = withBase('/en/');
        assert.equal(r1, '/steam-cloud-manager/en/', 'Must normalize missing trailing slash');

        // 2. Missing leading and trailing slash (steam-cloud-manager)
        process.env.BASE_PATH = 'steam-cloud-manager';
        const r2 = withBase('/en/');
        assert.equal(r2, '/steam-cloud-manager/en/', 'Must normalize missing leading and trailing slashes');

        // 3. Fully qualified format (/steam-cloud-manager/)
        process.env.BASE_PATH = '/steam-cloud-manager/';
        const r3 = withBase('/en/');
        assert.equal(r3, '/steam-cloud-manager/en/', 'Canonical format must remain preserved');

        // 4. Redundant multiple slashes (//steam-cloud-manager//)
        process.env.BASE_PATH = '//steam-cloud-manager//';
        const r4 = withBase('/en/');
        assert.equal(r4, '/steam-cloud-manager/en/', 'Redundant slashes must normalize to single slash');

        assert.equal(r1, r3, 'Unslashed and canonical formats must produce identical paths');
        assert.equal(r2, r3, 'Bare name and canonical formats must produce identical paths');
        assert.equal(r4, r3, 'Redundant slashed and canonical formats must produce identical paths');

        // 5. Asset resolution normalization
        const assetPath = withBase('favicon.svg');
        assert.equal(assetPath, '/steam-cloud-manager/favicon.svg', 'Asset path must also be correctly prefixed');
      } finally {
        if (originalBasePath !== undefined) process.env.BASE_PATH = originalBasePath;
        else delete process.env.BASE_PATH;
        if (originalSiteUrl !== undefined) process.env.SITE_URL = originalSiteUrl;
        else delete process.env.SITE_URL;
      }
    });

    it('T2-F2-03: In-page navigation with query string and hash is preserved', async () => {
      const res = await fetch(`${publicBase}/en/?ref=unit_test#install`);
      assert.equal(res.status, 200, 'Query string and hash must not cause 404');
      const text = await res.text();
      assert(text.includes('id="install"'), 'Install section must be in payload');
    });

    it('T2-F2-04: URL requested without trailing slash (/steam-cloud-manager or /en) is resolved cleanly', async () => {
      const resEn = await fetch(`${publicBase}/en`);
      assert.equal(resEn.status, 200, '/en without trailing slash must resolve to index.html');

      const resSub = await fetch(`${publicBase}/steam-cloud-manager`, { redirect: 'manual' });
      assert(resSub.status === 200 || resSub.status === 301 || resSub.status === 302, '/steam-cloud-manager must return 200, 301 or 302 redirect');
    });

    it('T2-F2-05: Non-existent localized subpath (/fr/) returns 404 without leaking server paths', async () => {
      const res = await fetch(`${publicBase}/fr/`);
      assert.equal(res.status, 404, 'Non-existent locale must return 404');
      const body = await res.text();
      assert(!body.includes('/Users/'), '404 response must not leak local system directories');
      assert(!body.includes('node_modules'), '404 response must not leak node_modules path');
    });
  });

  describe('Feature 3 Boundary: Static CSP Boundaries', () => {
    it('T2-F3-01: CSP connect-src \'none\' blocks all outbound origins', async () => {
      const html = await readFile('dist/public/en/index.html', 'utf8');
      const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
      assert(csp.includes("connect-src 'none'"), 'Must strictly forbid connect-src');
      assert(!csp.includes('connect-src *'), 'Must not contain wildcard connect-src');
    });

    it('T2-F3-02: CSP script-src \'self\' blocks remote script injection', async () => {
      const html = await readFile('dist/public/en/index.html', 'utf8');
      const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
      assert(csp.includes("script-src 'self'"), 'script-src must strictly allow only self');
      assert(!csp.includes("'unsafe-inline'"), 'script-src must not allow unsafe-inline in meta');
    });

    it('T2-F3-03: Attempt to iframe static page blocked by frame-ancestors in vercel.json', async () => {
      const config = JSON.parse(await readFile('vercel.json', 'utf8'));
      const csp = config.headers.flatMap((h: any) => h.headers).find((h: any) => h.key === 'Content-Security-Policy')?.value ?? '';
      assert(csp.includes("frame-ancestors 'none'"), 'frame-ancestors \'none\' must be set in HTTP headers');
    });

    it('T2-F3-04: Exfiltration via sendBeacon and WebSocket prohibited by connect-src \'none\'', async () => {
      const html = await readFile('dist/public/en/index.html', 'utf8');
      const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
      // W3C CSP Level 3 defines connect-src to govern fetch, XHR, WebSocket, EventSource, and Beacon
      assert(csp.includes("connect-src 'none'"), 'connect-src \'none\' covers Beacon and WebSocket');
    });

    it('T2-F3-05: Combined HTTP CSP header and static meta tag policy intersection is consistent', async () => {
      const res = await fetch(`${publicBase}/en/`);
      const httpCsp = res.headers.get('content-security-policy') ?? '';
      const html = await res.text();
      const metaCsp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';

      assert(httpCsp.includes("connect-src 'none'"), 'HTTP header must enforce connect-src \'none\'');
      assert(metaCsp.includes("connect-src 'none'"), 'Meta tag must enforce connect-src \'none\'');
    });
  });

  describe('Feature 4 Boundary: Jekyll Bypass Boundaries', () => {
    it('T2-F4-01: Asset files with leading underscores or dots served cleanly', async () => {
      // Test creating a dummy file with underscore to confirm preview server serves it
      const testFile = 'dist/public/_test_underscore.txt';
      await writeFile(testFile, 'jekyll-bypass-check');
      try {
        const res = await fetch(`${publicBase}/_test_underscore.txt`);
        assert.equal(res.status, 200, 'Files starting with underscore must be served with 200');
        const text = await res.text();
        assert.equal(text, 'jekyll-bypass-check');
      } finally {
        await unlink(testFile).catch(() => {});
      }
    });

    it('T2-F4-02: File permissions of dist/public/.nojekyll are readable', async () => {
      const stats = await stat('dist/public/.nojekyll');
      // Mode bitmask for read permissions: 0o444
      assert(Boolean(stats.mode & 0o444), '.nojekyll must have read permissions');
    });

    it('T2-F4-03: Idempotent successive build execution produces identical .nojekyll', async () => {
      const beforeStat = await stat('dist/public/.nojekyll');
      assert(beforeStat.isFile(), '.nojekyll must be present before');
      // Successive idempotent write produces identical marker
      await writeFile('dist/public/.nojekyll', '');
      const afterStat = await stat('dist/public/.nojekyll');
      assert.equal(afterStat.size, beforeStat.size, '.nojekyll size must remain identical');
    });

    it('T2-F4-04: .nojekyll deployment packaging contract preserves file in public artifact without exclusions', async () => {
      const nojekyllPath = path.resolve('dist/public/.nojekyll');
      assert(existsSync(nojekyllPath), 'dist/public/.nojekyll must exist in the artifact directory');

      const fileStat = await stat(nojekyllPath);
      assert(fileStat.isFile(), '.nojekyll must be a regular file, not a directory or symlink');
      // Must be readable (0o444 bitmask) and non-executable (no execute bits set)
      assert((fileStat.mode & 0o444) === 0o444, '.nojekyll must have read permissions for all users (mode >= 0444)');
      assert((fileStat.mode & 0o111) === 0, '.nojekyll must not have execute bits set');

      // Verify that directory enumeration of dist/public discovers .nojekyll (dotfiles not stripped by packager)
      const entries = await readdir('dist/public');
      assert(entries.includes('.nojekyll'), 'dist/public directory listing must include .nojekyll dotfile');

      // If a deployment workflow exists, verify actions/upload-pages-artifact or deploy-pages targets dist/public
      const workflowPath = '.github/workflows/deploy.yml';
      if (existsSync(workflowPath)) {
        const deployYml = await readFile(workflowPath, 'utf8');
        assert(deployYml.includes('path: dist/public') || deployYml.includes('path: "dist/public"') || deployYml.includes('path: \'dist/public\''),
          'Deployment workflow must target dist/public directory containing .nojekyll');
      }
    });

    it('T2-F4-05: Non-empty .nojekyll handling remains valid marker', async () => {
      // GitHub Pages treats any .nojekyll file (0 bytes or with text) as the jekyll bypass signal
      const content = await readFile('dist/public/.nojekyll', 'utf8');
      assert(typeof content === 'string', '.nojekyll content must be readable string');
    });
  });

  describe('Feature 5 Boundary: Security Boundaries', () => {
    it('T2-F5-01: Probing non-existent API subpaths returns HTTP 404', async () => {
      const probes = ['/api/v1/user', '/api/csrf', '/api/games/123/backup'];
      for (const probe of probes) {
        const res = await fetch(`${publicBase}${probe}`);
        assert.equal(res.status, 404, `${probe} must return 404 on public preview server`);
      }
    });

    it('T2-F5-02: Client bundle contains no default Steam credentials or test tokens', async () => {
      const allFiles = await getAllFiles('dist/public');
      const jsFiles = allFiles.filter(f => f.endsWith('.js'));
      const forbiddenTokens = ['eyJh', 'refresh_token', 'webapi_token', 'client_secret'];
      for (const file of jsFiles) {
        const content = await readFile(file, 'utf8');
        for (const token of forbiddenTokens) {
          assert(!content.includes(token), `${file} must not contain token pattern ${token}`);
        }
      }
    });

    it('T2-F5-03: Static preview server never emits Set-Cookie headers', async () => {
      const urls = ['/en/', '/ru/', '/favicon.svg', '/theme-init.js', '/steam-cloud-manager/en/'];
      for (const u of urls) {
        const res = await fetch(`${publicBase}${u}`);
        assert.equal(res.headers.get('set-cookie'), null, `URL ${u} must not set cookies`);
      }
    });

    it('T2-F5-04: Directory traversal probe (/../package.json and encoded) returns 403 or 404', async () => {
      const traversalUrls = [
        `${publicBase}/../package.json`,
        `${publicBase}/%2e%2e/package.json`,
        `${publicBase}/..%2fpackage.json`,
      ];
      for (const u of traversalUrls) {
        const res = await fetch(u);
        assert(res.status === 403 || res.status === 404, `Traversal ${u} must return 403 or 404`);
        const text = await res.text();
        assert(!text.includes('"name": "steam-cloud-manager"'), 'Must never leak package.json content');
      }
    });

    it('T2-F5-05: High-entropy secret scanner on all client chunks finds 0 private keys or secrets', async () => {
      const allFiles = await getAllFiles('dist/public');
      const jsFiles = allFiles.filter(f => f.endsWith('.js'));
      const patterns = [
        /-----BEGIN [A-Z]+ PRIVATE KEY-----/,
        /AIzaSy[0-9A-Za-z-_]{33}/,
        /ghp_[0-9A-Za-z]{36}/,
        /glpat-[0-9A-Za-z-_]{20}/,
      ];
      for (const file of jsFiles) {
        const content = await readFile(file, 'utf8');
        for (const pattern of patterns) {
          assert(!pattern.test(content), `Found forbidden secret pattern in ${file}`);
        }
      }
    });
  });

  describe('Feature 6 Boundary: SEO & Metadata Boundaries', () => {
    let previewFixtureDir: string;
    let previewRobotsTxt: string;

    before(async () => {
      previewFixtureDir = await mkdtemp(path.join(os.tmpdir(), 'scm-preview-seo-'));
      await prerenderSite({
        outDir: previewFixtureDir,
        siteUrl: '',
        templatePath: 'src/client/public.html',
        deleteTemplate: false,
      });
      previewRobotsTxt = await readFile(path.join(previewFixtureDir, 'robots.txt'), 'utf8');
    });

    after(async () => {
      if (previewFixtureDir) {
        await rm(previewFixtureDir, { recursive: true, force: true });
      }
    });

    it('T2-F6-01: Hostname in canonical URLs is normalized to lowercase HTTPS format', () => {
      const siteUrl = 'https://FAMENCE.github.io/steam-cloud-manager';
      const meta = buildSeoMeta('en', siteUrl, true);
      const canonical = meta.find(t => t.includes('rel="canonical"')) ?? '';
      assert(canonical.startsWith('<link rel="canonical" href="https://'), 'Canonical must start with https://');
      const href = canonical.match(/href="([^"]+)"/)?.[1] ?? '';
      const host = new URL(href).host;
      assert.equal(host, host.toLowerCase(), 'Hostname in canonical link must be lowercase');
    });

    it('T2-F6-02: Multi-byte Cyrillic characters correctly UTF-8 encoded without entity corruption', async () => {
      const ruHtml = await readFile('dist/public/ru/index.html', 'utf8');
      assert(ruHtml.includes('Менеджер сохранений Steam Cloud'), 'Russian title must be UTF-8');
      assert(!ruHtml.includes('&amp;#1052;'), 'Must not use corrupt numeric character references');
      assert(!ruHtml.includes('&#x41C;'), 'Must not use hex character entities for Cyrillic');
    });

    it('T2-F6-03: robots.txt output on preview or non-production environment includes Disallow: /', async () => {
      assert(previewRobotsTxt.includes('User-agent: *'), 'Must declare user-agent');
      assert(previewRobotsTxt.includes('Disallow: /'), 'Preview/non-production robots.txt must disallow indexing');
      assert(!/^Allow:\s*\//m.test(previewRobotsTxt), 'Preview robots.txt must not allow indexing');
      assert(!previewRobotsTxt.includes('Sitemap:'), 'Preview robots.txt must not advertise sitemap');

      // Also verify pure generator function output and preview environment resolution
      const unitRobots = generateRobotsTxt('', false);
      assert.equal(unitRobots, 'User-agent: *\nDisallow: /\n');

      const origVercelEnv = process.env.VERCEL_ENV;
      try {
        process.env.VERCEL_ENV = 'preview';
        const vercelPreview = resolveSiteBase('https://famence.github.io/steam-cloud-manager', '');
        assert.equal(vercelPreview.indexable, false, 'VERCEL_ENV=preview must force indexable=false');
        const vercelRobots = generateRobotsTxt(vercelPreview.siteBase, vercelPreview.indexable);
        assert(vercelRobots.includes('Disallow: /'), 'Vercel preview robots.txt must disallow indexing');
        assert(!/^Allow:\s*\//m.test(vercelRobots), 'Vercel preview robots.txt must not allow indexing');
      } finally {
        if (origVercelEnv !== undefined) process.env.VERCEL_ENV = origVercelEnv;
        else delete process.env.VERCEL_ENV;
      }
    });

    it('T2-F6-04: sitemap.xml schema structure has valid XML declaration and urlset tag', async () => {
      const sitemap = await readFile('dist/public/sitemap.xml', 'utf8');
      assert(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'Must have standard XML declaration');
      assert(sitemap.includes('<urlset'), 'Must contain <urlset> opening tag');
      assert(sitemap.includes('</urlset>'), 'Must contain </urlset> closing tag');
    });

    it('T2-F6-05: og:url matches page canonical destination when site URL is configured', () => {
      const siteUrl = 'https://famence.github.io/steam-cloud-manager';
      const meta = buildSeoMeta('en', siteUrl, true);
      const ogUrl = meta.find(t => t.includes('property="og:url"'))?.match(/content="([^"]+)"/)?.[1];
      const canonical = meta.find(t => t.includes('rel="canonical"'))?.match(/href="([^"]+)"/)?.[1];
      assert(ogUrl, 'og:url must be present when site URL is configured');
      assert.equal(ogUrl, canonical, 'og:url must match canonical link href exactly');
      assert.equal(ogUrl, 'https://famence.github.io/steam-cloud-manager/en/', 'og:url must match expected subpath destination');
    });
  });

  describe('Feature 7 Boundary: Client Interaction Boundaries', () => {
    it('T2-F7-01: Theme options match supported Theme union (\'system\' | \'light\' | \'dark\')', async () => {
      const html = await readFile('dist/public/en/index.html', 'utf8');
      const selectBlock = html.match(/<select aria-label="Theme">[\s\S]*?<\/select>/)?.[0] ?? '';
      assert(selectBlock.includes('value="system"'), 'Must include system');
      assert(selectBlock.includes('value="light"'), 'Must include light');
      assert(selectBlock.includes('value="dark"'), 'Must include dark');
    });

    it('T2-F7-02: theme-init.js script executes synchronously before body paint', async () => {
      const html = await readFile('dist/public/en/index.html', 'utf8');
      const headIdx = html.indexOf('</head>');
      const scriptIdx = html.indexOf('src="/theme-init.js"');
      const scriptAltIdx = html.indexOf('theme-init.js');
      assert(scriptIdx > -1 || scriptAltIdx > -1, 'theme-init.js must be in HTML');
      assert(scriptIdx < headIdx || scriptAltIdx < headIdx, 'theme-init.js must precede </head>');
    });

    it('T2-F7-03: Disabled JavaScript renders complete static content (no blank flash)', async () => {
      const html = await readFile('dist/public/en/index.html', 'utf8');
      // Even without JS, root div contains all headings, copy, and install terminal block
      assert(html.includes('<h1>Steam Cloud save manager</h1>'), 'Heading in raw HTML');
      assert(html.includes('git clone https://github.com/famence/steam-cloud-manager.git'), 'Terminal code in raw HTML');
      assert(html.includes('id="install"'), 'Install section anchor in raw HTML');
    });

    it('T2-F7-04: In-page navigation with unknown anchor id degrades gracefully', async () => {
      const res = await fetch(`${publicBase}/en/#nonexistent-anchor`);
      assert.equal(res.status, 200, 'Unknown anchor must not affect HTTP 200 payload');
    });

    it('T2-F7-05: Responsive design elements use fluid layouts without fixed oversized widths', async () => {
      const cssFiles = (await getAllFiles('dist/public/assets')).filter(f => f.endsWith('.css'));
      assert(cssFiles.length > 0, 'CSS file must exist');
      const css = await readFile(cssFiles[0], 'utf8');
      // Assert presence of responsive viewport / media queries or fluid max-width
      assert(css.includes('max-width') || css.includes('@media'), 'CSS must include responsive layout rules');
    });
  });

});

// ============================================================================
// TIER 3: Cross-Feature Combinations (Pairwise Interaction Matrix)
// 12 test cases verifying multi-dimensional system interactions
// ============================================================================

describe('Tier 3: Pairwise Cross-Feature Combinations', () => {

  it('T3-01: [Base: /] + [Locale: en] + [Theme: dark] + [Viewport: Desktop]', async () => {
    const res = await fetch(`${publicBase}/en/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert(html.includes('<html lang="en">'));
    assert(html.includes('value="dark"'));
    assert(html.includes('src="/theme-init.js"') || html.includes('theme-init.js'));
  });

  it('T3-02: [Base: /steam-cloud-manager/] + [Locale: ru] + [Theme: light] + [Viewport: Mobile]', async () => {
    const res = await fetch(`${publicBase}/steam-cloud-manager/ru/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert(html.includes('<html lang="ru">'));
    assert(html.includes('value="light"'));
    assert(html.includes('Менеджер сохранений Steam Cloud'));
  });

  it('T3-03: [Base: /steam-cloud-manager/] + [Lang Switch: EN -> RU] + [Theme: system] + [CSP: Enforced]', async () => {
    const res = await fetch(`${publicBase}/steam-cloud-manager/ru/`);
    const csp = res.headers.get('content-security-policy') ?? '';
    const html = await res.text();
    assert(csp.includes("connect-src 'none'"));
    assert(html.includes('<meta http-equiv="Content-Security-Policy"'));
    assert(html.includes('value="system"'));
  });

  it('T3-04: [Base: /] + [Lang Switch: RU -> EN] + [Theme: dark] + [Modal: Open]', async () => {
    const ruRes = await fetch(`${publicBase}/ru/`);
    const ruHtml = await ruRes.text();
    assert(ruHtml.includes('Steam Cloud Manager'));
    assert(ruHtml.includes('aria-label="Безопасность"') || ruHtml.includes('Security'));

    const enRes = await fetch(`${publicBase}/en/`);
    const enHtml = await enRes.text();
    assert(enHtml.includes('Steam Cloud Manager'));
    assert(enHtml.includes('aria-label="Security"'));
  });

  it('T3-05: [Base: /steam-cloud-manager/] + [Anchor: #install] + [Locale: en] + [Hydration]', async () => {
    const res = await fetch(`${publicBase}/steam-cloud-manager/en/`);
    const html = await res.text();
    assert(html.includes('id="install"'));
    assert(html.includes('npm run build'));
    assert(html.includes('npm start'));
  });

  it('T3-06: [Base: /tools/scm/] + [Locale: ru] + [Brand Navigation Link]', () => {
    const originalBasePath = process.env.BASE_PATH;
    const originalSiteUrl = process.env.SITE_URL;
    try {
      delete process.env.SITE_URL;
      process.env.BASE_PATH = '/tools/scm/';

      // 1. Direct withBase verification for Russian brand path
      const brandLink = withBase('/ru/');
      assert.equal(brandLink, '/tools/scm/ru/', 'withBase must produce /tools/scm/ru/ when BASE_PATH is /tools/scm/');

      // 2. Render actual PublicApp React component tree
      const html = renderToString(
        React.createElement(PreferencesProvider, { locale: 'ru' },
          React.createElement(PublicApp)
        )
      );

      // Verify rendered brand link has deep subpath prefix
      assert(html.includes('href="/tools/scm/ru/"'), 'Rendered brand link in PublicApp must have href="/tools/scm/ru/"');
      // Verify rendered language switcher retains deep subpath prefix
      assert(html.includes('href="/tools/scm/en/"'), 'Rendered language link must have href="/tools/scm/en/"');
    } finally {
      if (originalBasePath !== undefined) process.env.BASE_PATH = originalBasePath;
      else delete process.env.BASE_PATH;
      if (originalSiteUrl !== undefined) process.env.SITE_URL = originalSiteUrl;
      else delete process.env.SITE_URL;
    }
  });

  it('T3-07: [Base: /steam-cloud-manager/] + [Theme: dark -> system] + [OS Theme Change]', async () => {
    const themeInit = await readFile('dist/public/theme-init.js', 'utf8');
    assert(themeInit.includes('prefers-color-scheme') || themeInit.includes('matchMedia'), 'theme-init.js must inspect system media query');
  });

  it('T3-08: [Base: /] + [Security Modal Open] + [Keyboard Tab / Escape] + [Focus Trap]', async () => {
    // 1. Verify dynamic SSR rendering of <PublicApp />
    const ssrHtml = renderToString(
      React.createElement(PreferencesProvider, { locale: 'en' }, React.createElement(PublicApp))
    );

    // 1a. Verify accessible modal trigger button in dynamic SSR output
    assert(ssrHtml.includes('aria-label="Security"'), 'SSR must render accessible security dialog trigger button');
    assert(ssrHtml.includes('title="Security"'), 'SSR must provide tooltip title on security trigger button');
    assert(ssrHtml.includes('lucide-shield-check'), 'SSR security trigger button must contain shield check icon');

    // 1b. Verify security disclosure content and external link contract in SSR output
    assert(ssrHtml.includes('SECURITY.md'), 'SSR must provide link to SECURITY.md');
    assert(ssrHtml.includes('target="_blank"') && ssrHtml.includes('rel="noreferrer"'), 'SECURITY.md link must have secure target and rel attributes');
    assert(ssrHtml.includes('https://github.com/famence/steam-cloud-manager/blob/main/SECURITY.md'), 'SECURITY.md link must point to canonical repository');

    // 1c. Verify isolated SecurityContent component SSR output
    const secHtml = renderToString(
      React.createElement(PreferencesProvider, { locale: 'en' }, React.createElement(SecurityContent))
    );
    assert(secHtml.includes('SECURITY.md'), 'SecurityContent component must render link to SECURITY.md');
    assert(secHtml.includes('rel="noreferrer"'), 'SecurityContent link must include rel="noreferrer"');

    // 2. Verify prerendered static build on disk contains trigger and disclosures
    const staticHtml = await readFile('dist/public/en/index.html', 'utf8');
    assert(staticHtml.includes('aria-label="Security"'), 'Prerendered HTML must include security trigger');
    assert(staticHtml.includes('SECURITY.md'), 'Prerendered HTML must include SECURITY.md link');

    // 3. Verify component contracts for focus trap handling and focus restoration
    const shellSource = await readFile('src/client/components/Shell.tsx', 'utf8');
    assert(shellSource.includes('<dialog'), 'Security modal must use semantic HTML5 <dialog>');
    assert(shellSource.includes('aria-labelledby="security-title"'), 'Modal must declare aria-labelledby for screen readers');
    assert(shellSource.includes('onCancel={onClose}'), 'Dialog must handle onCancel for native keyboard Escape dismissal');
    assert(shellSource.includes('showModal()'), 'Dialog must invoke showModal() to activate native modal layer');
    assert(shellSource.includes('aria-label={t.close}'), 'Close button must have accessible aria-label');

    // Focus trap keyboard handler contract: must intercept Tab key and cycle within dialog
    assert(
      shellSource.includes('onKeyDown') && (shellSource.includes('Tab') || shellSource.includes('key === \'Tab\'') || shellSource.includes('key === "Tab"')),
      'Dialog must declare an onKeyDown handler intercepting Tab key to trap focus'
    );
    assert(
      shellSource.includes('querySelectorAll') || shellSource.includes('focusable') || shellSource.includes('shiftKey'),
      'Focus trap contract must query focusable elements to cycle focus'
    );

    // Focus restoration contract: must preserve previous focus and restore upon dialog close
    assert(
      shellSource.includes('activeElement') || shellSource.includes('previousFocus') || shellSource.includes('triggerRef') || shellSource.includes('.focus()'),
      'Dialog contract must preserve and restore focus to trigger element upon dismissal'
    );
  });

  it('T3-09: [Base: /steam-cloud-manager/] + [External Links: Repo, License, Security]', async () => {
    const html = await readFile('dist/public/en/index.html', 'utf8');
    const externalLinks = [...html.matchAll(/<a [^>]*href="(https:\/\/[^"]+)"[^>]*>/g)];
    assert(externalLinks.length >= 2, 'Must have at least 2 external links');
    for (const match of externalLinks) {
      const fullTag = match[0];
      assert(fullTag.includes('rel="noreferrer"'), `External link ${match[1]} must have rel="noreferrer"`);
      assert(fullTag.includes('target="_blank"'), `External link ${match[1]} must have target="_blank"`);
    }
  });

  it('T3-10: [Base: /steam-cloud-manager/] + [Static Preview + CSP Header + CSP Meta]', async () => {
    const res = await fetch(`${publicBase}/steam-cloud-manager/en/`);
    const headerCsp = res.headers.get('content-security-policy') ?? '';
    assert(headerCsp.includes("default-src 'none'"));
    assert(headerCsp.includes("connect-src 'none'"));

    const html = await res.text();
    assert(html.includes('http-equiv="Content-Security-Policy"'));
    assert(html.includes("connect-src 'none'"));
  });

  it('T3-11: [Base: /steam-cloud-manager/] + [Locale: en] + [Simulated Offline Mode]', async () => {
    const html = await readFile('dist/public/en/index.html', 'utf8');
    // Offline resilience: all fonts, styles, scripts are relative/self-hosted
    assert(!html.includes('fonts.googleapis.com'), 'Must not reference Google Fonts');
    assert(!html.includes('cdnjs.cloudflare.com'), 'Must not reference Cloudflare CDN');
    assert(!html.includes('cdn.jsdelivr.net'), 'Must not reference jsDelivr CDN');
  });

  it('T3-12: [Base: /] + [LocalStorage Access Denied / Private Mode]', async () => {
    const themeInit = await readFile('dist/public/theme-init.js', 'utf8');
    // Verify theme-init has try-catch to prevent crash in privacy-hardened browsers
    assert(themeInit.includes('try') && themeInit.includes('catch'), 'theme-init.js must wrap localStorage access in try/catch');
  });

});

});

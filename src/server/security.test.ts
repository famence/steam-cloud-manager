import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.js';
import { readConfig, type Config } from './config.js';
import { isPublicAddress, validateStorageUrl } from './steam/download.js';

function createProductionConfig(): Config {
  return readConfig({
    VERCEL: '1',
    APP_ORIGIN: 'https://steam-cloud-manager.vercel.app',
    SCM_SESSION_KEY: 'k'.repeat(43),
  });
}

function extractCookie(setCookie: string | string[] | undefined): string {
  if (!setCookie) throw new Error('Expected set-cookie header');
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return raw.split(';')[0];
}

describe('Serverless Security Suite (Feature EF3)', () => {
  describe('Tier 1: Feature Coverage — EF3 Serverless Security Perimeter', () => {
    it('T1-FEAT-F3-01: Canonical Production Host and *.vercel.app Preview Host Acceptance', async (t) => {
      const config = createProductionConfig();
      const app = await buildApp({ config, logger: false, serveStatic: false });
      t.after(() => app.close());

      const resProd = await app.inject({
        url: '/api/session',
        headers: { host: 'steam-cloud-manager.vercel.app' },
      });
      assert.equal(resProd.statusCode, 200);

      const resPreview = await app.inject({
        url: '/api/session',
        headers: { host: 'preview-branch-42.vercel.app' },
      });
      assert.equal(resPreview.statusCode, 200);

      const resPr = await app.inject({
        url: '/api/session',
        headers: { host: 'pr-123.vercel.app' },
      });
      assert.equal(resPr.statusCode, 200);
    });

    it('T1-FEAT-F3-02: Hostile Host Header Rejection', async (t) => {
      const config = createProductionConfig();
      const app = await buildApp({ config, logger: false, serveStatic: false });
      t.after(() => app.close());

      const resAttacker = await app.inject({
        url: '/api/session',
        headers: { host: 'attacker.com' },
      });
      assert.equal(resAttacker.statusCode, 403);
      assert.equal(resAttacker.json().error.code, 'INVALID_HOST');

      const resEvilPort = await app.inject({
        url: '/api/session',
        headers: { host: 'evil.example.org:3000' },
      });
      assert.equal(resEvilPort.statusCode, 403);
      assert.equal(resEvilPort.json().error.code, 'INVALID_HOST');

      const resIp = await app.inject({
        url: '/api/session',
        headers: { host: '192.168.1.1' },
      });
      assert.equal(resIp.statusCode, 403);
      assert.equal(resIp.json().error.code, 'INVALID_HOST');
    });

    it('T1-FEAT-F3-03: Exact Origin Header Enforcement for Mutations', async (t) => {
      const config = createProductionConfig();
      const app = await buildApp({ config, logger: false, serveStatic: false });
      t.after(() => app.close());

      const init = await app.inject({
        url: '/api/session',
        headers: { host: 'steam-cloud-manager.vercel.app' },
      });
      const cookie = extractCookie(init.headers['set-cookie']);
      const csrf = init.json().csrfToken as string;

      const resOk = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          host: 'steam-cloud-manager.vercel.app',
          origin: 'https://steam-cloud-manager.vercel.app',
          cookie,
          'x-csrf-token': csrf,
        },
        payload: {},
      });
      assert.equal(resOk.statusCode, 200);

      const resEvil = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          host: 'steam-cloud-manager.vercel.app',
          origin: 'https://evil.com',
          cookie,
          'x-csrf-token': csrf,
        },
        payload: {},
      });
      assert.equal(resEvil.statusCode, 403);
      assert.equal(resEvil.json().error.code, 'INVALID_ORIGIN');
    });

    it('T1-FEAT-F3-04: Sec-Fetch-Site: cross-site Blocking on API Routes', async (t) => {
      const config = createProductionConfig();
      const app = await buildApp({ config, logger: false, serveStatic: false });
      t.after(() => app.close());

      const res = await app.inject({
        url: '/api/session',
        headers: {
          host: 'steam-cloud-manager.vercel.app',
          'sec-fetch-site': 'cross-site',
        },
      });
      assert.equal(res.statusCode, 403);
      assert.equal(res.json().error.code, 'CROSS_SITE_REQUEST');
    });

    it('T1-FEAT-F3-05: Constant-Time CSRF Token Verification on Mutations', async (t) => {
      const config = createProductionConfig();
      const app = await buildApp({ config, logger: false, serveStatic: false });
      t.after(() => app.close());

      const init = await app.inject({
        url: '/api/session',
        headers: { host: 'steam-cloud-manager.vercel.app' },
      });
      const cookie = extractCookie(init.headers['set-cookie']);
      const csrf = init.json().csrfToken as string;

      const resValid = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          host: 'steam-cloud-manager.vercel.app',
          origin: 'https://steam-cloud-manager.vercel.app',
          cookie,
          'x-csrf-token': csrf,
        },
        payload: {},
      });
      assert.equal(resValid.statusCode, 200);

      const resInvalid = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          host: 'steam-cloud-manager.vercel.app',
          origin: 'https://steam-cloud-manager.vercel.app',
          cookie,
          'x-csrf-token': 'wrong-csrf-token',
        },
        payload: {},
      });
      assert.equal(resInvalid.statusCode, 403);
      assert.equal(resInvalid.json().error.code, 'CSRF_FAILED');

      const alteredCsrf = csrf.slice(0, -1) + (csrf.endsWith('x') ? 'y' : 'x');
      const resAltered = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          host: 'steam-cloud-manager.vercel.app',
          origin: 'https://steam-cloud-manager.vercel.app',
          cookie,
          'x-csrf-token': alteredCsrf,
        },
        payload: {},
      });
      assert.equal(resAltered.statusCode, 403);
      assert.equal(resAltered.json().error.code, 'CSRF_FAILED');
    });

    it('T1-FEAT-F3-06: Security Response Headers & Cookie Flags in Production', async (t) => {
      const config = createProductionConfig();
      const app = await buildApp({ config, logger: false, serveStatic: false });
      t.after(() => app.close());

      const res = await app.inject({
        url: '/api/session',
        headers: { host: 'steam-cloud-manager.vercel.app' },
      });

      assert.equal(res.statusCode, 200);
      const setCookie = res.headers['set-cookie'];
      assert.ok(setCookie);
      const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      assert.match(cookieHeader, /^__Host-scm=/);
      assert.ok(cookieHeader.includes('SameSite=Strict'));
      assert.ok(cookieHeader.includes('HttpOnly'));
      assert.ok(cookieHeader.includes('Secure'));
      assert.ok(cookieHeader.includes('Path=/'));

      assert.equal(res.headers['strict-transport-security'], 'max-age=31536000');
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['x-frame-options'], 'DENY');
      assert.equal(res.headers['referrer-policy'], 'no-referrer');
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.ok(res.headers['content-security-policy']);
      const csp = res.headers['content-security-policy'] as string;
      assert.ok(csp.includes("default-src 'self'"));
      assert.ok(csp.includes("frame-ancestors 'none'"));
    });
  });

  describe('Tier 2: Boundary & Corner Cases — EF3 Security Edge Cases & Attack Surface Deflection', () => {
    it('T2-BOUND-F3-01: Wildcard *.vercel.app Subdomain Boundary Checks', async (t) => {
      const config = createProductionConfig();
      const app = await buildApp({ config, logger: false, serveStatic: false });
      t.after(() => app.close());

      const resPreview = await app.inject({
        url: '/api/session',
        headers: { host: 'preview-1.vercel.app' },
      });
      assert.equal(resPreview.statusCode, 200);

      const resSubPreview = await app.inject({
        url: '/api/session',
        headers: { host: 'sub.preview.vercel.app' },
      });
      assert.equal(resSubPreview.statusCode, 200);

      const resSpoof = await app.inject({
        url: '/api/session',
        headers: { host: 'evil.vercel.app.attacker.com' },
      });
      assert.equal(resSpoof.statusCode, 403);
      assert.equal(resSpoof.json().error.code, 'INVALID_HOST');

      const resNotVercel = await app.inject({
        url: '/api/session',
        headers: { host: 'notvercel.app' },
      });
      assert.equal(resNotVercel.statusCode, 403);
      assert.equal(resNotVercel.json().error.code, 'INVALID_HOST');
    });

    it('T2-BOUND-F3-02: Case-Insensitivity of Host and Origin Headers', async (t) => {
      const config = createProductionConfig();
      const app = await buildApp({ config, logger: false, serveStatic: false });
      t.after(() => app.close());

      const resUpper = await app.inject({
        url: '/api/session',
        headers: { host: 'STEAM-CLOUD-MANAGER.VERCEL.APP' },
      });
      assert.equal(resUpper.statusCode, 200);

      const resMixed = await app.inject({
        url: '/api/session',
        headers: { host: 'StEaM-cLoUd-MaNaGeR.vErCeL.aPp' },
      });
      assert.equal(resMixed.statusCode, 200);
    });

    it('T2-BOUND-F3-03: Origin with Port, Username, Search, or Trailing Path Rejection', async (t) => {
      const config = createProductionConfig();
      const app = await buildApp({ config, logger: false, serveStatic: false });
      t.after(() => app.close());

      const init = await app.inject({
        url: '/api/session',
        headers: { host: 'steam-cloud-manager.vercel.app' },
      });
      const cookie = extractCookie(init.headers['set-cookie']);
      const csrf = init.json().csrfToken as string;

      const invalidOrigins = [
        'https://steam-cloud-manager.vercel.app/subpath',
        'https://steam-cloud-manager.vercel.app/',
        'https://steam-cloud-manager.vercel.app:8443',
        'https://user:pass@steam-cloud-manager.vercel.app',
        'https://steam-cloud-manager.vercel.app?query=1',
      ];

      for (const origin of invalidOrigins) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/demo',
          headers: {
            host: 'steam-cloud-manager.vercel.app',
            origin,
            cookie,
            'x-csrf-token': csrf,
          },
          payload: {},
        });
        assert.equal(res.statusCode, 403, `Origin ${origin} should be rejected`);
        assert.equal(res.json().error.code, 'INVALID_ORIGIN');
      }
    });

    it('T2-BOUND-F3-04: Sec-Fetch-Site Values (same-origin, same-site, none, cross-site)', async (t) => {
      const config = createProductionConfig();
      const app = await buildApp({ config, logger: false, serveStatic: false });
      t.after(() => app.close());

      const allowedValues = ['same-origin', 'same-site', 'none'];
      for (const site of allowedValues) {
        const res = await app.inject({
          url: '/api/session',
          headers: {
            host: 'steam-cloud-manager.vercel.app',
            'sec-fetch-site': site,
          },
        });
        assert.equal(res.statusCode, 200, `Sec-Fetch-Site ${site} should pass`);
      }

      const resCross = await app.inject({
        url: '/api/session',
        headers: {
          host: 'steam-cloud-manager.vercel.app',
          'sec-fetch-site': 'cross-site',
        },
      });
      assert.equal(resCross.statusCode, 403);
      assert.equal(resCross.json().error.code, 'CROSS_SITE_REQUEST');
    });

    it('T2-BOUND-F3-05: Empty and Whitespace-Only CSRF Header Rejection', async (t) => {
      const config = createProductionConfig();
      const app = await buildApp({ config, logger: false, serveStatic: false });
      t.after(() => app.close());

      const init = await app.inject({
        url: '/api/session',
        headers: { host: 'steam-cloud-manager.vercel.app' },
      });
      const cookie = extractCookie(init.headers['set-cookie']);

      const resEmpty = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          host: 'steam-cloud-manager.vercel.app',
          origin: 'https://steam-cloud-manager.vercel.app',
          cookie,
          'x-csrf-token': '',
        },
        payload: {},
      });
      assert.equal(resEmpty.statusCode, 403);
      assert.equal(resEmpty.json().error.code, 'CSRF_FAILED');

      const resWhitespace = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          host: 'steam-cloud-manager.vercel.app',
          origin: 'https://steam-cloud-manager.vercel.app',
          cookie,
          'x-csrf-token': '   ',
        },
        payload: {},
      });
      assert.equal(resWhitespace.statusCode, 403);
      assert.equal(resWhitespace.json().error.code, 'CSRF_FAILED');

      const resMissing = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          host: 'steam-cloud-manager.vercel.app',
          origin: 'https://steam-cloud-manager.vercel.app',
          cookie,
        },
        payload: {},
      });
      assert.equal(resMissing.statusCode, 403);
      assert.equal(resMissing.json().error.code, 'CSRF_FAILED');
    });

    it('T2-BOUND-F3-06: SSRF IP Boundary Checks for Cloud Storage (Forbidden Subnets)', () => {
      // Forbidden IPv4 & IPv6 subnets
      assert.equal(isPublicAddress('169.254.169.254'), false);
      assert.equal(isPublicAddress('169.254.1.1'), false);
      assert.equal(isPublicAddress('127.0.0.1'), false);
      assert.equal(isPublicAddress('10.0.0.1'), false);
      assert.equal(isPublicAddress('172.16.0.1'), false);
      assert.equal(isPublicAddress('192.168.1.1'), false);
      assert.equal(isPublicAddress('100.64.0.1'), false);
      assert.equal(isPublicAddress('::1'), false);
      assert.equal(isPublicAddress('fe80::1'), false);
      assert.equal(isPublicAddress('fc00::1'), false);

      // Public routable IPs
      assert.equal(isPublicAddress('8.8.8.8'), true);
      assert.equal(isPublicAddress('1.1.1.1'), true);
      assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
      assert.equal(isPublicAddress('2001:4860:4860::8888'), true);

      // Storage URL verification
      assert.throws(
        () => validateStorageUrl(new URL('https://evil.attacker.com/file')),
        { code: 'UNSAFE_STORAGE_URL' },
      );
      assert.throws(
        () => validateStorageUrl(new URL('http://steamcloud.akamaized.net/file')),
        { code: 'UNSAFE_STORAGE_URL' },
      );
      assert.doesNotThrow(() =>
        validateStorageUrl(new URL('https://steamcloud-us.storage.googleapis.com/file')),
      );
      assert.doesNotThrow(() =>
        validateStorageUrl(new URL('https://steamcloud.akamaized.net/file')),
      );
    });

    it('T2-BOUND-F3-07: Fastify Request Body Limit Defense (Oversized JSON Payload Rejection)', async (t) => {
      const config = createProductionConfig();
      const app = await buildApp({ config, logger: false, serveStatic: false });
      t.after(() => app.close());

      const init = await app.inject({
        url: '/api/session',
        headers: { host: 'steam-cloud-manager.vercel.app' },
      });
      const cookie = extractCookie(init.headers['set-cookie']);
      const csrf = init.json().csrfToken as string;

      const oversizedData = 'A'.repeat(3 * 1024 * 1024 + 1024);
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          host: 'steam-cloud-manager.vercel.app',
          origin: 'https://steam-cloud-manager.vercel.app',
          cookie,
          'x-csrf-token': csrf,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ padding: oversizedData }),
      });

      assert.equal(res.statusCode, 413);
      assert.equal(res.json().error.code, 'INVALID_REQUEST');
    });
  });

  describe('Tier 3: Pairwise Combinations — Hosted Security Multi-Layer Defenses', () => {
    it('T3-COMB-02: Encrypted Token + CSRF / Origin Guard', async (t) => {
      const config = createProductionConfig();
      const app = await buildApp({ config, logger: false, serveStatic: false });
      t.after(() => app.close());

      const init = await app.inject({
        url: '/api/session',
        headers: { host: 'steam-cloud-manager.vercel.app' },
      });
      const cookie = extractCookie(init.headers['set-cookie']);
      const csrf = init.json().csrfToken as string;

      // 1. Valid cookie + Mismatched Origin
      const resBadOrigin = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          host: 'steam-cloud-manager.vercel.app',
          origin: 'https://attacker.com',
          cookie,
          'x-csrf-token': csrf,
        },
        payload: {},
      });
      assert.equal(resBadOrigin.statusCode, 403);
      assert.equal(resBadOrigin.json().error.code, 'INVALID_ORIGIN');

      // 2. Valid cookie + Mismatched CSRF
      const resBadCsrf = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          host: 'steam-cloud-manager.vercel.app',
          origin: 'https://steam-cloud-manager.vercel.app',
          cookie,
          'x-csrf-token': 'forged-csrf-token',
        },
        payload: {},
      });
      assert.equal(resBadCsrf.statusCode, 403);
      assert.equal(resBadCsrf.json().error.code, 'CSRF_FAILED');

      // 3. Valid cookie + Valid Origin + Valid CSRF
      const resValid = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          host: 'steam-cloud-manager.vercel.app',
          origin: 'https://steam-cloud-manager.vercel.app',
          cookie,
          'x-csrf-token': csrf,
        },
        payload: {},
      });
      assert.equal(resValid.statusCode, 200);
      assert.equal(resValid.json().mode, 'demo');
    });

    it('T3-COMB-04: Cold Start Rehydration + Sec-Fetch-Site Guard', async (t) => {
      const config = createProductionConfig();

      // Instance 1: Generate valid encrypted session
      const app1 = await buildApp({ config, logger: false, serveStatic: false });
      const init1 = await app1.inject({
        url: '/api/session',
        headers: { host: 'steam-cloud-manager.vercel.app' },
      });
      const cookie = extractCookie(init1.headers['set-cookie']);
      await app1.close();

      // Instance 2: Brand new instance simulating cold start
      const app2 = await buildApp({ config, logger: false, serveStatic: false });
      t.after(() => app2.close());

      const res = await app2.inject({
        url: '/api/session',
        headers: {
          host: 'steam-cloud-manager.vercel.app',
          cookie,
          'sec-fetch-site': 'cross-site',
        },
      });

      assert.equal(res.statusCode, 403);
      assert.equal(res.json().error.code, 'CROSS_SITE_REQUEST');
    });
  });
});

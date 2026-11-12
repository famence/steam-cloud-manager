import assert from 'node:assert/strict';
import http from 'node:http';
import { readConfig } from '../src/server/config.js';
import { buildApp } from '../src/server/app.js';
import handler, { closeAppForTesting } from '../api/index.js';

interface Result {
  id: string;
  name: string;
  passed: boolean;
  actualStatus: number;
  expectedStatus: number;
  actualCode?: string;
  expectedCode?: string;
  note?: string;
}

const results: Result[] = [];

function record(
  id: string,
  name: string,
  passed: boolean,
  actualStatus: number,
  expectedStatus: number,
  actualCode?: string,
  expectedCode?: string,
  note?: string,
) {
  results.push({ id, name, passed, actualStatus, expectedStatus, actualCode, expectedCode, note });
  const statusMark = passed ? '✓ PASS' : '✗ FAIL';
  console.log(`[${statusMark}] ${id}: ${name}`);
  if (!passed) {
    console.log(`       Expected: status=${expectedStatus} code=${expectedCode}`);
    console.log(`       Actual:   status=${actualStatus} code=${actualCode} ${note || ''}`);
  }
}

async function runCreativeSuite() {
  console.log('================================================================');
  console.log('       CREATIVE ADVERSARIAL STRESS SUITE (ITERATION 2)         ');
  console.log('================================================================\n');

  // =========================================================================
  // 1. LOCAL MODE (config.port = 3000, trustProxy = false)
  // =========================================================================
  console.log('--- Section 1: Local Mode Edge Cases (Port 3000, Loopback) ---');
  const localConfig = readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000' });
  const localApp = await buildApp({ config: localConfig });

  const sessionRes = await localApp.inject({ url: '/api/session', headers: { host: '127.0.0.1:3000' } });
  const localCookie = (sessionRes.headers['set-cookie'] || '').split(';')[0];
  const localCsrf = sessionRes.json().csrfToken;

  // IPv6 bracket variations
  {
    const r1 = await localApp.inject({ url: '/api/health', headers: { host: '[::1]:3000' } });
    record('IPV6-01', 'Accept standard bracketed IPv6 with configured port [::1]:3000', r1.statusCode === 200, r1.statusCode, 200);

    const r2 = await localApp.inject({ url: '/api/health', headers: { host: '[::1]:9999' } });
    record('IPV6-02', 'Reject bracketed IPv6 with unauthorized port [::1]:9999', r2.statusCode === 403 && r2.json()?.error?.code === 'INVALID_HOST', r2.statusCode, 403, r2.json()?.error?.code, 'INVALID_HOST');

    const r3 = await localApp.inject({ url: '/api/health', headers: { host: '[::1]:443' } });
    record('IPV6-03', 'Reject bracketed IPv6 with HTTPS port [::1]:443', r3.statusCode === 403 && r3.json()?.error?.code === 'INVALID_HOST', r3.statusCode, 403, r3.json()?.error?.code, 'INVALID_HOST');

    const r4 = await localApp.inject({ url: '/api/health', headers: { host: '::1' } });
    record('IPV6-04', 'Reject unbracketed IPv6 ::1 (RFC 3986 violation in Host)', r4.statusCode === 403 && r4.json()?.error?.code === 'INVALID_HOST', r4.statusCode, 403, r4.json()?.error?.code, 'INVALID_HOST');

    const r5 = await localApp.inject({ url: '/api/health', headers: { host: '::1:3000' } });
    record('IPV6-05', 'Reject unbracketed IPv6 with port ::1:3000', r5.statusCode === 403 && r5.json()?.error?.code === 'INVALID_HOST', r5.statusCode, 403, r5.json()?.error?.code, 'INVALID_HOST');
  }

  // Authority Userinfo injection
  {
    const r1 = await localApp.inject({ url: '/api/health', headers: { host: 'user@localhost:3000' } });
    record('AUTH-01', 'Reject Host header with authority userinfo user@localhost:3000', r1.statusCode === 403 && r1.json()?.error?.code === 'INVALID_HOST', r1.statusCode, 403, r1.json()?.error?.code, 'INVALID_HOST');

    const r2 = await localApp.inject({ url: '/api/health', headers: { host: 'user:pass@127.0.0.1:3000' } });
    record('AUTH-02', 'Reject Host header with user and password user:pass@127.0.0.1:3000', r2.statusCode === 403 && r2.json()?.error?.code === 'INVALID_HOST', r2.statusCode, 403, r2.json()?.error?.code, 'INVALID_HOST');

    const r3 = await localApp.inject({ url: '/api/health', headers: { host: 'evil.com@localhost:3000' } });
    record('AUTH-03', 'Reject domain authority spoofing evil.com@localhost:3000', r3.statusCode === 403 && r3.json()?.error?.code === 'INVALID_HOST', r3.statusCode, 403, r3.json()?.error?.code, 'INVALID_HOST');
  }

  // Whitespace and control character injection
  {
    const r1 = await localApp.inject({ url: '/api/health', headers: { host: 'localhost\t:3000' } });
    record('WS-01', 'Reject embedded tab in Host localhost\\t:3000', r1.statusCode === 403 && r1.json()?.error?.code === 'INVALID_HOST', r1.statusCode, 403, r1.json()?.error?.code, 'INVALID_HOST');

    const r2 = await localApp.inject({ url: '/api/health', headers: { host: 'localhost\n:3000' } });
    record('WS-02', 'Reject embedded newline in Host localhost\\n:3000', r2.statusCode === 403 && r2.json()?.error?.code === 'INVALID_HOST', r2.statusCode, 403, r2.json()?.error?.code, 'INVALID_HOST');

    const r3 = await localApp.inject({ url: '/api/health', headers: { host: 'localhost\r:3000' } });
    record('WS-03', 'Reject embedded CR in Host localhost\\r:3000', r3.statusCode === 403 && r3.json()?.error?.code === 'INVALID_HOST', r3.statusCode, 403, r3.json()?.error?.code, 'INVALID_HOST');

    const r4 = await localApp.inject({ url: '/api/health', headers: { host: 'localhost :3000' } });
    record('WS-04', 'Reject embedded space in Host localhost :3000', r4.statusCode === 403 && r4.json()?.error?.code === 'INVALID_HOST', r4.statusCode, 403, r4.json()?.error?.code, 'INVALID_HOST');
  }

  // Path, query and hash injection in Host header
  {
    const r1 = await localApp.inject({ url: '/api/health', headers: { host: 'localhost:3000/api' } });
    record('PATH-01', 'Reject path in Host localhost:3000/api', r1.statusCode === 403 && r1.json()?.error?.code === 'INVALID_HOST', r1.statusCode, 403, r1.json()?.error?.code, 'INVALID_HOST');

    const r2 = await localApp.inject({ url: '/api/health', headers: { host: 'localhost:3000?foo=bar' } });
    record('PATH-02', 'Reject query in Host localhost:3000?foo=bar', r2.statusCode === 403 && r2.json()?.error?.code === 'INVALID_HOST', r2.statusCode, 403, r2.json()?.error?.code, 'INVALID_HOST');

    const r3 = await localApp.inject({ url: '/api/health', headers: { host: 'localhost:3000#section' } });
    record('PATH-03', 'Reject fragment in Host localhost:3000#section', r3.statusCode === 403 && r3.json()?.error?.code === 'INVALID_HOST', r3.statusCode, 403, r3.json()?.error?.code, 'INVALID_HOST');
  }

  // Trailing dot edge cases
  {
    const r1 = await localApp.inject({ url: '/api/health', headers: { host: 'localhost.:3000' } });
    record('DOT-01', 'Reject trailing dot in hostname localhost.:3000', r1.statusCode === 403 && r1.json()?.error?.code === 'INVALID_HOST', r1.statusCode, 403, r1.json()?.error?.code, 'INVALID_HOST');

    const r2 = await localApp.inject({ url: '/api/health', headers: { host: 'localhost.' } });
    record('DOT-02', 'Reject trailing dot in hostname localhost.', r2.statusCode === 403 && r2.json()?.error?.code === 'INVALID_HOST', r2.statusCode, 403, r2.json()?.error?.code, 'INVALID_HOST');
  }

  // Port boundaries and port mismatch attacks in local mode
  {
    const r1 = await localApp.inject({ url: '/api/health', headers: { host: 'localhost:3001' } });
    record('PORT-01', 'Reject off-by-one port localhost:3001', r1.statusCode === 403 && r1.json()?.error?.code === 'INVALID_HOST', r1.statusCode, 403, r1.json()?.error?.code, 'INVALID_HOST');

    const r2 = await localApp.inject({ url: '/api/health', headers: { host: 'localhost:443' } });
    record('PORT-02', 'Reject HTTPS port localhost:443 on HTTP server', r2.statusCode === 403 && r2.json()?.error?.code === 'INVALID_HOST', r2.statusCode, 403, r2.json()?.error?.code, 'INVALID_HOST');

    const r3 = await localApp.inject({ url: '/api/health', headers: { host: 'localhost:8080' } });
    record('PORT-03', 'Reject alternative port localhost:8080', r3.statusCode === 403 && r3.json()?.error?.code === 'INVALID_HOST', r3.statusCode, 403, r3.json()?.error?.code, 'INVALID_HOST');

    const r4 = await localApp.inject({ url: '/api/health', headers: { host: 'localhost:65535' } });
    record('PORT-04', 'Reject max port localhost:65535', r4.statusCode === 403 && r4.json()?.error?.code === 'INVALID_HOST', r4.statusCode, 403, r4.json()?.error?.code, 'INVALID_HOST');

    const r5 = await localApp.inject({ url: '/api/health', headers: { host: 'localhost:0' } });
    record('PORT-05', 'Reject port 0 localhost:0', r5.statusCode === 403 && r5.json()?.error?.code === 'INVALID_HOST', r5.statusCode, 403, r5.json()?.error?.code, 'INVALID_HOST');

    const r6 = await localApp.inject({ url: '/api/health', headers: { host: 'localhost:-3000' } });
    record('PORT-06', 'Reject negative port localhost:-3000', r6.statusCode === 403 && r6.json()?.error?.code === 'INVALID_HOST', r6.statusCode, 403, r6.json()?.error?.code, 'INVALID_HOST');
  }

  // Untrusted proxy X-Forwarded-Host injection
  {
    const r1 = await localApp.inject({
      url: '/api/health',
      headers: { host: 'attacker.com', 'x-forwarded-host': '127.0.0.1:3000' },
    });
    record('XFH-01', 'Untrusted proxy: Host attacker.com with spoofed XFH 127.0.0.1:3000 rejected', r1.statusCode === 403 && r1.json()?.error?.code === 'INVALID_HOST', r1.statusCode, 403, r1.json()?.error?.code, 'INVALID_HOST');

    const r2 = await localApp.inject({
      url: '/api/health',
      headers: { host: 'attacker.com', 'x-forwarded-host': 'localhost:3000' },
    });
    record('XFH-02', 'Untrusted proxy: Host attacker.com with spoofed XFH localhost:3000 rejected', r2.statusCode === 403 && r2.json()?.error?.code === 'INVALID_HOST', r2.statusCode, 403, r2.json()?.error?.code, 'INVALID_HOST');

    const r3 = await localApp.inject({
      url: '/api/health',
      headers: { host: 'attacker.com', 'x-forwarded-host': '[::1]:3000' },
    });
    record('XFH-03', 'Untrusted proxy: Host attacker.com with spoofed XFH [::1]:3000 rejected', r3.statusCode === 403 && r3.json()?.error?.code === 'INVALID_HOST', r3.statusCode, 403, r3.json()?.error?.code, 'INVALID_HOST');

    const r4 = await localApp.inject({
      url: '/api/health',
      headers: { host: 'localhost:3000', 'x-forwarded-host': 'attacker.com' },
    });
    record('XFH-04', 'Untrusted proxy: Host localhost:3000 ignores untrusted XFH attacker.com', r4.statusCode === 200, r4.statusCode, 200);
  }

  // Local Origin header checks on mutating endpoints
  {
    const postDemo = (headers: Record<string, string>) =>
      localApp.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          host: '127.0.0.1:3000',
          cookie: localCookie,
          'x-csrf-token': localCsrf,
          ...headers,
        },
        payload: {},
      });

    const r1 = await postDemo({ origin: 'null' });
    record('ORIG-01', 'Reject literal origin "null"', r1.statusCode === 403 && r1.json()?.error?.code === 'INVALID_ORIGIN', r1.statusCode, 403, r1.json()?.error?.code, 'INVALID_ORIGIN');

    const r2 = await postDemo({ origin: '"null"' });
    record('ORIG-02', 'Reject quoted origin \'"null"\'', r2.statusCode === 403 && r2.json()?.error?.code === 'INVALID_ORIGIN', r2.statusCode, 403, r2.json()?.error?.code, 'INVALID_ORIGIN');

    const r3 = await postDemo({ origin: 'http://127.0.0.1:9999' });
    record('ORIG-03', 'Reject origin with wrong port http://127.0.0.1:9999', r3.statusCode === 403 && r3.json()?.error?.code === 'INVALID_ORIGIN', r3.statusCode, 403, r3.json()?.error?.code, 'INVALID_ORIGIN');

    const r4 = await postDemo({ origin: 'http://127.0.0.1:80' });
    record('ORIG-04', 'Reject origin with wrong port http://127.0.0.1:80', r4.statusCode === 403 && r4.json()?.error?.code === 'INVALID_ORIGIN', r4.statusCode, 403, r4.json()?.error?.code, 'INVALID_ORIGIN');

    const r5 = await postDemo({ origin: 'https://127.0.0.1:3000' });
    record('ORIG-05', 'Reject HTTPS scheme in HTTP dev mode origin https://127.0.0.1:3000', r5.statusCode === 403 && r5.json()?.error?.code === 'INVALID_ORIGIN', r5.statusCode, 403, r5.json()?.error?.code, 'INVALID_ORIGIN');

    const r6 = await postDemo({ origin: 'http://evil.127.0.0.1.attacker.com:3000' });
    record('ORIG-06', 'Reject attacker subdomain origin http://evil.127.0.0.1.attacker.com:3000', r6.statusCode === 403 && r6.json()?.error?.code === 'INVALID_ORIGIN', r6.statusCode, 403, r6.json()?.error?.code, 'INVALID_ORIGIN');

    const r7 = await postDemo({ origin: 'http://127.0.0.1:3000' });
    record('ORIG-07', 'Accept exact canonical appOrigin http://127.0.0.1:3000', r7.statusCode === 200, r7.statusCode, 200);
  }

  await localApp.close();

  // =========================================================================
  // 2. CLOUD / VERCEL MODE (VERCEL=1, trustProxy = true)
  // =========================================================================
  console.log('\n--- Section 2: Cloud / Vercel Mode Edge Cases (Hosted HTTPS, Proxy) ---');
  process.env.VERCEL = '1';
  process.env.SCM_SESSION_KEY = Buffer.alloc(32, 9).toString('base64url');
  const cloudConfig = readConfig({
    VERCEL: '1',
    APP_ORIGIN: 'https://steam-cloud-manager.vercel.app',
    NODE_ENV: 'production',
    SCM_SESSION_KEY: process.env.SCM_SESSION_KEY,
  });
  const cloudApp = await buildApp({ config: cloudConfig });

  const cloudSessionRes = await cloudApp.inject({
    url: '/api/session',
    headers: { host: 'steam-cloud-manager.vercel.app' },
  });
  const cloudCookie = (cloudSessionRes.headers['set-cookie'] || '').split(';')[0];
  const cloudCsrf = cloudSessionRes.json().csrfToken;

  // Cloud Host validation
  {
    const r1 = await cloudApp.inject({ url: '/api/health', headers: { host: 'steam-cloud-manager.vercel.app' } });
    record('CLD-HOST-01', 'Accept production deployment host steam-cloud-manager.vercel.app', r1.statusCode === 200, r1.statusCode, 200);

    const r2 = await cloudApp.inject({ url: '/api/health', headers: { host: 'steam-cloud-manager.vercel.app:443' } });
    record('CLD-HOST-02', 'Accept production deployment host with port 443', r2.statusCode === 200, r2.statusCode, 200);

    const r3 = await cloudApp.inject({ url: '/api/health', headers: { host: 'steam-cloud-manager.vercel.app:80' } });
    record('CLD-HOST-03', 'Accept production deployment host with port 80', r3.statusCode === 200, r3.statusCode, 200);

    const r4 = await cloudApp.inject({ url: '/api/health', headers: { host: 'feature-pr-42.vercel.app' } });
    record('CLD-HOST-04', 'Accept valid preview branch feature-pr-42.vercel.app', r4.statusCode === 200, r4.statusCode, 200);

    const r5 = await cloudApp.inject({ url: '/api/health', headers: { host: 'feature-pr-42.vercel.app:443' } });
    record('CLD-HOST-05', 'Accept valid preview branch with port 443', r5.statusCode === 200, r5.statusCode, 200);

    const r6 = await cloudApp.inject({ url: '/api/health', headers: { host: 'steam-cloud-manager.vercel.app:8080' } });
    record('CLD-HOST-06', 'Reject non-standard port 8080 on production host', r6.statusCode === 403 && r6.json()?.error?.code === 'INVALID_HOST', r6.statusCode, 403, r6.json()?.error?.code, 'INVALID_HOST');

    const r7 = await cloudApp.inject({ url: '/api/health', headers: { host: 'steam-cloud-manager.vercel.app:3000' } });
    record('CLD-HOST-07', 'Reject local port 3000 on cloud host', r7.statusCode === 403 && r7.json()?.error?.code === 'INVALID_HOST', r7.statusCode, 403, r7.json()?.error?.code, 'INVALID_HOST');

    const r8 = await cloudApp.inject({ url: '/api/health', headers: { host: 'steam-cloud-manager.vercel.app:9999' } });
    record('CLD-HOST-08', 'Reject arbitrary port 9999 on cloud host', r8.statusCode === 403 && r8.json()?.error?.code === 'INVALID_HOST', r8.statusCode, 403, r8.json()?.error?.code, 'INVALID_HOST');
  }

  // Cloud loopback strict prohibition
  {
    const r1 = await cloudApp.inject({ url: '/api/health', headers: { host: 'localhost' } });
    record('CLD-LOOP-01', 'Reject localhost in cloud environment', r1.statusCode === 403 && r1.json()?.error?.code === 'INVALID_HOST', r1.statusCode, 403, r1.json()?.error?.code, 'INVALID_HOST');

    const r2 = await cloudApp.inject({ url: '/api/health', headers: { host: 'localhost:3000' } });
    record('CLD-LOOP-02', 'Reject localhost:3000 in cloud environment', r2.statusCode === 403 && r2.json()?.error?.code === 'INVALID_HOST', r2.statusCode, 403, r2.json()?.error?.code, 'INVALID_HOST');

    const r3 = await cloudApp.inject({ url: '/api/health', headers: { host: 'localhost:80' } });
    record('CLD-LOOP-03', 'Reject localhost:80 in cloud environment', r3.statusCode === 403 && r3.json()?.error?.code === 'INVALID_HOST', r3.statusCode, 403, r3.json()?.error?.code, 'INVALID_HOST');

    const r4 = await cloudApp.inject({ url: '/api/health', headers: { host: '127.0.0.1' } });
    record('CLD-LOOP-04', 'Reject 127.0.0.1 in cloud environment', r4.statusCode === 403 && r4.json()?.error?.code === 'INVALID_HOST', r4.statusCode, 403, r4.json()?.error?.code, 'INVALID_HOST');

    const r5 = await cloudApp.inject({ url: '/api/health', headers: { host: '127.0.0.1:3000' } });
    record('CLD-LOOP-05', 'Reject 127.0.0.1:3000 in cloud environment', r5.statusCode === 403 && r5.json()?.error?.code === 'INVALID_HOST', r5.statusCode, 403, r5.json()?.error?.code, 'INVALID_HOST');

    const r6 = await cloudApp.inject({ url: '/api/health', headers: { host: '[::1]' } });
    record('CLD-LOOP-06', 'Reject [::1] in cloud environment', r6.statusCode === 403 && r6.json()?.error?.code === 'INVALID_HOST', r6.statusCode, 403, r6.json()?.error?.code, 'INVALID_HOST');

    const r7 = await cloudApp.inject({ url: '/api/health', headers: { host: '[::1]:3000' } });
    record('CLD-LOOP-07', 'Reject [::1]:3000 in cloud environment', r7.statusCode === 403 && r7.json()?.error?.code === 'INVALID_HOST', r7.statusCode, 403, r7.json()?.error?.code, 'INVALID_HOST');
  }

  // Cloud domain spoofing and apex domain rejection
  {
    const r1 = await cloudApp.inject({ url: '/api/health', headers: { host: 'vercel.app' } });
    record('CLD-SPOOF-01', 'Reject apex vercel.app (only subdomains allowed)', r1.statusCode === 403 && r1.json()?.error?.code === 'INVALID_HOST', r1.statusCode, 403, r1.json()?.error?.code, 'INVALID_HOST');

    const r2 = await cloudApp.inject({ url: '/api/health', headers: { host: 'vercel.app:443' } });
    record('CLD-SPOOF-02', 'Reject apex vercel.app:443', r2.statusCode === 403 && r2.json()?.error?.code === 'INVALID_HOST', r2.statusCode, 403, r2.json()?.error?.code, 'INVALID_HOST');

    const r3 = await cloudApp.inject({ url: '/api/health', headers: { host: '.vercel.app' } });
    record('CLD-SPOOF-03', 'Reject leading dot .vercel.app', r3.statusCode === 403 && r3.json()?.error?.code === 'INVALID_HOST', r3.statusCode, 403, r3.json()?.error?.code, 'INVALID_HOST');

    const r4 = await cloudApp.inject({ url: '/api/health', headers: { host: 'foo..vercel.app' } });
    record('CLD-SPOOF-04', 'Reject double dot foo..vercel.app', r4.statusCode === 403 && r4.json()?.error?.code === 'INVALID_HOST', r4.statusCode, 403, r4.json()?.error?.code, 'INVALID_HOST');

    const r5 = await cloudApp.inject({ url: '/api/health', headers: { host: 'evil-vercel.app' } });
    record('CLD-SPOOF-05', 'Reject hyphenated spoof evil-vercel.app', r5.statusCode === 403 && r5.json()?.error?.code === 'INVALID_HOST', r5.statusCode, 403, r5.json()?.error?.code, 'INVALID_HOST');

    const r6 = await cloudApp.inject({ url: '/api/health', headers: { host: 'steam-cloud-manager.vercel.app.attacker.com' } });
    record('CLD-SPOOF-06', 'Reject attacker domain with vercel suffix steam-cloud-manager.vercel.app.attacker.com', r6.statusCode === 403 && r6.json()?.error?.code === 'INVALID_HOST', r6.statusCode, 403, r6.json()?.error?.code, 'INVALID_HOST');

    const r7 = await cloudApp.inject({ url: '/api/health', headers: { host: 'steam-cloud-manager.vercel.app.' } });
    record('CLD-SPOOF-07', 'Reject trailing dot on cloud hostname steam-cloud-manager.vercel.app.', r7.statusCode === 403 && r7.json()?.error?.code === 'INVALID_HOST', r7.statusCode, 403, r7.json()?.error?.code, 'INVALID_HOST');

    const r8 = await cloudApp.inject({ url: '/api/health', headers: { host: 'user@steam-cloud-manager.vercel.app' } });
    record('CLD-SPOOF-08', 'Reject authority userinfo on cloud host user@steam-cloud-manager.vercel.app', r8.statusCode === 403 && r8.json()?.error?.code === 'INVALID_HOST', r8.statusCode, 403, r8.json()?.error?.code, 'INVALID_HOST');
  }

  // Cloud Origin validation on mutating endpoints
  {
    const postCloudDemo = (headers: Record<string, string>) =>
      cloudApp.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: {
          host: 'steam-cloud-manager.vercel.app',
          cookie: cloudCookie,
          'x-csrf-token': cloudCsrf,
          ...headers,
        },
        payload: {},
      });

    const r1 = await postCloudDemo({ origin: 'https://steam-cloud-manager.vercel.app' });
    record('CLD-ORIG-01', 'Accept canonical production origin https://steam-cloud-manager.vercel.app', r1.statusCode === 200, r1.statusCode, 200);

    const r2 = await cloudApp.inject({
      method: 'POST',
      url: '/api/auth/demo',
      headers: {
        host: 'preview-branch-99.vercel.app',
        origin: 'https://preview-branch-99.vercel.app',
        cookie: cloudCookie,
        'x-csrf-token': cloudCsrf,
      },
      payload: {},
    });
    record('CLD-ORIG-02', 'Accept matching preview branch origin https://preview-branch-99.vercel.app', r2.statusCode === 200, r2.statusCode, 200);

    const r3 = await postCloudDemo({ origin: 'https://preview-branch-99.vercel.app' });
    record('CLD-ORIG-03', 'Reject preview origin when Host header is production (origin/host mismatch)', r3.statusCode === 403 && r3.json()?.error?.code === 'INVALID_ORIGIN', r3.statusCode, 403, r3.json()?.error?.code, 'INVALID_ORIGIN');

    const r4 = await postCloudDemo({ origin: 'http://steam-cloud-manager.vercel.app' });
    record('CLD-ORIG-04', 'Reject insecure HTTP origin http://steam-cloud-manager.vercel.app', r4.statusCode === 403 && r4.json()?.error?.code === 'INVALID_ORIGIN', r4.statusCode, 403, r4.json()?.error?.code, 'INVALID_ORIGIN');

    const r5 = await postCloudDemo({ origin: 'https://steam-cloud-manager.vercel.app.biz' });
    record('CLD-ORIG-05', 'Reject spoofed TLD origin https://steam-cloud-manager.vercel.app.biz', r5.statusCode === 403 && r5.json()?.error?.code === 'INVALID_ORIGIN', r5.statusCode, 403, r5.json()?.error?.code, 'INVALID_ORIGIN');

    const r6 = await postCloudDemo({ origin: 'https://steam-cloud-manager.vercel.app:8443' });
    record('CLD-ORIG-06', 'Reject arbitrary port origin https://steam-cloud-manager.vercel.app:8443', r6.statusCode === 403 && r6.json()?.error?.code === 'INVALID_ORIGIN', r6.statusCode, 403, r6.json()?.error?.code, 'INVALID_ORIGIN');

    const r7 = await postCloudDemo({ origin: 'null' });
    record('CLD-ORIG-07', 'Reject Origin: null in cloud environment', r7.statusCode === 403 && r7.json()?.error?.code === 'INVALID_ORIGIN', r7.statusCode, 403, r7.json()?.error?.code, 'INVALID_ORIGIN');

    const r8 = await postCloudDemo({ origin: '"null"' });
    record('CLD-ORIG-08', 'Reject Origin: string "null" in cloud environment', r8.statusCode === 403 && r8.json()?.error?.code === 'INVALID_ORIGIN', r8.statusCode, 403, r8.json()?.error?.code, 'INVALID_ORIGIN');

    const r9 = await postCloudDemo({ origin: 'https://vercel.app' });
    record('CLD-ORIG-09', 'Reject apex vercel.app origin https://vercel.app', r9.statusCode === 403 && r9.json()?.error?.code === 'INVALID_ORIGIN', r9.statusCode, 403, r9.json()?.error?.code, 'INVALID_ORIGIN');
  }

  await cloudApp.close();
  delete process.env.VERCEL;
  delete process.env.SCM_SESSION_KEY;

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n================================================================');
  console.log('            CREATIVE ADVERSARIAL SUITE SUMMARY                  ');
  console.log('================================================================');
  const total = results.length;
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  console.log(`Total Creative Scenarios: ${total}`);
  console.log(`Passed:                   ${passedCount} (${((passedCount / total) * 100).toFixed(1)}%)`);
  console.log(`Failed:                   ${failedCount} (${((failedCount / total) * 100).toFixed(1)}%)`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

void runCreativeSuite();

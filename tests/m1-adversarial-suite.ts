import assert from 'node:assert/strict';
import http from 'node:http';
import { readConfig } from '../src/server/config.js';
import { buildApp } from '../src/server/app.js';
import handler, { closeAppForTesting } from '../api/index.js';

interface TestResult {
  category: string;
  id: string;
  description: string;
  passed: boolean;
  actualStatus?: number | string;
  expectedStatus?: number | string;
  actualCode?: string;
  expectedCode?: string;
  details?: string;
}

const results: TestResult[] = [];

async function recordTest(
  category: string,
  id: string,
  description: string,
  fn: () => Promise<{ passed: boolean; actualStatus?: number | string; expectedStatus?: number | string; actualCode?: string; expectedCode?: string; details?: string }>,
) {
  try {
    const outcome = await fn();
    results.push({ category, id, description, ...outcome });
    const mark = outcome.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${mark}] ${id}: ${description}`);
    if (!outcome.passed) {
      console.log(`       Expected: status=${outcome.expectedStatus} code=${outcome.expectedCode}`);
      console.log(`       Actual:   status=${outcome.actualStatus} code=${outcome.actualCode} ${outcome.details || ''}`);
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    results.push({
      category,
      id,
      description,
      passed: false,
      details: `Exception: ${errorMsg}`,
    });
    console.log(`[✗ FAIL] ${id}: ${description}`);
    console.log(`       Exception thrown: ${errorMsg}`);
  }
}

async function runAdversarialSuite() {
  console.log('================================================================');
  console.log('       MILESTONE 1 EMPIRICAL ADVERSARIAL STRESS TEST SUITE       ');
  console.log('================================================================\n');

  const config = readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000' });
  let clock = Date.now();
  const app = await buildApp({
    config,
    now: () => clock,
  });

  // Helper to establish a valid user session
  async function createSession(host = '127.0.0.1:3000') {
    const res = await app.inject({ url: '/api/session', headers: { host } });
    const setCookie = res.headers['set-cookie'] as string;
    const cookie = setCookie ? setCookie.split(';')[0] : '';
    const csrfToken = res.json().csrfToken as string;
    return {
      cookie,
      csrfToken,
      headers: {
        host,
        cookie,
        origin: config.appOrigin,
        'x-csrf-token': csrfToken,
      },
    };
  }

  // =========================================================================
  // CATEGORY 1: HOST HEADER FORGERY
  // =========================================================================
  console.log('\n--- Category 1: Host Header Forgery ---');

  await recordTest('Host Header Forgery', 'HOST-01', 'Reject external forged host attacker.com', async () => {
    const res = await app.inject({ url: '/api/health', headers: { host: 'attacker.com' } });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'INVALID_HOST',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'INVALID_HOST',
    };
  });

  await recordTest('Host Header Forgery', 'HOST-02', 'Reject evil-vercel.app (hyphenated subdomain)', async () => {
    const res = await app.inject({ url: '/api/health', headers: { host: 'evil-vercel.app' } });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'INVALID_HOST',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'INVALID_HOST',
    };
  });

  await recordTest('Host Header Forgery', 'HOST-03', 'Reject evil.vercel.app when running locally (VERCEL not set)', async () => {
    const res = await app.inject({ url: '/api/health', headers: { host: 'evil.vercel.app' } });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'INVALID_HOST',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'INVALID_HOST',
    };
  });

  await recordTest('Host Header Forgery', 'HOST-04', 'Reject unauthorized loopback port localhost:9999 (configured: 3000)', async () => {
    const res = await app.inject({ url: '/api/health', headers: { host: 'localhost:9999' } });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'INVALID_HOST',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'INVALID_HOST',
      details: res.statusCode === 200 ? 'VULNERABILITY: localhost:9999 was accepted with 200 OK!' : undefined,
    };
  });

  await recordTest('Host Header Forgery', 'HOST-05', 'Reject unauthorized loopback port 127.0.0.1:9999 (configured: 3000)', async () => {
    const res = await app.inject({ url: '/api/health', headers: { host: '127.0.0.1:9999' } });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'INVALID_HOST',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'INVALID_HOST',
      details: res.statusCode === 200 ? 'VULNERABILITY: 127.0.0.1:9999 was accepted with 200 OK!' : undefined,
    };
  });

  await recordTest('Host Header Forgery', 'HOST-06', 'Reject malformed host header with spaces or invalid syntax', async () => {
    const res = await app.inject({ url: '/api/health', headers: { host: 'malformed host injected.com' } });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'INVALID_HOST',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'INVALID_HOST',
    };
  });

  await recordTest('Host Header Forgery', 'HOST-07', 'Reject external host with legitimate port attacker.com:3000', async () => {
    const res = await app.inject({ url: '/api/health', headers: { host: 'attacker.com:3000' } });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'INVALID_HOST',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'INVALID_HOST',
    };
  });

  await recordTest('Host Header Forgery', 'HOST-08', 'Reject unverified X-Forwarded-Host spoofing without trusted proxy', async () => {
    // When trustProxy is disabled, X-Forwarded-Host: 127.0.0.1:3000 should NOT allow Host: attacker.com
    const res = await app.inject({
      url: '/api/health',
      headers: {
        host: 'attacker.com',
        'x-forwarded-host': '127.0.0.1:3000',
      },
    });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'INVALID_HOST',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'INVALID_HOST',
      details: res.statusCode === 200 ? 'VULNERABILITY: Spoofed X-Forwarded-Host bypassed Host check!' : undefined,
    };
  });

  await recordTest('Host Header Forgery', 'HOST-09', 'Accept legitimate local host localhost:3000', async () => {
    const res = await app.inject({ url: '/api/health', headers: { host: 'localhost:3000' } });
    return {
      passed: res.statusCode === 200,
      actualStatus: res.statusCode,
      expectedStatus: 200,
    };
  });

  await recordTest('Host Header Forgery', 'HOST-10', 'Accept legitimate local host 127.0.0.1:3000', async () => {
    const res = await app.inject({ url: '/api/health', headers: { host: '127.0.0.1:3000' } });
    return {
      passed: res.statusCode === 200,
      actualStatus: res.statusCode,
      expectedStatus: 200,
    };
  });

  // Vercel production mode host tests
  const prevVercel = process.env.VERCEL;
  process.env.VERCEL = '1';
  process.env.SCM_SESSION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const vercelConfig = readConfig();
  const vercelApp = await buildApp({ config: vercelConfig });

  await recordTest('Host Header Forgery', 'HOST-11', 'Vercel mode: Reject localhost:9999 in cloud environment', async () => {
    const res = await vercelApp.inject({ url: '/api/health', headers: { host: 'localhost:9999' } });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'INVALID_HOST',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'INVALID_HOST',
      details: res.statusCode === 200 ? 'VULNERABILITY: localhost:9999 accepted in Vercel mode!' : undefined,
    };
  });

  await recordTest('Host Header Forgery', 'HOST-12', 'Vercel mode: Accept production host steam-cloud-manager.vercel.app', async () => {
    const res = await vercelApp.inject({ url: '/api/health', headers: { host: 'steam-cloud-manager.vercel.app' } });
    return {
      passed: res.statusCode === 200,
      actualStatus: res.statusCode,
      expectedStatus: 200,
    };
  });

  await recordTest('Host Header Forgery', 'HOST-13', 'Vercel mode: Accept preview host branch.vercel.app', async () => {
    const res = await vercelApp.inject({ url: '/api/health', headers: { host: 'scm-preview-git-fix.vercel.app' } });
    return {
      passed: res.statusCode === 200,
      actualStatus: res.statusCode,
      expectedStatus: 200,
    };
  });

  await recordTest('Host Header Forgery', 'HOST-14', 'Vercel mode: Reject external host attacker.com', async () => {
    const res = await vercelApp.inject({ url: '/api/health', headers: { host: 'attacker.com' } });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'INVALID_HOST',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'INVALID_HOST',
    };
  });

  await vercelApp.close();
  if (prevVercel !== undefined) process.env.VERCEL = prevVercel;
  else delete process.env.VERCEL;

  // =========================================================================
  // CATEGORY 2: ORIGIN HEADER FORGERY & SEC-FETCH-SITE
  // =========================================================================
  console.log('\n--- Category 2: Origin Header Forgery & Sec-Fetch-Site ---');

  const session1 = await createSession();

  await recordTest('Origin & Sec-Fetch-Site', 'ORIG-01', 'Reject cross-origin POST /api/auth/demo (attacker.example)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/demo',
      headers: {
        ...session1.headers,
        origin: 'https://attacker.example',
      },
      payload: {},
    });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'INVALID_ORIGIN',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'INVALID_ORIGIN',
    };
  });

  await recordTest('Origin & Sec-Fetch-Site', 'ORIG-02', 'Reject cross-origin POST /api/auth/steam (attacker.example)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/steam',
      headers: {
        ...session1.headers,
        origin: 'https://attacker.example',
      },
      payload: {},
    });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'INVALID_ORIGIN',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'INVALID_ORIGIN',
    };
  });

  await recordTest('Origin & Sec-Fetch-Site', 'ORIG-03', 'Reject null origin on POST /api/auth/demo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/demo',
      headers: {
        ...session1.headers,
        origin: 'null',
      },
      payload: {},
    });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'INVALID_ORIGIN',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'INVALID_ORIGIN',
    };
  });

  await recordTest('Origin & Sec-Fetch-Site', 'ORIG-04', 'Reject cross-site sec-fetch-site on POST /api/auth/demo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/demo',
      headers: {
        ...session1.headers,
        'sec-fetch-site': 'cross-site',
      },
      payload: {},
    });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'CROSS_SITE_REQUEST',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'CROSS_SITE_REQUEST',
    };
  });

  await recordTest('Origin & Sec-Fetch-Site', 'ORIG-05', 'Reject cross-site sec-fetch-site on GET /api/session', async () => {
    const res = await app.inject({
      url: '/api/session',
      headers: {
        host: '127.0.0.1:3000',
        'sec-fetch-site': 'cross-site',
      },
    });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'CROSS_SITE_REQUEST',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'CROSS_SITE_REQUEST',
    };
  });

  await recordTest('Origin & Sec-Fetch-Site', 'ORIG-06', 'Reject cross-site sec-fetch-site on GET /api/games', async () => {
    const res = await app.inject({
      url: '/api/games',
      headers: {
        ...session1.headers,
        'sec-fetch-site': 'cross-site',
      },
    });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'CROSS_SITE_REQUEST',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'CROSS_SITE_REQUEST',
    };
  });

  await recordTest('Origin & Sec-Fetch-Site', 'ORIG-07', 'Accept legitimate same-origin POST /api/auth/demo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/demo',
      headers: {
        ...session1.headers,
        'sec-fetch-site': 'same-origin',
      },
      payload: {},
    });
    return {
      passed: res.statusCode === 200 && res.json()?.mode === 'demo',
      actualStatus: res.statusCode,
      expectedStatus: 200,
    };
  });

  // =========================================================================
  // CATEGORY 3: CSRF FORGERY
  // =========================================================================
  console.log('\n--- Category 3: CSRF Forgery ---');

  const session2 = await createSession();
  const session3 = await createSession();

  await recordTest('CSRF Forgery', 'CSRF-01', 'Reject POST /api/auth/demo with missing x-csrf-token', async () => {
    const headers = { ...session2.headers };
    delete (headers as Record<string, string>)['x-csrf-token'];
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/demo',
      headers,
      payload: {},
    });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'CSRF_FAILED',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'CSRF_FAILED',
    };
  });

  await recordTest('CSRF Forgery', 'CSRF-02', 'Reject POST /api/auth/demo with empty x-csrf-token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/demo',
      headers: { ...session2.headers, 'x-csrf-token': '' },
      payload: {},
    });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'CSRF_FAILED',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'CSRF_FAILED',
    };
  });

  await recordTest('CSRF Forgery', 'CSRF-03', 'Reject POST /api/auth/demo with mismatched x-csrf-token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/demo',
      headers: { ...session2.headers, 'x-csrf-token': 'attacker-arbitrary-csrf-token' },
      payload: {},
    });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'CSRF_FAILED',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'CSRF_FAILED',
    };
  });

  await recordTest('CSRF Forgery', 'CSRF-04', 'Reject POST /api/auth/demo with 1-byte altered x-csrf-token', async () => {
    const original = session2.csrfToken;
    const tampered = original.slice(0, -1) + (original.slice(-1) === 'a' ? 'b' : 'a');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/demo',
      headers: { ...session2.headers, 'x-csrf-token': tampered },
      payload: {},
    });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'CSRF_FAILED',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'CSRF_FAILED',
    };
  });

  await recordTest('CSRF Forgery', 'CSRF-05', 'Reject POST /api/auth/demo with valid token from another session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/demo',
      headers: { ...session2.headers, 'x-csrf-token': session3.csrfToken },
      payload: {},
    });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'CSRF_FAILED',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'CSRF_FAILED',
    };
  });

  await recordTest('CSRF Forgery', 'CSRF-06', 'Reject POST /api/auth/logout with missing CSRF token', async () => {
    const headers = { ...session2.headers };
    delete (headers as Record<string, string>)['x-csrf-token'];
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers,
      payload: {},
    });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 403 && code === 'CSRF_FAILED',
      actualStatus: res.statusCode,
      expectedStatus: 403,
      actualCode: code,
      expectedCode: 'CSRF_FAILED',
    };
  });

  // =========================================================================
  // CATEGORY 4: TWO-PHASE DELETION REPLAY PREVENTION & OPTIMISTIC LOCKING
  // =========================================================================
  console.log('\n--- Category 4: Two-Phase Deletion Replay Prevention & Optimistic Locking ---');

  const demoUser = await createSession();
  await app.inject({ method: 'POST', url: '/api/auth/demo', headers: demoUser.headers, payload: {} });

  const bg3AppId = 1086940; // Baldur's Gate 3
  const bg3FilesRes = await app.inject({ url: `/api/games/${bg3AppId}/files`, headers: demoUser.headers });
  const bg3Listing = bg3FilesRes.json();
  const fileToDelete = bg3Listing.files[0].name;

  let planId = '';
  let confirmation = '';

  await recordTest('Two-Phase Deletion', 'DEL-01', 'Generate review-plan token with optimistic file revision', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${bg3AppId}/delete-plan`,
      headers: demoUser.headers,
      payload: { names: [fileToDelete], revision: bg3Listing.revision },
    });
    const body = res.json();
    planId = body.planId;
    confirmation = body.confirmation;
    return {
      passed: res.statusCode === 200 && typeof planId === 'string' && planId.length > 50 && typeof confirmation === 'string',
      actualStatus: res.statusCode,
      expectedStatus: 200,
    };
  });

  await recordTest('Two-Phase Deletion', 'DEL-02', 'Execute deletion once with valid confirmation and gamesClosed flag', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${bg3AppId}/delete`,
      headers: demoUser.headers,
      payload: { planId, confirmation, gamesClosed: true },
    });
    const body = res.json();
    return {
      passed: res.statusCode === 200 && Array.isArray(body.deleted) && body.deleted.includes(fileToDelete) && body.batchCompleted === true,
      actualStatus: res.statusCode,
      expectedStatus: 200,
    };
  });

  await recordTest('Two-Phase Deletion', 'DEL-03', 'Verify catalog updated and deleted file no longer listed', async () => {
    const res = await app.inject({ url: `/api/games/${bg3AppId}/files`, headers: demoUser.headers });
    const listing = res.json();
    const stillPresent = listing.files.some((f: { name: string }) => f.name === fileToDelete);
    return {
      passed: res.statusCode === 200 && !stillPresent && listing.revision !== bg3Listing.revision,
      actualStatus: res.statusCode,
      expectedStatus: 200,
      details: stillPresent ? 'File was not deleted from listing!' : undefined,
    };
  });

  await recordTest('Two-Phase Deletion', 'DEL-04', 'Replay identical planId token: verify rejection with 409 FILES_CHANGED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${bg3AppId}/delete`,
      headers: demoUser.headers,
      payload: { planId, confirmation, gamesClosed: true },
    });
    const body = res.json();
    const code = body?.error?.code;
    return {
      passed: res.statusCode === 409 && (code === 'FILES_CHANGED' || code === 'PLAN_EXPIRED'),
      actualStatus: res.statusCode,
      expectedStatus: 409,
      actualCode: code,
      expectedCode: 'FILES_CHANGED',
    };
  });

  await recordTest('Two-Phase Deletion', 'DEL-05', 'Replay rejection does NOT delete any files or corrupt catalog', async () => {
    const res = await app.inject({ url: `/api/games/${bg3AppId}/files`, headers: demoUser.headers });
    const listing = res.json();
    // Initially BG3 had 2 files. After deleting 1, it must have exactly 1 file remaining.
    return {
      passed: listing.files.length === 1,
      actualStatus: listing.files.length,
      expectedStatus: 1,
      details: `Remaining files count: ${listing.files.length}`,
    };
  });

  await recordTest('Two-Phase Deletion', 'DEL-06', 'Reject delete request with confirmation phrase mismatch', async () => {
    // Generate new plan for remaining file
    const listingRes = await app.inject({ url: `/api/games/${bg3AppId}/files`, headers: demoUser.headers });
    const listing = listingRes.json();
    const planRes = await app.inject({
      method: 'POST',
      url: `/api/games/${bg3AppId}/delete-plan`,
      headers: demoUser.headers,
      payload: { names: [listing.files[0].name], revision: listing.revision },
    });
    const newPlan = planRes.json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${bg3AppId}/delete`,
      headers: demoUser.headers,
      payload: { planId: newPlan.planId, confirmation: 'WRONG_CONFIRMATION', gamesClosed: true },
    });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 400 && code === 'CONFIRMATION_MISMATCH',
      actualStatus: res.statusCode,
      expectedStatus: 400,
      actualCode: code,
      expectedCode: 'CONFIRMATION_MISMATCH',
    };
  });

  await recordTest('Two-Phase Deletion', 'DEL-07', 'Reject delete request without gamesClosed: true', async () => {
    const listingRes = await app.inject({ url: `/api/games/${bg3AppId}/files`, headers: demoUser.headers });
    const listing = listingRes.json();
    const planRes = await app.inject({
      method: 'POST',
      url: `/api/games/${bg3AppId}/delete-plan`,
      headers: demoUser.headers,
      payload: { names: [listing.files[0].name], revision: listing.revision },
    });
    const newPlan = planRes.json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${bg3AppId}/delete`,
      headers: demoUser.headers,
      payload: { planId: newPlan.planId, confirmation: newPlan.confirmation, gamesClosed: false },
    });
    return {
      passed: res.statusCode === 400,
      actualStatus: res.statusCode,
      expectedStatus: 400,
    };
  });

  await recordTest('Two-Phase Deletion', 'DEL-08', 'Cross-game plan replay: reject planId used on another appId', async () => {
    const listingRes = await app.inject({ url: `/api/games/${bg3AppId}/files`, headers: demoUser.headers });
    const listing = listingRes.json();
    const planRes = await app.inject({
      method: 'POST',
      url: `/api/games/${bg3AppId}/delete-plan`,
      headers: demoUser.headers,
      payload: { names: [listing.files[0].name], revision: listing.revision },
    });
    const plan = planRes.json();
    // Send to Cities: Skylines II (949230)
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/949230/delete`,
      headers: demoUser.headers,
      payload: { planId: plan.planId, confirmation: plan.confirmation, gamesClosed: true },
    });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 409 && code === 'PLAN_EXPIRED',
      actualStatus: res.statusCode,
      expectedStatus: 409,
      actualCode: code,
      expectedCode: 'PLAN_EXPIRED',
    };
  });

  await recordTest('Two-Phase Deletion', 'DEL-09', 'Expired plan replay: clock advancement past TTL invalidates plan', async () => {
    const listingRes = await app.inject({ url: `/api/games/${bg3AppId}/files`, headers: demoUser.headers });
    const listing = listingRes.json();
    const planRes = await app.inject({
      method: 'POST',
      url: `/api/games/${bg3AppId}/delete-plan`,
      headers: demoUser.headers,
      payload: { names: [listing.files[0].name], revision: listing.revision },
    });
    const plan = planRes.json();
    clock += 6 * 60_000; // Advance 6 minutes (TTL is 5 minutes)
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${bg3AppId}/delete`,
      headers: demoUser.headers,
      payload: { planId: plan.planId, confirmation: plan.confirmation, gamesClosed: true },
    });
    const code = res.json()?.error?.code;
    return {
      passed: res.statusCode === 409 && code === 'PLAN_EXPIRED',
      actualStatus: res.statusCode,
      expectedStatus: 409,
      actualCode: code,
      expectedCode: 'PLAN_EXPIRED',
    };
  });

  // =========================================================================
  // CATEGORY 5: DEMO MODE SESSION ISOLATION & CONCURRENCY
  // =========================================================================
  console.log('\n--- Category 5: Demo Mode Session Isolation & Multi-User Concurrency ---');

  async function createIndependentDemoUser() {
    const sess = await createSession();
    await app.inject({ method: 'POST', url: '/api/auth/demo', headers: sess.headers, payload: {} });
    return {
      headers: sess.headers,
      listFiles: async (appId: number) => (await app.inject({ url: `/api/games/${appId}/files`, headers: sess.headers })).json(),
      deleteFile: async (appId: number, fileName: string) => {
        const listing = (await app.inject({ url: `/api/games/${appId}/files`, headers: sess.headers })).json();
        const plan = (await app.inject({
          method: 'POST',
          url: `/api/games/${appId}/delete-plan`,
          headers: sess.headers,
          payload: { names: [fileName], revision: listing.revision },
        })).json();
        return (await app.inject({
          method: 'POST',
          url: `/api/games/${appId}/delete`,
          headers: sess.headers,
          payload: { planId: plan.planId, confirmation: plan.confirmation, gamesClosed: true },
        })).json();
      },
    };
  }

  const userA = await createIndependentDemoUser();
  const userB = await createIndependentDemoUser();
  const userC = await createIndependentDemoUser();

  await recordTest('Session Isolation', 'ISO-01', 'Concurrent file mutation in User A does not affect User B or User C', async () => {
    // User A deletes 'Saves/Cedar Valley.cok' from Cities: Skylines II (949230)
    await userA.deleteFile(949230, 'Saves/Cedar Valley.cok');

    // User B deletes 'Save_01.lsv' from Baldur's Gate 3 (1086940)
    await userB.deleteFile(1086940, 'Save_01.lsv');

    // Inspect User A
    const aC2 = (await userA.listFiles(949230)).files.map((f: { name: string }) => f.name);
    const aBG3 = (await userA.listFiles(1086940)).files.map((f: { name: string }) => f.name);

    // Inspect User B
    const bC2 = (await userB.listFiles(949230)).files.map((f: { name: string }) => f.name);
    const bBG3 = (await userB.listFiles(1086940)).files.map((f: { name: string }) => f.name);

    // Inspect User C (pure observer)
    const cC2 = (await userC.listFiles(949230)).files.map((f: { name: string }) => f.name);
    const cBG3 = (await userC.listFiles(1086940)).files.map((f: { name: string }) => f.name);

    const userACorrect = !aC2.includes('Saves/Cedar Valley.cok') && aBG3.length === 2;
    const userBCorrect = bC2.includes('Saves/Cedar Valley.cok') && bC2.length === 6 && !bBG3.includes('Save_01.lsv') && bBG3.length === 1;
    const userCCorrect = cC2.length === 6 && cBG3.length === 2;

    return {
      passed: userACorrect && userBCorrect && userCCorrect,
      details: `User A (C2=${aC2.length}, BG3=${aBG3.length}); User B (C2=${bC2.length}, BG3=${bBG3.length}); User C (C2=${cC2.length}, BG3=${cBG3.length})`,
    };
  });

  await recordTest('Session Isolation', 'ISO-02', 'Download isolation: User A cannot download deleted file, User B can', async () => {
    const dlUserA = await app.inject({
      url: `/api/games/949230/download?name=${encodeURIComponent('Saves/Cedar Valley.cok')}`,
      headers: userA.headers,
    });
    const dlUserB = await app.inject({
      url: `/api/games/949230/download?name=${encodeURIComponent('Saves/Cedar Valley.cok')}`,
      headers: userB.headers,
    });
    return {
      passed: dlUserA.statusCode === 404 && dlUserB.statusCode === 200,
      actualStatus: `UserA=${dlUserA.statusCode}, UserB=${dlUserB.statusCode}`,
      expectedStatus: 'UserA=404, UserB=200',
    };
  });

  await app.close();

  // =========================================================================
  // CATEGORY 6: SERVERLESS HANDLER CONCURRENCY & FLUID COMPUTE REUSE
  // =========================================================================
  console.log('\n--- Category 6: Serverless Handler Concurrency & Fluid Compute Warm Reuse ---');

  process.env.VERCEL = '1';
  process.env.SCM_SESSION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  const server = http.createServer((req, res) => {
    void handler(req, res);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const initialHeap = process.memoryUsage().heapUsed;

  async function executeBurst(size: number, burstId: number) {
    const start = performance.now();
    const tasks = Array.from({ length: size }, async () => {
      const sRes = await fetch(`${baseUrl}/api/session`, {
        headers: { 'x-forwarded-host': 'steam-cloud-manager.vercel.app' },
      });
      const cookie = sRes.headers.get('set-cookie')?.split(';')[0];
      const sData = await sRes.json();

      const hRes = await fetch(`${baseUrl}/api/health`, {
        headers: { 'x-forwarded-host': 'steam-cloud-manager.vercel.app' },
      });
      const hData = await hRes.json();

      return sRes.status === 200 && hRes.status === 200 && Boolean(sData.csrfToken) && hData.status === 'ok';
    });

    const resultsArr = await Promise.all(tasks);
    const passed = resultsArr.filter(Boolean).length;
    const elapsed = performance.now() - start;
    return { passed, total: size, elapsed };
  }

  await recordTest('Serverless Concurrency', 'BURST-01', 'Cold burst: 30 concurrent invocations across session & health endpoints', async () => {
    const b1 = await executeBurst(30, 1);
    return {
      passed: b1.passed === 30,
      actualStatus: `${b1.passed}/30 in ${b1.elapsed.toFixed(1)}ms`,
      expectedStatus: '30/30',
    };
  });

  await recordTest('Serverless Concurrency', 'BURST-02', 'Warm burst 1: 30 concurrent invocations reusing warm Fastify instance', async () => {
    const b2 = await executeBurst(30, 2);
    return {
      passed: b2.passed === 30,
      actualStatus: `${b2.passed}/30 in ${b2.elapsed.toFixed(1)}ms`,
      expectedStatus: '30/30',
    };
  });

  await recordTest('Serverless Concurrency', 'BURST-03', 'Warm burst 2: 30 concurrent invocations verifying memory stability', async () => {
    const b3 = await executeBurst(30, 3);
    const finalHeap = process.memoryUsage().heapUsed;
    const deltaMb = (finalHeap - initialHeap) / (1024 * 1024);
    return {
      passed: b3.passed === 30 && deltaMb < 50, // Heap growth under 50MB
      actualStatus: `${b3.passed}/30, Heap delta=${deltaMb.toFixed(2)}MB`,
      expectedStatus: '30/30, delta < 50MB',
    };
  });

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeAppForTesting();

  // =========================================================================
  // SUMMARY REPORT
  // =========================================================================
  console.log('\n================================================================');
  console.log('                   VERIFICATION SUMMARY                         ');
  console.log('================================================================');
  const total = results.length;
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  console.log(`Total Scenarios Tested: ${total}`);
  console.log(`Passed:                 ${passedCount} (${((passedCount / total) * 100).toFixed(1)}%)`);
  console.log(`Failed:                 ${failedCount} (${((failedCount / total) * 100).toFixed(1)}%)`);

  if (failedCount > 0) {
    console.log('\n--- FAILED SCENARIOS ---');
    for (const f of results.filter((r) => !r.passed)) {
      console.log(`✖ [${f.id}] ${f.description}`);
      console.log(`    Expected: status=${f.expectedStatus} code=${f.expectedCode}`);
      console.log(`    Actual:   status=${f.actualStatus} code=${f.actualCode}`);
      if (f.details) console.log(`    Details:  ${f.details}`);
    }
  }

  console.log('\n================================================================\n');
}

runAdversarialSuite().catch((err) => {
  console.error('Fatal suite error:', err);
  process.exit(1);
});

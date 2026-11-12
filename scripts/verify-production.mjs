#!/usr/bin/env node
/**
 * scripts/verify-production.mjs
 * Comprehensive automated probe for live production deployment on Vercel.
 *
 * Probes:
 *   1. GET /                      -> 200, HTML, title contains "Steam Cloud Manager", no legacy install text
 *   2. GET /api/health            -> 200, status 'ok', uptime/version checks if provided
 *   3. GET /api/session           -> 200, csrfToken returned, session cookie set (__Host-scm or scm-session)
 *   4. POST /api/auth/demo        -> 200, login.status 'connected', user 'Demo Account', mode 'demo'
 *   5. GET /api/games             -> 200, game library with Cities: Skylines II, ELDEN RING, Baldur's Gate 3
 *   6. GET /api/games/949230/files-> 200, 6 save files with revision string
 *   7. POST /api/auth/logout      -> 200, login.status 'disconnected', destroys session
 *   8. GET /api/games (post-out)  -> 401 Unauthorized, verifies session destruction
 *   9. Security Headers           -> CSP, X-Content-Type-Options: nosniff, anti-framing protection
 */

import assert from 'node:assert/strict';

const targetUrl = (
  process.env.PROD_URL ||
  process.env.BASE_URL ||
  process.argv[2] ||
  'https://steam-cloud-manager.vercel.app'
).replace(/\/+$/, '');

console.log('='.repeat(70));
console.log(`🚀 SCM LIVE PRODUCTION CLOUD PROBE`);
console.log(`🎯 Target URL: ${targetUrl}`);
console.log(`⏱️  Timestamp:  ${new Date().toISOString()}`);
console.log('='.repeat(70) + '\n');

const cookieJar = new Map();

function storeCookies(response) {
  const rawHeaders = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);

  for (const str of rawHeaders) {
    const pair = str.split(';')[0].trim();
    const idx = pair.indexOf('=');
    if (idx !== -1) {
      const name = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      cookieJar.set(name, val);
    }
  }
}

function getCookieHeader() {
  return Array.from(cookieJar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function verifySecurityHeaders(response, contextDescription) {
  const headers = response.headers;

  const nosniff = headers.get('x-content-type-options');
  assert.equal(
    nosniff,
    'nosniff',
    `[${contextDescription}] Expected X-Content-Type-Options: nosniff, got: ${nosniff}`,
  );

  const csp = headers.get('content-security-policy') || '';
  const xfo = headers.get('x-frame-options');
  const frameProtected =
    (xfo && xfo.toUpperCase() === 'DENY') ||
    csp.includes("frame-ancestors 'none'") ||
    csp.includes("frame-ancestors 'self'");
  assert.ok(
    frameProtected,
    `[${contextDescription}] Expected anti-framing protection (X-Frame-Options: DENY or CSP frame-ancestors), got XFO: ${xfo}, CSP: ${csp}`,
  );

  assert.ok(
    csp.length > 0,
    `[${contextDescription}] Expected Content-Security-Policy header to be present`,
  );
}

async function runProbe() {
  const startTime = Date.now();

  // ---------------------------------------------------------------------------
  // Step 1: Probe Root HTML endpoint (GET /)
  // ---------------------------------------------------------------------------
  console.log(`[1/8] Probing root HTML endpoint: GET ${targetUrl}/`);
  const rootRes = await fetch(`${targetUrl}/`, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'User-Agent': 'SCM-Production-Probe/1.0',
    },
  });
  assert.equal(rootRes.status, 200, `Expected HTTP 200 at /, got ${rootRes.status}`);
  const rootContentType = rootRes.headers.get('content-type') || '';
  assert.ok(
    rootContentType.includes('text/html'),
    `Expected text/html content-type, got: ${rootContentType}`,
  );
  verifySecurityHeaders(rootRes, 'GET /');

  const htmlText = await rootRes.text();
  assert.ok(
    /<title>.*?Steam Cloud Manager.*?<\/title>/i.test(htmlText),
    'Expected HTML title to contain "Steam Cloud Manager"',
  );
  assert.ok(
    htmlText.includes('id="root"'),
    'Expected root container <div id="root"> for React SPA mounting',
  );

  const forbiddenPhrases = [
    'git clone',
    'npm install',
    'clone and install locally',
    'runs only on your local computer',
    'install Node.js',
  ];
  for (const phrase of forbiddenPhrases) {
    assert.ok(
      !htmlText.toLowerCase().includes(phrase.toLowerCase()),
      `HTML contains prohibited legacy instruction: "${phrase}"`,
    );
  }
  console.log('   ✓ Root HTML loaded, React SPA container present, zero install instructions.');

  // ---------------------------------------------------------------------------
  // Step 2: Probe Health Check endpoint (GET /api/health)
  // ---------------------------------------------------------------------------
  console.log(`[2/8] Probing health endpoint: GET ${targetUrl}/api/health`);
  const healthRes = await fetch(`${targetUrl}/api/health`, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'SCM-Production-Probe/1.0',
    },
  });
  assert.equal(healthRes.status, 200, `Expected HTTP 200 at /api/health, got ${healthRes.status}`);
  verifySecurityHeaders(healthRes, 'GET /api/health');

  const healthJson = await healthRes.json();
  assert.equal(healthJson.status, 'ok', `Expected health.status to be 'ok', got: ${healthJson.status}`);
  if (healthJson.uptime !== undefined) {
    assert.equal(typeof healthJson.uptime, 'number', 'Expected uptime to be a number');
  }
  if (healthJson.version !== undefined) {
    assert.equal(typeof healthJson.version, 'string', 'Expected version to be a string');
  }
  console.log(`   ✓ Health endpoint OK (status: "${healthJson.status}", mode: "${healthJson.mode ?? 'live'}").`);

  // ---------------------------------------------------------------------------
  // Step 3: Probe Session Creation (GET /api/session)
  // ---------------------------------------------------------------------------
  console.log(`[3/8] Probing session initialization: GET ${targetUrl}/api/session`);
  const sessionRes = await fetch(`${targetUrl}/api/session`, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'SCM-Production-Probe/1.0',
    },
  });
  assert.equal(sessionRes.status, 200, `Expected HTTP 200 at /api/session, got ${sessionRes.status}`);
  verifySecurityHeaders(sessionRes, 'GET /api/session');

  storeCookies(sessionRes);
  const cookieNames = Array.from(cookieJar.keys());
  const hasSessionCookie = cookieNames.some(c => c === '__Host-scm' || c === 'scm-session');
  assert.ok(
    hasSessionCookie,
    `Expected __Host-scm or scm-session cookie to be set, got cookies: ${cookieNames.join(', ')}`,
  );

  const sessionJson = await sessionRes.json();
  assert.ok(
    typeof sessionJson.csrfToken === 'string' && sessionJson.csrfToken.length > 10,
    `Expected valid csrfToken string, got: ${sessionJson.csrfToken}`,
  );
  assert.ok(sessionJson.login, 'Expected login object in session response');
  const initialCsrfToken = sessionJson.csrfToken;
  console.log(`   ✓ Session established (cookie: "${cookieNames.find(c => c.includes('scm'))}", CSRF token: ${initialCsrfToken.slice(0, 8)}...).`);

  // ---------------------------------------------------------------------------
  // Step 4: Probe 1-Click Demo Mode (POST /api/auth/demo)
  // ---------------------------------------------------------------------------
  console.log(`[4/8] Probing 1-Click Demo Mode: POST ${targetUrl}/api/auth/demo`);
  const demoRes = await fetch(`${targetUrl}/api/auth/demo`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Cookie': getCookieHeader(),
      'x-csrf-token': initialCsrfToken,
      'Origin': targetUrl,
      'Sec-Fetch-Site': 'same-origin',
      'User-Agent': 'SCM-Production-Probe/1.0',
    },
    body: JSON.stringify({}),
  });
  assert.equal(demoRes.status, 200, `Expected HTTP 200 at /api/auth/demo, got ${demoRes.status}`);
  verifySecurityHeaders(demoRes, 'POST /api/auth/demo');

  storeCookies(demoRes);
  const demoJson = await demoRes.json();
  assert.equal(demoJson.mode, 'demo', `Expected mode 'demo', got: ${demoJson.mode}`);
  assert.ok(demoJson.login, 'Expected login object in demo response');
  assert.equal(
    demoJson.login.status,
    'connected',
    `Expected login.status 'connected', got: ${demoJson.login.status}`,
  );
  assert.equal(
    demoJson.login.user?.displayName,
    'Demo Account',
    `Expected user.displayName 'Demo Account', got: ${demoJson.login.user?.displayName}`,
  );
  assert.equal(
    demoJson.login.user?.steamId,
    '76561198000000000',
    `Expected demo steamId '76561198000000000', got: ${demoJson.login.user?.steamId}`,
  );

  const activeCsrfToken = demoJson.csrfToken || initialCsrfToken;
  console.log(`   ✓ 1-Click Demo Mode active (User: "${demoJson.login.user?.displayName}", SteamID: ${demoJson.login.user?.steamId}).`);

  // ---------------------------------------------------------------------------
  // Step 5: Probe Game Library (GET /api/games)
  // ---------------------------------------------------------------------------
  console.log(`[5/8] Probing game library in Demo Mode: GET ${targetUrl}/api/games`);
  const gamesRes = await fetch(`${targetUrl}/api/games`, {
    headers: {
      'Accept': 'application/json',
      'Cookie': getCookieHeader(),
      'User-Agent': 'SCM-Production-Probe/1.0',
    },
  });
  assert.equal(gamesRes.status, 200, `Expected HTTP 200 at /api/games, got ${gamesRes.status}`);
  verifySecurityHeaders(gamesRes, 'GET /api/games');

  const gamesJson = await gamesRes.json();
  assert.ok(Array.isArray(gamesJson.games), 'Expected games array in response');
  assert.ok(gamesJson.games.length >= 3, `Expected at least 3 demo games, got: ${gamesJson.games.length}`);

  const gameNames = gamesJson.games.map(g => g.name);
  const expectedGames = ['Cities: Skylines II', 'ELDEN RING', "Baldur's Gate 3"];
  for (const expected of expectedGames) {
    assert.ok(
      gameNames.includes(expected),
      `Expected demo games to include "${expected}", found: ${gameNames.join(', ')}`,
    );
  }
  console.log(`   ✓ Game library verified (${gamesJson.games.length} games: ${gameNames.join(', ')}).`);

  // ---------------------------------------------------------------------------
  // Step 6: Probe Save File Listing (GET /api/games/949230/files)
  // ---------------------------------------------------------------------------
  console.log(`[6/8] Probing save files for Cities: Skylines II: GET ${targetUrl}/api/games/949230/files`);
  const filesRes = await fetch(`${targetUrl}/api/games/949230/files`, {
    headers: {
      'Accept': 'application/json',
      'Cookie': getCookieHeader(),
      'User-Agent': 'SCM-Production-Probe/1.0',
    },
  });
  assert.equal(filesRes.status, 200, `Expected HTTP 200 at /api/games/949230/files, got ${filesRes.status}`);
  verifySecurityHeaders(filesRes, 'GET /api/games/949230/files');

  const filesJson = await filesRes.json();
  assert.ok(Array.isArray(filesJson.files), 'Expected files array in response');
  assert.equal(filesJson.files.length, 6, `Expected 6 files for Cities: Skylines II, got: ${filesJson.files.length}`);
  assert.ok(typeof filesJson.revision === 'string' && filesJson.revision.length === 64, 'Expected 64-char SHA-256 revision hash');
  console.log(`   ✓ Save files verified (6 files, revision: ${filesJson.revision.slice(0, 12)}...).`);

  // ---------------------------------------------------------------------------
  // Step 7: Probe Session Logout (POST /api/auth/logout)
  // ---------------------------------------------------------------------------
  console.log(`[7/8] Probing session logout: POST ${targetUrl}/api/auth/logout`);
  const logoutRes = await fetch(`${targetUrl}/api/auth/logout`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Cookie': getCookieHeader(),
      'x-csrf-token': activeCsrfToken,
      'Origin': targetUrl,
      'Sec-Fetch-Site': 'same-origin',
      'User-Agent': 'SCM-Production-Probe/1.0',
    },
    body: JSON.stringify({}),
  });
  assert.equal(logoutRes.status, 200, `Expected HTTP 200 at /api/auth/logout, got ${logoutRes.status}`);
  verifySecurityHeaders(logoutRes, 'POST /api/auth/logout');

  storeCookies(logoutRes);
  const logoutJson = await logoutRes.json();
  assert.equal(
    logoutJson.login?.status,
    'disconnected',
    `Expected login.status 'disconnected', got: ${logoutJson.login?.status}`,
  );
  console.log('   ✓ Session logged out successfully, credentials cleared.');

  // ---------------------------------------------------------------------------
  // Step 8: Probe Post-Logout 401 Authorization Guard (GET /api/games)
  // ---------------------------------------------------------------------------
  console.log(`[8/8] Probing post-logout authorization boundary: GET ${targetUrl}/api/games`);
  const postLogoutRes = await fetch(`${targetUrl}/api/games`, {
    headers: {
      'Accept': 'application/json',
      'Cookie': getCookieHeader(),
      'User-Agent': 'SCM-Production-Probe/1.0',
    },
  });
  assert.equal(
    postLogoutRes.status,
    401,
    `Expected HTTP 401 Unauthorized after logout, got: ${postLogoutRes.status}`,
  );
  console.log('   ✓ Post-logout authorization guard confirmed (HTTP 401 Unauthorized).');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n' + '='.repeat(70));
  console.log(`✨ ALL 8 CLOUD PROBES PASSED PERFECTLY IN ${elapsed}s! ✨`);
  console.log(`🔒 Production deployment at ${targetUrl} is live, verified, and secure.`);
  console.log('='.repeat(70) + '\n');
}

runProbe().catch((err) => {
  console.error('\n❌ PRODUCTION CLOUD PROBE FAILED:');
  console.error(err);
  process.exit(1);
});

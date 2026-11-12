import assert from 'node:assert/strict';
import { randomBytes, createCipheriv } from 'node:crypto';
import {
  encryptToken,
  decryptToken,
  resolveEncryptionKey,
  resetEphemeralKeyForTesting,
  AAD,
  IV_LENGTH,
  AUTH_TAG_LENGTH,
  KEY_BYTES,
  MAX_TOKEN_BYTES,
  CLOCK_TOLERANCE_MS,
  type SessionTokenPayload,
  type ReviewPlanTokenPayload,
} from '../src/server/session-token.js';
import { SessionStore } from '../src/server/sessions.js';
import { DemoCloudDriver } from '../src/server/demo-driver.js';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';

async function main() {
  console.log('=== CHALLENGER E2.1: EMPIRICAL ADVERSARIAL VERIFICATION ===\n');

  // --------------------------------------------------------------------------
  // PROBE 1: Flipping ANY byte in IV, authTag, or ciphertext
  // --------------------------------------------------------------------------
  console.log('PROBE 1: Exhaustive bit-flipping across every single byte and bit...');
  const key = randomBytes(KEY_BYTES);
  const now = 1_700_000_000_000;
  const originalPayload: SessionTokenPayload = {
    purpose: 'scm-session',
    sessionId: 'sess_adversarial_test_id_12345',
    csrfToken: 'csrf_adversarial_secret_token_abcde',
    mode: 'demo',
    steamId: '76561198000000000',
    displayName: 'Adversarial Challenger',
    refreshToken: 'secret_refresh_token_xyz987',
    issuedAt: now,
    expiresAt: now + 3600_000,
  };

  const validToken = encryptToken(originalPayload, key);
  const raw = Buffer.from(validToken, 'base64url');
  console.log(`  Raw token buffer length: ${raw.length} bytes (IV: ${IV_LENGTH}, Tag: ${AUTH_TAG_LENGTH}, Ciphertext: ${raw.length - IV_LENGTH - AUTH_TAG_LENGTH})`);

  let bitFlipCount = 0;
  let uncaughtThrows = 0;
  let nonNullDecryptions = 0;

  const bitMasks = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0xFF];

  for (let byteIdx = 0; byteIdx < raw.length; byteIdx++) {
    for (const mask of bitMasks) {
      bitFlipCount++;
      const tampered = Buffer.from(raw);
      tampered[byteIdx] ^= mask;
      const tamperedToken = tampered.toString('base64url');

      try {
        const result = decryptToken(tamperedToken, key, 'scm-session', now + 1000);
        if (result !== null) {
          nonNullDecryptions++;
          console.error(`  FAIL: Tampered byte ${byteIdx} mask 0x${mask.toString(16)} decrypted to non-null!`);
        }
      } catch (err) {
        uncaughtThrows++;
        console.error(`  FAIL: Tampered byte ${byteIdx} mask 0x${mask.toString(16)} threw uncaught error:`, err);
      }
    }
  }

  console.log(`  Tested ${bitFlipCount} byte/bit mutations across all offsets (0..${raw.length - 1}).`);
  assert.equal(uncaughtThrows, 0, 'Uncaught exceptions during bit-flipping probe');
  assert.equal(nonNullDecryptions, 0, 'Non-null return values during bit-flipping probe');
  console.log('  ✔ PROBE 1 PASSED: 100% of bit-flip mutations strictly returned null without throwing.');

  // Truncation probe: lengths 0 to raw.length - 1
  console.log('\nPROBE 1B: Truncation boundary fuzzing...');
  for (let len = 0; len < raw.length; len++) {
    const truncated = raw.subarray(0, len).toString('base64url');
    const res = decryptToken(truncated, key, 'scm-session', now + 1000);
    assert.equal(res, null, `Truncated token of length ${len} did not return null`);
  }
  console.log('  ✔ PROBE 1B PASSED: All truncations strictly return null.');

  // Extension probe
  console.log('\nPROBE 1C: Ciphertext extension fuzzing...');
  for (let extra = 1; extra <= 32; extra++) {
    const extended = Buffer.concat([raw, randomBytes(extra)]).toString('base64url');
    const res = decryptToken(extended, key, 'scm-session', now + 1000);
    assert.equal(res, null, `Extended token (+${extra} bytes) did not return null`);
  }
  console.log('  ✔ PROBE 1C PASSED: All extensions strictly return null.');

  // --------------------------------------------------------------------------
  // PROBE 2: Key derivation properly rejects non-43-char base64url keys
  // --------------------------------------------------------------------------
  console.log('\nPROBE 2: Key derivation rejection of invalid keys in production...');

  // Unset SCM_SESSION_KEY in production
  assert.throws(
    () => resolveEncryptionKey({ NODE_ENV: 'production' }),
    /SCM_SESSION_KEY must be configured in production and Vercel environments/,
  );
  assert.throws(
    () => resolveEncryptionKey({ VERCEL: '1' }),
    /SCM_SESSION_KEY must be configured in production and Vercel environments/,
  );
  assert.throws(
    () => resolveEncryptionKey({ VERCEL: 'true' }),
    /SCM_SESSION_KEY must be configured in production and Vercel environments/,
  );

  // Non-43 characters: 42 chars
  assert.throws(
    () => resolveEncryptionKey({ SCM_SESSION_KEY: 'A'.repeat(42), NODE_ENV: 'production' }),
    /SCM_SESSION_KEY must contain exactly 32 random bytes encoded as a 43-character base64url string/,
  );

  // Non-43 characters: 44 chars (e.g. standard base64 with padding)
  assert.throws(
    () => resolveEncryptionKey({ SCM_SESSION_KEY: 'A'.repeat(44), NODE_ENV: 'production' }),
    /SCM_SESSION_KEY must contain exactly 32 random bytes encoded as a 43-character base64url string/,
  );
  assert.throws(
    () => resolveEncryptionKey({ SCM_SESSION_KEY: 'A'.repeat(43) + '=', NODE_ENV: 'production' }),
    /SCM_SESSION_KEY must contain exactly 32 random bytes encoded as a 43-character base64url string/,
  );

  // 43 chars with illegal characters (+, /, space, punctuation)
  assert.throws(
    () => resolveEncryptionKey({ SCM_SESSION_KEY: 'A'.repeat(42) + '+', NODE_ENV: 'production' }),
    /SCM_SESSION_KEY must contain exactly 32 random bytes encoded as a 43-character base64url string/,
  );
  assert.throws(
    () => resolveEncryptionKey({ SCM_SESSION_KEY: 'A'.repeat(42) + '/', NODE_ENV: 'production' }),
    /SCM_SESSION_KEY must contain exactly 32 random bytes encoded as a 43-character base64url string/,
  );
  assert.throws(
    () => resolveEncryptionKey({ SCM_SESSION_KEY: 'A'.repeat(42) + ' ', NODE_ENV: 'production' }),
    /SCM_SESSION_KEY must contain exactly 32 random bytes encoded as a 43-character base64url string/,
  );

  // Empty string in production
  assert.throws(
    () => resolveEncryptionKey({ SCM_SESSION_KEY: '', NODE_ENV: 'production' }),
    /SCM_SESSION_KEY must be configured in production and Vercel environments/,
  );

  // In test/dev environment, invalid key should also be rejected if provided
  assert.throws(
    () => resolveEncryptionKey({ SCM_SESSION_KEY: 'invalid_short_key', NODE_ENV: 'test' }),
    /SCM_SESSION_KEY must contain exactly 32 random bytes encoded as a 43-character base64url string/,
  );

  // Valid 43-char base64url key in production
  const validKeyBytes = randomBytes(KEY_BYTES);
  const validKeyB64 = validKeyBytes.toString('base64url');
  assert.equal(validKeyB64.length, 43);
  const resolvedKey = resolveEncryptionKey({ SCM_SESSION_KEY: validKeyB64, NODE_ENV: 'production' });
  assert.deepEqual(resolvedKey, validKeyBytes);

  console.log('  ✔ PROBE 2 PASSED: Key derivation strictly rejects missing/malformed keys.');

  // --------------------------------------------------------------------------
  // PROBE 3: Clock tolerance strictly rejects issuedAt > now + 5000
  // --------------------------------------------------------------------------
  console.log('\nPROBE 3: Clock tolerance boundary testing (issuedAt > now + 5000)...');
  const clockBase = 1_000_000_000;

  // Exactly now + 5000ms: must PASS
  const tokenAt5000 = encryptToken(
    {
      purpose: 'scm-session',
      sessionId: 's_5000',
      csrfToken: 'c_5000',
      mode: 'demo',
      issuedAt: clockBase + 5000,
      expiresAt: clockBase + 60_000,
    },
    key,
  );
  const decAt5000 = decryptToken(tokenAt5000, key, 'scm-session', clockBase);
  assert.ok(decAt5000, 'Token issued at now + 5000 was unexpectedly rejected');
  assert.equal(decAt5000?.sessionId, 's_5000');

  // now + 4999ms: must PASS
  const tokenAt4999 = encryptToken(
    {
      purpose: 'scm-session',
      sessionId: 's_4999',
      csrfToken: 'c_4999',
      mode: 'demo',
      issuedAt: clockBase + 4999,
      expiresAt: clockBase + 60_000,
    },
    key,
  );
  assert.ok(decryptToken(tokenAt4999, key, 'scm-session', clockBase));

  // now + 5001ms: must FAIL (null)
  const tokenAt5001 = encryptToken(
    {
      purpose: 'scm-session',
      sessionId: 's_5001',
      csrfToken: 'c_5001',
      mode: 'demo',
      issuedAt: clockBase + 5001,
      expiresAt: clockBase + 60_000,
    },
    key,
  );
  assert.equal(decryptToken(tokenAt5001, key, 'scm-session', clockBase), null);

  // now + 5002ms ... now + 10000ms: must FAIL (null)
  for (let delta = 5002; delta <= 5050; delta++) {
    const t = encryptToken(
      {
        purpose: 'scm-session',
        sessionId: `s_${delta}`,
        csrfToken: `c_${delta}`,
        mode: 'demo',
        issuedAt: clockBase + delta,
        expiresAt: clockBase + 60_000,
      },
      key,
    );
    assert.equal(decryptToken(t, key, 'scm-session', clockBase), null);
  }

  // Non-integer timestamp tampering (e.g. 5000.5)
  // Craft raw token with float issuedAt
  const cipherFloat = createCipheriv('aes-256-gcm', key, randomBytes(IV_LENGTH));
  cipherFloat.setAAD(AAD);
  const floatPlaintext = Buffer.from(
    JSON.stringify({
      purpose: 'scm-session',
      sessionId: 's_float',
      csrfToken: 'c_float',
      mode: 'demo',
      issuedAt: clockBase + 5000.5,
      expiresAt: clockBase + 60_000,
    }),
    'utf8',
  );
  const floatCiphertext = Buffer.concat([cipherFloat.update(floatPlaintext), cipherFloat.final()]);
  const floatToken = Buffer.concat([
    cipherFloat.getAuthTag(), // wait, order is iv, authTag, ciphertext
  ]);
  // Use proper helper
  function craft(obj: unknown) {
    const iv = randomBytes(IV_LENGTH);
    const c = createCipheriv('aes-256-gcm', key, iv);
    c.setAAD(AAD);
    const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj))), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
  }

  assert.equal(
    decryptToken(craft({ purpose: 'scm-session', sessionId: 's', csrfToken: 'c', mode: 'demo', issuedAt: clockBase + 1000.5, expiresAt: clockBase + 60_000 }), key, 'scm-session', clockBase),
    null,
  );

  console.log('  ✔ PROBE 3 PASSED: Clock skew strictly enforces issuedAt <= now + 5000.');

  // --------------------------------------------------------------------------
  // PROBE 4: Multi-instance rehydration maintains separate RAM state (zero shared cache leak)
  // --------------------------------------------------------------------------
  console.log('\nPROBE 4: Multi-instance rehydration isolation and zero shared RAM state...');

  let storeClockTime = 2_000_000_000;
  const storeClock = () => storeClockTime;

  const storeA = new SessionStore(
    () => new DemoCloudDriver(),
    3600_000,
    100,
    storeClock,
    { encryptionKey: key },
  );

  const sessionA = storeA.create({ mode: 'demo' });
  void sessionA.driver.startLogin();
  const tokenA = storeA.issueToken(sessionA);

  // Mutate sessionA in storeA
  sessionA.activeTransfers = 3;
  sessionA.busy = true;

  // Create storeB with NO knowledge of storeA's RAM
  const storeB = new SessionStore(
    () => new DemoCloudDriver(),
    3600_000,
    100,
    storeClock,
    { encryptionKey: key },
  );

  // Verification 4.1: Direct lookup of session ID fails in storeB
  assert.equal(storeB.get(sessionA.id), undefined, 'storeB leaked session by ID before token decryption');

  // Verification 4.2: Rehydrate via token
  const sessionB = storeB.get(tokenA);
  assert.ok(sessionB, 'storeB failed to rehydrate session from token');

  // Verification 4.3: Identity separation
  assert.notEqual(sessionA, sessionB, 'storeA and storeB share the exact same object reference!');

  // Verification 4.4: In-memory transient state was NOT leaked
  assert.equal(sessionB.activeTransfers, 0, 'activeTransfers leaked from storeA to storeB');
  assert.equal(sessionB.busy, false, 'busy state leaked from storeA to storeB');
  assert.equal(sessionB.plans.size, 0, 'plans leaked from storeA to storeB');

  // Verification 4.5: Mutating storeB does NOT affect storeA
  sessionB.activeTransfers = 1;
  assert.equal(sessionA.activeTransfers, 3, 'storeB mutated storeA activeTransfers');

  // Verification 4.6: Destroying storeA does NOT affect storeB
  storeA.close();
  assert.equal(sessionA.revoked, true, 'sessionA was not revoked on storeA close');
  assert.equal(sessionB.revoked, false, 'storeA close revoked sessionB in storeB!');
  const sessionB2 = storeB.get(tokenA);
  assert.ok(sessionB2, 'storeB session was invalidated by storeA destruction');
  assert.equal(sessionB2?.revoked, false);
  storeB.close();

  // Verification 4.7: Cold-instance Fastify app delete plan execution
  console.log('  Testing cold-instance end-to-end delete plan execution across separate Fastify apps...');
  const sessionKeyB64 = key.toString('base64url');

  let appClockTime = 3_000_000_000;
  const appClock = () => appClockTime;

  // App 1: creates session, demo login, and delete plan
  const app1 = await buildApp({
    config: readConfig({
      APP_ORIGIN: 'http://127.0.0.1:3000',
      NODE_ENV: 'test',
      SCM_SESSION_KEY: sessionKeyB64,
    }),
    now: appClock,
    logger: false,
    serveStatic: false,
  });

  const initRes = await app1.inject({ url: '/api/session' });
  const initCookie = initRes.headers['set-cookie'] as string;
  const initCsrf = initRes.json().csrfToken as string;

  const demoRes = await app1.inject({
    method: 'POST',
    url: '/api/auth/demo',
    headers: {
      origin: 'http://127.0.0.1:3000',
      cookie: initCookie.split(';')[0],
      'x-csrf-token': initCsrf,
    },
    payload: {},
  });
  assert.equal(demoRes.statusCode, 200);
  const demoCookie = (demoRes.headers['set-cookie'] as string).split(';')[0];
  const demoCsrf = demoRes.json().csrfToken as string;

  // List files to get revision
  const filesRes = await app1.inject({
    url: '/api/games/949230/files',
    headers: { cookie: demoCookie },
  });
  assert.equal(filesRes.statusCode, 200);
  const { files, revision } = filesRes.json();
  const fileToDelete = files[0].name;

  // Create delete plan on App 1
  const planRes = await app1.inject({
    method: 'POST',
    url: '/api/games/949230/delete-plan',
    headers: {
      origin: 'http://127.0.0.1:3000',
      cookie: demoCookie,
      'x-csrf-token': demoCsrf,
    },
    payload: {
      names: [fileToDelete],
      revision,
    },
  });
  assert.equal(planRes.statusCode, 200);
  const { planId, confirmation } = planRes.json();
  assert.ok(planId);
  assert.ok(confirmation);

  // Now destroy App 1 completely!
  await app1.close();

  // Advance time by 30 seconds (still within 5-min plan TTL)
  appClockTime += 30_000;

  // App 2: Fresh instance with zero in-memory state, sharing only SCM_SESSION_KEY
  const app2 = await buildApp({
    config: readConfig({
      APP_ORIGIN: 'http://127.0.0.1:3000',
      NODE_ENV: 'test',
      SCM_SESSION_KEY: sessionKeyB64,
    }),
    now: appClock,
    logger: false,
    serveStatic: false,
  });

  // Execute deletion on App 2
  const deleteRes = await app2.inject({
    method: 'POST',
    url: '/api/games/949230/delete',
    headers: {
      origin: 'http://127.0.0.1:3000',
      cookie: demoCookie,
      'x-csrf-token': demoCsrf,
    },
    payload: {
      planId,
      confirmation,
      gamesClosed: true,
    },
  });

  assert.equal(deleteRes.statusCode, 200, `Cold instance delete failed with ${deleteRes.statusCode}: ${deleteRes.body}`);
  const deleteBody = deleteRes.json();
  assert.equal(deleteBody.batchCompleted, true);
  assert.ok(Array.isArray(deleteBody.deleted));
  assert.equal(deleteBody.deleted[0], fileToDelete);

  // Subsequent delete replay on App 2 must fail with 409
  const replayRes = await app2.inject({
    method: 'POST',
    url: '/api/games/949230/delete',
    headers: {
      origin: 'http://127.0.0.1:3000',
      cookie: demoCookie,
      'x-csrf-token': demoCsrf,
    },
    payload: {
      planId,
      confirmation,
      gamesClosed: true,
    },
  });
  assert.equal(replayRes.statusCode, 409, 'Replay on cold instance did not return 409');

  await app2.close();
  console.log('  ✔ PROBE 4 PASSED: Multi-instance rehydration maintains zero RAM leak and successfully recovers delete plan cryptographically.');

  // --------------------------------------------------------------------------
  // PROBE 5: Cross-purpose and session hijack attacks
  // --------------------------------------------------------------------------
  console.log('\nPROBE 5: Cross-purpose and cross-session token binding attacks...');

  // Token crafted for session X cannot be used in session Y for plan deletion
  const appHijack = await buildApp({
    config: readConfig({
      APP_ORIGIN: 'http://127.0.0.1:3000',
      NODE_ENV: 'test',
      SCM_SESSION_KEY: sessionKeyB64,
    }),
    now: appClock,
    logger: false,
    serveStatic: false,
  });

  // Create session Y
  const initY = await appHijack.inject({ url: '/api/session' });
  const cookieY = (initY.headers['set-cookie'] as string).split(';')[0];
  const csrfY = initY.json().csrfToken as string;
  const demoY = await appHijack.inject({
    method: 'POST',
    url: '/api/auth/demo',
    headers: {
      origin: 'http://127.0.0.1:3000',
      cookie: cookieY,
      'x-csrf-token': csrfY,
    },
    payload: {},
  });
  const demoCookieY = (demoY.headers['set-cookie'] as string).split(';')[0];
  const demoCsrfY = demoY.json().csrfToken as string;

  // Attacker tries to use planId from Session X in Session Y:
  const hijackDelete = await appHijack.inject({
    method: 'POST',
    url: '/api/games/949230/delete',
    headers: {
      origin: 'http://127.0.0.1:3000',
      cookie: demoCookieY,
      'x-csrf-token': demoCsrfY,
    },
    payload: {
      planId, // planId was bound to Session X
      confirmation,
      gamesClosed: true,
    },
  });

  assert.equal(hijackDelete.statusCode, 409);
  assert.equal(hijackDelete.json().error.code, 'PLAN_EXPIRED');

  await appHijack.close();
  console.log('  ✔ PROBE 5 PASSED: Session binding prevents cross-session plan token hijacking.');

  console.log('\n=== ALL 5 ADVERSARIAL PROBES EXECUTED AND PASSED WITH 100% SUCCESS ===');
}

main().catch((err) => {
  console.error('\n❌ FATAL: Adversarial challenge probe failed:', err);
  process.exit(1);
});

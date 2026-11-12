import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from './sessions.js';
import { DemoCloudDriver } from './demo-driver.js';
import { readConfig } from './config.js';
import { AppError } from './errors.js';
import { randomBytes } from 'node:crypto';

test('anonymous session flood evicts idle prelogin slots while preserving connected accounts', async () => {
  let now = 0;
  const store = new SessionStore(() => new DemoCloudDriver(), 60 * 60_000, 2, () => now);
  try {
    const connected = store.create(); await connected.driver.startLogin();
    now++;
    const anonymous = store.create(); now++;
    const replacement = store.create();
    assert.equal(store.get(anonymous.id), undefined);
    assert.ok(store.get(connected.id)); assert.ok(store.get(replacement.id));
    now += 5 * 60_000;
    assert.equal(store.get(replacement.id), undefined);
    assert.ok(store.get(connected.id));
  } finally { store.close(); }
});

test('eviction of idle demo sessions when at capacity to make room for new sessions', async () => {
  let now = 1000;
  const store = new SessionStore(() => new DemoCloudDriver(), 60 * 60_000, 2, () => now);
  try {
    // 1. Create two demo sessions and connect both
    const d1 = store.create({ mode: 'demo' });
    await d1.driver.startLogin();
    assert.equal(d1.driver.getLogin().status, 'connected');

    now += 1000;
    const d2 = store.create({ mode: 'demo' });
    await d2.driver.startLogin();
    assert.equal(d2.driver.getLogin().status, 'connected');

    // 2. Advance time and create 3rd session
    now += 1000;
    const d3 = store.create({ mode: 'demo' });

    // 3. Oldest idle demo session d1 must be evicted, d2 and d3 must be active
    assert.equal(store.get(d1.id), undefined);
    assert.ok(store.get(d2.id));
    assert.ok(store.get(d3.id));
  } finally {
    store.close();
  }
});

test('never evicts busy sessions or sessions with active transfers', async () => {
  let now = 1000;
  const store = new SessionStore(() => new DemoCloudDriver(), 60 * 60_000, 2, () => now);
  try {
    // 1. Create s1 (busy) and s2 (idle)
    const s1 = store.create({ mode: 'demo' });
    await s1.driver.startLogin();
    s1.busy = true;

    now += 1000;
    const s2 = store.create({ mode: 'demo' });
    await s2.driver.startLogin();

    // 2. Creating s3 should evict s2 (idle) and protect s1 (busy)
    now += 1000;
    const s3 = store.create({ mode: 'demo' });
    assert.ok(store.get(s1.id), 'busy session s1 must be preserved');
    assert.equal(store.get(s2.id), undefined, 'idle session s2 must be evicted');
    assert.ok(store.get(s3.id));

    // 3. Mark s3 as active transfer
    s3.activeTransfers = 1;

    // 4. Now both s1 (busy) and s3 (transferring) are protected; creating s4 must throw SESSION_LIMIT (503)
    assert.throws(
      () => store.create({ mode: 'demo' }),
      (err: unknown) => err instanceof AppError && err.statusCode === 503 && err.code === 'SESSION_LIMIT',
    );
    assert.ok(store.get(s1.id));
    assert.ok(store.get(s3.id));
  } finally {
    store.close();
  }
});

test('eviction priority respects 3 tiers (disconnected/expired -> idle demo -> non-busy live LRU)', async () => {
  let now = 1000;
  const store = new SessionStore(() => new DemoCloudDriver(), 60 * 60_000, 3, () => now);
  try {
    // Create sLive: live mode, connected (Tier 3 fallback)
    const sLive = store.create({ mode: 'live' });
    await sLive.driver.startLogin();
    sLive.lastSeen = 10;

    // Create sDemo: demo mode, connected (Tier 2)
    const sDemo = store.create({ mode: 'demo' });
    await sDemo.driver.startLogin();
    sDemo.lastSeen = 20;

    // Create sDisc: live mode, disconnected (Tier 1)
    const sDisc = store.create({ mode: 'live' });
    sDisc.lastSeen = 30; // Newer lastSeen than sLive and sDemo, but Tier 1

    // Store is at capacity (3/3)
    // 1. Next creation must evict Tier 1 (sDisc) first, despite having newest lastSeen
    now = 5000;
    const sNew1 = store.create({ mode: 'live' });
    await sNew1.driver.startLogin();
    assert.equal(store.get(sDisc.id), undefined, 'Tier 1 disconnected session must be evicted first');
    assert.equal(store.get(sNew1.id)?.id, sNew1.id);
    // Reset sLive and sDemo lastSeen because store.get updates lastSeen
    sLive.lastSeen = 10;
    sDemo.lastSeen = 20;

    // 2. Next creation must evict Tier 2 (sDemo) next, despite sLive having older lastSeen
    now = 6000;
    const sNew2 = store.create({ mode: 'live' });
    await sNew2.driver.startLogin();
    assert.equal(store.get(sDemo.id), undefined, 'Tier 2 demo session must be evicted before live session');
    assert.equal(store.get(sNew2.id)?.id, sNew2.id);
    sLive.lastSeen = 10;
    sNew1.lastSeen = 5000;

    // 3. Next creation must evict Tier 3 (sLive) because it is the oldest non-busy session
    now = 7000;
    const sNew3 = store.create({ mode: 'live' });
    await sNew3.driver.startLogin();
    assert.equal(store.get(sLive.id), undefined, 'Tier 3 live session evicted via LRU fallback');
    assert.equal(store.get(sNew1.id)?.id, sNew1.id);
    assert.equal(store.get(sNew2.id)?.id, sNew2.id);
    assert.equal(store.get(sNew3.id)?.id, sNew3.id);
  } finally {
    store.close();
  }
});

test('evicted demo session transparently rehydrates on get() with valid session token', async () => {
  let now = 1000;
  const testKey = randomBytes(32);
  const store = new SessionStore(() => new DemoCloudDriver(), 60 * 60_000, 2, () => now, {
    encryptionKey: testKey,
  });
  try {
    const d1 = store.create({ mode: 'demo' });
    await d1.driver.startLogin();
    const token1 = store.issueToken(d1);

    // Fill store to evict d1
    now += 1000;
    const d2 = store.create({ mode: 'demo' });
    await d2.driver.startLogin();
    now += 1000;
    const d3 = store.create({ mode: 'demo' });
    await d3.driver.startLogin();

    // d1 is evicted from store.sessions
    assert.equal(store.get(d1.id), undefined);

    // Querying with token1 should transparently decrypt and rehydrate d1
    const rehydrated = store.get(token1);
    assert.ok(rehydrated, 'd1 should be rehydrated from token');
    assert.equal(rehydrated.id, d1.id);
    assert.equal(rehydrated.mode, 'demo');
    assert.equal(rehydrated.driver.getLogin().status, 'connected');
  } finally {
    store.close();
  }
});

test('configurable MAX_SESSIONS behavior (5..1000 bounds)', () => {
  // Safe default of 200 when unset
  const defaultCfg = readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000' });
  assert.equal(defaultCfg.maxSessions, 200);

  // Custom valid values
  const customCfg = readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000', MAX_SESSIONS: '50' });
  assert.equal(customCfg.maxSessions, 50);

  // SCM_MAX_SESSIONS fallback
  const fallbackCfg = readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000', SCM_MAX_SESSIONS: '75' });
  assert.equal(fallbackCfg.maxSessions, 75);

  // Boundary checks: 5 and 1000 are valid
  assert.equal(readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000', MAX_SESSIONS: '5' }).maxSessions, 5);
  assert.equal(readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000', MAX_SESSIONS: '1000' }).maxSessions, 1000);

  // Invalid values outside 5..1000 bounds
  assert.throws(
    () => readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000', MAX_SESSIONS: '4' }),
    /MAX_SESSIONS must be 5\.\.1000/,
  );
  assert.throws(
    () => readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000', MAX_SESSIONS: '1001' }),
    /MAX_SESSIONS must be 5\.\.1000/,
  );
  assert.throws(
    () => readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000', MAX_SESSIONS: 'invalid' }),
    /MAX_SESSIONS must be 5\.\.1000/,
  );
  assert.throws(
    () => readConfig({ APP_ORIGIN: 'http://127.0.0.1:3000', MAX_SESSIONS: '50.5' }),
    /MAX_SESSIONS must be 5\.\.1000/,
  );
});

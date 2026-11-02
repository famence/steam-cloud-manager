import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from './sessions.js';
import { DemoCloudDriver } from './demo-driver.js';

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

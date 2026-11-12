import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { en, ru } from '../src/client/i18n.js';

describe('Milestone 2 Challenger 1: Static Contract & AST Stress Verification', () => {

  it('CONTRACT-01: i18n Demo and CTA keys exist in strict parity', () => {
    const requiredKeys = ['tryDemo', 'demoActive', 'demoBadge', 'orDivider', 'signIn', 'signOut', 'cancel'] as const;

    for (const key of requiredKeys) {
      assert.ok(en[key], `en missing key: ${key}`);
      assert.ok(ru[key], `ru missing key: ${key}`);
      assert.equal(typeof en[key], 'string', `en[${key}] must be string`);
      assert.equal(typeof ru[key], 'string', `ru[${key}] must be string`);
    }

    assert.equal(en.tryDemo, 'Try Demo Mode');
    assert.equal(ru.tryDemo, 'Попробовать демо-режим');

    assert.equal(en.demoActive, 'Demo Mode active — safe interactive sandbox with simulated saves.');
    assert.equal(ru.demoActive, 'Активен демо-режим — безопасная интерактивная песочница с тестовыми сохранениями.');

    assert.equal(en.demoBadge, 'Demo');
    assert.equal(ru.demoBadge, 'Демо');

    assert.equal(en.orDivider, 'or');
    assert.equal(ru.orDivider, 'или');

    // Russian signIn text
    assert.equal(ru.signIn, 'Войти через Steam QR');
    assert.equal(en.signIn, 'Sign in with Steam QR');
  });

  it('CONTRACT-02: styles.css contains valid CSS rules and media queries for Demo UI', () => {
    const css = readFileSync('src/client/styles.css', 'utf8');

    // .demo-banner
    assert.ok(css.includes('.demo-banner'), 'Missing .demo-banner rule');
    assert.ok(css.includes('background: var(--warning-soft);'), 'Missing warning-soft background on demo banner');
    assert.ok(css.includes('border: 1px solid var(--warning);'), 'Missing warning border on demo banner');

    // .demo-badge
    assert.ok(css.includes('.demo-badge'), 'Missing .demo-badge rule');

    // .login-divider
    assert.ok(css.includes('.login-divider'), 'Missing .login-divider rule');
    assert.ok(css.includes('.login-divider::before'), 'Missing .login-divider::before');
    assert.ok(css.includes('.login-divider::after'), 'Missing .login-divider::after');

    // Media query < 900px (Tablet): hides demo-badge
    const media900Index = css.indexOf('@media (max-width: 900px)');
    assert.ok(media900Index !== -1, 'Missing @media (max-width: 900px)');
    const media900Block = css.slice(media900Index, media900Index + 200);
    assert.ok(media900Block.includes('.demo-badge') && media900Block.includes('display: none'),
      '@media (max-width: 900px) must hide .demo-badge');

    // Media query < 600px (Mobile): wraps demo-banner
    const media600Index = css.indexOf('@media (max-width: 600px)');
    assert.ok(media600Index !== -1, 'Missing @media (max-width: 600px)');
    const media600Block = css.slice(media600Index, media600Index + 200);
    assert.ok(media600Block.includes('.demo-banner') && media600Block.includes('flex-wrap: wrap'),
      '@media (max-width: 600px) must wrap .demo-banner');
  });

  it('CONTRACT-03: Shell.tsx defines demo prop and renders .demo-badge conditionally', () => {
    const shellCode = readFileSync('src/client/components/Shell.tsx', 'utf8');

    // Verify prop definition
    assert.ok(shellCode.includes('demo?: boolean;'), 'Shell props interface must define demo?: boolean');
    assert.ok(shellCode.includes('demo = false'), 'Shell component must default demo to false');

    // Verify conditional rendering of demo-badge
    assert.ok(
      shellCode.includes('{demo && <span className="demo-badge">{t.demoBadge}</span>}'),
      'Shell must conditionally render demo-badge when demo is true'
    );
  });

  it('CONTRACT-04: App.tsx state machines correctly invoke /api/auth/demo and /api/auth/logout with CSRF', () => {
    const appCode = readFileSync('src/client/App.tsx', 'utf8');

    // startDemo handler
    assert.ok(appCode.includes("api<SessionInfo>('/api/auth/demo'"), 'startDemo must POST /api/auth/demo');
    assert.ok(appCode.includes('csrf: session.csrfToken'), 'startDemo must pass session.csrfToken');

    // cancelLogin handler
    assert.ok(appCode.includes("api<SessionInfo>('/api/auth/logout'"), 'cancelLogin must POST /api/auth/logout');

    // Shell invocation
    assert.ok(
      appCode.includes("demo={connected && session.mode === 'demo'}"),
      'App must pass demo={connected && session.mode === "demo"} to Shell'
    );

    // .demo-banner role="status"
    assert.ok(
      appCode.includes('<div className="demo-banner" role="status">'),
      'App must render .demo-banner with role="status"'
    );

    // Dual CTAs structure
    assert.ok(appCode.includes('className="login-actions"'), 'App must render .login-actions container');
    assert.ok(appCode.includes('className="login-divider"'), 'App must render .login-divider');
    assert.ok(appCode.includes('demo-button'), 'App must render .demo-button');
    assert.ok(appCode.includes('cancelLogin()'), 'App must render Cancel button calling cancelLogin()');
  });

});

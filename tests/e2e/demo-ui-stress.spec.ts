import { test, expect } from '@playwright/test';

test.describe('Milestone 2 Challenger 1: Demo Mode UI & Client State Machines', () => {

  test.beforeEach(async ({ page }) => {
    // Abort external steam asset calls
    await page.route('https://shared.fastly.steamstatic.com/**', route => route.abort());
  });

  test('C1-01: Dual CTAs and login-divider exist in unauthenticated state', async ({ page }) => {
    // Mock clean unauthenticated session
    await page.route('**/api/session', route => route.fulfill({
      status: 200,
      json: {
        login: { status: 'disconnected' },
        mode: 'live',
        csrfToken: 'csrf-test-token-01',
      },
    }));

    await page.goto('/');

    // Check login card exists
    const loginCard = page.locator('.login-card');
    await expect(loginCard).toBeVisible();

    // Verify dual CTAs container
    const loginActions = loginCard.locator('.login-actions');
    await expect(loginActions).toBeVisible();

    // 1. Primary button: Sign in with Steam QR
    const primaryBtn = loginActions.locator('button.button-primary');
    await expect(primaryBtn).toBeVisible();
    await expect(primaryBtn).toContainText('Sign in with Steam QR');
    await expect(primaryBtn).toBeEnabled();

    // 2. Divider with t.orDivider ("or")
    const divider = loginActions.locator('.login-divider');
    await expect(divider).toBeVisible();
    await expect(divider.locator('span')).toHaveText('or');

    // 3. Secondary button: Try Demo Mode
    const demoBtn = loginActions.locator('button.button-secondary.demo-button');
    await expect(demoBtn).toBeVisible();
    await expect(demoBtn).toContainText('Try Demo Mode');
    await expect(demoBtn).toBeEnabled();

    // Verify DOM ordering: primary button -> divider -> demo button
    const elements = await loginActions.locator('> *').evaluateAll(els =>
      els.map(el => el.className)
    );
    expect(elements).toEqual([
      expect.stringContaining('button-primary'),
      expect.stringContaining('login-divider'),
      expect.stringContaining('demo-button'),
    ]);
  });

  test('C1-02: Cancel flow — QR pending state returns cleanly to dual CTAs', async ({ page }) => {
    let sessionStatus = 'disconnected';

    await page.route('**/api/session', route => {
      route.fulfill({
        status: 200,
        json: {
          login: {
            status: sessionStatus,
            qrDataUrl: sessionStatus === 'awaiting_confirmation'
              ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
              : undefined,
          },
          mode: 'live',
          csrfToken: 'csrf-cancel-token',
        },
      });
    });

    await page.route('**/api/auth/steam', route => {
      sessionStatus = 'awaiting_confirmation';
      route.fulfill({
        status: 200,
        json: {
          login: {
            status: 'awaiting_confirmation',
            qrDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          },
          mode: 'live',
          csrfToken: 'csrf-cancel-token',
        },
      });
    });

    let logoutCalled = false;
    await page.route('**/api/auth/logout', route => {
      logoutCalled = true;
      sessionStatus = 'disconnected';
      route.fulfill({
        status: 200,
        json: {
          login: { status: 'disconnected' },
          mode: 'live',
          csrfToken: 'csrf-cancel-token',
        },
      });
    });

    await page.goto('/');

    // Click Sign in with Steam QR
    await page.locator('button.button-primary').click();

    // Verify QR section appears
    const qrSection = page.locator('.qr-section');
    await expect(qrSection).toBeVisible();
    await expect(qrSection.locator('img')).toBeVisible();

    // Verify Cancel button is rendered
    const cancelBtn = qrSection.locator('button.button-ghost');
    await expect(cancelBtn).toBeVisible();
    await expect(cancelBtn).toHaveText('Cancel');

    // Click Cancel
    await cancelBtn.click();

    // Verify logout endpoint was called to cancel pending state
    expect(logoutCalled).toBe(true);

    // Verify QR section disappears and dual CTAs return cleanly
    await expect(qrSection).toHaveCount(0);
    await expect(page.locator('.login-actions')).toBeVisible();
    await expect(page.locator('button.button-primary')).toBeVisible();
    await expect(page.locator('button.demo-button')).toBeVisible();
    await expect(page.locator('.error-message')).toHaveCount(0);
  });

  test('C1-03: State transition to Demo Mode renders .demo-banner and [Demo] badge', async ({ page }) => {
    let mode = 'live';
    let status = 'disconnected';

    await page.route('**/api/session', route => {
      route.fulfill({
        status: 200,
        json: {
          login: {
            status,
            user: status === 'connected' ? { steamId: 'demo', displayName: 'Demo Player' } : undefined,
          },
          mode,
          csrfToken: 'csrf-demo-token',
        },
      });
    });

    await page.route('**/api/auth/demo', route => {
      mode = 'demo';
      status = 'connected';
      route.fulfill({
        status: 200,
        json: {
          login: {
            status: 'connected',
            user: { steamId: 'demo', displayName: 'Demo Player' },
          },
          mode: 'demo',
          csrfToken: 'csrf-demo-token',
        },
      });
    });

    await page.route('**/api/games', route => {
      route.fulfill({
        status: 200,
        json: {
          games: [
            { appId: 100, name: 'Demo Game Alpha', fileCount: 2, totalBytes: 2048, cloudSupport: 'supported' }
          ]
        }
      });
    });

    await page.goto('/');

    // Initially in unauthenticated state: no demo-banner, no demo-badge
    await expect(page.locator('.demo-banner')).toHaveCount(0);
    await expect(page.locator('.demo-badge')).toHaveCount(0);

    // Click Try Demo Mode
    await page.locator('button.demo-button').click();

    // Verify transition to connected demo state
    const banner = page.locator('.demo-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('role', 'status');
    await expect(banner).toContainText('Demo Mode active — safe interactive sandbox with simulated saves.');

    // Verify Sparkles icon in banner
    await expect(banner.locator('.demo-banner-content svg')).toBeVisible();

    // Verify Shell navbar displays account name and [Demo] badge
    const header = page.locator('.app-header');
    await expect(header.locator('.account-name')).toHaveText('Demo Player');
    const badge = header.locator('.demo-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('Demo');
  });

  test('C1-04: Sign Out flow from .demo-banner and navbar restores unauthenticated state', async ({ page }) => {
    let mode = 'demo';
    let status = 'connected';
    let logoutCallCount = 0;

    await page.route('**/api/session', route => {
      route.fulfill({
        status: 200,
        json: {
          login: {
            status,
            user: status === 'connected' ? { steamId: 'demo', displayName: 'Demo Player' } : undefined,
          },
          mode,
          csrfToken: 'csrf-signout-token',
        },
      });
    });

    await page.route('**/api/auth/logout', route => {
      logoutCallCount++;
      mode = 'live';
      status = 'disconnected';
      route.fulfill({
        status: 200,
        json: {
          login: { status: 'disconnected' },
          mode: 'live',
          csrfToken: 'csrf-signout-token',
        },
      });
    });

    await page.route('**/api/games', route => {
      route.fulfill({
        status: 200,
        json: { games: [{ appId: 100, name: 'Demo Game Alpha', fileCount: 1, totalBytes: 100 }] }
      });
    });

    await page.goto('/');

    // 1. Verify demo mode is active
    await expect(page.locator('.demo-banner')).toBeVisible();
    const bannerSignOut = page.locator('.demo-banner button.button-sm');
    await expect(bannerSignOut).toBeVisible();
    await expect(bannerSignOut).toContainText('Sign out');

    // Click Sign out in demo banner
    await bannerSignOut.click();

    expect(logoutCallCount).toBe(1);

    // Verify returned to unauthenticated state with dual CTAs
    await expect(page.locator('.login-card')).toBeVisible();
    await expect(page.locator('.demo-banner')).toHaveCount(0);
    await expect(page.locator('.demo-badge')).toHaveCount(0);
    await expect(page.locator('button.demo-button')).toBeVisible();

    // 2. Now re-enter demo mode and test sign out via navbar
    mode = 'demo';
    status = 'connected';
    await page.route('**/api/auth/demo', route => {
      route.fulfill({
        status: 200,
        json: {
          login: { status: 'connected', user: { steamId: 'demo', displayName: 'Demo Player' } },
          mode: 'demo',
          csrfToken: 'csrf-signout-token',
        },
      });
    });

    await page.locator('button.demo-button').click();
    await expect(page.locator('.demo-banner')).toBeVisible();

    // Click Sign out button in navbar
    const navSignOut = page.locator('.header-controls button[aria-label="Sign out"]');
    await expect(navSignOut).toBeVisible();
    await navSignOut.click();

    expect(logoutCallCount).toBe(2);
    await expect(page.locator('.login-card')).toBeVisible();
    await expect(page.locator('.demo-banner')).toHaveCount(0);
  });

  test('C1-05: Mobile responsive styles for .demo-banner and .demo-badge (<900px and <600px)', async ({ page }) => {
    await page.route('**/api/session', route => {
      route.fulfill({
        status: 200,
        json: {
          login: { status: 'connected', user: { steamId: 'demo', displayName: 'Demo Player' } },
          mode: 'demo',
          csrfToken: 'csrf-responsive-token',
        },
      });
    });
    await page.route('**/api/games', route => route.fulfill({ status: 200, json: { games: [] } }));

    // 1. Desktop Viewport (1200x800)
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');

    const badge = page.locator('.demo-badge');
    const banner = page.locator('.demo-banner');

    await expect(badge).toBeVisible();
    // Flex child computed display is blockified per CSS Flexbox spec
    const badgeDisplayDesktop = await badge.evaluate(el => window.getComputedStyle(el).display);
    expect(['inline-block', 'block']).toContain(badgeDisplayDesktop);

    const bannerWrapDesktop = await banner.evaluate(el => window.getComputedStyle(el).flexWrap);
    expect(bannerWrapDesktop).toBe('nowrap');

    // 2. Tablet Viewport (800x800) - < 900px breakpoint
    await page.setViewportSize({ width: 800, height: 800 });
    // In CSS: @media (max-width: 900px) { .demo-badge { display: none; } }
    const badgeDisplayTablet = await badge.evaluate(el => window.getComputedStyle(el).display);
    expect(badgeDisplayTablet).toBe('none');

    // 3. Mobile Viewport (390x844) - < 600px breakpoint
    await page.setViewportSize({ width: 390, height: 844 });
    // In CSS: @media (max-width: 600px) { .demo-banner { flex-wrap: wrap; padding: 10px 12px; } }
    const bannerWrapMobile = await banner.evaluate(el => window.getComputedStyle(el).flexWrap);
    expect(bannerWrapMobile).toBe('wrap');

    const bannerPaddingMobile = await banner.evaluate(el => {
      const s = window.getComputedStyle(el);
      return `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`;
    });
    expect(bannerPaddingMobile).toBe('10px 12px 10px 12px');

    // Verify zero horizontal overflow on mobile
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflow).toBe(false);
  });

  test('C1-06: Error handling on 401, 500, or network failure during demo transition', async ({ page }) => {
    await page.route('**/api/session', route => {
      route.fulfill({
        status: 200,
        json: {
          login: { status: 'disconnected' },
          mode: 'live',
          csrfToken: 'csrf-error-token',
        },
      });
    });

    // 1. Scenario: HTTP 500 Server Error
    await page.route('**/api/auth/demo', route => {
      route.fulfill({
        status: 500,
        json: { error: { code: 'DEMO_FAILURE', message: 'Simulated backend crash' } },
      });
    });

    await page.goto('/');

    const demoBtn = page.locator('button.demo-button');
    await expect(demoBtn).toBeEnabled();
    await demoBtn.click();

    // Verify error message is rendered with role="alert"
    const errorAlert = page.locator('.error-message[role="alert"]');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText('DEMO_FAILURE');

    // Verify UI did not crash and buttons are re-enabled
    await expect(demoBtn).toBeEnabled();
    await expect(page.locator('button.button-primary')).toBeEnabled();

    // 2. Scenario: HTTP 401 Unauthorized
    await page.unroute('**/api/auth/demo');
    await page.route('**/api/auth/demo', route => {
      route.fulfill({
        status: 401,
        json: { error: { code: 'UNAUTHORIZED', message: 'Session expired' } },
      });
    });

    await demoBtn.click();
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText('UNAUTHORIZED');
    await expect(demoBtn).toBeEnabled();

    // 3. Scenario: Network Abort / Failure
    await page.unroute('**/api/auth/demo');
    await page.route('**/api/auth/demo', route => route.abort('failed'));

    await demoBtn.click();
    await expect(errorAlert).toBeVisible();
    await expect(demoBtn).toBeEnabled();
  });

  test('C1-07: Bilingual UI test (RU locale) for Demo Mode and CTAs', async ({ page }) => {
    await page.route('**/api/session', route => {
      route.fulfill({
        status: 200,
        json: {
          login: { status: 'disconnected' },
          mode: 'live',
          csrfToken: 'csrf-ru-token',
        },
      });
    });

    // Set localStorage language to ru
    await page.addInitScript(() => {
      localStorage.setItem('scm:language', 'ru');
    });

    await page.goto('/');

    // Check Russian localized strings
    const loginActions = page.locator('.login-actions');
    await expect(loginActions.locator('button.button-primary')).toContainText('Войти через Steam QR');
    await expect(loginActions.locator('.login-divider span')).toHaveText('или');
    await expect(loginActions.locator('button.demo-button')).toContainText('Попробовать демо-режим');

    // Now test entering demo in Russian
    await page.route('**/api/auth/demo', route => {
      route.fulfill({
        status: 200,
        json: {
          login: { status: 'connected', user: { steamId: 'demo', displayName: 'Демо Игрок' } },
          mode: 'demo',
          csrfToken: 'csrf-ru-token',
        },
      });
    });
    await page.route('**/api/games', route => route.fulfill({ status: 200, json: { games: [] } }));

    await loginActions.locator('button.demo-button').click();

    // Verify Russian demo banner copy
    const banner = page.locator('.demo-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Активен демо-режим — безопасная интерактивная песочница с тестовыми сохранениями.');

    // Verify Russian badge
    const badge = page.locator('.app-header .demo-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('Демо');
  });

  test('C1-08: CSRF token header is strictly propagated on Demo and Cancel/Logout requests', async ({ page }) => {
    const expectedCsrf = 'secure-random-csrf-nonce-98765';
    let interceptedDemoCsrf = '';
    let interceptedLogoutCsrf = '';

    await page.route('**/api/session', route => {
      route.fulfill({
        status: 200,
        json: {
          login: { status: 'disconnected' },
          mode: 'live',
          csrfToken: expectedCsrf,
        },
      });
    });

    await page.route('**/api/auth/demo', route => {
      interceptedDemoCsrf = route.request().headers()['x-csrf-token'];
      route.fulfill({
        status: 200,
        json: {
          login: { status: 'connected', user: { steamId: 'demo', displayName: 'Demo Player' } },
          mode: 'demo',
          csrfToken: expectedCsrf,
        },
      });
    });

    await page.route('**/api/auth/logout', route => {
      interceptedLogoutCsrf = route.request().headers()['x-csrf-token'];
      route.fulfill({
        status: 200,
        json: {
          login: { status: 'disconnected' },
          mode: 'live',
          csrfToken: expectedCsrf,
        },
      });
    });

    await page.route('**/api/games', route => route.fulfill({ status: 200, json: { games: [] } }));

    await page.goto('/');

    // 1. Enter Demo Mode
    await page.locator('button.demo-button').click();
    expect(interceptedDemoCsrf).toBe(expectedCsrf);

    // 2. Sign Out
    await page.locator('.demo-banner button.button-sm').click();
    expect(interceptedLogoutCsrf).toBe(expectedCsrf);
  });

  test('C1-09: Rapid repeated clicks on Try Demo Mode does not trigger concurrent requests', async ({ page }) => {
    let demoCallCount = 0;
    await page.route('**/api/session', route => {
      route.fulfill({
        status: 200,
        json: {
          login: { status: 'disconnected' },
          mode: 'live',
          csrfToken: 'csrf-rapid-token',
        },
      });
    });

    await page.route('**/api/auth/demo', async route => {
      demoCallCount++;
      // Artificial 200ms delay to test in-flight lock
      await new Promise(r => setTimeout(r, 200));
      route.fulfill({
        status: 200,
        json: {
          login: { status: 'connected', user: { steamId: 'demo', displayName: 'Demo Player' } },
          mode: 'demo',
          csrfToken: 'csrf-rapid-token',
        },
      });
    });
    await page.route('**/api/games', route => route.fulfill({ status: 200, json: { games: [] } }));

    await page.goto('/');

    const demoBtn = page.locator('button.demo-button');

    // Rapid quadruple click
    await Promise.all([
      demoBtn.click({ clickCount: 1, delay: 0 }),
      demoBtn.click({ clickCount: 1, delay: 10 }).catch(() => {}),
      demoBtn.click({ clickCount: 1, delay: 20 }).catch(() => {}),
      demoBtn.click({ clickCount: 1, delay: 30 }).catch(() => {}),
    ]);

    await expect(page.locator('.demo-banner')).toBeVisible();

    // Exactly 1 request initiated due to disabled state while sessionLoading
    expect(demoCallCount).toBe(1);
  });

  test('C1-10: Keyboard navigation and accessibility for Dual CTAs and Demo Banner', async ({ page }) => {
    await page.route('**/api/session', route => {
      route.fulfill({
        status: 200,
        json: {
          login: { status: 'disconnected' },
          mode: 'live',
          csrfToken: 'csrf-a11y-token',
        },
      });
    });

    await page.route('**/api/auth/demo', route => {
      route.fulfill({
        status: 200,
        json: {
          login: { status: 'connected', user: { steamId: 'demo', displayName: 'Demo Player' } },
          mode: 'demo',
          csrfToken: 'csrf-a11y-token',
        },
      });
    });

    await page.route('**/api/auth/logout', route => {
      route.fulfill({
        status: 200,
        json: {
          login: { status: 'disconnected' },
          mode: 'live',
          csrfToken: 'csrf-a11y-token',
        },
      });
    });

    await page.route('**/api/games', route => route.fulfill({ status: 200, json: { games: [] } }));

    await page.goto('/');

    // Focus demo button directly and trigger via Space
    const demoBtn = page.locator('button.demo-button');
    await demoBtn.focus();
    await expect(demoBtn).toBeFocused();
    await page.keyboard.press('Space');

    // Verify demo mode entered via keyboard
    await expect(page.locator('.demo-banner')).toBeVisible();

    // Verify demo banner has proper role="status" for screen readers
    const banner = page.locator('.demo-banner');
    await expect(banner).toHaveAttribute('role', 'status');

    // Verify Sign out button in banner is keyboard-focusable
    const bannerSignOut = banner.locator('button.button-sm');
    await bannerSignOut.focus();
    await expect(bannerSignOut).toBeFocused();
    await page.keyboard.press('Enter');

    // Verify returned to unauthenticated state
    await expect(page.locator('.login-card')).toBeVisible();
  });

});

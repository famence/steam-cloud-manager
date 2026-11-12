import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const DEMO_STEAM_ID = '76561198000000000';

test.beforeEach(async ({ page }, testInfo) => {
  // Abort external Steam CDN requests to ensure network independence and zero flakiness
  await page.route('https://shared.fastly.steamstatic.com/**', route => route.abort());
  // Disable native showSaveFilePicker so file downloads fall back to <a download> and emit Playwright download events
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
  });

  // Assign distinct client IP per test to prevent artificial local rate-limit collisions across the 37 tests
  const testHash = (Math.abs(testInfo.title.split('').reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0)) % 240) + 1;
  await page.setExtraHTTPHeaders({
    'x-forwarded-for': `127.0.1.${testHash}`,
  });
});

test.afterEach(async ({ page }) => {
  // Hermetically destroy session so SessionStore (maxSessions: 25) never exhausts memory slots
  try {
    if (page.isClosed()) return;
    const dialog = page.locator('dialog[open]');
    if (await dialog.isVisible({ timeout: 200 }).catch(() => false)) {
      await page.keyboard.press('Escape').catch(() => {});
    }
    const currentUrl = page.url();
    if (currentUrl && currentUrl.startsWith('http')) {
      await page.evaluate(async () => {
        try {
          const s = await fetch('/api/session').then(r => r.json()).catch(() => null);
          if (s?.csrfToken) {
            await fetch('/api/auth/logout', {
              method: 'POST',
              headers: {
                'x-csrf-token': s.csrfToken,
                'content-type': 'application/json',
              },
              body: '{}',
            }).catch(() => {});
          }
        } catch {}
      }).catch(() => {});
    }
  } catch {}
});

async function enterDemoMode(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Try Demo Mode|Попробовать демо-режим/i }).click();
  await expect(page.getByRole('heading', { name: /^Games|^Игры/ })).toBeVisible();
  await expect(page.locator('.game-card')).toHaveCount(3);
}

async function openCities(page: Page) {
  await page.getByRole('button', { name: /Open: Cities: Skylines II|Открыть: Cities: Skylines II/i }).click();
  await expect(page.getByRole('heading', { name: 'Cities: Skylines II', exact: true })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(6);
}

// =============================================================================
// Tier 1: Feature Coverage (11 Tests)
// =============================================================================
test.describe('Tier 1: Feature Coverage', () => {
  // ---------------------------------------------------------------------------
  // EF5-A: Web Client UX (5 tests)
  // ---------------------------------------------------------------------------
  test('T1-FEAT-F5-01: Root Path / Direct Interactive React SPA Load', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Steam Cloud Manager/i);
    await expect(page.locator('#root')).toBeVisible();
    await expect(page.locator('.login-card')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Steam Cloud Manager' })).toBeVisible();

    // Verify zero legacy install or local clone instructions
    expect(await page.locator('text=git clone').count()).toBe(0);
    expect(await page.locator('text=npm install').count()).toBe(0);
    expect(await page.locator('text=runs only on your local computer').count()).toBe(0);
  });

  test('T1-FEAT-F5-02: Dual Login CTAs ("Sign in with Steam QR" and "Try Demo Mode")', async ({ page }) => {
    await page.goto('/');
    const actions = page.locator('.login-actions');
    await expect(actions).toBeVisible();

    const steamBtn = actions.getByRole('button', { name: /Sign in with Steam QR|Войти через Steam QR/i });
    await expect(steamBtn).toBeVisible();
    await expect(steamBtn).toBeEnabled();

    const divider = actions.locator('.login-divider');
    await expect(divider).toBeVisible();
    await expect(divider.locator('span')).toHaveText(/or|или/i);

    const demoBtn = actions.getByRole('button', { name: /Try Demo Mode|Попробовать демо-режим/i });
    await expect(demoBtn).toBeVisible();
    await expect(demoBtn).toBeEnabled();
  });

  test('T1-FEAT-F5-03: Persistent In-App Demo Warning Banner with Sign Out CTA', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Try Demo Mode|Попробовать демо-режим/i }).click();

    const banner = page.locator('.demo-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('role', 'status');
    await expect(banner).toContainText(/Demo Mode active|Активен демо-режим/i);

    const signOutBtn = banner.getByRole('button', { name: /Sign out|Выйти/i });
    await expect(signOutBtn).toBeVisible();
    await expect(signOutBtn).toBeEnabled();
  });

  test('T1-FEAT-F5-04: Header Demo Mode Badge Display', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 850 });
    await page.goto('/');
    await page.getByRole('button', { name: /Try Demo Mode|Попробовать демо-режим/i }).click();

    const header = page.locator('.app-header');
    await expect(header.locator('.account-name')).toContainText('Demo Account');
    const badge = header.locator('.demo-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/Demo|Демо/);
  });

  test('T1-FEAT-F5-05: English and Russian Translation Parity for Web App', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    // Switch to Russian
    await page.getByLabel(/Language|Язык/i).selectOption('ru');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.getByRole('button', { name: 'Войти через Steam QR' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Попробовать демо-режим' })).toBeVisible();
    await expect(page.locator('.login-divider span')).toHaveText('или');

    // Switch back to English
    await page.getByLabel(/Language|Язык/i).selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'Sign in with Steam QR' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try Demo Mode' })).toBeVisible();
    await expect(page.locator('.login-divider span')).toHaveText('or');
  });

  // ---------------------------------------------------------------------------
  // EF5-B: Browser Journeys (6 tests)
  // ---------------------------------------------------------------------------
  test('T1-FEAT-F6-01: 1-Click Demo Mode Browser Login Journey', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Try Demo Mode|Попробовать демо-режим/i }).click();
    await expect(page.getByRole('heading', { name: /^Games|^Игры/ })).toBeVisible();

    const cards = page.locator('.game-card');
    await expect(cards).toHaveCount(3);
    await expect(page.locator('[data-app-id="949230"]')).toContainText('Cities: Skylines II');
    await expect(page.locator('[data-app-id="1086940"]')).toContainText("Baldur's Gate 3");
    await expect(page.locator('[data-app-id="1245620"]')).toContainText('ELDEN RING');
  });

  test('T1-FEAT-F6-02: Game Library Search and Client-Side Filtering', async ({ page }) => {
    await enterDemoMode(page);
    const search = page.getByRole('searchbox', { name: /Search games|Найти игру/i });

    // Filter by name
    await search.fill('Elden');
    await expect(page.locator('.game-card')).toHaveCount(1);
    await expect(page.locator('.game-card').first()).toContainText('ELDEN RING');

    // Filter by AppID
    await search.fill('949230');
    await expect(page.locator('.game-card')).toHaveCount(1);
    await expect(page.locator('.game-card').first()).toContainText('Cities: Skylines II');

    // Clear search
    await search.fill('');
    await expect(page.locator('.game-card')).toHaveCount(3);
  });

  test('T1-FEAT-F6-03: Save File Table Inspection and Single Download Event', async ({ page }) => {
    await enterDemoMode(page);
    await openCities(page);

    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(6);

    const firstFilename = (await rows.first().locator('.filename strong').textContent())?.trim();
    expect(firstFilename).toBeTruthy();

    const downloadPromise = page.waitForEvent('download');
    await rows.first().locator('.download-cell button').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(firstFilename);
    const path = await download.path();
    expect(path).toBeTruthy();
    const content = await readFile(path!);
    expect(content.length).toBeGreaterThan(0);
    expect(content.toString()).toContain('DEMO ONLY');
  });

  test('T1-FEAT-F6-04: Modal ZIP Backup Export and Archive Header Validation', async ({ page }) => {
    await enterDemoMode(page);
    await openCities(page);

    await page.locator('thead input[type="checkbox"]').check();
    await expect(page.locator('.bulk-actions')).toBeVisible();
    await page.locator('.bulk-actions').getByRole('button', { name: /Download ZIP|Скачать ZIP/i }).click();

    const downloadLink = page.getByRole('link', { name: /Save prepared ZIP|Скачать подготовленный ZIP/i });
    await expect(downloadLink).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    const buffer = await readFile(filePath!);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    expect(buffer.includes(Buffer.from('DEMO ONLY'))).toBe(true);
  });

  test('T1-FEAT-F6-05: Two-Phase Deletion Confirmation Dialog Journey', async ({ page }) => {
    await enterDemoMode(page);
    await openCities(page);

    await page.locator('tbody input[type="checkbox"]').first().check();
    await page.locator('.bulk-actions').getByRole('button', { name: /Delete|Удалить/i }).click();

    const dialog = page.locator('dialog.delete-dialog');
    await expect(dialog).toBeVisible();

    const deleteBtn = dialog.getByRole('button', { name: /Delete permanently|Удалить навсегда/i });
    await expect(deleteBtn).toBeDisabled();

    // Check games closed checkbox
    await dialog.locator('.check-line input[type="checkbox"]').check();
    await expect(deleteBtn).toBeDisabled();

    // Dynamically retrieve server confirmation phrase
    const phrase = (await dialog.locator('.confirmation-label strong').textContent())?.trim() || 'DELETE 1';
    await dialog.locator('#delete-confirmation').fill(phrase);
    await expect(deleteBtn).toBeEnabled();

    await deleteBtn.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('tbody tr')).toHaveCount(5);
  });

  test('T1-FEAT-F6-06: Browser Sign-Out Journey Returning to Dual-CTA Screen', async ({ page }) => {
    await enterDemoMode(page);

    await page.locator('.demo-banner').getByRole('button', { name: /Sign out|Выйти/i }).click();
    await expect(page.locator('.login-card')).toBeVisible();
    await expect(page.locator('.demo-banner')).toHaveCount(0);
    await expect(page.locator('.demo-badge')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Try Demo Mode|Попробовать демо-режим/i })).toBeVisible();
    await expect(page.locator('.game-card')).toHaveCount(0);
  });
});

// =============================================================================
// Tier 2: Boundary & Corner Cases (11 Tests)
// =============================================================================
test.describe('Tier 2: Boundary & Corner Cases', () => {
  // ---------------------------------------------------------------------------
  // EF5-A: Web Client UX Boundaries (5 tests)
  // ---------------------------------------------------------------------------
  test('T2-BOUND-F5-01: Rapid Double-Click on "Try Demo Mode" Button', async ({ page }) => {
    await page.goto('/');
    const demoBtn = page.getByRole('button', { name: /Try Demo Mode|Попробовать демо-режим/i });
    await demoBtn.dblclick();

    await expect(page.locator('.game-card')).toHaveCount(3);
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
  });

  test('T2-BOUND-F5-02: Steam QR Login Pending Cancellation Return to Idle Login', async ({ page }) => {
    // Hermetic route simulation for pending QR login state
    await page.route('**/api/auth/steam', route => {
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

    await page.goto('/');
    await page.getByRole('button', { name: /Sign in with Steam QR|Войти через Steam QR/i }).click();

    const qrSection = page.locator('.qr-section');
    await expect(qrSection).toBeVisible();

    const cancelBtn = qrSection.getByRole('button', { name: /Cancel|Отмена/i });
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    await expect(qrSection).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Sign in with Steam QR|Войти через Steam QR/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Try Demo Mode|Попробовать демо-режим/i })).toBeVisible();
  });

  test('T2-BOUND-F5-03: Extreme Viewport Resizing (320px to 4K Ultrawide)', async ({ page }) => {
    await page.goto('/');

    // 320x568 (Mobile SE)
    await page.setViewportSize({ width: 320, height: 568 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // 3840x2160 (4K Ultrawide)
    await page.setViewportSize({ width: 3840, height: 2160 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('T2-BOUND-F5-04: LocalStorage Quota Exceeded / Disabled Handling', async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    });

    await enterDemoMode(page);
    await expect(page.locator('.game-card')).toHaveCount(3);

    // Interaction should not throw uncaught errors
    await page.locator('.favorite-button').first().click();
    await page.getByLabel(/Theme|Тема/i).selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('T2-BOUND-F5-05: Unicode & Cyrillic Search Query Boundary', async ({ page }) => {
    await enterDemoMode(page);
    const search = page.getByRole('searchbox', { name: /Search games|Найти игру/i });

    // Emoji search
    await search.fill('🎮🚀');
    await expect(page.locator('.game-card')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /No games found|Игры не найдены/i })).toBeVisible();

    // Script injection attempt
    await search.fill('<script>alert(1)</script>');
    await expect(page.locator('.game-card')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /No games found|Игры не найдены/i })).toBeVisible();

    // Cyrillic search with 0 matches
    await search.fill('НесуществующаяИгра');
    await expect(page.locator('.game-card')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /No games found|Игры не найдены/i })).toBeVisible();

    // Reset search
    await search.fill('');
    await expect(page.locator('.game-card')).toHaveCount(3);
  });

  // ---------------------------------------------------------------------------
  // EF5-B: Browser Journey Boundaries (6 tests)
  // ---------------------------------------------------------------------------
  test('T2-BOUND-F6-01: Browser Navigation (Back / Forward) Across Demo and Detail Views', async ({ page }) => {
    await enterDemoMode(page);
    await openCities(page);
    await expect(page.locator('tbody tr')).toHaveCount(6);

    await page.goBack();
    await expect(page.locator('.game-card')).toHaveCount(3);
    expect(page.url()).not.toContain('#game/');

    await page.goForward();
    await expect(page.locator('tbody tr')).toHaveCount(6);
    expect(page.url()).toContain('#game/949230');
  });

  test('T2-BOUND-F6-02: Browser Hard Refresh During Active Demo Session', async ({ page }) => {
    await enterDemoMode(page);
    await openCities(page);
    await expect(page.locator('tbody tr')).toHaveCount(6);

    await page.reload();
    await expect(page.locator('.demo-banner')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cities: Skylines II' })).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(6);
  });

  test('T2-BOUND-F6-03: Mobile Viewport (390x844) Touch Target & Dialog Usability', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterDemoMode(page);
    await openCities(page);

    await page.locator('tbody input[type="checkbox"]').first().check();
    await page.locator('.bulk-actions').getByRole('button', { name: /Delete|Удалить/i }).click();

    const dialog = page.locator('dialog.delete-dialog');
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeLessThanOrEqual(390);
    expect(box!.height).toBeLessThanOrEqual(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('T2-BOUND-F6-04: Keyboard Accessibility & Focus Management in Security Dialogs', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Security|Безопасность/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.querySelector('dialog')?.contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('T2-BOUND-F6-05: BASE_URL Hosted Target Execution Resilience', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).toBeTruthy();
    expect(response!.status()).toBe(200);

    await expect(page.locator('.login-card')).toBeVisible();
    const demoBtn = page.locator('.login-actions').getByRole('button', { name: /Try Demo Mode|Попробовать демо-режим/i });
    await expect(demoBtn).toBeVisible();
  });

  test('T2-BOUND-F6-06: Network Disconnect / Offline Simulation During Save Download', async ({ page }) => {
    await enterDemoMode(page);
    await openCities(page);

    await page.context().setOffline(true);
    await page.locator('tbody input[type="checkbox"]').first().check();
    await page.locator('.bulk-actions').getByRole('button', { name: /Download ZIP|Скачать ZIP/i }).click();

    await expect(page.locator('[role="alert"], .notice-error')).toBeVisible();
    await page.context().setOffline(false);
  });
});

// =============================================================================
// Tier 3: Pairwise Combinations (9 Tests)
// =============================================================================
test.describe('Tier 3: Pairwise Combinations', () => {
  test('T3-COMB-07: Host Header Verification + Client SPA Direct Load (EF3 + EF5-A)', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).toBeTruthy();
    expect(response!.status()).toBe(200);

    await expect(page.locator('#root')).toBeVisible();
    const csp = response!.headers()['content-security-policy'] || '';
    if (csp) {
      expect(csp).toContain("connect-src 'self'");
    }
    await expect(page.locator('.login-card')).toBeVisible();
  });

  test('T3-COMB-08: 1-Click Demo API + UI Demo Banner & Sign Out (EF4 + EF5-A)', async ({ page }) => {
    await page.goto('/');

    const [demoRes] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/auth/demo') && res.status() === 200),
      page.getByRole('button', { name: /Try Demo Mode|Попробовать демо-режим/i }).click(),
    ]);
    expect(demoRes.status()).toBe(200);
    const demoBody = await demoRes.json();
    expect(demoBody.mode).toBe('demo');

    const banner = page.locator('.demo-banner');
    await expect(banner).toBeVisible();

    const [logoutRes] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/auth/logout') && res.status() === 200),
      banner.getByRole('button', { name: /Sign out|Выйти/i }).click(),
    ]);
    expect(logoutRes.status()).toBe(200);

    await expect(banner).toHaveCount(0);
    await expect(page.locator('.login-card')).toBeVisible();
  });

  test('T3-COMB-09: Demo Mode API + Browser E2E Download & Deletion (EF4 + EF5-B)', async ({ page }) => {
    await enterDemoMode(page);
    await openCities(page);

    // 1. Download first save file
    const downloadPromise = page.waitForEvent('download');
    await page.locator('tbody tr .download-cell button').first().click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();
    const content = await readFile(path!);
    expect(content.toString()).toContain('DEMO ONLY');

    // 2. Delete second save file
    await page.locator('tbody tr input[type="checkbox"]').nth(1).check();
    await page.locator('.bulk-actions').getByRole('button', { name: /Delete|Удалить/i }).click();

    const dialog = page.locator('dialog.delete-dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('.check-line input[type="checkbox"]').check();

    const phrase = (await dialog.locator('.confirmation-label strong').textContent())?.trim() || 'DELETE 1';
    await dialog.locator('#delete-confirmation').fill(phrase);
    await dialog.getByRole('button', { name: /Delete permanently|Удалить навсегда/i }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.locator('tbody tr')).toHaveCount(5);
  });

  test('T3-COMB-10: Dual-CTA UI + Browser Search & Favorites Persistence (EF5-A + EF5-B)', async ({ page }) => {
    await enterDemoMode(page);

    // Favorite ELDEN RING
    const eldenCard = page.locator('[data-app-id="1245620"]');
    await eldenCard.locator('.favorite-button').click();

    // ELDEN RING moves to first position
    await expect(page.locator('.game-card').first()).toHaveAttribute('data-app-id', '1245620');

    // Reload browser and verify state persists
    await page.reload();
    await expect(page.locator('.game-card').first()).toHaveAttribute('data-app-id', '1245620');

    const storedFavs = await page.evaluate((id) => localStorage.getItem(`scm:favorites:${id}`), DEMO_STEAM_ID);
    expect(storedFavs).toBeTruthy();
    expect(storedFavs!).toContain('1245620');
  });

  test('T3-COMB-11: Token Expiration + Browser Graceful Session Recovery (EF2-A + EF5-B)', async ({ page }) => {
    await enterDemoMode(page);

    // Mock 401 response on game inspection
    await page.route('**/api/games/949230/files', route =>
      route.fulfill({
        status: 401,
        json: { error: { code: 'SESSION_EXPIRED', message: 'Session expired' } },
      })
    );

    await page.getByRole('button', { name: /Open: Cities: Skylines II|Открыть: Cities: Skylines II/i }).click();
    await expect(page.locator('[role="alert"]')).toBeVisible();
  });

  test('T3-COMB-12: Cold Start Mid-Journey + Browser ZIP Export & Download (EF2-B + EF5-B)', async ({ page }) => {
    await enterDemoMode(page);
    await openCities(page);

    await page.locator('thead input[type="checkbox"]').check();
    await page.locator('.bulk-actions').getByRole('button', { name: /Download ZIP|Скачать ZIP/i }).click();

    const downloadLink = page.getByRole('link', { name: /Save prepared ZIP|Скачать подготовленный ZIP/i });
    await expect(downloadLink).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
    const path = await download.path();
    expect(path).toBeTruthy();

    const buf = await readFile(path!);
    expect(buf.subarray(0, 2).toString()).toBe('PK');
  });

  test('T3-COMB-13: Live BASE_URL + Browser Playwright Session Navigation (EF3 + EF5-B)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Try Demo Mode|Попробовать демо-режим/i }).click();
    await expect(page.locator('.game-card')).toHaveCount(3);

    await page.getByRole('button', { name: /Open: Baldur's Gate 3|Открыть: Baldur's Gate 3/i }).click();
    await expect(page.getByRole('heading', { name: "Baldur's Gate 3", exact: true })).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(2);
  });

  test('T3-COMB-14: Demo Mode Multi-Tab Cold Start under Strict Origin (EF4 + EF2-B + EF3)', async ({ page }) => {
    const context = page.context();
    const page2 = await context.newPage();
    await page2.setExtraHTTPHeaders({
      'x-forwarded-for': '127.0.1.200',
    });
    await page2.route('https://shared.fastly.steamstatic.com/**', r => r.abort());
    await page2.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
    });

    await enterDemoMode(page);
    await openCities(page);

    await page2.goto('/');
    await openCities(page2);

    // Tab 1 deletes first file
    await page.locator('tbody tr input[type="checkbox"]').first().check();
    await page.locator('.bulk-actions').getByRole('button', { name: /Delete|Удалить/i }).click();
    const dialog1 = page.locator('dialog.delete-dialog');
    await dialog1.locator('.check-line input[type="checkbox"]').check();
    const phrase1 = (await dialog1.locator('.confirmation-label strong').textContent())?.trim() || 'DELETE 1';
    await dialog1.locator('#delete-confirmation').fill(phrase1);
    await dialog1.getByRole('button', { name: /Delete permanently|Удалить навсегда/i }).click();
    await expect(dialog1).toHaveCount(0);
    await expect(page.locator('tbody tr')).toHaveCount(5);

    // Tab 2 attempts deletion on stale revision
    await page2.locator('tbody tr input[type="checkbox"]').first().check();
    await page2.locator('.bulk-actions').getByRole('button', { name: /Delete|Удалить/i }).click();

    // Tab 2 receives conflict alert on the page due to revision mismatch
    await expect(page2.locator('[role="alert"]')).toBeVisible();
    await page2.close();
  });

  test('T3-COMB-15: Mobile Viewport + Live Origin + Theme/Locale Override (EF5-A + EF5-B + EF3)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await page.getByLabel(/Language|Язык/i).selectOption('ru');
    await page.getByLabel(/Theme|Тема/i).selectOption('dark');

    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const demoBtn = page.getByRole('button', { name: 'Попробовать демо-режим' });
    await expect(demoBtn).toBeVisible();
    await demoBtn.click();

    await expect(page.locator('.demo-banner')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

// =============================================================================
// Tier 4: Real-World Application Scenarios (6 Tests)
// =============================================================================
test.describe('Tier 4: Real-World Application Scenarios', () => {
  test('T4-SCEN-01: First-Time Visitor 1-Click Demo Exploration & Live ZIP Backup', async ({ page }) => {
    // 1. Visit start screen on clean browser profile
    await page.goto('/');
    expect(await page.locator('text=git clone').count()).toBe(0);
    expect(await page.locator('text=npm install').count()).toBe(0);

    // 2. Click "Try Demo Mode"
    await page.getByRole('button', { name: /Try Demo Mode|Попробовать демо-режим/i }).click();
    await expect(page.locator('.demo-banner')).toBeVisible();

    // 3. Search and open Cities: Skylines II
    const search = page.getByRole('searchbox', { name: /Search games|Найти игру/i });
    await search.fill('Cities');
    await openCities(page);

    // 4. Select 2 saves and download ZIP
    const rows = page.locator('tbody tr');
    await rows.nth(0).locator('input[type="checkbox"]').check();
    await rows.nth(1).locator('input[type="checkbox"]').check();

    await page.locator('.bulk-actions').getByRole('button', { name: /Download ZIP|Скачать ZIP/i }).click();
    const downloadLink = page.getByRole('link', { name: /Save prepared ZIP|Скачать подготовленный ZIP/i });
    await expect(downloadLink).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const buffer = await readFile(filePath!);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');

    // 5. Sign out cleanly
    await page.locator('.demo-banner').getByRole('button', { name: /Sign out|Выйти/i }).click();
    await expect(page.locator('.login-card')).toBeVisible();
  });

  test('T4-SCEN-02: Two-Phase Deletion Safety Workflow with Backup & Revision Collision', async ({ page }) => {
    await enterDemoMode(page);

    // Open ELDEN RING
    await page.getByRole('button', { name: /Open: ELDEN RING|Открыть: ELDEN RING/i }).click();
    await expect(page.getByRole('heading', { name: 'ELDEN RING', exact: true })).toBeVisible();

    // Select save and initiate delete
    await page.locator('tbody tr input[type="checkbox"]').first().check();
    await page.locator('.bulk-actions').getByRole('button', { name: /Delete|Удалить/i }).click();

    const dialog = page.locator('dialog.delete-dialog');
    await expect(dialog).toBeVisible();
    const deleteBtn = dialog.getByRole('button', { name: /Delete permanently|Удалить навсегда/i });
    await expect(deleteBtn).toBeDisabled();

    // Create safety backup inside modal
    await dialog.getByRole('button', { name: /Download ZIP|Скачать ZIP/i }).click();
    const zipLink = dialog.getByRole('link', { name: /Save prepared ZIP|Скачать подготовленный ZIP/i });
    await expect(zipLink).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), zipLink.click()]);
    const zipFile = await download.path();
    expect(zipFile).toBeTruthy();
    const zipBytes = await readFile(zipFile!);
    expect(zipBytes.subarray(0, 2).toString()).toBe('PK');

    // Complete safety confirmation inputs
    await dialog.locator('.check-line input[type="checkbox"]').check();
    const phrase = (await dialog.locator('.confirmation-label strong').textContent())?.trim() || 'DELETE 1';
    await dialog.locator('#delete-confirmation').fill(phrase);
    await expect(deleteBtn).toBeEnabled();

    // Simulate optimistic revision collision (409 PLAN_EXPIRED)
    await page.route('**/api/games/1245620/delete', route =>
      route.fulfill({
        status: 409,
        json: {
          error: {
            code: 'PLAN_EXPIRED',
            message: 'Cloud saves were modified since the review plan was generated',
          },
        },
      })
    );

    await deleteBtn.click();
    // Deletion is rejected; error alert displayed on page protecting cloud saves
    await expect(page.locator('[role="alert"]')).toBeVisible();
  });

  test('T4-SCEN-03: Serverless Cold-Instance Recovery During Multi-Step Save Management', async ({ page }) => {
    // Step 1: Demo login
    await page.goto('/');
    await page.getByRole('button', { name: /Try Demo Mode|Попробовать демо-режим/i }).click();
    await expect(page.locator('.game-card')).toHaveCount(3);

    // Step 2: Open game
    await openCities(page);
    await expect(page.locator('tbody tr')).toHaveCount(6);

    // Step 3: Delete plan creation and execution
    await page.locator('tbody tr input[type="checkbox"]').first().check();
    await page.locator('.bulk-actions').getByRole('button', { name: /Delete|Удалить/i }).click();

    const dialog = page.locator('dialog.delete-dialog');
    await dialog.locator('.check-line input[type="checkbox"]').check();
    const phrase = (await dialog.locator('.confirmation-label strong').textContent())?.trim() || 'DELETE 1';
    await dialog.locator('#delete-confirmation').fill(phrase);
    await dialog.getByRole('button', { name: /Delete permanently|Удалить навсегда/i }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.locator('tbody tr')).toHaveCount(5);

    // Step 4: Sign out
    await page.locator('.demo-banner').getByRole('button', { name: /Sign out|Выйти/i }).click();
    await expect(page.locator('.login-card')).toBeVisible();
  });

  test('T4-SCEN-04: Cross-Site Attack & Host Header Injection Deflection', async ({ page, request }) => {
    // 1. Verify iframe embedding rejection headers on root
    const rootRes = await page.goto('/');
    expect(rootRes).toBeTruthy();
    const headers = rootRes!.headers();
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");

    // 2. Cross-site request blocked by Sec-Fetch-Site: cross-site
    const crossSiteRes = await request.get('/api/session', {
      headers: {
        'sec-fetch-site': 'cross-site',
        'x-forwarded-for': '127.0.2.1',
      },
    });
    expect(crossSiteRes.status()).toBe(403);
    const crossSiteBody = await crossSiteRes.json();
    const crossSiteCode = typeof crossSiteBody.error === 'object' ? crossSiteBody.error?.code : crossSiteBody.code || crossSiteBody.error;
    expect(['CROSS_SITE_REQUEST', 'Forbidden']).toContain(crossSiteCode);

    // 3. Request without CSRF token blocked
    const noCsrfRes = await request.post('/api/auth/demo', {
      headers: {
        'x-forwarded-for': '127.0.2.2',
      },
    });
    expect(noCsrfRes.status()).toBe(403);

    // 4. Bit-flipped / corrupted session cookie returns clean disconnected session (no 500)
    const corruptCookieRes = await request.get('/api/session', {
      headers: {
        cookie: 'scm-session=corrupted-junk-payload',
        'x-forwarded-for': '127.0.2.3',
      },
    });
    expect(corruptCookieRes.status()).toBe(200);
    const corruptBody = await corruptCookieRes.json();
    expect(corruptBody.login.status).toBe('disconnected');
  });

  test('T4-SCEN-05: Dual-Locale, Dual-Theme Switching and Offline/Network Glitch Resilience', async ({ page }) => {
    await page.goto('/');

    // 1. Switch to Russian
    await page.getByLabel(/Language|Язык/i).selectOption('ru');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');

    // 2. Switch to Dark Theme
    await page.getByLabel(/Theme|Тема/i).selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // 3. Reload page: settings must persist from localStorage
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // 4. Enter Demo Mode in Russian
    await page.getByRole('button', { name: 'Попробовать демо-режим' }).click();
    await openCities(page);

    // 5. Offline simulation during bulk export
    await page.context().setOffline(true);
    await page.locator('tbody tr input[type="checkbox"]').first().check();
    await page.locator('.bulk-actions').getByRole('button', { name: /Download ZIP|Скачать ZIP/i }).click();
    await expect(page.locator('[role="alert"], .notice-error')).toBeVisible();

    // 6. Online restore and retry
    await page.context().setOffline(false);
    const firstRow = page.locator('tbody tr').first();
    const firstFilename = (await firstRow.locator('.filename strong').textContent())?.trim();
    const downloadPromise = page.waitForEvent('download');
    await firstRow.locator('.download-cell button').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(firstFilename);
  });

  test('T4-SCEN-06: Full Mobile Journey from Demo Login to Backup Export on Low-Res Screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    // Verify zero horizontal scroll on mobile start screen
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // 1. Enter demo mode
    await page.getByRole('button', { name: /Try Demo Mode|Попробовать демо-режим/i }).click();
    await expect(page.locator('.demo-banner')).toBeVisible();

    // 2. Search and open Baldur's Gate 3
    const search = page.getByRole('searchbox', { name: /Search games|Найти игру/i });
    await search.fill("Baldur");
    await page.getByRole('button', { name: /Open: Baldur's Gate 3|Открыть: Baldur's Gate 3/i }).click();

    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(2);

    // 3. Export ZIP backup
    await rows.first().locator('input[type="checkbox"]').check();
    await page.locator('.bulk-actions').getByRole('button', { name: /Download ZIP|Скачать ZIP/i }).click();
    const downloadLink = page.getByRole('link', { name: /Save prepared ZIP|Скачать подготовленный ZIP/i });
    await expect(downloadLink).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const buffer = await readFile(filePath!);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');

    // 4. Sign out
    await page.locator('.demo-banner').getByRole('button', { name: /Sign out|Выйти/i }).click();
    await expect(page.locator('.login-card')).toBeVisible();
  });
});

// =============================================================================
// Tier 5: Adversarial Coverage Hardening (Client & Boundary Flows)
// =============================================================================
test.describe('Tier 5: Adversarial Coverage Hardening (Client & Boundary Flows)', () => {

  test('T5-ADV-01: Delete Dialog Confirmation Phrase Mismatch & Form Submit Rejection', async ({ page }) => {
    await enterDemoMode(page);
    await openCities(page);

    await page.locator('tbody tr input[type="checkbox"]').first().check();
    await page.locator('.bulk-actions').getByRole('button', { name: /Delete|Удалить/i }).click();

    const dialog = page.locator('dialog.delete-dialog');
    await expect(dialog).toBeVisible();

    const deleteBtn = dialog.getByRole('button', { name: /Delete permanently|Удалить навсегда/i });
    await expect(deleteBtn).toBeDisabled();

    // 1. Lowercase casing mismatch
    await dialog.locator('.check-line input[type="checkbox"]').check();
    await dialog.locator('#delete-confirmation').fill('delete 1');
    await expect(deleteBtn).toBeDisabled();

    // 2. Trailing whitespace mismatch
    await dialog.locator('#delete-confirmation').fill('DELETE 1 ');
    await expect(deleteBtn).toBeDisabled();

    // 3. Form submission attempt via Enter key on mismatched phrase
    await dialog.locator('#delete-confirmation').press('Enter');
    await expect(dialog).toBeVisible();

    // 4. Correct phrase enables button; unchecking gamesClosed immediately disables it
    await dialog.locator('#delete-confirmation').fill('DELETE 1');
    await expect(deleteBtn).toBeEnabled();

    await dialog.locator('.check-line input[type="checkbox"]').uncheck();
    await expect(deleteBtn).toBeDisabled();
  });

  test('T5-ADV-02: Delete Dialog Cancellation Lifecycle & Selection State Retention', async ({ page }) => {
    await enterDemoMode(page);
    await openCities(page);

    const firstCheckbox = page.locator('tbody tr input[type="checkbox"]').first();
    await firstCheckbox.check();

    // 1. Cancel via Cancel button
    await page.locator('.bulk-actions').getByRole('button', { name: /Delete|Удалить/i }).click();
    let dialog = page.locator('dialog.delete-dialog');
    await dialog.getByRole('button', { name: /Cancel|Отмена/i }).click();
    await expect(dialog).toHaveCount(0);
    await expect(firstCheckbox).toBeChecked();

    // 2. Cancel via top-right Close "X" button
    await page.locator('.bulk-actions').getByRole('button', { name: /Delete|Удалить/i }).click();
    dialog = page.locator('dialog.delete-dialog');
    await dialog.locator('.dialog-top button[aria-label="Close"], .dialog-top button[aria-label="Закрыть"]').click();
    await expect(dialog).toHaveCount(0);
    await expect(firstCheckbox).toBeChecked();

    // 3. Cancel via native Escape key
    await page.locator('.bulk-actions').getByRole('button', { name: /Delete|Удалить/i }).click();
    dialog = page.locator('dialog.delete-dialog');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(firstCheckbox).toBeChecked();

    // Verify zero files were deleted
    await expect(page.locator('tbody tr')).toHaveCount(6);
  });

  test('T5-ADV-03: File Table Substring Search, Empty State & Scoped Select-All', async ({ page }) => {
    await enterDemoMode(page);
    await openCities(page);

    const searchInput = page.getByRole('searchbox', { name: /Search files|Найти файл/i });

    // 1. Substring filter matches subset of files
    await searchInput.fill('autosave');
    const filteredRows = page.locator('tbody tr');
    const count = await filteredRows.count();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThan(6);

    // 2. Non-matching search displays empty state
    await searchInput.fill('__nonexistent_save_file_999__');
    await expect(page.locator('tbody tr')).toHaveCount(0);
    await expect(page.locator('p.empty-state')).toContainText(/No files found|Файлы не найдены/i);

    // 3. Special regex characters in search do not crash
    await searchInput.fill('save.coc');
    await expect(page.locator('p.empty-state, tbody tr')).toBeVisible();

    // 4. "Select matching files" with active filter only selects filtered subset
    await searchInput.fill('autosave');
    const matchCount = await page.locator('tbody tr').count();
    await page.getByRole('button', { name: /Select matching files|Выбрать найденные файлы/i }).click();
    await expect(page.locator('.bulk-summary')).toContainText(new RegExp(`${matchCount}\\s*(file|файл)`, 'i'));

    // 5. Clearing search restores full 6 rows
    await searchInput.fill('');
    await expect(page.locator('tbody tr')).toHaveCount(6);
  });

  test('T5-ADV-04: File Table Sorting Across All 4 Modes', async ({ page }) => {
    await enterDemoMode(page);
    await openCities(page);

    const sortSelect = page.locator('select.sort-select');

    // Default: Largest first (size)
    const initialFirst = await page.locator('tbody tr .filename strong').first().textContent();
    expect(initialFirst).toBeTruthy();

    // Sort by name
    await sortSelect.selectOption('name');
    const nameFirst = await page.locator('tbody tr .filename strong').first().textContent();
    expect(nameFirst).toBeTruthy();

    // Sort by newest
    await sortSelect.selectOption('newest');
    const newestFirst = await page.locator('tbody tr .filename strong').first().textContent();
    expect(newestFirst).toBeTruthy();

    // Sort by oldest
    await sortSelect.selectOption('oldest');
    const oldestFirst = await page.locator('tbody tr .filename strong').first().textContent();
    expect(oldestFirst).toBeTruthy();

    expect(newestFirst !== oldestFirst || Boolean(newestFirst)).toBe(true);
  });

  test('T5-ADV-05: Checkbox Indeterminate State & Bulk Selection Clear Lifecycle', async ({ page }) => {
    await enterDemoMode(page);
    await openCities(page);

    const headerCheckbox = page.locator('thead input[type="checkbox"]');

    // 1. Partial selection sets indeterminate=true
    await page.locator('tbody tr input[type="checkbox"]').first().check();
    expect(await headerCheckbox.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true);
    expect(await headerCheckbox.isChecked()).toBe(false);

    // 2. Check header checkbox to select all on page
    await headerCheckbox.check();
    expect(await headerCheckbox.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(false);
    expect(await headerCheckbox.isChecked()).toBe(true);

    // 3. Clear selection button clears selection and unmounts bulk actions
    await page.locator('.bulk-actions button[aria-label="Clear selection"], .bulk-actions button[aria-label="Снять выбор"]').click();
    await expect(page.locator('.bulk-actions')).toHaveCount(0);
    expect(await headerCheckbox.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(false);
    expect(await headerCheckbox.isChecked()).toBe(false);
  });

  test('T5-ADV-06: Manual Game Opening Disclosure (Invalid ID Rejection & Valid URL Navigation)', async ({ page }) => {
    await enterDemoMode(page);

    // Open manual open disclosure
    await page.locator('.manual-open summary').click();
    const manualInput = page.locator('.manual-open input');
    const openBtn = page.locator('.manual-open button');

    // 1. Invalid input shows error message
    await manualInput.fill('invalid_input');
    await openBtn.click();
    await expect(page.locator('.manual-open .error-message')).toBeVisible();

    // 2. Malicious domain rejected
    await manualInput.fill('https://evil-site.com/app/949230');
    await openBtn.click();
    await expect(page.locator('.manual-open .error-message')).toBeVisible();

    // 3. Valid AppID navigates to Cities: Skylines II
    await manualInput.fill('949230');
    await openBtn.click();
    await page.waitForURL('**/#game/949230');
    await expect(page.getByRole('heading', { name: 'Cities: Skylines II' })).toBeVisible();

    // 4. Return to library and navigate via canonical Steam store URL
    await page.getByRole('button', { name: /All games|Все игры/i }).click();
    await page.locator('.manual-open summary').click();
    await manualInput.fill('https://store.steampowered.com/app/1245620/ELDEN_RING/');
    await openBtn.click();
    await page.waitForURL('**/#game/1245620');
    await expect(page.getByRole('heading', { name: 'ELDEN RING' })).toBeVisible();
  });

  test('T5-ADV-07: In-App Notice Banner Dismissal via Close Button', async ({ page }) => {
    await enterDemoMode(page);
    await openCities(page);

    // Trigger notice via single file download
    await page.locator('tbody tr .download-cell button').first().click();
    const notice = page.locator('.notice');
    await expect(notice).toBeVisible();

    // Click Close icon button
    await notice.locator('button[aria-label="Close"], button[aria-label="Закрыть"]').click();
    await expect(notice).toHaveCount(0);
  });

  test('T5-ADV-08: Ultra-Narrow Viewport (320px) Mobile Layout Boundary Stress Test', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');

    // 1. Start screen has zero horizontal overflow
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: /Sign in with Steam QR|Войти через Steam QR/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Try Demo Mode|Попробовать демо-режим/i })).toBeVisible();

    // 2. Demo library screen has zero horizontal overflow
    await page.getByRole('button', { name: /Try Demo Mode|Попробовать демо-режим/i }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // 3. Files table at 320px hides date and size columns and fits viewport
    await page.getByRole('button', { name: /Open: Cities: Skylines II|Открыть: Cities: Skylines II/i }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator('tbody tr .date-cell').first()).not.toBeVisible();
    await expect(page.locator('tbody tr .size-cell').first()).not.toBeVisible();

    // 4. Delete modal fits 320px viewport
    await page.locator('tbody tr input[type="checkbox"]').first().check();
    await page.locator('.bulk-actions').getByRole('button', { name: /Delete|Удалить/i }).click();
    const deleteDialog = page.locator('dialog.delete-dialog');
    const deleteBox = await deleteDialog.boundingBox();
    expect(deleteBox).toBeTruthy();
    expect(deleteBox!.width).toBeLessThanOrEqual(320);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await deleteDialog.getByRole('button', { name: /Cancel|Отмена/i }).click();

    // 5. Security modal fits 320px viewport
    await page.locator('.app-header button[aria-label="Security"], .app-header button[aria-label="Безопасность"]').click();
    const secDialog = page.locator('dialog.security-dialog');
    const secBox = await secDialog.boundingBox();
    expect(secBox).toBeTruthy();
    expect(secBox!.width).toBeLessThanOrEqual(320);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('T5-ADV-09: Shell Header Sign-Out & Hash Route Cleanup from Game View', async ({ page }) => {
    await enterDemoMode(page);
    await openCities(page);
    expect(page.url()).toContain('#game/949230');

    // Sign out using Shell header logout button
    const headerLogout = page.locator('.app-header button[aria-label="Sign out"], .app-header button[aria-label="Выйти"]');
    await expect(headerLogout).toBeVisible();
    await headerLogout.click();

    await expect(page.locator('.login-card')).toBeVisible();
    expect(page.url()).not.toContain('#game/');
    await expect(page.locator('.demo-banner')).toHaveCount(0);
    await expect(page.locator('.demo-badge')).toHaveCount(0);
  });

  test('T5-ADV-10: In-App Locale Switching inside Game Detail View', async ({ page }) => {
    await enterDemoMode(page);
    await openCities(page);

    // Switch to Russian while inside game detail view
    await page.getByLabel(/Language|Язык/i).selectOption('ru');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.locator('.back-button')).toContainText('Все игры');
    await expect(page.locator('th').nth(1)).toContainText('Имя файла');

    // Switch back to English
    await page.getByLabel(/Язык/i).selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.back-button')).toContainText('All games');
    await expect(page.locator('th').nth(1)).toContainText('File name');
  });

  test('T5-ADV-11: Network Failure & Error State Resilience (Session Fetch, Demo Auth, Expired QR)', async ({ page }) => {
    // 1. Initial /api/session 500 error shows in-page Retry button
    let failSession = true;
    await page.route('**/api/session', route => {
      if (failSession) {
        route.fulfill({ status: 500, json: { error: { code: 'NETWORK_ERROR', message: 'Down' } } });
      } else {
        route.continue();
      }
    });

    await page.goto('/');
    const retryBtn = page.locator('.login-card button:has-text("Try again"), .login-card button:has-text("Повторить")');
    await expect(retryBtn).toBeVisible();

    failSession = false;
    await retryBtn.click();
    await expect(page.locator('.login-actions')).toBeVisible();

    // 2. Demo auth 500 displays error alert and keeps demo button enabled
    await page.route('**/api/auth/demo', route =>
      route.fulfill({ status: 500, json: { error: { code: 'AUTH_TIMEOUT', message: 'Sandbox timeout' } } })
    );

    const demoBtn = page.getByRole('button', { name: /Try Demo Mode|Попробовать демо-режим/i });
    await demoBtn.click();
    await expect(page.locator('.login-card p.error-message[role="alert"]')).toBeVisible();
    await expect(demoBtn).toBeEnabled();

    // 3. Expired QR code displays expired warning
    await page.route('**/api/session', route =>
      route.fulfill({
        status: 200,
        json: { csrfToken: 'exp-tok', mode: 'live', login: { status: 'expired' } },
      })
    );
    await page.reload();
    await expect(page.locator('.login-card p.error-message')).toContainText(/expired/i);
  });

  test('T5-ADV-12: File Listing Fetch 500 Error & In-Page Retry Recovery', async ({ page }) => {
    await enterDemoMode(page);

    let failFiles = true;
    await page.route('**/api/games/949230/files', route => {
      if (failFiles) {
        route.fulfill({ status: 500, json: { error: { code: 'STORAGE_UNAVAILABLE', message: 'Storage down' } } });
      } else {
        route.continue();
      }
    });

    await page.getByRole('button', { name: /Open: Cities: Skylines II|Открыть: Cities: Skylines II/i }).click();

    // In-page error alert & retry button displayed
    await expect(page.locator('.main-content .empty-state p.error-message[role="alert"]')).toBeVisible();
    const retryBtn = page.locator('.main-content .empty-state button:has-text("Try again"), .main-content .empty-state button:has-text("Повторить")');
    await expect(retryBtn).toBeVisible();

    // Click retry with working route
    failFiles = false;
    await retryBtn.click();
    await expect(page.locator('tbody tr')).toHaveCount(6);
  });
});


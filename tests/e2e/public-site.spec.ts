import { test, expect } from '@playwright/test';

const publicBase = 'http://127.0.0.1:3111';

test.describe('Tier 4: Real-World Public Site E2E Journeys', () => {
  test('T4-01: GitHub Pages New Visitor Journey (prerendered, subpath, zero network leaks)', async ({ page }) => {
    const outboundRequests: string[] = [];
    page.on('request', req => outboundRequests.push(req.url()));

    const response = await page.goto(`${publicBase}/steam-cloud-manager/en/`);
    expect(response?.status()).toBe(200);

    // Verify prerendered heading, lead paragraph and feature list
    const heading = page.getByRole('heading', { name: 'Steam Cloud save manager', exact: true });
    await expect(heading).toBeVisible();
    await expect(page.locator('p.lead')).toContainText('View, back up and delete Steam Cloud saves on your computer.');

    const featureList = page.locator('ul.features li');
    await expect(featureList).toHaveCount(3);
    await expect(featureList.nth(0)).toHaveText('Browse saves by game');
    await expect(featureList.nth(1)).toHaveText('Download files and ZIP backups');
    await expect(featureList.nth(2)).toHaveText('Delete selected saves with confirmation');

    // Confirm zero backend API or Steam network calls
    const privateCalls = outboundRequests.filter(url =>
      url.includes('/api/') || url.includes('steampowered.com') || url.includes('steamserver.net')
    );
    expect(privateCalls).toEqual([]);
  });

  test('T4-02: Bilingual Navigation & Subpath Journey (EN -> RU -> brand -> back/forward)', async ({ page }) => {
    await page.goto(`${publicBase}/steam-cloud-manager/en/`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'Steam Cloud save manager', exact: true })).toBeVisible();

    // Click Russian language switcher link
    await page.getByRole('link', { name: 'RU', exact: true }).click();
    await expect(page).toHaveURL(/\/ru\/?$/);

    // Document language and Russian copy verification
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.getByRole('heading', { name: 'Менеджер сохранений Steam Cloud', exact: true })).toBeVisible();
    await expect(page.locator('ul.features li').nth(0)).toHaveText('Просмотр сохранений по играм');

    // Brand link should preserve language
    await page.locator('a.brand').click();
    await expect(page).toHaveURL(/\/ru\/?$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.getByRole('heading', { name: 'Менеджер сохранений Steam Cloud', exact: true })).toBeVisible();

    // Browser back/forward navigation
    await page.goBack();
    await expect(page).toHaveURL(/\/en\/?$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'Steam Cloud save manager', exact: true })).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/\/ru\/?$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.getByRole('heading', { name: 'Менеджер сохранений Steam Cloud', exact: true })).toBeVisible();
  });

  test('T4-03: Security & Privacy Audit Journey (dialog, disclosures, escape trap, zero cookies, CSP)', async ({ page }) => {
    await page.goto(`${publicBase}/steam-cloud-manager/en/`);

    // Open security disclosures modal
    const trigger = page.getByRole('button', { name: 'Security', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Verify key architectural security commitments
    await expect(dialog).toContainText('Steam tokens stay in the memory of the local process');
    await expect(dialog).toContainText('The backend binds only to loopback addresses');
    await expect(dialog).toContainText('This is not a security audit or a guarantee');

    // Verify external SECURITY.md link attributes
    const securityLink = dialog.getByRole('link', { name: 'SECURITY.md' });
    await expect(securityLink).toHaveAttribute('target', '_blank');
    await expect(securityLink).toHaveAttribute('rel', 'noreferrer');

    // Verify focus trap inside dialog:
    // 1. Initial focus lands on the first focusable element inside dialog (Close X button)
    const closeTop = dialog.getByRole('button', { name: 'Close' }).first();
    const closeBottom = dialog.getByRole('button', { name: 'Close' }).last();
    await expect(closeTop).toBeFocused();

    // 2. Tab forward to SECURITY.md link
    await page.keyboard.press('Tab');
    await expect(securityLink).toBeFocused();

    // 3. Tab forward to bottom Close button (last focusable element)
    await page.keyboard.press('Tab');
    await expect(closeBottom).toBeFocused();

    // 4. Tab past last focusable element wraps back to the first interactive element inside dialog
    await page.keyboard.press('Tab');
    await expect(closeTop).toBeFocused();
    const focusInsideDialog = await page.evaluate(() => Boolean(document.activeElement?.closest('dialog')));
    expect(focusInsideDialog).toBe(true);

    // Dismiss with Escape key
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Verify focus is restored to the Security trigger button
    await expect(trigger).toBeFocused();
    const activeRole = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(activeRole).toBe('Security');

    // Verify zero cookies are set
    const cookies = await page.evaluate(() => document.cookie);
    expect(cookies).toBe('');

    // Verify CSP meta tag exists in head with connect-src 'none'
    const cspMeta = await page.evaluate(() =>
      document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')
    );
    expect(cspMeta).toBeTruthy();
    expect(cspMeta).toContain("connect-src 'none'");
  });

  test('T4-04: Developer Onboarding & Installation Journey (smooth scroll, terminal, local app link)', async ({ page }) => {
    await page.goto(`${publicBase}/steam-cloud-manager/en/`);

    // Click Run locally hero button
    await page.getByRole('link', { name: 'Run locally', exact: true }).click();
    await expect(page.locator('#install')).toBeInViewport();

    // Check terminal installation instructions
    const terminalCode = await page.locator('pre.terminal code').innerText();
    expect(terminalCode).toContain('git clone https://github.com/famence/steam-cloud-manager.git');
    expect(terminalCode).toContain('cd steam-cloud-manager');
    expect(terminalCode).toContain('npm ci');
    expect(terminalCode).toContain('npm run build');
    expect(terminalCode).toContain('npm start');

    // Check Open Local App button
    const openLocalApp = page.getByRole('link', { name: 'Open local app', exact: true });
    await expect(openLocalApp).toHaveAttribute('href', 'http://127.0.0.1:3000');
    await expect(openLocalApp).toHaveAttribute('target', '_blank');
    await expect(openLocalApp).toHaveAttribute('rel', 'noreferrer');

    // Check Source code GitHub link
    const sourceCode = page.getByRole('link', { name: 'Source code', exact: true });
    await expect(sourceCode).toHaveAttribute('href', 'https://github.com/famence/steam-cloud-manager');
    await expect(sourceCode).toHaveAttribute('target', '_blank');
    await expect(sourceCode).toHaveAttribute('rel', 'noreferrer');
  });

  test('T4-05: Theme Customization & Mobile Journey (390x844, zero horizontal overflow, persistence)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark' });

    await page.goto(`${publicBase}/steam-cloud-manager/en/`);

    // Verify zero horizontal scroll overflow on mobile viewport
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasHorizontalOverflow).toBe(false);

    // Switch theme to 'light' manually
    const themeSelect = page.getByLabel('Theme', { exact: true });
    await themeSelect.selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    const storedTheme = await page.evaluate(() => localStorage.getItem('scm:theme'));
    expect(storedTheme).toBe('light');

    // Reload and assert light theme is preserved without flashing
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Switch to dark theme
    await page.getByLabel('Theme', { exact: true }).selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Switch to system theme
    await page.getByLabel('Theme', { exact: true }).selectOption('system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('T4-06: Static Offline & Network Invariant Journey (offline mode, CSP enforcement)', async ({ page }) => {
    const recordedCalls: string[] = [];
    page.on('request', req => recordedCalls.push(req.url()));

    await page.goto(`${publicBase}/steam-cloud-manager/en/`);
    await page.waitForLoadState('domcontentloaded');

    // Simulate going offline
    await page.context().setOffline(true);

    // Theme selector works completely offline
    await page.getByLabel('Theme', { exact: true }).selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Security dialog opens and closes offline
    await page.getByRole('button', { name: 'Security', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // In-page navigation works offline
    await page.getByRole('link', { name: 'Run locally', exact: true }).click();
    await expect(page.locator('#install')).toBeInViewport();

    // Restore online state
    await page.context().setOffline(false);

    // Verify zero API/Steam requests made during entire session
    expect(recordedCalls.some(url => url.includes('/api/') || url.includes('steampowered.com'))).toBe(false);

    // Verify CSP blocks any programmatic fetch attempt
    const blockedByCSP = await page.evaluate(async () => {
      try {
        await fetch('https://api.steampowered.com/test');
        return false;
      } catch {
        return true;
      }
    });
    expect(blockedByCSP).toBe(true);
  });
});

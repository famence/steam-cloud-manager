import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const steamId = '76561198000000000';
async function signIn(page: Page) {
  await page.route('https://shared.fastly.steamstatic.com/**', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Open demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Games/ })).toBeVisible();
  await expect(page.locator('.game-card')).toHaveCount(3);
}
async function openCities(page: Page) {
  await page.getByRole('button', { name: 'Open: Cities: Skylines II', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(6);
}

test('favorites, locale and theme persist, without storing Steam session data', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Add to favorites: ELDEN RING', exact: true }).click();
  await expect(page.locator('.game-card').first()).toHaveAttribute('data-app-id', '1245620');
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Language', { exact: true }).selectOption('ru');
  await expect(page.getByRole('heading', { name: /^Игры/ })).toBeVisible();
  await page.reload();
  await expect(page.locator('.game-card').first()).toHaveAttribute('data-app-id', '1245620');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  const stored = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(stored).toEqual([`scm:favorites:${steamId}`, 'scm:language', 'scm:theme'].sort());
  await page.screenshot({ path: 'test-results/library-dark.png', fullPage: true });
});

test('system theme follows system changes; manual setting overrides them', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('navigation back preserves search and the selected game is not auto-opened', async ({ page }) => {
  await signIn(page); await page.getByRole('searchbox', { name: 'Search games' }).fill('Cities');
  await openCities(page); await page.goBack();
  await expect(page.getByRole('searchbox', { name: 'Search games' })).toHaveValue('Cities');
  await page.goForward(); await expect(page.getByRole('heading', { name: 'Cities: Skylines II', exact: true })).toBeVisible();
});

test('game cards are revealed on scroll, not all at once', async ({ page }) => {
  const games = Array.from({ length: 72 }, (_, i) => ({ appId: 1000 + i, name: `Game ${String(i).padStart(3, '0')}`, fileCount: 1, totalBytes: 10, cloudSupport: 'supported' }));
  await page.route('**/api/games', route => route.fulfill({ json: { games } }));
  await page.route('https://shared.fastly.steamstatic.com/**', route => route.abort());
  await page.goto('/'); await page.getByRole('button', { name: 'Open demo', exact: true }).click();
  await expect(page.locator('.game-card')).toHaveCount(24);
  await page.locator('.load-more').scrollIntoViewIfNeeded();
  await expect(page.locator('.game-card')).toHaveCount(48);
});

test('failed checks stay unknown; confirmed empty and unsupported games go last', async ({ page }) => {
  const games = [
    { appId: 1, name: 'A empty', fileCount: 0, totalBytes: 0 },
    { appId: 2, name: 'B unsupported', fileCount: null, totalBytes: null, cloudSupport: 'unsupported' },
    { appId: 3, name: 'C unknown', fileCount: null, totalBytes: null },
    { appId: 4, name: 'D available', fileCount: 1, totalBytes: 10 },
  ];
  await page.route('**/api/games', route => route.fulfill({ json: { games } }));
  await page.route('**/api/games/3/summary', route => route.fulfill({ status: 502, json: { error: { code: 'STEAM_RESULT_2', message: 'test' } } }));
  await page.route('https://shared.fastly.steamstatic.com/**', route => route.abort());
  await page.goto('/'); await page.getByRole('button', { name: 'Open demo', exact: true }).click();
  await expect(page.locator('.game-card')).toHaveCount(4);
  await expect(page.locator('[data-app-id="3"]')).not.toHaveClass(/game-inactive/);
  await expect(page.locator('[data-app-id="3"]')).toContainText('Could not check');
  const order = await page.locator('.game-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-app-id')));
  expect(order).toEqual(['3', '4', '1', '2']);
});

test('backup link works inside the deletion dialog; explicit confirmation is still required', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }); });
  await signIn(page); await openCities(page);
  const checkbox = page.locator('tbody input[type=checkbox]').first(); await checkbox.check();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Delete permanently', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  const link = dialog.getByRole('link', { name: 'Save prepared ZIP', exact: true });
  await expect(link).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  const file = await download.path(); expect(file).not.toBeNull();
  const zip = await readFile(file!); expect(zip.subarray(0, 2).toString()).toBe('PK');
  expect(zip.includes(Buffer.from('DEMO ONLY'))).toBeTruthy();
  await dialog.getByRole('checkbox').check(); await dialog.locator('#delete-confirmation').fill('DELETE 1');
  await dialog.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('tbody tr')).toHaveCount(5);
});

test('backup failure is visible in the dialog', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }); });
  await signIn(page); await openCities(page); await page.locator('tbody input[type=checkbox]').first().check();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.route('**/api/games/*/exports', route => route.fulfill({ status: 502, json: { error: { code: 'DOWNLOAD_REJECTED', message: 'test' } } }));
  await page.getByRole('dialog').getByRole('button', { name: 'Download ZIP', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('could not be downloaded');
});

test('mobile layout has no horizontal overflow and security text is accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await signIn(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Security', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('not an independent security audit');
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/library-mobile.png', fullPage: true });
});

test('public site is prerendered, localized and makes no Steam/session requests', async ({ page, request }) => {
  const calls: string[] = []; page.on('request', req => calls.push(req.url()));
  const html = await (await request.get('http://127.0.0.1:3111/en/')).text();
  expect(html).toContain('Steam Cloud save manager'); expect(html).toContain('made by ');
  await page.goto('http://127.0.0.1:3111/en/');
  await expect(page.getByRole('heading', { name: 'Steam Cloud save manager', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'RU', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.getByRole('heading', { name: 'Менеджер сохранений Steam Cloud', exact: true })).toBeVisible();
  await page.getByLabel('Тема', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Безопасность', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('не заменяет независимый аудит');
  await page.keyboard.press('Escape');
  expect(calls.some(url => url.includes('/api/') || url.includes('steampowered.com') || url.includes('steamserver.net'))).toBeFalsy();
  const available = await request.get('http://127.0.0.1:3111/api/session'); expect(available.status()).toBe(200);
  await page.screenshot({ path: 'test-results/public-ru.png', fullPage: true });
});

test('Vercel-only /app/ signs in with a demo session and renders the Steam library', async ({page}) => {
  await page.route('https://shared.fastly.steamstatic.com/**', route => route.abort());
  await page.goto('http://127.0.0.1:3111/app/');
  await page.getByRole('button',{name:'Open demo',exact:true}).click();
  await expect(page.getByRole('heading',{name:/^Games/})).toBeVisible();
  await page.getByRole('button',{name:'Open: Cities: Skylines II',exact:true}).click();
  await expect(page.locator('tbody tr')).toHaveCount(6);
  await page.locator('tbody input[type=checkbox]').first().check();
  await page.getByRole('button',{name:'Delete',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('request failed');
});

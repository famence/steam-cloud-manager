import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.', timeout: 30_000, fullyParallel: false, workers: 1,
  forbidOnly: Boolean(process.env.CI), retries: process.env.CI ? 1 : 0,
  reporter: 'list', use: { baseURL: 'http://127.0.0.1:3110', locale: 'en-US', trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1200, height: 850 } } }],
  webServer: [
    { command: 'npm start', cwd: process.cwd(), url: 'http://127.0.0.1:3110/api/health', env: { PORT: '3110', DEMO_MODE: 'true' }, reuseExistingServer: false },
    { command: 'node scripts/preview-public.mjs', cwd: process.cwd(), url: 'http://127.0.0.1:3111/en/', reuseExistingServer: false },
  ],
});

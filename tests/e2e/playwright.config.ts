import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:3110';
const isExternal = Boolean(process.env.BASE_URL);

export default defineConfig({
  testDir: '.',
  // Segregate legacy static landing page E2E suite (public-site.spec.ts requires legacy port 3111 preview server)
  // Strictly target core full-stack web application journeys (app.spec.ts)
  testMatch: ['**/app.spec.ts'],
  testIgnore: ['**/public-site.spec.ts'],
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  outputDir: 'test-results/artifacts',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/html' }],
  ],
  use: {
    baseURL,
    locale: 'en-US',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1200, height: 850 },
      },
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  // If targeting a live hosted environment (BASE_URL set), skip local webServer spawn
  webServer: isExternal
    ? undefined
    : {
        command: 'npm start',
        cwd: process.cwd(),
        url: 'http://127.0.0.1:3110/api/health',
        env: {
          PORT: '3110',
          DEMO_MODE: 'true',
          NODE_ENV: 'production',
          SCM_SESSION_KEY: process.env.SCM_SESSION_KEY || 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
        },
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});

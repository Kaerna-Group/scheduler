import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4179/scheduler/',
    locale: 'en-US',
    timezoneId: 'Europe/Kyiv',
    contextOptions: { reducedMotion: 'reduce' },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: '**/pwa.spec.ts',
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testIgnore: '**/pwa.spec.ts',
    },
    {
      name: 'pwa',
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'allow' },
      testMatch: '**/pwa.spec.ts',
    },
  ],
  webServer: {
    command: 'node e2e/server.mjs',
    url: 'http://127.0.0.1:4179/scheduler/',
    reuseExistingServer: false,
    timeout: 90_000,
  },
});

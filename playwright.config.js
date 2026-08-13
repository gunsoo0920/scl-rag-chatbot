import { defineConfig, devices } from '@playwright/test';

const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL
  || (process.platform === 'win32' ? 'msedge' : 'chromium');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: [['line']],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'edge-desktop',
      use: { ...devices['Desktop Edge'], channel: browserChannel },
      testIgnore: /mobile\.spec\.js/,
    },
    {
      name: 'edge-mobile',
      use: { ...devices['Pixel 7'], channel: browserChannel },
      testMatch: /mobile\.spec\.js/,
    },
  ],
  webServer: {
    command: 'node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
    timeout: 120000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const BASE_URL = 'http://localhost:8080';

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node server.js 8080',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 30 * 1000,
  },
});

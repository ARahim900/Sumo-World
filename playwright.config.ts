import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3106);
const baseURL = `http://127.0.0.1:${port}`;

/**
 * Smoke tests run against the production build (`npm run build` first), so they exercise
 * the real security headers. Headless Chromium has no GPU in CI; SwiftShader provides a
 * software WebGL context. Set E2E_CHANNEL=chrome to use an installed Google Chrome instead
 * of Playwright's bundled Chromium.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 300_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        channel: process.env.E2E_CHANNEL,
        launchOptions: {
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],
  webServer: {
    command: `npx next start --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

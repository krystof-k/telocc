import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for `pnpm test:e2e` (docs/testing.md "E2E scope", docs/milestones.md
 * M10). Runs against the demo stack — `webServer` below shells out to the very same
 * `scripts/demo.mjs` that `pnpm demo` runs (docker compose Postgres → migrate → seed →
 * API + web), so the e2e suite exercises the exact code path a human running the demo
 * would. `reuseExistingServer` means a demo you already have running locally is reused
 * as-is rather than restarted.
 *
 * Chromium only (docs/testing.md). The environment ships a pre-installed browser at
 * `/opt/pw-browsers/chromium` — pinned explicitly so a version mismatch with
 * `@playwright/test`'s expected revision never triggers an (blocked) auto-download.
 */
const WEB_URL = 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  // Logs in once as the demo user and saves the session cookie for every spec file to
  // reuse (see e2e/global-setup.ts's header comment — a real rate-limit constraint,
  // not just speed).
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: WEB_URL,
    storageState: 'e2e/.auth/demo-user.json',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: '/opt/pw-browsers/chromium',
        },
      },
    },
  ],
  webServer: {
    command: 'node scripts/demo.mjs',
    url: WEB_URL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});

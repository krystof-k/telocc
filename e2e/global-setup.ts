/**
 * Logs in as the seeded demo user exactly once for the whole suite and saves the
 * resulting session cookie as Playwright `storageState` (`playwright.config.ts`'s
 * `use.storageState`), so almost every spec file starts already authenticated.
 *
 * This exists because of a real constraint, not convenience: magic-link requests are
 * rate-limited to 3 per 15 minutes per email (docs/design.md §7, ER-RATE-1) — logging in
 * fresh inside every test (or even every file) would blow through that budget in a
 * dozen-plus test suite. Only `login.spec.ts` (which tests the login mechanism itself)
 * and the "before login" half of `cookie-inventory.spec.ts` opt out of this shared
 * state via `test.use({ storageState: { cookies: [], origins: [] } })`.
 */
import { request as playwrightRequest } from '@playwright/test';
import { DEMO_EMAIL, getLatestMagicLink, requestMagicLink } from './helpers.ts';

const BASE_URL = 'http://localhost:5173';
const API_HEALTH_URL = 'http://localhost:3001/health';
export const STORAGE_STATE_PATH = 'e2e/.auth/demo-user.json';

/** `scripts/demo.mjs` starts the API and the web dev server concurrently; Playwright's
 * own `webServer.url` check only confirms the (faster-booting) web server is up, so this
 * closes the residual race by polling the API directly before issuing any request
 * through it. */
async function waitForApi(timeoutMs = 60_000, intervalMs = 500): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(API_HEALTH_URL);
      if (res.ok) return;
    } catch {
      // not listening yet — keep polling.
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`global-setup: API never became healthy at ${API_HEALTH_URL}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export default async function globalSetup(): Promise<void> {
  await waitForApi();
  const requestContext = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    await requestMagicLink(requestContext, DEMO_EMAIL);
    const link = await getLatestMagicLink(requestContext, DEMO_EMAIL);
    const res = await requestContext.get(link);
    if (!res.ok()) {
      throw new Error(`global-setup: magic-link verify -> ${res.status()} ${await res.text()}`);
    }
    await requestContext.storageState({ path: STORAGE_STATE_PATH });
  } finally {
    await requestContext.dispose();
  }
}

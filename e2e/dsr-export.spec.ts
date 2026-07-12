/**
 * Data-export half of the DSR walk (docs/testing.md "E2E scope" #6, ER-DSR-1): the JSON
 * and CSV exports download from the Settings page's danger zone.
 *
 * Deliberately excludes account deletion: this suite runs against one shared, long-lived
 * demo stack (`playwright.config.ts`'s `webServer`, same process every other spec file
 * uses), so actually deleting the seeded org would break every other test and every
 * later `pnpm demo` run against this same database. Erasure itself (ER-DSR-2) is already
 * pinned end-to-end by `tests/contract/dsr.contract.test.ts` (M8) — that is the right
 * layer for a destructive, single-shot flow like this one, not a suite that shares state
 * across files.
 *
 * Uses the suite-wide authenticated `storageState` (`e2e/global-setup.ts`) — no
 * per-test login.
 */
import { expect, test } from '@playwright/test';

test('the JSON export downloads a well-formed account bundle', async ({ page }) => {
  const res = await page.request.get('/api/export');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.account?.email).toBe('demo@telocc.example');
  expect(Array.isArray(body.calls)).toBe(true);
  expect(body.calls.length).toBeGreaterThan(0);
});

test('the CSV export downloads from the Settings page', async ({ page }) => {
  await page.goto('/settings');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: /Download call log \(CSV\)/i }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename().length).toBeGreaterThan(0);
  const path = await download.path();
  expect(path).toBeTruthy();
});

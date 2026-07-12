/**
 * Accessibility gate (ER-ACC-1, docs/testing.md "E2E scope" #8): `@axe-core/playwright`
 * reports zero violations on login, dashboard, calls, and settings.
 *
 * The login page must be reached unauthenticated (an already-signed-in session redirects
 * away from `/login` — `RequireOrg`/`RedirectIfSignedIn`, `apps/web/src/components/route-
 * guards.tsx`), so that one test overrides the suite-wide authenticated `storageState`
 * (`e2e/global-setup.ts`); the rest reuse it directly — no fresh login, no extra
 * magic-link request (docs/design.md §7 rate limit).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('login page (unauthenticated)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login page has no axe violations', async ({ page }) => {
    await page.goto('/login');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test('dashboard has no axe violations', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('calls page has no axe violations', async ({ page }) => {
  await page.goto('/calls');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('settings page has no axe violations', async ({ page }) => {
  await page.goto('/settings');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

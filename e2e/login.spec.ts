/**
 * Login journey (docs/testing.md "E2E scope" #1, seeded-org path — docs/milestones.md
 * M10): request a magic link through the real login form, open it from the dev
 * mailbox, and land on the dashboard showing the seeded org's active business number.
 *
 * Starts unauthenticated (overrides the suite-wide logged-in `storageState` from
 * `e2e/global-setup.ts`) — this is the one file that must actually exercise the
 * unauthenticated login form. It performs exactly one fresh magic-link request, so the
 * whole suite stays under the 3-per-15-minutes rate limit alongside `global-setup.ts`'s
 * own login (docs/design.md §7, ER-RATE-1).
 *
 * Single-use token rejection is deliberately NOT re-asserted here — it is already pinned
 * end-to-end (token → DB) by `tests/contract/auth.contract.test.ts`, and driving it
 * through this suite would require a working sign-out round trip first; while poking at
 * that, `apps/web/src/lib/api.ts`'s `signOut()` was found to send `POST
 * /api/auth/sign-out` with no body/content-type, which Better Auth's endpoint rejects
 * (415) — the SPA client-side-clears its cache and navigates to `/login` regardless
 * (its `fetch` call result is never checked), so the UI *looks* signed out while the
 * session cookie may still be valid server-side. `apps/web/src/lib/**` is owned by the
 * concurrently-running M7.1 milestone, so this is flagged here rather than fixed.
 */
import { expect, test } from '@playwright/test';
import { DEMO_BUSINESS_NUMBER, DEMO_EMAIL, getLatestMagicLink } from './helpers.ts';

test.use({ storageState: { cookies: [], origins: [] } });

test('requesting a magic link and opening it from the dev mailbox signs the demo user in', async ({
  page,
}) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in to Telocc' })).toBeVisible();

  await page.getByLabel('Email address').fill(DEMO_EMAIL);
  await page.getByRole('button', { name: 'Send me a sign-in link' }).click();

  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  const link = await getLatestMagicLink(page.request);
  await page.goto(link);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText(DEMO_BUSINESS_NUMBER)).toBeVisible();
});

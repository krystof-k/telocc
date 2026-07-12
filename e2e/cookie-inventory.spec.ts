/**
 * Cookie inventory gate (docs/testing.md "E2E scope" #7, ER-COOK-1): only the Better
 * Auth session cookie exists, with the documented flags, on every page — no banner, no
 * analytics, no third-party anything (docs/design.md §6/§9.6).
 *
 * The "after login" check reuses the suite-wide authenticated `storageState`
 * (`e2e/global-setup.ts`) rather than logging in again; the "before login" check
 * deliberately starts from an empty storage state — neither needs a fresh magic-link
 * request (docs/design.md §7 rate limit).
 */
import { expect, test } from '@playwright/test';

const ALLOWED_COOKIE_NAMES = new Set(['telocc.session_token']);

test.describe('before login', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('no cookies exist on the login page before signing in', async ({ page, context }) => {
    await page.goto('/login');
    const cookies = await context.cookies();
    expect(cookies).toEqual([]);
  });
});

test('only the Better Auth session cookie exists, with the documented flags, on every page', async ({
  page,
  context,
}) => {
  for (const path of ['/', '/calls', '/settings']) {
    await page.goto(path);
    const cookies = await context.cookies();
    const names = cookies.map((c) => c.name);
    for (const name of names) {
      expect(ALLOWED_COOKIE_NAMES.has(name), `unexpected cookie "${name}" on ${path}`).toBe(true);
    }

    const session = cookies.find((c) => c.name === 'telocc.session_token');
    expect(session, `missing session cookie on ${path}`).toBeTruthy();
    if (session) {
      expect(session.httpOnly).toBe(true);
      expect(session.secure).toBe(true);
      expect(session.sameSite).toBe('Lax');
    }
  }
});

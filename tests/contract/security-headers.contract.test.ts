import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loginViaMagicLink } from '../helpers/auth.ts';
import { setupContractTest } from '../helpers/context.ts';
import { getJson } from '../helpers/http.ts';

const ALLOWED_COOKIE_PREFIXES = ['telocc.session_token='];

function disallowedCookies(res: Response): string[] {
  const withGetSetCookie = res.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = withGetSetCookie.getSetCookie?.() ?? [];
  return setCookies.filter((c) => !ALLOWED_COOKIE_PREFIXES.some((prefix) => c.startsWith(prefix)));
}

/**
 * security-headers.contract.test.ts — headers & cookies (ER-COOK-1 API half,
 * docs/testing.md, design.md §9.6).
 */
describe('security headers', () => {
  const ctx = setupContractTest();

  it('every API response carries CSP default-src self, nosniff, frame-ancestors none, referrer-policy', async () => {
    // No /api/* routes exist yet at M1 (health-check only) — the security-headers
    // middleware is global (`app.use('*', securityHeaders)`), so it must apply
    // identically whether the path matches a real route or 404s.
    const res = await getJson(ctx.app, '/api/anything');

    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBeTruthy();
  });

  it('no Set-Cookie other than the Better Auth session cookies is ever issued', async () => {
    const res = await getJson(ctx.app, '/health');
    expect(disallowedCookies(res)).toEqual([]);
  });

  it(
    'the magic-link login flow (request + verify) issues no cookies other than the ' +
      'Better Auth session cookie, at any step of the real boundary (ER-COOK-1)',
    async () => {
      const email = `cookie-sweep-${randomUUID()}@example.test`;
      const { requestResponse, verifyResponse } = await loginViaMagicLink(
        ctx.app,
        ctx.mailbox,
        email,
      );

      expect(disallowedCookies(requestResponse)).toEqual([]);
      expect(disallowedCookies(verifyResponse)).toEqual([]);
    },
  );

  it('dev routes return 404 when ENABLE_DEV_ROUTES is off (production gate)', async () => {
    ctx.rebuildApp({ ENABLE_DEV_ROUTES: undefined });
    const res = await getJson(ctx.app, '/dev/sim/incoming-call');
    expect(res.status).toBe(404);
  });
});

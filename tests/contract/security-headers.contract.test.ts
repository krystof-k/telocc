import { describe, expect, it } from 'vitest';
import { setupContractTest } from '../helpers/context.ts';
import { getJson } from '../helpers/http.ts';

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
    const withGetSetCookie = res.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies = withGetSetCookie.getSetCookie?.() ?? [];
    const nonSessionCookies = setCookies.filter((c) => !c.startsWith('telocc.session_token='));
    expect(nonSessionCookies).toEqual([]);
  });

  it('dev routes return 404 when ENABLE_DEV_ROUTES is off (production gate)', async () => {
    ctx.rebuildApp({ ENABLE_DEV_ROUTES: undefined });
    const res = await getJson(ctx.app, '/dev/sim/incoming-call');
    expect(res.status).toBe(404);
  });
});

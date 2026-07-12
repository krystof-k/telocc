import { randomUUID } from 'node:crypto';
import { verification as verificationTable } from '@telocc/db';
import { describe, expect, it } from 'vitest';
import { setupContractTest } from '../helpers/context.ts';
import { getJson, jsonBody, postJson } from '../helpers/http.ts';
import { extractMagicLinkToken } from '../helpers/mailbox.ts';

/**
 * auth.contract.test.ts — magic-link boundaries (ER-SEC-2, ER-RATE-1, design.md §6/§9.4).
 *
 * Ambiguity note (see tests/helpers/README.md): "except auth and org-creation preflight"
 * in the unauthenticated-route-sweep case is read here as excluding `/api/auth/*` (public
 * by definition) and `POST /api/orgs` (the one session-but-orgless route a brand new user
 * must be able to reach right after verifying their magic link — org-bootstrap.contract
 * covers its own auth/shape requirements). Per-IP rate limiting is asserted against an
 * `X-Forwarded-For` header — the only IP signal available to an in-process `app.request()`
 * call and the standard way a Workers/Node-dual app would read a proxied client IP.
 */

async function requestLink(
  app: ReturnType<typeof setupContractTest>['app'],
  email: string,
  ip?: string,
) {
  return postJson(
    app,
    '/api/auth/sign-in/magic-link',
    { email },
    ip ? { headers: { 'x-forwarded-for': ip } } : undefined,
  );
}

describe('magic-link auth', () => {
  const ctx = setupContractTest();

  it('requesting a magic link for an unknown email returns the same response as for a known email', async () => {
    const knownEmail = `known-${randomUUID()}@example.test`;
    const unknownEmail = `unknown-${randomUUID()}@example.test`;

    // Prime "known" by requesting once first (Better Auth creates the user lazily).
    await requestLink(ctx.app, knownEmail, '203.0.113.10');
    ctx.mailbox.clear();

    const knownRes = await requestLink(ctx.app, knownEmail, '203.0.113.11');
    const unknownRes = await requestLink(ctx.app, unknownEmail, '203.0.113.12');

    expect(knownRes.status).toBe(unknownRes.status);
    const [knownBody, unknownBody] = await Promise.all([jsonBody(knownRes), jsonBody(unknownRes)]);
    expect(knownBody).toEqual(unknownBody);
  });

  it('a magic link logs the user in exactly once — the same token is rejected on second use', async () => {
    const email = `once-${randomUUID()}@example.test`;
    await requestLink(ctx.app, email);
    const token = extractMagicLinkToken(ctx.mailbox.latestFor(email));

    const firstUse = await getJson(
      ctx.app,
      `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
    );
    expect(firstUse.status).toBeLessThan(400);

    const secondUse = await getJson(
      ctx.app,
      `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
    );
    expect(secondUse.status).toBeGreaterThanOrEqual(400);
  });

  it('a magic link older than 15 minutes is rejected', async () => {
    const email = `stale-${randomUUID()}@example.test`;
    await requestLink(ctx.app, email);
    const token = extractMagicLinkToken(ctx.mailbox.latestFor(email));

    ctx.clock.advanceMinutes(15);
    ctx.clock.advanceSeconds(1);
    ctx.rebuildApp();

    const res = await getJson(
      ctx.app,
      `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('issuing a new magic link invalidates the previous unused one', async () => {
    const email = `reissue-${randomUUID()}@example.test`;
    await requestLink(ctx.app, email);
    const firstToken = extractMagicLinkToken(ctx.mailbox.latestFor(email));

    ctx.clock.advanceSeconds(1);
    ctx.rebuildApp();
    await requestLink(ctx.app, email);
    const secondToken = extractMagicLinkToken(ctx.mailbox.latestFor(email));
    expect(secondToken).not.toBe(firstToken);

    const firstRes = await getJson(
      ctx.app,
      `/api/auth/magic-link/verify?token=${encodeURIComponent(firstToken)}`,
    );
    expect(firstRes.status).toBeGreaterThanOrEqual(400);

    const secondRes = await getJson(
      ctx.app,
      `/api/auth/magic-link/verify?token=${encodeURIComponent(secondToken)}`,
    );
    expect(secondRes.status).toBeLessThan(400);
  });

  it('magic-link tokens are stored hashed — the raw token never appears in the database', async () => {
    const email = `hashed-${randomUUID()}@example.test`;
    await requestLink(ctx.app, email);
    const rawToken = extractMagicLinkToken(ctx.mailbox.latestFor(email));

    const rows = await ctx.db.select().from(verificationTable);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.value).not.toBe(rawToken);
      expect(row.value.includes(rawToken)).toBe(false);
    }
  });

  it('a 4th magic-link request for the same email inside 15 minutes returns 429', async () => {
    const email = `email-limit-${randomUUID()}@example.test`;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await requestLink(ctx.app, email, `203.0.113.${20 + i}`);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3).every((s) => s < 300)).toBe(true);
    expect(statuses[3]).toBe(429);
  });

  it('an 11th magic-link request from the same IP inside an hour returns 429', async () => {
    const ip = '203.0.113.99';
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await requestLink(ctx.app, `ip-limit-${i}-${randomUUID()}@example.test`, ip);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s < 300)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('the session cookie is HttpOnly, Secure, SameSite=Lax', async () => {
    const email = `cookie-${randomUUID()}@example.test`;
    await requestLink(ctx.app, email);
    const token = extractMagicLinkToken(ctx.mailbox.latestFor(email));
    const res = await getJson(
      ctx.app,
      `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
    );

    const withGetSetCookie = res.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies = withGetSetCookie.getSetCookie?.() ?? [];
    const sessionCookie = setCookies.find((c) => c.startsWith('telocc.session_token='));
    expect(sessionCookie).toBeTruthy();
    expect(sessionCookie?.toLowerCase()).toContain('httponly');
    expect(sessionCookie?.toLowerCase()).toContain('secure');
    expect(sessionCookie?.toLowerCase()).toContain('samesite=lax');
  });

  it('unauthenticated requests to every /api route except auth and org-creation preflight return 401', async () => {
    const protectedRoutes: { method: 'GET' | 'POST' | 'PUT' | 'PATCH'; path: string }[] = [
      { method: 'GET', path: '/api/me' },
      { method: 'GET', path: '/api/org' },
      { method: 'PATCH', path: '/api/org' },
      { method: 'POST', path: '/api/verifications' },
      { method: 'POST', path: '/api/verifications/does-not-exist/confirm' },
      { method: 'GET', path: '/api/office-hours' },
      { method: 'PUT', path: '/api/office-hours' },
      { method: 'GET', path: '/api/kyc/requirements' },
      { method: 'GET', path: '/api/kyc' },
      { method: 'PUT', path: '/api/kyc' },
      { method: 'POST', path: '/api/kyc/documents' },
      { method: 'GET', path: '/api/numbers/catalog?region=Prague' },
      { method: 'POST', path: '/api/numbers/provision' },
      { method: 'GET', path: '/api/business-number' },
      { method: 'GET', path: '/api/calls' },
      { method: 'GET', path: '/api/export' },
      { method: 'GET', path: '/api/export/calls.csv' },
      { method: 'POST', path: '/api/account/delete' },
    ];

    for (const route of protectedRoutes) {
      const res = await ctx.app.request(route.path, { method: route.method });
      expect(res.status, `${route.method} ${route.path}`).toBe(401);
    }
  });
});

import { randomUUID } from 'node:crypto';
import { memberships, orgs } from '@telocc/db';
import { describe, expect, it } from 'vitest';
import { loginViaMagicLink } from '../helpers/auth.ts';
import { setupContractTest } from '../helpers/context.ts';
import { getJson, postJson } from '../helpers/http.ts';

/**
 * org-bootstrap.contract.test.ts — first login → org (ER-B2B-1, roles seam,
 * design.md §6, §3.2).
 */
describe('org bootstrap', () => {
  const ctx = setupContractTest();

  async function freshLogin() {
    const email = `owner-${randomUUID()}@example.test`;
    const { cookieHeader } = await loginViaMagicLink(ctx.app, ctx.mailbox, email);
    return { email, cookieHeader };
  }

  it('a first-time user has no org and every org-scoped route returns 403/redirect-to-onboarding shape', async () => {
    const { cookieHeader } = await freshLogin();
    const orgScopedRoutes = ['/api/org', '/api/business-number', '/api/calls', '/api/office-hours'];
    for (const path of orgScopedRoutes) {
      const res = await getJson(ctx.app, path, { cookieHeader });
      expect(res.status, path).toBe(403);
    }
  });

  it('creating an org without the business-capacity declaration is rejected by validation', async () => {
    const { cookieHeader } = await freshLogin();
    const res = await postJson(
      ctx.app,
      '/api/orgs',
      { name: 'Acme s.r.o.', businessCapacityDeclared: false },
      { cookieHeader },
    );
    expect(res.status).toBe(400);
  });

  it('creating an org stores the declaration timestamp and declaration version', async () => {
    const { cookieHeader } = await freshLogin();
    const before = ctx.clock.now();
    const res = await postJson(
      ctx.app,
      '/api/orgs',
      { name: 'Acme s.r.o.', businessCapacityDeclared: true },
      { cookieHeader },
    );
    expect(res.status).toBeLessThan(300);

    const rows = await ctx.db.select().from(orgs);
    expect(rows.length).toBe(1);
    const org = rows[0];
    expect(org).toBeDefined();
    expect(org?.businessCapacityDeclaredAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(org?.declarationVersion).toBeTruthy();
  });

  it('a user can create at most one org', async () => {
    const { cookieHeader } = await freshLogin();
    const first = await postJson(
      ctx.app,
      '/api/orgs',
      { name: 'First Org s.r.o.', businessCapacityDeclared: true },
      { cookieHeader },
    );
    expect(first.status).toBeLessThan(300);

    const second = await postJson(
      ctx.app,
      '/api/orgs',
      { name: 'Second Org s.r.o.', businessCapacityDeclared: true },
      { cookieHeader },
    );
    expect(second.status).toBeGreaterThanOrEqual(400);

    const rows = await ctx.db.select().from(orgs);
    expect(rows.length).toBe(1);
  });

  it("the creator's membership has role owner", async () => {
    const { cookieHeader } = await freshLogin();
    await postJson(
      ctx.app,
      '/api/orgs',
      { name: 'Acme s.r.o.', businessCapacityDeclared: true },
      { cookieHeader },
    );

    const rows = await ctx.db.select().from(memberships);
    expect(rows.length).toBe(1);
    expect(rows[0]?.role).toBe('owner');
  });

  it('org name is required, 1–120 chars', async () => {
    const { cookieHeader: cookie1 } = await freshLogin();
    const empty = await postJson(
      ctx.app,
      '/api/orgs',
      { name: '', businessCapacityDeclared: true },
      { cookieHeader: cookie1 },
    );
    expect(empty.status).toBe(400);

    const { cookieHeader: cookie2 } = await freshLogin();
    const tooLong = await postJson(
      ctx.app,
      '/api/orgs',
      { name: 'A'.repeat(121), businessCapacityDeclared: true },
      { cookieHeader: cookie2 },
    );
    expect(tooLong.status).toBe(400);

    const { cookieHeader: cookie3 } = await freshLogin();
    const exactlyMax = await postJson(
      ctx.app,
      '/api/orgs',
      { name: 'A'.repeat(120), businessCapacityDeclared: true },
      { cookieHeader: cookie3 },
    );
    expect(exactlyMax.status).toBeLessThan(300);
  });
});

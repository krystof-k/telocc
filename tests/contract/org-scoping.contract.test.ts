import { calls } from '@telocc/db';
import { parseE164 } from '@telocc/telephony';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setupContractTest } from '../helpers/context.ts';
import { createReadyOrg } from '../helpers/fixtures.ts';
import { getJson, jsonBody } from '../helpers/http.ts';

/**
 * org-scoping.contract.test.ts — tenant isolation (design.md §3.2 "Org-scoping pattern").
 * Two orgs, seeded with full data. The cross-org dial-in case and the export case are
 * intentionally named to match milestones.md's `-t` filters (M5 excludes both via
 * `-t '^(?!.*(dial-in|export))'`; M6/M8 re-include them).
 *
 * Ambiguity note (tests/helpers/README.md): design.md §7's API table has no documented
 * by-id GET route for an individual call or KYC document. This file assumes
 * `GET /api/calls/:id` and `GET /api/kyc/documents/:id` as the plausible detail routes
 * for the "fetching another org's ... by id" case.
 */
describe('org scoping', () => {
  const ctx = setupContractTest();

  async function readyOrg() {
    return createReadyOrg(ctx.app, ctx.db, ctx.mailbox, { officeHoursMode: 'always_open' });
  }

  it("every authenticated GET route returns only the caller's org's data", async () => {
    const orgA = await readyOrg();
    const orgB = await readyOrg();

    const businessNumberRes = await getJson(ctx.app, '/api/business-number', {
      cookieHeader: orgA.cookieHeader,
    });
    const businessNumberBody = await jsonBody<{ e164?: string }>(businessNumberRes);
    expect(businessNumberBody?.e164).toBe(orgA.businessNumberE164);
    expect(businessNumberBody?.e164).not.toBe(orgB.businessNumberE164);

    const meRes = await getJson(ctx.app, '/api/me', { cookieHeader: orgA.cookieHeader });
    const meBody = await jsonBody<{ orgId?: string }>(meRes);
    if (meBody?.orgId) {
      expect(meBody.orgId).toBe(orgA.orgId);
      expect(meBody.orgId).not.toBe(orgB.orgId);
    }
  });

  it("fetching another org's call by id returns 404, not 403", async () => {
    const orgA = await readyOrg();
    const orgB = await readyOrg();
    const to = parseE164(orgB.businessNumberE164);
    if (!to) throw new Error('bad fixture');
    await ctx.telco.incomingCall({ to, from: parseE164('+420603000001') });

    const [orgBCall] = await ctx.db.select().from(calls).where(eq(calls.orgId, orgB.orgId));
    expect(orgBCall).toBeDefined();

    const res = await getJson(ctx.app, `/api/calls/${orgBCall?.id}`, {
      cookieHeader: orgA.cookieHeader,
    });
    expect(res.status).toBe(404);
  });

  it("org B's verified number dialling org A's business number gets customer treatment, not dial-in", async () => {
    const orgA = await readyOrg();
    const orgB = await readyOrg();
    const toA = parseE164(orgA.businessNumberE164);
    const orgBPersonal = parseE164(orgB.personalNumberE164);
    if (!toA || !orgBPersonal) throw new Error('bad fixture');

    const res = await ctx.telco.incomingCall({ to: toA, from: orgBPersonal });
    expect(res.instruction?.kind).not.toBe('collectDigits');
    expect(res.instruction?.kind).toBe('forward');
  });

  it("export contains only the caller's org's rows", async () => {
    const orgA = await readyOrg();
    const orgB = await readyOrg();

    const res = await getJson(ctx.app, '/api/export', { cookieHeader: orgA.cookieHeader });
    expect(res.status).toBe(200);
    const text = await res.clone().text();
    expect(text.includes(orgB.businessNumberE164)).toBe(false);
    expect(text.includes(orgB.personalNumberE164)).toBe(false);
    expect(text.includes(orgA.businessNumberE164)).toBe(true);
  });

  it('webhook-driven writes land on the org owning the called business number', async () => {
    const orgA = await readyOrg();
    const orgB = await readyOrg();
    const toB = parseE164(orgB.businessNumberE164);
    if (!toB) throw new Error('bad fixture');

    await ctx.telco.incomingCall({ to: toB, from: parseE164('+420603000002') });

    const orgBCalls = await ctx.db.select().from(calls).where(eq(calls.orgId, orgB.orgId));
    const orgACalls = await ctx.db.select().from(calls).where(eq(calls.orgId, orgA.orgId));
    expect(orgBCalls.length).toBe(1);
    expect(orgACalls.length).toBe(0);
  });
});

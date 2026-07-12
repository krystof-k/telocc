import { calls } from '@telocc/db';
import { parseE164 } from '@telocc/telephony';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setupContractTest } from '../helpers/context.ts';
import {
  createEndUserFixture,
  createKycDocumentFixture,
  createReadyOrg,
} from '../helpers/fixtures.ts';
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
 * for the "fetching another org's ... by id" case (decisions.md: these two by-id routes
 * are hereby pinned as part of the API surface the contract layer requires — design §7's
 * table omission, not an open question).
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

    // Unconditional — a route that silently omits `orgId` from `GET /api/me` must not
    // let this case pass by accident (the previous `if (meBody?.orgId)` guard did).
    const meRes = await getJson(ctx.app, '/api/me', { cookieHeader: orgA.cookieHeader });
    const meBody = await jsonBody<{ orgId?: string }>(meRes);
    expect(meBody?.orgId).toBe(orgA.orgId);
    expect(meBody?.orgId).not.toBe(orgB.orgId);

    // The full sweep named in the finding: calls, office-hours, kyc, export (json+csv).
    const callsRes = await getJson(ctx.app, '/api/calls', { cookieHeader: orgA.cookieHeader });
    expect(callsRes.status).toBe(200);
    const callsBody = await jsonBody<{ items: { id: string }[] }>(callsRes);
    expect(Array.isArray(callsBody?.items)).toBe(true);

    const officeHoursRes = await getJson(ctx.app, '/api/office-hours', {
      cookieHeader: orgA.cookieHeader,
    });
    expect(officeHoursRes.status).toBe(200);
    const officeHoursText = await officeHoursRes.clone().text();
    expect(officeHoursText.includes(orgB.orgId)).toBe(false);

    const kycRes = await getJson(ctx.app, '/api/kyc', { cookieHeader: orgA.cookieHeader });
    // No KYC record exists for a fresh readyOrg() fixture (it only seeds membership,
    // business number and office hours) — either shape is acceptable here, but whichever
    // it is, org B's data must never leak through.
    expect([200, 404]).toContain(kycRes.status);
    const kycText = await kycRes.clone().text();
    expect(kycText.includes(orgB.orgId)).toBe(false);

    const exportRes = await getJson(ctx.app, '/api/export', { cookieHeader: orgA.cookieHeader });
    expect(exportRes.status).toBe(200);
    const exportText = await exportRes.clone().text();
    expect(exportText.includes(orgB.businessNumberE164)).toBe(false);
    expect(exportText.includes(orgB.personalNumberE164)).toBe(false);
    expect(exportText.includes(orgA.businessNumberE164)).toBe(true);

    const exportCsvRes = await getJson(ctx.app, '/api/export/calls.csv', {
      cookieHeader: orgA.cookieHeader,
    });
    expect(exportCsvRes.status).toBe(200);
    const exportCsvText = await exportCsvRes.clone().text();
    expect(exportCsvText.includes(orgB.businessNumberE164)).toBe(false);
  });

  it(
    'an owner fetching their own call by id gets 200 (positive control) — ' +
      "fetching another org's call by id returns 404, not 403",
    async () => {
      const orgA = await readyOrg();
      const orgB = await readyOrg();
      const toA = parseE164(orgA.businessNumberE164);
      const toB = parseE164(orgB.businessNumberE164);
      if (!toA || !toB) throw new Error('bad fixture');
      await ctx.telco.incomingCall({ to: toA, from: parseE164('+420603000003') });
      await ctx.telco.incomingCall({ to: toB, from: parseE164('+420603000001') });

      const [orgACall] = await ctx.db.select().from(calls).where(eq(calls.orgId, orgA.orgId));
      const [orgBCall] = await ctx.db.select().from(calls).where(eq(calls.orgId, orgB.orgId));
      expect(orgACall).toBeDefined();
      expect(orgBCall).toBeDefined();

      // Positive control FIRST: the owner can fetch their own org's call by id. Without
      // this, a route that 404s on every request (broken, not scoped) would pass the
      // cross-org case below for the wrong reason.
      const ownRes = await getJson(ctx.app, `/api/calls/${orgACall?.id}`, {
        cookieHeader: orgA.cookieHeader,
      });
      expect(ownRes.status).toBe(200);

      const crossRes = await getJson(ctx.app, `/api/calls/${orgBCall?.id}`, {
        cookieHeader: orgA.cookieHeader,
      });
      expect(crossRes.status).toBe(404);
    },
  );

  it(
    'an owner fetching their own KYC document by id gets 200 (positive control) — ' +
      "fetching another org's KYC document by id returns 404, not 403",
    async () => {
      const orgA = await readyOrg();
      const orgB = await readyOrg();
      const endUserA = await createEndUserFixture(ctx.db, { orgId: orgA.orgId });
      const endUserB = await createEndUserFixture(ctx.db, { orgId: orgB.orgId });
      const docA = await createKycDocumentFixture(ctx.db, {
        orgId: orgA.orgId,
        endUserId: endUserA.id,
      });
      const docB = await createKycDocumentFixture(ctx.db, {
        orgId: orgB.orgId,
        endUserId: endUserB.id,
      });

      const ownRes = await getJson(ctx.app, `/api/kyc/documents/${docA.id}`, {
        cookieHeader: orgA.cookieHeader,
      });
      expect(ownRes.status).toBe(200);

      const crossRes = await getJson(ctx.app, `/api/kyc/documents/${docB.id}`, {
        cookieHeader: orgA.cookieHeader,
      });
      expect(crossRes.status).toBe(404);
    },
  );

  it(
    "the business-number route returns only the caller's own number — org B's number is " +
      'never visible to org A (no by-id route is documented for this singular per-org ' +
      'resource, design.md §7, so this is the equivalent scoping check for "number" in ' +
      'testing.md\'s "call/document/number by id" trio)',
    async () => {
      const orgA = await readyOrg();
      const orgB = await readyOrg();

      const res = await getJson(ctx.app, '/api/business-number', {
        cookieHeader: orgA.cookieHeader,
      });
      expect(res.status).toBe(200);
      const text = await res.clone().text();
      const body = (JSON.parse(text || '{}') as { e164?: string }) ?? {};
      expect(body.e164).toBe(orgA.businessNumberE164);
      expect(body.e164).not.toBe(orgB.businessNumberE164);
      expect(text.includes(orgB.businessNumberE164)).toBe(false);
    },
  );

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

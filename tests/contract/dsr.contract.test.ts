import { randomUUID } from 'node:crypto';
import {
  account as accountTable,
  auditEvents,
  businessNumbers,
  callSessions,
  calls,
  deletionTombstones,
  endUsers,
  kycDocuments,
  memberships,
  officeHourRules,
  orgs,
  phoneVerifications,
  regulatoryBundles,
  session as sessionTable,
  user as userTable,
} from '@telocc/db';
import { parseE164 } from '@telocc/telephony';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setupContractTest } from '../helpers/context.ts';
import {
  createCallSessionFixture,
  createEndUserFixture,
  createReadyOrg,
} from '../helpers/fixtures.ts';
import { getJson, jsonBody, postJson } from '../helpers/http.ts';

/**
 * dsr.contract.test.ts — export & erasure (ER-DSR-1/2, design.md §10.2-10.3, §7).
 */
describe('data subject rights: export and erasure', () => {
  const ctx = setupContractTest();

  async function readyOrgWithData() {
    const org = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
      officeHoursMode: 'always_open',
    });
    await createEndUserFixture(ctx.db, { orgId: org.orgId });
    const to = parseE164(org.businessNumberE164);
    if (to) {
      const callRef = `call_export_seed_${randomUUID()}`;
      await ctx.telco.incomingCall({ callRef, to, from: parseE164('+420605000001') });
      await ctx.telco.completed({ callRef, durationSeconds: 0 });
    }
    return org;
  }

  it('the JSON export contains account email, verified number, settings, office hours, business-number details, KYC record and the full call log', async () => {
    const { cookieHeader, businessNumberE164, personalNumberE164 } = await readyOrgWithData();
    const res = await getJson(ctx.app, '/api/export', { cookieHeader });
    expect(res.status).toBe(200);
    const body = await jsonBody<{
      account?: { email?: string };
      membership?: { personalNumber?: string };
      officeHours?: unknown;
      businessNumber?: { e164?: string };
      kyc?: unknown;
      calls?: unknown[];
    }>(res);

    expect(body?.account?.email).toBeTruthy();
    expect(body?.membership?.personalNumber ?? '').toBe(personalNumberE164);
    expect(body?.officeHours).toBeTruthy();
    expect(body?.businessNumber?.e164).toBe(businessNumberE164);
    expect(body?.kyc).toBeTruthy();
    expect(Array.isArray(body?.calls)).toBe(true);
  });

  it('the CSV export has one row per call with the documented columns', async () => {
    const { cookieHeader, businessNumberE164 } = await readyOrgWithData();
    const to = parseE164(businessNumberE164);
    if (to) await ctx.telco.incomingCall({ to, from: parseE164('+420605000002') });

    const res = await getJson(ctx.app, '/api/export/calls.csv', { cookieHeader });
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split('\n');
    const header = lines[0]?.split(',');
    expect(header).toEqual([
      'started_at',
      'direction',
      'status',
      'reason',
      'from',
      'to',
      'duration_seconds',
    ]);
    // header + at least one data row for the calls generated above.
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('deletion requires the exact org name as confirmation', async () => {
    const { cookieHeader, orgId } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
    const [orgRow] = await ctx.db.select().from(orgs).where(eq(orgs.id, orgId));

    const wrongName = await postJson(
      ctx.app,
      '/api/account/delete',
      { confirmName: `not-${orgRow?.name}` },
      { cookieHeader },
    );
    expect(wrongName.status).toBeGreaterThanOrEqual(400);

    const [stillThere] = await ctx.db.select().from(orgs).where(eq(orgs.id, orgId));
    expect(stillThere).toBeDefined();

    const rightName = await postJson(
      ctx.app,
      '/api/account/delete',
      { confirmName: orgRow?.name },
      { cookieHeader },
    );
    expect(rightName.status).toBeLessThan(300);
  });

  it('deletion removes every org-scoped row across all tables and the auth user, in one pass', async () => {
    const { cookieHeader, orgId, userId, businessNumberId } = await readyOrgWithData();
    const [orgRow] = await ctx.db.select().from(orgs).where(eq(orgs.id, orgId));

    // Seed an org-scoped audit event and an in-flight call session directly so the
    // sweep proves it removes real rows, not just already-empty tables.
    await ctx.db.insert(auditEvents).values({
      orgId,
      actorUserId: userId,
      type: 'settings_changed',
      retentionClass: 'security',
      meta: {},
    });
    await createCallSessionFixture(ctx.db, { orgId, businessNumberId });

    await postJson(ctx.app, '/api/account/delete', { confirmName: orgRow?.name }, { cookieHeader });

    const [remainingOrg] = await ctx.db.select().from(orgs).where(eq(orgs.id, orgId));
    expect(remainingOrg, 'orgs').toBeUndefined();

    const remainingMemberships = await ctx.db
      .select()
      .from(memberships)
      .where(eq(memberships.orgId, orgId));
    expect(remainingMemberships.length, 'memberships').toBe(0);

    const remainingNumbers = await ctx.db
      .select()
      .from(businessNumbers)
      .where(eq(businessNumbers.orgId, orgId));
    expect(remainingNumbers.length, 'business_numbers').toBe(0);

    const remainingEndUsers = await ctx.db.select().from(endUsers).where(eq(endUsers.orgId, orgId));
    expect(remainingEndUsers.length, 'end_users').toBe(0);

    const remainingBundles = await ctx.db
      .select()
      .from(regulatoryBundles)
      .where(eq(regulatoryBundles.orgId, orgId));
    expect(remainingBundles.length, 'regulatory_bundles').toBe(0);

    const remainingDocuments = await ctx.db
      .select()
      .from(kycDocuments)
      .where(eq(kycDocuments.orgId, orgId));
    expect(remainingDocuments.length, 'kyc_documents').toBe(0);

    const remainingRules = await ctx.db
      .select()
      .from(officeHourRules)
      .where(eq(officeHourRules.orgId, orgId));
    expect(remainingRules.length, 'office_hour_rules').toBe(0);

    const remainingCalls = await ctx.db.select().from(calls).where(eq(calls.orgId, orgId));
    expect(remainingCalls.length, 'calls').toBe(0);

    const remainingPhoneVerifications = await ctx.db
      .select()
      .from(phoneVerifications)
      .where(eq(phoneVerifications.orgId, orgId));
    expect(remainingPhoneVerifications.length, 'phone_verifications').toBe(0);

    const remainingSessions = await ctx.db
      .select()
      .from(sessionTable)
      .where(eq(sessionTable.userId, userId));
    expect(remainingSessions.length, 'session').toBe(0);

    // Better Auth `user` row is gone (design.md §10.3 step 3: Better Auth user + sessions
    // deleted via the Better Auth API, after the org cascade).
    const remainingUser = await ctx.db.select().from(userTable).where(eq(userTable.id, userId));
    expect(remainingUser.length, 'user').toBe(0);

    // Better Auth `account` rows are gone too (cascades from the user delete).
    const remainingAccounts = await ctx.db
      .select()
      .from(accountTable)
      .where(eq(accountTable.userId, userId));
    expect(remainingAccounts.length, 'account').toBe(0);

    // Org-scoped audit_events are zero. Filtering on this org's id already excludes
    // org_id:null lifecycle events (e.g. the number-release event, tests/helpers/README.md)
    // by construction — those rows can never match `eq(auditEvents.orgId, orgId)`.
    const remainingOrgAuditEvents = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.orgId, orgId));
    expect(remainingOrgAuditEvents.length, 'audit_events (org-scoped)').toBe(0);

    // call_sessions (in-flight working state) are zero.
    const remainingCallSessions = await ctx.db
      .select()
      .from(callSessions)
      .where(eq(callSessions.orgId, orgId));
    expect(remainingCallSessions.length, 'call_sessions').toBe(0);
  });

  it('deletion calls releaseNumber and deleteCallRecord on the provider for every provider call ref', async () => {
    const { cookieHeader, orgId, businessNumberE164 } = await readyOrgWithData();
    const to = parseE164(businessNumberE164);
    if (to) {
      const callRef = `call_dsr_${randomUUID()}`;
      await ctx.telco.incomingCall({ callRef, to, from: parseE164('+420605000003') });
      await ctx.telco.completed({ callRef, durationSeconds: 5 });
    }
    const [orgRow] = await ctx.db.select().from(orgs).where(eq(orgs.id, orgId));

    await postJson(ctx.app, '/api/account/delete', { confirmName: orgRow?.name }, { cookieHeader });

    expect(ctx.spies.releasedNumberRefs.length).toBeGreaterThan(0);
    expect(ctx.spies.deletedCallRefs.length).toBeGreaterThan(0);
  });

  it('deletion writes a tombstone containing counts only', async () => {
    const { cookieHeader, orgId } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
    const [orgRow] = await ctx.db.select().from(orgs).where(eq(orgs.id, orgId));
    const orgName = orgRow?.name ?? '';

    const before = (await ctx.db.select().from(deletionTombstones)).length;
    await postJson(ctx.app, '/api/account/delete', { confirmName: orgName }, { cookieHeader });
    const after = await ctx.db.select().from(deletionTombstones);

    expect(after.length).toBe(before + 1);
    const latest = after.at(-1);
    const serialized = JSON.stringify(latest?.stats ?? {});
    expect(serialized.includes(orgName)).toBe(false);
  });

  it('the session is invalid after deletion', async () => {
    const { cookieHeader, orgId } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
    const [orgRow] = await ctx.db.select().from(orgs).where(eq(orgs.id, orgId));
    await postJson(ctx.app, '/api/account/delete', { confirmName: orgRow?.name }, { cookieHeader });

    const res = await getJson(ctx.app, '/api/me', { cookieHeader });
    expect(res.status).toBe(401);
  });

  it("the other org's data is untouched by a deletion", async () => {
    const orgA = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
    const orgB = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
    const [orgARow] = await ctx.db.select().from(orgs).where(eq(orgs.id, orgA.orgId));

    await postJson(
      ctx.app,
      '/api/account/delete',
      { confirmName: orgARow?.name },
      { cookieHeader: orgA.cookieHeader },
    );

    const [orgBStillThere] = await ctx.db.select().from(orgs).where(eq(orgs.id, orgB.orgId));
    expect(orgBStillThere).toBeDefined();
    const orgBMembership = await ctx.db
      .select()
      .from(memberships)
      .where(eq(memberships.orgId, orgB.orgId));
    expect(orgBMembership.length).toBe(1);
  });
});

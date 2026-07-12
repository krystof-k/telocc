import { randomUUID } from 'node:crypto';
import { calls } from '@telocc/db';
import { parseE164 } from '@telocc/telephony';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { findUserIdByEmail, loginViaMagicLink } from '../helpers/auth.ts';
import { setupContractTest } from '../helpers/context.ts';
import {
  createBusinessNumberFixture,
  createMembershipFixture,
  createOfficeHourRules,
  createOrgFixture,
  createReadyOrg,
  STANDARD_WEEKDAY_9_TO_17,
} from '../helpers/fixtures.ts';

/**
 * inbound-routing.contract.test.ts — customer calls (design.md §5.1, §5.3, ER-AUD-1).
 * All fixtures use `officeHoursMode: 'always_open'` unless the case is specifically
 * about hours, so the routing-vs-hours concerns stay decoupled.
 */
describe('inbound routing', () => {
  const ctx = setupContractTest();

  async function readyOrg() {
    return createReadyOrg(ctx.app, ctx.db, ctx.mailbox, { officeHoursMode: 'always_open' });
  }

  async function orgCalls(orgId: string) {
    return ctx.db.select().from(calls).where(eq(calls.orgId, orgId));
  }

  it('in-hours inbound call produces a forward instruction to the verified personal number with the business number as caller ID', async () => {
    const { businessNumberE164, personalNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('bad fixture');
    const res = await ctx.telco.incomingCall({ to, from: parseE164('+420601000001') });

    expect(res.instruction?.kind).toBe('forward');
    if (res.instruction?.kind === 'forward') {
      expect(res.instruction.to).toBe(personalNumberE164);
      expect(res.instruction.callerId.e164).toBe(businessNumberE164);
    }
  });

  it("the forwarded-leg caller ID is never the original caller's number (ER-CLI-2a)", async () => {
    const { businessNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('bad fixture');
    const callerNumber = parseE164('+420601000002');
    const res = await ctx.telco.incomingCall({ to, from: callerNumber });

    if (res.instruction?.kind === 'forward') {
      expect(res.instruction.callerId.e164).not.toBe(callerNumber);
      expect(res.instruction.callerId.e164).toBe(businessNumberE164);
    } else {
      throw new Error(`expected a forward instruction, got ${JSON.stringify(res.instruction)}`);
    }
  });

  it('out-of-hours inbound call is declined busy and logged declined/out_of_hours with caller CLI and business number', async () => {
    const { orgId, businessNumberE164 } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
      officeHoursMode: 'always_closed',
    });
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('bad fixture');
    const caller = parseE164('+420601000003');
    const res = await ctx.telco.incomingCall({ to, from: caller });
    expect(res.instruction?.kind).toBe('reject');

    const rows = await orgCalls(orgId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.direction).toBe('inbound');
    expect(rows[0]?.status).toBe('declined');
    expect(rows[0]?.reason).toBe('out_of_hours');
    expect(rows[0]?.fromE164).toBe(caller);
    expect(rows[0]?.toE164).toBe(businessNumberE164);
  });

  it('inbound call to an org with no verified personal number is declined busy and logged declined/no_verified_number', async () => {
    const email = `no-verified-${randomUUID()}@example.test`;
    await loginViaMagicLink(ctx.app, ctx.mailbox, email);
    const userId = await findUserIdByEmail(ctx.db, email);
    const org = await createOrgFixture(ctx.db, { officeHoursMode: 'always_open' });
    await createMembershipFixture(ctx.db, { orgId: org.id, userId }); // no personal number
    const businessNumberE164 = '+420212345699';
    await createBusinessNumberFixture(ctx.db, { orgId: org.id, e164: businessNumberE164 });
    await createOfficeHourRules(ctx.db, org.id, STANDARD_WEEKDAY_9_TO_17);

    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('bad fixture');
    const res = await ctx.telco.incomingCall({ to, from: parseE164('+420601000004') });
    expect(res.instruction?.kind).toBe('reject');

    const rows = await orgCalls(org.id);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe('declined');
    expect(rows[0]?.reason).toBe('no_verified_number');
  });

  it('answered forwarded call logs answered with the provider-reported duration', async () => {
    const { orgId, businessNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('bad fixture');
    const callRef = `call_answered_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef, to, from: parseE164('+420601000005') });
    await ctx.telco.legAnswered({ callRef });
    await ctx.telco.completed({ callRef, durationSeconds: 87 });

    const rows = await orgCalls(orgId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe('answered');
    expect(rows[0]?.durationSeconds).toBe(87);
  });

  it(
    'the caller hanging up first after an answered forward logs exactly one answered row ' +
      'with the talk duration (design §4.4/§5.0)',
    async () => {
      const { orgId, businessNumberE164 } = await readyOrg();
      const to = parseE164(businessNumberE164);
      if (!to) throw new Error('bad fixture');
      const callRef = `call_callerhangup_after_answer_${randomUUID()}`;
      await ctx.telco.incomingCall({ callRef, to, from: parseE164('+420601000006') });
      // The child-leg "answered" signal fires at pickup; the caller then hangs up
      // first — Twilio's Dial action callback never fires here, only `call.completed`.
      await ctx.telco.legAnswered({ callRef });
      await ctx.telco.completed({ callRef, durationSeconds: 34 });

      const rows = await orgCalls(orgId);
      expect(rows.length).toBe(1);
      expect(rows[0]?.status).toBe('answered');
      expect(rows[0]?.durationSeconds).toBe(34);
    },
  );

  it('unanswered forward (no_answer) logs missed with zero duration', async () => {
    const { orgId, businessNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('bad fixture');
    const callRef = `call_noanswer_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef, to, from: parseE164('+420601000007') });
    await ctx.telco.legEnded({ callRef, legStatus: 'no_answer' });
    await ctx.telco.completed({ callRef, durationSeconds: 0 });

    const rows = await orgCalls(orgId);
    expect(rows[0]?.status).toBe('missed');
    expect(rows[0]?.durationSeconds).toBe(0);
  });

  it('callee busy logs missed', async () => {
    const { orgId, businessNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('bad fixture');
    const callRef = `call_busy_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef, to, from: parseE164('+420601000008') });
    await ctx.telco.legEnded({ callRef, legStatus: 'busy' });
    await ctx.telco.completed({ callRef, durationSeconds: 0 });

    const rows = await orgCalls(orgId);
    expect(rows[0]?.status).toBe('missed');
  });

  it('provider failure on the forward leg logs failed with the provider error code', async () => {
    const { orgId, businessNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('bad fixture');
    const callRef = `call_legfail_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef, to, from: parseE164('+420601000009') });
    await ctx.telco.legEnded({ callRef, legStatus: 'failed', errorCode: '31005' });
    await ctx.telco.completed({ callRef, durationSeconds: 0, errorCode: '31005' });

    const rows = await orgCalls(orgId);
    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.providerErrorCode).toBe('31005');
  });

  it('caller hanging up while ringing logs missed/caller_hangup', async () => {
    const { orgId, businessNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('bad fixture');
    const callRef = `call_ringinghangup_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef, to, from: parseE164('+420601000010') });
    // No leg-status event ever arrives — the caller hung up before any outcome.
    await ctx.telco.completed({ callRef, durationSeconds: 0 });

    const rows = await orgCalls(orgId);
    expect(rows[0]?.status).toBe('missed');
    expect(rows[0]?.reason).toBe('caller_hangup');
  });

  it(
    'a delayed leg callback delivered after call.completed already finalized the row is ' +
      'acknowledged and ignored — the final row is still correct (order tolerance, §5.0)',
    async () => {
      const { orgId, businessNumberE164 } = await readyOrg();
      const to = parseE164(businessNumberE164);
      if (!to) throw new Error('bad fixture');
      const callRef = `call_reordered_${randomUUID()}`;
      await ctx.telco.incomingCall({ callRef, to, from: parseE164('+420601000011') });
      await ctx.telco.legAnswered({ callRef });
      await ctx.telco.completed({ callRef, durationSeconds: 55 });

      // Late/duplicate/re-ordered leg callback arriving after finalization.
      const late = await ctx.telco.legEnded({ callRef, legStatus: 'busy' });
      expect(late.status).toBe(200);

      const rows = await orgCalls(orgId);
      expect(rows.length).toBe(1);
      expect(rows[0]?.status).toBe('answered');
      expect(rows[0]?.durationSeconds).toBe(55);
    },
  );

  it('a caller with withheld CLI is routed as a normal customer call', async () => {
    const { businessNumberE164, personalNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('bad fixture');
    const res = await ctx.telco.incomingCall({ to, from: null });

    expect(res.instruction?.kind).toBe('forward');
    if (res.instruction?.kind === 'forward') {
      expect(res.instruction.to).toBe(personalNumberE164);
    }
  });

  it('every terminal state writes exactly one call row and the row is never updated afterwards', async () => {
    const { orgId, businessNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('bad fixture');
    const callRef = `call_writeonce_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef, to, from: parseE164('+420601000012') });
    await ctx.telco.legAnswered({ callRef });
    await ctx.telco.completed({ callRef, durationSeconds: 12 });

    const firstSnapshot = await orgCalls(orgId);
    expect(firstSnapshot.length).toBe(1);
    const insertedAtFirstRead = firstSnapshot[0];

    // Redeliver + a late leg event: neither should change the row.
    await ctx.telco.completed({ callRef, durationSeconds: 12 });
    await ctx.telco.legEnded({ callRef, legStatus: 'failed', errorCode: 'ignored' });

    const secondSnapshot = await orgCalls(orgId);
    expect(secondSnapshot.length).toBe(1);
    expect(secondSnapshot[0]).toEqual(insertedAtFirstRead);
  });
});

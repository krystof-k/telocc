import { randomUUID } from 'node:crypto';
import { calls } from '@telocc/db';
import { parseE164 } from '@telocc/telephony';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setupContractTest } from '../helpers/context.ts';
import { createReadyOrg } from '../helpers/fixtures.ts';

/**
 * dialin-outbound.contract.test.ts — the appless bridge (design.md §5.2, ER-CLI-1,
 * ER-RATE-2).
 */
describe('appless dial-in outbound', () => {
  const ctx = setupContractTest();

  async function readyOrg(opts: Parameters<typeof createReadyOrg>[3] = {}) {
    return createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
      officeHoursMode: 'always_open',
      ...opts,
    });
  }

  async function orgCalls(orgId: string) {
    return ctx.db.select().from(calls).where(eq(calls.orgId, orgId));
  }

  it('a call from the verified personal number is answered with a beep and DTMF collection — not forwarded', async () => {
    const { businessNumberE164, personalNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    const from = parseE164(personalNumberE164);
    if (!to || !from) throw new Error('bad fixture');
    const res = await ctx.telco.incomingCall({ to, from });

    expect(res.instruction?.kind).toBe('collectDigits');
    if (res.instruction?.kind === 'collectDigits') {
      expect(res.instruction.prompt).toBe('beep');
    }
  });

  it(
    'the verified match uses provider signalling CLI, exact E.164 — a near-miss number ' +
      '(one digit off) gets customer treatment',
    async () => {
      const { businessNumberE164, personalNumberE164 } = await readyOrg();
      const nearMiss = `${personalNumberE164.slice(0, -1)}${personalNumberE164.endsWith('7') ? '8' : '7'}`;
      const to = parseE164(businessNumberE164);
      const from = parseE164(nearMiss);
      if (!to || !from) throw new Error('bad fixture');
      const res = await ctx.telco.incomingCall({ to, from });

      expect(res.instruction?.kind).toBe('forward');
    },
  );

  it('dial-in works out of hours (outbound not gated)', async () => {
    const { businessNumberE164, personalNumberE164 } = await readyOrg({
      officeHoursMode: 'always_closed',
    });
    const to = parseE164(businessNumberE164);
    const from = parseE164(personalNumberE164);
    if (!to || !from) throw new Error('bad fixture');
    const res = await ctx.telco.incomingCall({ to, from });

    expect(res.instruction?.kind).toBe('collectDigits');
  });

  it('an unverified caller can never reach DTMF collection', async () => {
    const { businessNumberE164 } = await readyOrg({ officeHoursMode: 'always_closed' });
    const to = parseE164(businessNumberE164);
    const from = parseE164('+420601999888');
    if (!to || !from) throw new Error('bad fixture');
    const res = await ctx.telco.incomingCall({ to, from });

    expect(res.instruction?.kind).not.toBe('collectDigits');
  });

  it('entering a valid CZ mobile number bridges with the business number as caller ID', async () => {
    const { businessNumberE164, personalNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    const from = parseE164(personalNumberE164);
    if (!to || !from) throw new Error('bad fixture');
    const callRef = `call_bridge_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef, to, from });
    const res = await ctx.telco.dtmf({ callRef, digits: '604111222' });

    expect(res.instruction?.kind).toBe('bridge');
    if (res.instruction?.kind === 'bridge') {
      expect(res.instruction.target).toBe('+420604111222');
      expect(res.instruction.callerId.e164).toBe(businessNumberE164);
    }
  });

  it('entering 9 digits without prefix normalises to +420; 00420-prefixed input normalises to the same target', async () => {
    const { businessNumberE164, personalNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    const from = parseE164(personalNumberE164);
    if (!to || !from) throw new Error('bad fixture');

    const callRef1 = `call_norm_bare_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef: callRef1, to, from });
    const bareRes = await ctx.telco.dtmf({ callRef: callRef1, digits: '604111333' });
    expect(bareRes.instruction?.kind).toBe('bridge');
    const bareTarget = bareRes.instruction?.kind === 'bridge' ? bareRes.instruction.target : null;
    // Finish the first bridge before starting the second: one active bridge per org is a
    // structural invariant (decisions.md #29) pinned by this file's concurrency cases.
    await ctx.telco.completed({ callRef: callRef1, durationSeconds: 5 });

    const callRef2 = `call_norm_00420_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef: callRef2, to, from });
    const prefixedRes = await ctx.telco.dtmf({ callRef: callRef2, digits: '00420604111333' });
    expect(prefixedRes.instruction?.kind).toBe('bridge');
    const prefixedTarget =
      prefixedRes.instruction?.kind === 'bridge' ? prefixedRes.instruction.target : null;

    expect(bareTarget).toBe('+420604111333');
    expect(prefixedTarget).toBe('+420604111333');
  });

  it("the bridge instruction carries a max duration equal to the org's remaining daily outbound minutes", async () => {
    const { businessNumberE164, personalNumberE164 } = await readyOrg({
      outboundDailyMinutesCap: 5,
    });
    const to = parseE164(businessNumberE164);
    const from = parseE164(personalNumberE164);
    if (!to || !from) throw new Error('bad fixture');
    const callRef = `call_maxdur_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef, to, from });
    const res = await ctx.telco.dtmf({ callRef, digits: '604111444' });

    expect(res.instruction?.kind).toBe('bridge');
    if (res.instruction?.kind === 'bridge') {
      expect(res.instruction.maxDurationSeconds).toBe(5 * 60);
    }
  });

  it(
    "after partial consumption, the bridge instruction's max duration equals the cap " +
      'minus minutes already used today — not the full cap',
    async () => {
      const { orgId, businessNumberE164, personalNumberE164 } = await readyOrg({
        outboundDailyMinutesCap: 10,
      });
      const to = parseE164(businessNumberE164);
      const from = parseE164(personalNumberE164);
      if (!to || !from) throw new Error('bad fixture');

      // First bridged call consumes 3 of the 10-minute daily cap.
      const firstRef = `call_remaining_first_${randomUUID()}`;
      await ctx.telco.incomingCall({ callRef: firstRef, to, from });
      await ctx.telco.dtmf({ callRef: firstRef, digits: '604113000' });
      await ctx.telco.legAnswered({ callRef: firstRef });
      await ctx.telco.completed({ callRef: firstRef, durationSeconds: 180 }); // 3 minutes

      // The second bridge instruction must reflect the REMAINDER (10 - 3 = 7 minutes),
      // not the org's unconsumed full cap.
      const secondRef = `call_remaining_second_${randomUUID()}`;
      await ctx.telco.incomingCall({ callRef: secondRef, to, from });
      const res = await ctx.telco.dtmf({ callRef: secondRef, digits: '604113001' });

      expect(res.instruction?.kind).toBe('bridge');
      if (res.instruction?.kind === 'bridge') {
        expect(res.instruction.maxDurationSeconds).toBe(7 * 60);
      }

      const rows = await orgCalls(orgId);
      expect(rows.some((r) => r.status === 'answered' && r.durationSeconds === 180)).toBe(true);
    },
  );

  it(
    'either leg hanging up ends both legs and logs one answered outbound row with duration, ' +
      'initiator, source CLI and target (ER-AUD-1 fields)',
    async () => {
      const { orgId, userId, businessNumberE164, personalNumberE164 } = await readyOrg();
      const to = parseE164(businessNumberE164);
      const from = parseE164(personalNumberE164);
      if (!to || !from) throw new Error('bad fixture');
      const callRef = `call_bothdrop_${randomUUID()}`;
      await ctx.telco.incomingCall({ callRef, to, from });
      await ctx.telco.dtmf({ callRef, digits: '604111555' });
      await ctx.telco.legAnswered({ callRef });
      await ctx.telco.completed({ callRef, durationSeconds: 66 });

      const rows = await orgCalls(orgId);
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row?.direction).toBe('outbound');
      expect(row?.status).toBe('answered');
      expect(row?.durationSeconds).toBe(66);
      expect(row?.initiatingUserId).toBe(userId);
      expect(row?.fromE164).toBe(personalNumberE164);
      expect(row?.toE164).toBe('+420604111555');
    },
  );

  it(
    'the initiating caller hanging up first after an answered bridge logs exactly one ' +
      'answered outbound row with duration (design §4.4/§5.0)',
    async () => {
      const { orgId, businessNumberE164, personalNumberE164 } = await readyOrg();
      const to = parseE164(businessNumberE164);
      const from = parseE164(personalNumberE164);
      if (!to || !from) throw new Error('bad fixture');
      const callRef = `call_initiatorhangup_${randomUUID()}`;
      await ctx.telco.incomingCall({ callRef, to, from });
      await ctx.telco.dtmf({ callRef, digits: '604111666' });
      await ctx.telco.legAnswered({ callRef });
      await ctx.telco.completed({ callRef, durationSeconds: 21 });

      const rows = await orgCalls(orgId);
      expect(rows.length).toBe(1);
      expect(rows[0]?.status).toBe('answered');
      expect(rows[0]?.durationSeconds).toBe(21);
    },
  );

  it('target busy/no-answer logs missed', async () => {
    const { orgId, businessNumberE164, personalNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    const from = parseE164(personalNumberE164);
    if (!to || !from) throw new Error('bad fixture');

    const busyRef = `call_targetbusy_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef: busyRef, to, from });
    await ctx.telco.dtmf({ callRef: busyRef, digits: '604111777' });
    await ctx.telco.legEnded({ callRef: busyRef, legStatus: 'busy' });
    await ctx.telco.completed({ callRef: busyRef, durationSeconds: 0 });

    const noAnswerRef = `call_targetnoanswer_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef: noAnswerRef, to, from });
    await ctx.telco.dtmf({ callRef: noAnswerRef, digits: '604111778' });
    await ctx.telco.legEnded({ callRef: noAnswerRef, legStatus: 'no_answer' });
    await ctx.telco.completed({ callRef: noAnswerRef, durationSeconds: 0 });

    const rows = await orgCalls(orgId);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.status === 'missed')).toBe(true);
  });

  it('caller hangup while the target is still ringing logs missed/caller_hangup', async () => {
    const { orgId, businessNumberE164, personalNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    const from = parseE164(personalNumberE164);
    if (!to || !from) throw new Error('bad fixture');
    const callRef = `call_ringinghangup_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef, to, from });
    await ctx.telco.dtmf({ callRef, digits: '604111888' });
    await ctx.telco.completed({ callRef, durationSeconds: 0 });

    const rows = await orgCalls(orgId);
    expect(rows[0]?.status).toBe('missed');
    expect(rows[0]?.reason).toBe('caller_hangup');
  });

  it('DTMF inactivity timeout hangs up and logs failed/inactivity_timeout', async () => {
    const { orgId, businessNumberE164, personalNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    const from = parseE164(personalNumberE164);
    if (!to || !from) throw new Error('bad fixture');
    const callRef = `call_dtmftimeout_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef, to, from });
    const res = await ctx.telco.dtmf({ callRef, digits: '' });

    expect(res.instruction?.kind).toBe('hangup');
    const rows = await orgCalls(orgId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.reason).toBe('inactivity_timeout');
  });

  it('caller hangup during collection logs failed/caller_hangup', async () => {
    const { orgId, businessNumberE164, personalNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    const from = parseE164(personalNumberE164);
    if (!to || !from) throw new Error('bad fixture');
    const callRef = `call_collecthangup_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef, to, from });
    await ctx.telco.completed({ callRef, durationSeconds: 0 });

    const rows = await orgCalls(orgId);
    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.reason).toBe('caller_hangup');
  });

  it('invalid digits get the refusal tone and log failed/invalid_target — no retry, no second gather', async () => {
    const { orgId, businessNumberE164, personalNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    const from = parseE164(personalNumberE164);
    if (!to || !from) throw new Error('bad fixture');
    const callRef = `call_invaliddigits_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef, to, from });
    const res = await ctx.telco.dtmf({ callRef, digits: '12345678901234567' });

    expect(res.instruction?.kind).toBe('refuseTone');
    const rows = await orgCalls(orgId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.reason).toBe('invalid_target');

    // No retry / no second gather: the session is already finalized.
    const secondAttempt = await ctx.telco.dtmf({ callRef, digits: '604111999' });
    expect(secondAttempt.instruction?.kind).not.toBe('collectDigits');
    const rowsAfter = await orgCalls(orgId);
    expect(rowsAfter.length).toBe(1);
  });

  it('a second simultaneous dial-in is rejected busy and logged blocked/concurrent_bridge', async () => {
    const { orgId, businessNumberE164, personalNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    const from = parseE164(personalNumberE164);
    if (!to || !from) throw new Error('bad fixture');

    await ctx.telco.incomingCall({ callRef: `call_first_${randomUUID()}`, to, from });
    const secondRes = await ctx.telco.incomingCall({
      callRef: `call_second_${randomUUID()}`,
      to,
      from,
    });

    expect(secondRes.instruction?.kind).toBe('reject');
    const rows = await orgCalls(orgId);
    expect(rows.some((r) => r.status === 'blocked' && r.reason === 'concurrent_bridge')).toBe(true);
  });

  it('the (cap+1)-th dial-in within an hour is rejected and logged blocked/rate_limited', async () => {
    const { orgId, businessNumberE164, personalNumberE164 } = await readyOrg({
      dialinHourlyCap: 6,
    });
    const to = parseE164(businessNumberE164);
    const from = parseE164(personalNumberE164);
    if (!to || !from) throw new Error('bad fixture');

    const results: (import('@telocc/telephony').CallInstruction | null)[] = [];
    for (let i = 0; i < 7; i += 1) {
      const callRef = `call_ratelimit_${i}_${randomUUID()}`;
      const res = await ctx.telco.incomingCall({ callRef, to, from });
      results.push(res.instruction);
      if (res.instruction?.kind === 'collectDigits') {
        await ctx.telco.dtmf({ callRef, digits: '' }); // fast, cheap terminal
      }
    }

    expect(results.slice(0, 6).every((i) => i?.kind === 'collectDigits')).toBe(true);
    expect(results[6]?.kind).toBe('reject');
    const rows = await orgCalls(orgId);
    expect(rows.some((r) => r.status === 'blocked' && r.reason === 'rate_limited')).toBe(true);
  });

  it('with the daily minutes cap exhausted, dial-in is rejected and logged blocked/daily_cap_reached', async () => {
    const { orgId, businessNumberE164, personalNumberE164 } = await readyOrg({
      outboundDailyMinutesCap: 1,
    });
    const to = parseE164(businessNumberE164);
    const from = parseE164(personalNumberE164);
    if (!to || !from) throw new Error('bad fixture');

    const firstRef = `call_capuse_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef: firstRef, to, from });
    await ctx.telco.dtmf({ callRef: firstRef, digits: '604112000' });
    await ctx.telco.legAnswered({ callRef: firstRef });
    await ctx.telco.completed({ callRef: firstRef, durationSeconds: 60 }); // consumes the full 1-minute cap

    const secondRef = `call_capexhausted_${randomUUID()}`;
    const res = await ctx.telco.incomingCall({ callRef: secondRef, to, from });
    expect(res.instruction?.kind).toBe('reject');

    const rows = await orgCalls(orgId);
    expect(rows.some((r) => r.status === 'blocked' && r.reason === 'daily_cap_reached')).toBe(true);
  });

  it('dialling the business number itself or the own personal number is refused as invalid_target', async () => {
    const { orgId, businessNumberE164, personalNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    const from = parseE164(personalNumberE164);
    if (!to || !from) throw new Error('bad fixture');

    const selfCallRef = `call_dialself_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef: selfCallRef, to, from });
    const selfRes = await ctx.telco.dtmf({
      callRef: selfCallRef,
      digits: businessNumberE164.replace('+', ''),
    });
    expect(selfRes.instruction?.kind).toBe('refuseTone');

    const ownCallRef = `call_dialown_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef: ownCallRef, to, from });
    const ownRes = await ctx.telco.dtmf({
      callRef: ownCallRef,
      digits: personalNumberE164.replace('+', ''),
    });
    expect(ownRes.instruction?.kind).toBe('refuseTone');

    const rows = await orgCalls(orgId);
    expect(rows.filter((r) => r.status === 'failed' && r.reason === 'invalid_target').length).toBe(
      2,
    );
  });
});

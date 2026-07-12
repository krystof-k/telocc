import { parseE164 } from '@telocc/telephony';
import { describe, expect, it } from 'vitest';
import { setupContractTest } from '../helpers/context.ts';
import { createReadyOrg, STANDARD_WEEKDAY_9_TO_17 } from '../helpers/fixtures.ts';

/**
 * office-hours.contract.test.ts — the routing matrix (ER-CLI-2b, design.md §8).
 *
 * Dates are chosen so a wrong/naive timezone or DST calculation produces a
 * DIFFERENT (wrong) answer than the correct one, not an accidentally-matching one:
 * 2026-01-12 is a Monday; 2026-03-30 is the Monday right after the EU spring-forward
 * (2026-03-29, CET→CEST); 2026-10-26 is the Monday right after the EU fall-back
 * (2026-10-25, CEST→CET).
 */
describe('office hours routing matrix', () => {
  const ctx = setupContractTest();

  async function callAt(businessNumberE164: string, at: string) {
    ctx.clock.set(at);
    ctx.rebuildApp();
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('bad business number fixture');
    return ctx.telco.incomingCall({ to, from: parseE164('+420600100100') });
  }

  it('always_open forwards at 3 a.m. Sunday', async () => {
    const { businessNumberE164 } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
      officeHoursMode: 'always_open',
    });
    const res = await callAt(businessNumberE164, '2026-01-11T03:00:00.000Z');
    expect(res.instruction?.kind).toBe('forward');
  });

  it('always_closed declines with busy at noon Wednesday', async () => {
    const { businessNumberE164 } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
      officeHoursMode: 'always_closed',
    });
    const res = await callAt(businessNumberE164, '2026-01-14T12:00:00.000Z');
    expect(res.instruction?.kind).toBe('reject');
  });

  it(
    'schedule mode: call at 08:59:59 local is declined, at 09:00:00 forwarded, ' +
      'at 16:59:59 forwarded, at 17:00:00 declined',
    async () => {
      const { businessNumberE164 } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
        officeHoursMode: 'schedule',
        timezone: 'Europe/Prague',
        officeHourRules: STANDARD_WEEKDAY_9_TO_17,
      });
      // Winter (CET, UTC+1): local 08:59:59/09:00:00/16:59:59/17:00:00 on Monday 2026-01-12.
      const beforeOpen = await callAt(businessNumberE164, '2026-01-12T07:59:59.000Z');
      expect(beforeOpen.instruction?.kind).toBe('reject');

      const atOpen = await callAt(businessNumberE164, '2026-01-12T08:00:00.000Z');
      expect(atOpen.instruction?.kind).toBe('forward');

      const beforeClose = await callAt(businessNumberE164, '2026-01-12T15:59:59.000Z');
      expect(beforeClose.instruction?.kind).toBe('forward');

      const atClose = await callAt(businessNumberE164, '2026-01-12T16:00:00.000Z');
      expect(atClose.instruction?.kind).toBe('reject');
    },
  );

  it('a weekday with no rule is closed all day', async () => {
    const { businessNumberE164 } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
      officeHoursMode: 'schedule',
      timezone: 'Europe/Prague',
      officeHourRules: STANDARD_WEEKDAY_9_TO_17, // Mon-Fri only
    });
    // 2026-01-17 is a Saturday (weekday 5) — no rule for it.
    const res = await callAt(businessNumberE164, '2026-01-17T12:00:00.000Z');
    expect(res.instruction?.kind).toBe('reject');
  });

  it(
    'evaluation uses the org timezone: 08:00 UTC is in-hours for Europe/Prague 9–17 in winter ' +
      '(09:00 local) — and the same instant maps correctly across the March and October 2026 DST transitions',
    async () => {
      const { businessNumberE164 } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
        officeHoursMode: 'schedule',
        timezone: 'Europe/Prague',
        officeHourRules: STANDARD_WEEKDAY_9_TO_17,
      });

      // Winter (CET, UTC+1): 08:00 UTC = 09:00 local, right at opening.
      const winter = await callAt(businessNumberE164, '2026-01-12T08:00:00.000Z');
      expect(winter.instruction?.kind).toBe('forward');

      // After spring-forward (CEST, UTC+2), Monday 2026-03-30: 15:00 UTC = 17:00
      // local exactly at close — a stale UTC+1 offset would wrongly compute 16:00
      // local (still open) and forward instead of declining.
      const afterSpringForward = await callAt(businessNumberE164, '2026-03-30T15:00:00.000Z');
      expect(afterSpringForward.instruction?.kind).toBe('reject');

      // After fall-back (CET, UTC+1), Monday 2026-10-26: 08:00 UTC = 09:00 local
      // exactly at open — a stale UTC+2 offset would wrongly compute 07:00 local
      // (before opening) and decline instead of forwarding.
      const afterFallBack = await callAt(businessNumberE164, '2026-10-26T08:00:00.000Z');
      expect(afterFallBack.instruction?.kind).toBe('forward');
    },
  );

  it('a non-Prague timezone org evaluates in its own zone', async () => {
    const { businessNumberE164 } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
      officeHoursMode: 'schedule',
      timezone: 'America/New_York', // EST = UTC-5 in January
      officeHourRules: STANDARD_WEEKDAY_9_TO_17,
    });

    // 13:59:59 UTC = 08:59:59 EST — before opening in New York.
    const beforeOpen = await callAt(businessNumberE164, '2026-01-12T13:59:59.000Z');
    expect(beforeOpen.instruction?.kind).toBe('reject');

    // 14:00:00 UTC = 09:00:00 EST — exactly opening in New York.
    const atOpen = await callAt(businessNumberE164, '2026-01-12T14:00:00.000Z');
    expect(atOpen.instruction?.kind).toBe('forward');
  });

  it('out-of-hours the number still responds: the decline is a busy instruction, never an unrouted/dead number', async () => {
    const { businessNumberE164 } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
      officeHoursMode: 'always_closed',
    });
    const res = await callAt(businessNumberE164, '2026-01-12T12:00:00.000Z');
    expect(res.status).toBe(200);
    expect(res.instruction?.kind).toBe('reject');
    if (res.instruction?.kind === 'reject') {
      expect(res.instruction.cause).toBe('busy');
    }
  });
});

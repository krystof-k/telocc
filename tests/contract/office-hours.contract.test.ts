import { parseE164 } from '@telocc/telephony';
import { describe, expect, it } from 'vitest';
import { setupContractTest } from '../helpers/context.ts';
import { createReadyOrg, STANDARD_WEEKDAY_9_TO_17 } from '../helpers/fixtures.ts';
import { getJson, jsonBody, putJson } from '../helpers/http.ts';

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

  /**
   * These cases drive the REAL `PUT /api/office-hours` route (design.md §7) rather than
   * seeding rules directly in the DB, and confirm the change actually reaches routing
   * decisions on a real inbound call. They are red until M5 lands the route — that is
   * expected/correct per the finding; M5's verify command
   * (`pnpm vitest run tests/contract/office-hours.contract.test.ts ...`) is file-level
   * with no `-t` filter, so these cases are already selected by that gate without any
   * milestones.md change.
   */
  describe('PUT /api/office-hours (real route)', () => {
    it(
      'setting weekly rules via HTTP changes real routing: a subsequent inbound call ' +
        'is forwarded in-hours and declined busy out-of-hours after the change',
      async () => {
        const { cookieHeader, businessNumberE164 } = await createReadyOrg(
          ctx.app,
          ctx.db,
          ctx.mailbox,
          { officeHoursMode: 'schedule', timezone: 'Europe/Prague', officeHourRules: [] },
        );

        const putRes = await putJson(
          ctx.app,
          '/api/office-hours',
          {
            mode: 'schedule',
            timezone: 'Europe/Prague',
            rules: [{ weekday: 0, opensAt: '09:00', closesAt: '17:00' }],
          },
          { cookieHeader },
        );
        expect(putRes.status).toBeLessThan(300);

        const getRes = await getJson(ctx.app, '/api/office-hours', { cookieHeader });
        expect(getRes.status).toBe(200);
        const body = await jsonBody<{ mode: string; rules: { weekday: number }[] }>(getRes);
        expect(body?.mode).toBe('schedule');
        expect(body?.rules?.some((r) => r.weekday === 0)).toBe(true);

        // 08:30 UTC = 09:30 local (Monday 2026-01-12, CET winter) — in hours, forwarded.
        const inHours = await callAt(businessNumberE164, '2026-01-12T08:30:00.000Z');
        expect(inHours.instruction?.kind).toBe('forward');

        // 18:00 UTC = 19:00 local — after the (newly set) 17:00 close, declined busy.
        const outOfHours = await callAt(businessNumberE164, '2026-01-12T18:00:00.000Z');
        expect(outOfHours.instruction?.kind).toBe('reject');
      },
    );

    it('opens>=closes in a rule is rejected with 400', async () => {
      const { cookieHeader } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
      const res = await putJson(
        ctx.app,
        '/api/office-hours',
        {
          mode: 'schedule',
          timezone: 'Europe/Prague',
          rules: [{ weekday: 0, opensAt: '17:00', closesAt: '09:00' }],
        },
        { cookieHeader },
      );
      expect(res.status).toBe(400);
    });

    it('a duplicate weekday across rules is rejected with 400', async () => {
      const { cookieHeader } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
      const res = await putJson(
        ctx.app,
        '/api/office-hours',
        {
          mode: 'schedule',
          timezone: 'Europe/Prague',
          rules: [
            { weekday: 0, opensAt: '09:00', closesAt: '17:00' },
            { weekday: 0, opensAt: '10:00', closesAt: '18:00' },
          ],
        },
        { cookieHeader },
      );
      expect(res.status).toBe(400);
    });

    it('a non-IANA timezone string is rejected with 400', async () => {
      const { cookieHeader } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
      const res = await putJson(
        ctx.app,
        '/api/office-hours',
        {
          mode: 'schedule',
          timezone: 'Not/A_Real_Zone',
          rules: [{ weekday: 0, opensAt: '09:00', closesAt: '17:00' }],
        },
        { cookieHeader },
      );
      expect(res.status).toBe(400);
    });

    it('more than 7 rules is rejected with 400', async () => {
      const { cookieHeader } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
      const rules = Array.from({ length: 8 }, (_, i) => ({
        weekday: i % 7,
        opensAt: '09:00',
        closesAt: '17:00',
      }));
      const res = await putJson(
        ctx.app,
        '/api/office-hours',
        { mode: 'schedule', timezone: 'Europe/Prague', rules },
        { cookieHeader },
      );
      expect(res.status).toBe(400);
    });
  });
});

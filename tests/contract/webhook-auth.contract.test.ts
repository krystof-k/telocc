import { randomUUID } from 'node:crypto';
import { auditEvents, businessNumbers, callSessions, calls } from '@telocc/db';
import { parseE164 } from '@telocc/telephony';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setupContractTest } from '../helpers/context.ts';
import { createReadyOrg } from '../helpers/fixtures.ts';

/**
 * webhook-auth.contract.test.ts — provider callbacks (ER-WEB-1, design.md §4.3, §9.5).
 */
describe('webhook signature verification', () => {
  const ctx = setupContractTest();

  it('an unsigned webhook is rejected with 401 before any state changes', async () => {
    const { businessNumberE164 } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
      officeHoursMode: 'always_open',
    });
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('fixture produced an invalid business number');

    const res = await ctx.telco.incomingCall(
      { to, from: parseE164('+420600000001') },
      { omitSignatureHeaders: true },
    );
    expect(res.status).toBe(401);

    const rows = await ctx.db.select().from(calls);
    expect(rows.length).toBe(0);
  });

  it('a webhook with a wrong signature is rejected with 401 and counted in audit_events', async () => {
    const { businessNumberE164 } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
      officeHoursMode: 'always_open',
    });
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('fixture produced an invalid business number');

    const res = await ctx.telco.incomingCall(
      { to, from: parseE164('+420600000002') },
      { signatureOverride: 'deadbeef'.repeat(8) },
    );
    expect(res.status).toBe(401);

    const events = await ctx.db.select().from(auditEvents);
    expect(events.some((e) => e.type === 'webhook_rejected')).toBe(true);
  });

  it('a webhook with a valid signature but a timestamp older than 5 minutes is rejected (mock scheme)', async () => {
    const { businessNumberE164 } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
      officeHoursMode: 'always_open',
    });
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('fixture produced an invalid business number');

    const staleTimestamp = Math.floor(ctx.clock.now().getTime() / 1000) - 301;
    const res = await ctx.telco.incomingCall(
      { to, from: parseE164('+420600000003') },
      { timestampOverride: staleTimestamp },
    );
    expect(res.status).toBe(401);
  });

  it('a correctly signed webhook is accepted and processed', async () => {
    const { businessNumberE164 } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
      officeHoursMode: 'always_open',
    });
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('fixture produced an invalid business number');

    const res = await ctx.telco.incomingCall({ to, from: parseE164('+420600000004') });
    expect(res.status).toBe(200);
    expect(res.instruction).not.toBeNull();
  });

  it('a signed webhook with a malformed payload returns 400 and changes nothing', async () => {
    const { businessNumberE164 } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
      officeHoursMode: 'always_open',
    });
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('fixture produced an invalid business number');

    const res = await ctx.telco.sendEvent(
      { type: 'call.incoming', callRef: 'call_malformed', to, from: null, at: ctx.clock.now() },
      { rawBodyOverride: '{ this is not valid json' },
    );
    expect(res.status).toBe(400);

    const rows = await ctx.db.select().from(calls);
    expect(rows.length).toBe(0);
  });

  it('a webhook naming an unknown business number is acknowledged but ignored (no session, no log row)', async () => {
    await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, { officeHoursMode: 'always_open' });
    const unknownNumber = parseE164('+420299999999');
    if (!unknownNumber) throw new Error('bad test fixture number');

    const res = await ctx.telco.incomingCall({
      to: unknownNumber,
      from: parseE164('+420600000005'),
    });
    expect(res.status).toBe(200);

    const rows = await ctx.db.select().from(calls);
    expect(rows.length).toBe(0);
  });

  it('redelivering the same completed-call webhook twice writes exactly one call row', async () => {
    const { businessNumberE164 } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
      officeHoursMode: 'always_open',
    });
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('fixture produced an invalid business number');
    const callRef = `call_redeliver_${randomUUID()}`;

    await ctx.telco.incomingCall({ callRef, to, from: parseE164('+420600000006') });
    await ctx.telco.legAnswered({ callRef });
    const first = await ctx.telco.completed({ callRef, durationSeconds: 42 });
    expect(first.status).toBe(200);
    const second = await ctx.telco.completed({ callRef, durationSeconds: 42 });
    expect(second.status).toBe(200);

    const rows = await ctx.db.select().from(calls).where(eq(calls.providerCallRef, callRef));
    expect(rows.length).toBe(1);
  });

  it(
    'an event for a callRef that never existed (or whose session was already finalized) is acknowledged 200, ' +
      'changes nothing, and is counted in audit_events',
    async () => {
      const res = await ctx.telco.completed({
        callRef: `call_never_existed_${randomUUID()}`,
        durationSeconds: 10,
      });
      expect(res.status).toBe(200);

      const rows = await ctx.db.select().from(calls);
      expect(rows.length).toBe(0);

      const events = await ctx.db.select().from(auditEvents);
      expect(events.some((e) => e.type === 'webhook_ignored')).toBe(true);
    },
  );

  it('a completed-call webhook redelivered after the 4-hour session sweep creates no new call row and returns 200', async () => {
    const { orgId, businessNumberE164 } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
      officeHoursMode: 'always_open',
    });
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('fixture produced an invalid business number');
    const callRef = `call_swept_${randomUUID()}`;

    await ctx.telco.incomingCall({ callRef, to, from: parseE164('+420600000007') });

    // Simulate the purge job's 4h sweep (design.md §10.1 step 5) having already run:
    // it deletes the call_sessions row and writes one failed/session_expired call row.
    // Fabricated directly here rather than by invoking `runScheduledJobs` — that job's
    // own end-to-end behaviour (incl. its still-a-stub signature, see this file's
    // report note) is exercised by retention-purge.contract.test.ts instead.
    const [businessNumberRow] = await ctx.db
      .select()
      .from(businessNumbers)
      .where(eq(businessNumbers.orgId, orgId));
    if (!businessNumberRow) throw new Error('fixture business number row missing');
    await ctx.db.delete(callSessions).where(eq(callSessions.providerCallRef, callRef));
    await ctx.db.insert(calls).values({
      orgId,
      businessNumberId: businessNumberRow.id,
      direction: 'inbound',
      status: 'failed',
      reason: 'session_expired',
      startedAt: ctx.clock.now(),
      providerCallRef: callRef,
    });

    ctx.clock.advanceHours(4);
    ctx.clock.advanceMinutes(1);
    ctx.rebuildApp();

    const res = await ctx.telco.completed({ callRef, durationSeconds: 5 });
    expect(res.status).toBe(200);

    const rows = await ctx.db.select().from(calls).where(eq(calls.providerCallRef, callRef));
    expect(rows.length).toBe(1);
  });

  it('a webhook for the wrong provider path returns 404', async () => {
    const { businessNumberE164 } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
      officeHoursMode: 'always_open',
    });
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('fixture produced an invalid business number');

    const res = await ctx.telco.incomingCall(
      { to, from: parseE164('+420600000008') },
      { path: '/webhooks/telephony/twilio' },
    );
    expect(res.status).toBe(404);
  });
});

import { randomUUID } from 'node:crypto';
import { runScheduledJobs as runScheduledJobsStub } from '@telocc/core';
import type { Db } from '@telocc/db';
import {
  auditEvents,
  callSessions,
  calls,
  phoneVerifications,
  purgeRuns,
  rateLimitCounters,
  verification as verificationTable,
} from '@telocc/db';
import type { TelephonyProvider } from '@telocc/telephony';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../apps/api/src/env.ts';
import { setupContractTest } from '../helpers/context.ts';
import { buildTestEnv } from '../helpers/env.ts';
import { createReadyOrg } from '../helpers/fixtures.ts';

/**
 * retention-purge.contract.test.ts — the scheduled job (ER-RET-1..3, design.md §10.1).
 *
 * SCAFFOLD GAP: `packages/core/src/retention.ts`'s M0 stub is `runScheduledJobs(now)`;
 * design.md §10.1 documents `runScheduledJobs(db, provider, env, now)`. The cast below
 * pins the contract to the documented 4-arg signature so this file compiles today AND
 * calls straight through once M8 implements the real function with that shape — no
 * edit to this frozen file should be needed. See this milestone's report for detail.
 */
type RunScheduledJobs = (
  db: Db,
  provider: TelephonyProvider,
  env: Env,
  now: () => Date,
) => Promise<{ ranAt: Date; stats?: Record<string, unknown> }>;
const runScheduledJobs = runScheduledJobsStub as unknown as RunScheduledJobs;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

describe('retention & purge job', () => {
  const ctx = setupContractTest();

  function env(overrides: Record<string, string | undefined> = {}) {
    return buildTestEnv(overrides);
  }

  async function run(envOverrides: Record<string, string | undefined> = {}) {
    return runScheduledJobs(ctx.db, ctx.provider, env(envOverrides), () => ctx.clock.now());
  }

  it(
    'calls older than the retention window are anonymised: both numbers, initiator and ' +
      'provider refs stripped; timestamps, direction, duration, status kept',
    async () => {
      const { orgId, businessNumberId, userId } = await createReadyOrg(
        ctx.app,
        ctx.db,
        ctx.mailbox,
      );
      const oldStartedAt = new Date(ctx.clock.now().getTime() - 14 * 30 * ONE_DAY_MS); // ~14 months
      const [row] = await ctx.db
        .insert(calls)
        .values({
          orgId,
          businessNumberId,
          direction: 'inbound',
          status: 'answered',
          fromE164: '+420604000001',
          toE164: '+420212345678',
          initiatingUserId: userId,
          startedAt: oldStartedAt,
          durationSeconds: 42,
          providerCallRef: `call_old_${randomUUID()}`,
        })
        .returning();
      if (!row) throw new Error('fixture insert failed');

      await run();

      const [after] = await ctx.db.select().from(calls).where(eq(calls.id, row.id));
      expect(after?.fromE164).toBeNull();
      expect(after?.toE164).toBeNull();
      expect(after?.initiatingUserId).toBeNull();
      expect(after?.providerCallRef).toBeNull();
      expect(after?.anonymisedAt).toBeTruthy();
      // Kept: timestamps, direction, duration, status.
      expect(after?.direction).toBe('inbound');
      expect(after?.status).toBe('answered');
      expect(after?.durationSeconds).toBe(42);
      expect(after?.startedAt.getTime()).toBe(oldStartedAt.getTime());
    },
  );

  it('calls inside the window are untouched', async () => {
    const { orgId, businessNumberId } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
    const recentStartedAt = new Date(ctx.clock.now().getTime() - 2 * 30 * ONE_DAY_MS); // ~2 months
    const [row] = await ctx.db
      .insert(calls)
      .values({
        orgId,
        businessNumberId,
        direction: 'inbound',
        status: 'answered',
        fromE164: '+420604000002',
        toE164: '+420212345678',
        startedAt: recentStartedAt,
        durationSeconds: 10,
        providerCallRef: `call_recent_${randomUUID()}`,
      })
      .returning();
    if (!row) throw new Error('fixture insert failed');

    await run();

    const [after] = await ctx.db.select().from(calls).where(eq(calls.id, row.id));
    expect(after?.anonymisedAt).toBeNull();
    expect(after?.fromE164).toBe('+420604000002');
  });

  it('security audit events older than 90 days are deleted; lifecycle events survive until the call-log window', async () => {
    const { orgId } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
    const oldAt = new Date(ctx.clock.now().getTime() - 91 * ONE_DAY_MS);
    const [securityRow] = await ctx.db
      .insert(auditEvents)
      .values({ orgId, type: 'pin_issued', retentionClass: 'security', createdAt: oldAt })
      .returning();
    const [lifecycleRow] = await ctx.db
      .insert(auditEvents)
      .values({ orgId, type: 'number_lifecycle', retentionClass: 'lifecycle', createdAt: oldAt })
      .returning();
    if (!securityRow || !lifecycleRow) throw new Error('fixture insert failed');

    await run();

    const remaining = await ctx.db.select().from(auditEvents);
    expect(remaining.some((r) => r.id === securityRow.id)).toBe(false);
    expect(remaining.some((r) => r.id === lifecycleRow.id)).toBe(true);
  });

  it('expired magic-link hashes and PIN challenges are deleted', async () => {
    const { orgId, userId } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
    const past = new Date(ctx.clock.now().getTime() - 60 * 60 * 1000);
    const [verificationRow] = await ctx.db
      .insert(verificationTable)
      .values({
        id: randomUUID(),
        identifier: 'test@example.test',
        value: 'expired-hash',
        expiresAt: past,
      })
      .returning();
    const [pinRow] = await ctx.db
      .insert(phoneVerifications)
      .values({
        orgId,
        userId,
        phoneE164: '+420604000003',
        pinHash: 'expired-hash',
        expiresAt: past,
      })
      .returning();
    if (!verificationRow || !pinRow) throw new Error('fixture insert failed');

    await run();

    const remainingVerifications = await ctx.db
      .select()
      .from(verificationTable)
      .where(eq(verificationTable.id, verificationRow.id));
    const remainingPins = await ctx.db
      .select()
      .from(phoneVerifications)
      .where(eq(phoneVerifications.id, pinRow.id));
    expect(remainingVerifications.length).toBe(0);
    expect(remainingPins.length).toBe(0);
  });

  it('expired rate-limit counters are deleted', async () => {
    const past = new Date(ctx.clock.now().getTime() - 60 * 60 * 1000);
    await ctx.db.insert(rateLimitCounters).values({
      key: `expired_${randomUUID()}`,
      scope: 'test-scope',
      count: 1,
      windowStartsAt: past,
      expiresAt: past,
    });

    await run();

    const remaining = await ctx.db.select().from(rateLimitCounters);
    expect(remaining.length).toBe(0);
  });

  it('call sessions stuck for over 4 hours are finalized as failed/session_expired and removed', async () => {
    const { orgId, businessNumberId } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
    const stuckSince = new Date(ctx.clock.now().getTime() - 5 * 60 * 60 * 1000);
    const providerCallRef = `call_stuck_${randomUUID()}`;
    await ctx.db.insert(callSessions).values({
      orgId,
      businessNumberId,
      providerCallRef,
      kind: 'inbound',
      state: 'forwarding',
      fromE164: '+420604000004',
      createdAt: stuckSince,
      updatedAt: stuckSince,
    });

    await run();

    const remainingSessions = await ctx.db
      .select()
      .from(callSessions)
      .where(eq(callSessions.providerCallRef, providerCallRef));
    expect(remainingSessions.length).toBe(0);

    const [callRow] = await ctx.db
      .select()
      .from(calls)
      .where(eq(calls.providerCallRef, providerCallRef));
    expect(callRow?.status).toBe('failed');
    expect(callRow?.reason).toBe('session_expired');
  });

  it('the run writes a purge_runs row with counts only — no personal data', async () => {
    const before = (await ctx.db.select().from(purgeRuns)).length;
    await run();
    const after = await ctx.db.select().from(purgeRuns);
    expect(after.length).toBe(before + 1);

    const latest = after.at(-1);
    const serializedStats = JSON.stringify(latest?.stats ?? {});
    expect(serializedStats.includes('@')).toBe(false); // no email addresses
    expect(/\+\d{6,}/.test(serializedStats)).toBe(false); // no E.164 phone numbers
  });

  it('running the job twice in a row is a no-op the second time (idempotence)', async () => {
    const { orgId, businessNumberId } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
    const oldStartedAt = new Date(ctx.clock.now().getTime() - 14 * 30 * ONE_DAY_MS);
    await ctx.db.insert(calls).values({
      orgId,
      businessNumberId,
      direction: 'inbound',
      status: 'answered',
      fromE164: '+420604000005',
      startedAt: oldStartedAt,
      providerCallRef: `call_idempotent_${randomUUID()}`,
    });

    await run();
    const afterFirst = await ctx.db.select().from(calls);
    await run();
    const afterSecond = await ctx.db.select().from(calls);

    expect(afterSecond).toEqual(afterFirst);
  });

  it('retention windows come from config: shortening the window and re-running purges accordingly', async () => {
    const { orgId, businessNumberId } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
    const twoMonthsAgo = new Date(ctx.clock.now().getTime() - 2 * 30 * ONE_DAY_MS);
    const [row] = await ctx.db
      .insert(calls)
      .values({
        orgId,
        businessNumberId,
        direction: 'inbound',
        status: 'answered',
        fromE164: '+420604000006',
        startedAt: twoMonthsAgo,
        providerCallRef: `call_shorten_${randomUUID()}`,
      })
      .returning();
    if (!row) throw new Error('fixture insert failed');

    // Default window (13 months): untouched.
    await run();
    const [afterDefault] = await ctx.db.select().from(calls).where(eq(calls.id, row.id));
    expect(afterDefault?.anonymisedAt).toBeNull();

    // Shortened window (1 month): now eligible.
    await run({ RETENTION_CALL_LOG_MONTHS: '1' });
    const [afterShortened] = await ctx.db.select().from(calls).where(eq(calls.id, row.id));
    expect(afterShortened?.anonymisedAt).toBeTruthy();
  });
});

/**
 * `runScheduledJobs(db, provider, env, now)` — the scheduled purge/anonymise job
 * (ER-RET-1..3, ER-AUD-2, design.md §10.1). Called identically by the Workers cron
 * trigger, the Node entry's 24h interval, and `scripts/run-jobs.mjs`
 * (`apps/api/src/jobs/scheduled.ts` is the thin I/O wrapper all three use). Idempotent
 * and org-iterating by construction: every step is a plain `WHERE ... < cutoff` sweep,
 * so running it twice back-to-back is a no-op the second time. Reports counts only —
 * `stats` must never contain a phone number, email, or org name (design.md §10.1 step 7).
 */
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
import { and, eq, gte, isNull, lt } from 'drizzle-orm';
import { writeTerminalCall } from './call-log.ts';
import { writeAuditEvent } from './repos/audit.ts';

/**
 * Structural subset of `apps/api/src/env.ts`'s `Env` this job reads. Declared locally
 * (not imported from `apps/api`) so `packages/core` never depends on `apps/api`
 * (design.md §1 layering) — any object with these numeric fields (the real `Env`
 * included) satisfies this by structural typing.
 */
export interface ScheduledJobsEnv {
  RETENTION_CALL_LOG_MONTHS: number;
  RETENTION_SECURITY_LOG_DAYS: number;
  ANOMALY_DAILY_CALLS: number;
  ANOMALY_DAILY_MINUTES: number;
  ANOMALY_NIGHT_CALLS: number;
  ANOMALY_CZ_FAILURE_PCT: number;
}

export interface ScheduledJobsResult {
  ranAt: Date;
  stats: Record<string, number>;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** design.md §10.1 step 5: sessions stuck longer than this are treated as abandoned. */
const SESSION_STALE_HOURS = 4;

function monthsAgo(now: Date, months: number): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * MS_PER_DAY);
}

/** The UTC calendar day immediately before `at` — the anomaly scan's "yesterday". */
function previousUtcDay(at: Date): { start: Date; end: Date } {
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const start = new Date(end.getTime() - MS_PER_DAY);
  return { start, end };
}

interface OrgDailyAggregate {
  calls: number;
  minutes: number;
  nightCalls: number;
  czLegs: number;
  czFailedOrBlocked: number;
}

/**
 * design.md §9.9 — daily per-org anomaly guard: call count, minutes, 22:00–06:00 UTC
 * count, and the failed+blocked share of CZ-destination legs, each against an
 * `ANOMALY_*` threshold. Flags write an `anomaly_flagged` audit event (counts only);
 * returns how many orgs were flagged for the caller's stats line.
 */
async function runAnomalyScan(db: Db, env: ScheduledJobsEnv, at: Date): Promise<number> {
  const { start, end } = previousUtcDay(at);
  const rows = await db
    .select({
      orgId: calls.orgId,
      startedAt: calls.startedAt,
      durationSeconds: calls.durationSeconds,
      status: calls.status,
      toE164: calls.toE164,
    })
    .from(calls)
    .where(and(gte(calls.startedAt, start), lt(calls.startedAt, end)));

  const byOrg = new Map<string, OrgDailyAggregate>();
  for (const row of rows) {
    const agg = byOrg.get(row.orgId) ?? {
      calls: 0,
      minutes: 0,
      nightCalls: 0,
      czLegs: 0,
      czFailedOrBlocked: 0,
    };
    agg.calls += 1;
    agg.minutes += row.durationSeconds / 60;
    const hourUtc = row.startedAt.getUTCHours();
    if (hourUtc >= 22 || hourUtc < 6) agg.nightCalls += 1;
    if (row.toE164?.startsWith('+420')) {
      agg.czLegs += 1;
      if (row.status === 'failed' || row.status === 'blocked') agg.czFailedOrBlocked += 1;
    }
    byOrg.set(row.orgId, agg);
  }

  let flagged = 0;
  for (const [orgId, agg] of byOrg) {
    const czFailurePct = agg.czLegs > 0 ? (agg.czFailedOrBlocked / agg.czLegs) * 100 : 0;
    const exceeded =
      agg.calls > env.ANOMALY_DAILY_CALLS ||
      agg.minutes > env.ANOMALY_DAILY_MINUTES ||
      agg.nightCalls > env.ANOMALY_NIGHT_CALLS ||
      czFailurePct > env.ANOMALY_CZ_FAILURE_PCT;
    if (!exceeded) continue;
    flagged += 1;
    await writeAuditEvent(db, {
      orgId,
      type: 'anomaly_flagged',
      retentionClass: 'security',
      meta: {
        calls: agg.calls,
        minutes: Math.round(agg.minutes * 100) / 100,
        nightCalls: agg.nightCalls,
        czFailurePct: Math.round(czFailurePct * 100) / 100,
      },
    });
  }
  return flagged;
}

/**
 * design.md §10.1 — purge steps 1–7, run in order, idempotent, org-agnostic (every
 * step is a global sweep, not looped per org — the anomaly scan is the one exception
 * that is inherently per-org).
 */
export async function runScheduledJobs(
  db: Db,
  _provider: TelephonyProvider,
  env: ScheduledJobsEnv,
  now: () => Date = () => new Date(),
): Promise<ScheduledJobsResult> {
  const at = now();
  const stats: Record<string, number> = {};

  // 1. Anonymise calls older than the retention window: strip both numbers, initiator,
  // and provider refs; keep timestamps/direction/duration/status (the aggregate row
  // survives for ESD counts, decisions.md #9). `isNull(anonymisedAt)` makes a second
  // run a no-op.
  const callCutoff = monthsAgo(at, env.RETENTION_CALL_LOG_MONTHS);
  const anonymised = await db
    .update(calls)
    .set({
      fromE164: null,
      toE164: null,
      initiatingUserId: null,
      providerCallRef: null,
      providerErrorCode: null,
      anonymisedAt: at,
    })
    .where(and(lt(calls.startedAt, callCutoff), isNull(calls.anonymisedAt)))
    .returning();
  stats.callsAnonymised = anonymised.length;

  // 2. Delete audit_events: `security` class older than RETENTION_SECURITY_LOG_DAYS,
  // `lifecycle` class older than the call-log window.
  const securityCutoff = daysAgo(at, env.RETENTION_SECURITY_LOG_DAYS);
  const deletedSecurityEvents = await db
    .delete(auditEvents)
    .where(
      and(eq(auditEvents.retentionClass, 'security'), lt(auditEvents.createdAt, securityCutoff)),
    )
    .returning();
  const deletedLifecycleEvents = await db
    .delete(auditEvents)
    .where(and(eq(auditEvents.retentionClass, 'lifecycle'), lt(auditEvents.createdAt, callCutoff)))
    .returning();
  stats.auditEventsDeleted = deletedSecurityEvents.length + deletedLifecycleEvents.length;

  // 3. Delete expired phone_verifications and expired Better Auth `verification` rows.
  const deletedPhoneVerifications = await db
    .delete(phoneVerifications)
    .where(lt(phoneVerifications.expiresAt, at))
    .returning();
  const deletedMagicLinkVerifications = await db
    .delete(verificationTable)
    .where(lt(verificationTable.expiresAt, at))
    .returning();
  stats.phoneVerificationsDeleted = deletedPhoneVerifications.length;
  stats.magicLinkVerificationsDeleted = deletedMagicLinkVerifications.length;

  // 4. Delete expired rate_limit_counters.
  const deletedCounters = await db
    .delete(rateLimitCounters)
    .where(lt(rateLimitCounters.expiresAt, at))
    .returning();
  stats.rateLimitCountersDeleted = deletedCounters.length;

  // 5. Sweep call_sessions stuck longer than 4h: finalize as failed/session_expired,
  // then remove the session row (Workers have no in-memory state to lean on).
  const staleCutoff = new Date(at.getTime() - SESSION_STALE_HOURS * 60 * 60 * 1000);
  const staleSessions = await db
    .select()
    .from(callSessions)
    .where(lt(callSessions.updatedAt, staleCutoff));
  for (const session of staleSessions) {
    await writeTerminalCall(db, {
      orgId: session.orgId,
      businessNumberId: session.businessNumberId,
      direction: session.kind === 'dialin' ? 'outbound' : 'inbound',
      status: 'failed',
      reason: 'session_expired',
      fromE164: session.fromE164,
      toE164: session.targetE164,
      startedAt: session.createdAt,
      endedAt: at,
      providerCallRef: session.providerCallRef,
    });
    await db.delete(callSessions).where(eq(callSessions.id, session.id));
  }
  stats.staleSessionsExpired = staleSessions.length;

  // 6. Anomaly scan (§9.9).
  stats.orgsFlaggedForAnomaly = await runAnomalyScan(db, env, at);

  // 7. Insert a purge_runs row — counts only, no personal data.
  await db.insert(purgeRuns).values({ ranAt: at, stats });

  return { ranAt: at, stats };
}

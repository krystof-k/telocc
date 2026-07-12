/**
 * `runScheduledJobs(db, provider, env, now)` — purge/anonymise routines (ER-RET-1..3,
 * design.md §10.1). A no-op placeholder lands here in M0 so the Workers cron handler
 * and the Node interval both have something to call; the real steps land in M8.
 */

export async function runScheduledJobs(now: () => Date = () => new Date()): Promise<{
  ranAt: Date;
}> {
  // TODO(M8): anonymise calls, purge audit/verification/rate-limit rows, sweep stale
  // call_sessions, run the anomaly scan, and write a purge_runs row.
  return { ranAt: now() };
}

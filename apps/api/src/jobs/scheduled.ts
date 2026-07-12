/**
 * Thin adapter around `@telocc/core`'s `runScheduledJobs` (design.md §10.1) — the one
 * function the Workers cron handler (`entry.workers.ts`), the Node entry's 24h interval
 * (`entry.node.ts`), and `scripts/run-jobs.mjs` all call. All purge/anonymise/anomaly
 * logic lives in `packages/core/src/retention.ts`; this module only wires `Deps` into
 * it and reports the outcome — counts only, never personal data (design.md §9.8).
 */
import { runScheduledJobs } from '@telocc/core';
import type { Deps } from '../deps.ts';
import { safeLog } from '../lib/log.ts';

export async function runScheduledJob(deps: Deps): Promise<void> {
  try {
    const result = await runScheduledJobs(deps.db, deps.provider, deps.env, deps.now);
    safeLog('info', 'scheduled job run complete', {
      ranAt: result.ranAt.toISOString(),
      stats: result.stats,
    });
  } catch (err) {
    safeLog('error', 'scheduled job run failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

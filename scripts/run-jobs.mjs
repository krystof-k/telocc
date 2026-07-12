#!/usr/bin/env node
/**
 * Manual trigger for the scheduled jobs, run locally (design.md §1). The Workers
 * cron and the Node entry's 24h interval both call the same
 * `packages/core/src/retention.ts#runScheduledJobs` — this script exists so the
 * purge/anomaly pass can be run on demand without waiting for either trigger.
 * The real steps land in M8; today it just proves the wiring.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const implPath = fileURLToPath(new URL('./run-jobs.impl.ts', import.meta.url));
const result = spawnSync('pnpm', ['exec', 'tsx', implPath], {
  stdio: 'inherit',
  cwd: fileURLToPath(new URL('..', import.meta.url)),
});
process.exit(result.status ?? 1);

/**
 * Manual one-shot trigger for `runScheduledJobs` (design.md §10.1, §12) — the exact same
 * function the Workers cron handler and the Node entry's 24h interval call
 * (`apps/api/src/jobs/scheduled.ts`), reconstructed here from a plain `DATABASE_URL` so
 * it can run without either runtime being up. Reuses `apps/api`'s own `loadEnv`/
 * `buildDeps` so provider/env selection (mock vs twilio, dev vs resend) is identical to
 * the real app rather than a second, drifting copy of that logic.
 *
 * Runs inside `main()` rather than as top-level await: this file is plain
 * CommonJS-compiled by `tsx` when invoked directly (no root `"type": "module"`), and
 * esbuild rejects top-level await under the "cjs" output format.
 */
import { fileURLToPath } from 'node:url';
import { runScheduledJobs } from '@telocc/core';
import { createNodeDb } from '@telocc/db/node';
import { config } from 'dotenv';
import { buildDeps } from '../apps/api/src/deps.ts';
import { loadEnv } from '../apps/api/src/env.ts';

async function main(): Promise<void> {
  config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

  const env = loadEnv();
  const db = createNodeDb(env.DATABASE_URL);
  const deps = buildDeps({ db, env });

  const result = await runScheduledJobs(deps.db, deps.provider, deps.env, deps.now);
  console.log('scheduled jobs run:', JSON.stringify(result, null, 2));

  // Closes the pg Pool so the process exits naturally (tests/helpers/README.md:
  // `.$client` is the documented way to reach the underlying `pg.Pool` without
  // importing `pg` here).
  await db.$client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

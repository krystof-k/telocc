/**
 * ER-AUD-3 half-year volumes report (SQL over `calls`; design.md §7, §10.1). Usage:
 *
 *   pnpm report:esd -- --year 2026 --half 1
 *
 * Prints one JSON object to stdout: `{ inbound: { calls, minutes }, outbound: { calls,
 * minutes } }` for the requested half-year (H1 = 1 Jan–30 Jun, H2 = 1 Jul–31 Dec,
 * matching ČTÚ's ESD cutoffs). Counts include anonymised rows — the purge job
 * (`packages/core/src/retention.ts`) only strips numbers/refs, never the timestamp,
 * direction, duration, or status the aggregate depends on. Deliberately not an HTTP
 * route (design.md §7) — this is the only place `DATABASE_URL` is read directly rather
 * than through `apps/api`'s full `loadEnv()`, since the report needs nothing else the
 * app's config schema requires.
 *
 * Everything below runs inside `main()` rather than as top-level await: this file is
 * plain CommonJS-compiled by `tsx` when invoked directly (no root `"type": "module"`),
 * and esbuild rejects top-level await under the "cjs" output format.
 */

import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { calls } from '@telocc/db';
import { createNodeDb } from '@telocc/db/node';
import { config } from 'dotenv';
import { and, gte, lt } from 'drizzle-orm';

async function main(): Promise<void> {
  // Local dev convenience only, matching `entry.node.ts`/`run-jobs.impl.ts` — production
  // config comes from real environment variables, never a `.env` file. `quiet: true`
  // keeps dotenv's own "injected env" tip line off stdout, which this script's callers
  // (posture-flip.contract.test.ts, the `report:esd` script) parse as JSON.
  config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

  // `pnpm report:esd -- --year 2026 --half 1` forwards a literal `--` token ahead of
  // the real args (npm/pnpm's "extra args" convention) — `node:util`'s `parseArgs`
  // treats that as the POSIX end-of-options marker and would otherwise throw
  // `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL` on the first flag after it. Stripping any
  // stray `--` keeps both that invocation and a direct
  // `tsx scripts/esd-report.ts --year 2026 --half 1` call working.
  const rawArgs = process.argv.slice(2).filter((arg) => arg !== '--');
  const { values } = parseArgs({
    args: rawArgs,
    options: {
      year: { type: 'string' },
      half: { type: 'string' },
    },
  });

  if (!values.year || !values.half) {
    console.error('Usage: pnpm report:esd -- --year <YYYY> --half <1|2>');
    process.exit(1);
  }

  const year = Number(values.year);
  const half = Number(values.half);
  if (!Number.isInteger(year) || (half !== 1 && half !== 2)) {
    console.error('Usage: pnpm report:esd -- --year <YYYY> --half <1|2>');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  // H1: [1 Jan, 1 Jul); H2: [1 Jul, 1 Jan next year) — the 30 June / 31 December
  // cutoffs expressed as half-open UTC ranges.
  const start = half === 1 ? new Date(Date.UTC(year, 0, 1)) : new Date(Date.UTC(year, 6, 1));
  const end = half === 1 ? new Date(Date.UTC(year, 6, 1)) : new Date(Date.UTC(year + 1, 0, 1));

  const db = createNodeDb(databaseUrl);
  const rows = await db
    .select({ direction: calls.direction, durationSeconds: calls.durationSeconds })
    .from(calls)
    .where(and(gte(calls.startedAt, start), lt(calls.startedAt, end)));

  const report = {
    inbound: { calls: 0, minutes: 0 },
    outbound: { calls: 0, minutes: 0 },
  };
  for (const row of rows) {
    const bucket = row.direction === 'outbound' ? report.outbound : report.inbound;
    bucket.calls += 1;
    bucket.minutes += row.durationSeconds / 60;
  }

  console.log(JSON.stringify(report));
  // Closes the pg Pool so the process exits naturally instead of hanging on its open
  // socket/keepalive timer (tests/helpers/README.md: `db.$client` is the underlying
  // `pg.Pool`, the documented way to reach it without importing `pg` directly here).
  await db.$client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

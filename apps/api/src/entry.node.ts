import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createNodeDb } from '@telocc/db/node';
import { config } from 'dotenv';
import { buildApp } from './app.ts';
import { buildDeps } from './deps.ts';
import { loadEnv } from './env.ts';
import { runScheduledJob } from './jobs/scheduled.ts';

// Local dev/demo convenience only — production Workers config comes from
// wrangler.jsonc vars + `wrangler secret put` (design.md §2), never a .env file.
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const env = loadEnv();
const db = createNodeDb(env.DATABASE_URL);
const deps = buildDeps({ db, env });
const app = buildApp(deps);

const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`telocc api listening on http://localhost:${info.port}`);
});

// Local "cron": the same job the Workers cron trigger runs, on a 24h interval
// (design.md §1). `scripts/run-jobs.mjs` provides a manual one-shot trigger.
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  void runScheduledJob(deps);
}, TWENTY_FOUR_HOURS_MS).unref();

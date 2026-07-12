import { runScheduledJobs } from '@telocc/core';
import { createNeonDb } from '@telocc/db/neon';
import { buildApp } from './app.ts';
import { buildDeps } from './deps.ts';
import { loadEnv } from './env.ts';

interface WorkersEnv {
  [key: string]: string | undefined;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export default {
  fetch(
    request: Request,
    rawEnv: WorkersEnv,
    _ctx: ExecutionContext,
  ): Response | Promise<Response> {
    const env = loadEnv(rawEnv);
    const db = createNeonDb(env.DATABASE_URL);
    const app = buildApp(buildDeps({ db, env }));
    return app.fetch(request, rawEnv);
  },

  async scheduled(_event: unknown, rawEnv: WorkersEnv, ctx: ExecutionContext): Promise<void> {
    const env = loadEnv(rawEnv);
    void env; // reserved for the real job wiring (M8)
    ctx.waitUntil(runScheduledJobs());
  },
};

import { Hono } from 'hono';
import type { Deps } from '../../deps.ts';
import type { AppEnv } from '../../lib/context.ts';

/** Dev-only simulator + mailbox routes, env-gated (design.md §12, decisions.md #21).
 * Implementation lands in M4. */
export function devRoutes(_deps: Deps) {
  const r = new Hono<AppEnv>();
  return r;
}

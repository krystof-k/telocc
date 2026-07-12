import { Hono } from 'hono';
import type { Deps } from '../deps.ts';
import type { AppEnv } from '../lib/context.ts';

/** Provider webhook surface — signature-authenticated, never session-authenticated
 * (design.md §4). Implementation lands in M4. */
export function webhooksRoutes(_deps: Deps) {
  const r = new Hono<AppEnv>();
  return r;
}

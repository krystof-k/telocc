import { Hono } from 'hono';
import type { Deps } from '../deps.ts';
import type { AppEnv } from '../lib/context.ts';

/** Number catalog, provisioning, and business-number routes (design.md §6).
 * Covers /api/numbers and /api/business-number. Implementation lands in M4. */
export function numbersRoutes(_deps: Deps) {
  const r = new Hono<AppEnv>();
  return r;
}

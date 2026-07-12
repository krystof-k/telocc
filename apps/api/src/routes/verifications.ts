import { Hono } from 'hono';
import type { Deps } from '../deps.ts';
import type { AppEnv } from '../lib/context.ts';

/** SMS-PIN verification routes (design.md §6). Implementation lands in M3. */
export function verificationsRoutes(_deps: Deps) {
  const r = new Hono<AppEnv>();
  return r;
}

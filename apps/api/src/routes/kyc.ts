import { Hono } from 'hono';
import type { Deps } from '../deps.ts';
import type { AppEnv } from '../lib/context.ts';

/** KYC / regulatory-bundle routes (design.md §6). Implementation lands in M4. */
export function kycRoutes(_deps: Deps) {
  const r = new Hono<AppEnv>();
  return r;
}

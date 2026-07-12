/**
 * Session middleware (design.md §6 "Org-scoping pattern" step 1). Resolves the Better
 * Auth session from the request cookie and sets `c.var.userId`; 401 (generic, no
 * enumeration) when there is none.
 */
import type { MiddlewareHandler } from 'hono';
import type { BetterAuthInstance } from '../lib/auth.ts';
import type { AppEnv } from '../lib/context.ts';

export function requireSession(auth: BetterAuthInstance): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!result) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    c.set('userId', result.user.id);
    return next();
  };
}

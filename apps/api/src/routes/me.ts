/**
 * `GET /api/me` (design.md §6/§7) — session required, org optional. The SPA calls this
 * right after verifying a magic link; a `null` org routes it to onboarding.
 */
import { getMembershipByUserId } from '@telocc/core/repos/memberships';
import { getOrgById } from '@telocc/core/repos/orgs';
import { Hono } from 'hono';
import type { Deps } from '../deps.ts';
import type { AppEnv } from '../lib/context.ts';

export function meRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    const userId = c.get('userId');
    if (!userId) return c.json({ error: 'unauthorized' }, 401);

    // `/api/me` is reachable without a membership (design.md §6) — the global org
    // gate bypasses this route rather than 403ing it, so the membership lookup is
    // this route's own responsibility, not `c.var.orgId`.
    const membership = await getMembershipByUserId(deps.db, userId);
    if (!membership) {
      return c.json({ user: { id: userId }, org: null });
    }
    const org = await getOrgById(deps.db, membership.orgId);
    return c.json({ user: { id: userId }, org });
  });

  return app;
}

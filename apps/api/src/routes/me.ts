/**
 * `GET /api/me` (design.md §6/§7) — session required, org optional. The SPA calls this
 * right after verifying a magic link; a `null` org routes it to onboarding.
 */
import { getMembershipByUserId } from '@telocc/core/repos/memberships';
import { getOrgById } from '@telocc/core/repos/orgs';
import { getUserById } from '@telocc/core/repos/users';
import { Hono } from 'hono';
import type { Deps } from '../deps.ts';
import type { AppEnv } from '../lib/context.ts';

export function meRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    const userId = c.get('userId');
    if (!userId) return c.json({ error: 'unauthorized' }, 401);

    // Additive (settings.tsx "Account" needs the login email + verified-number
    // status; design.md §11 / brief.md "Settings"). Existing `user`/`org`/`orgId`
    // fields are unchanged — orgId stays top-level (org-scoping contract sweep).
    const authUser = await getUserById(deps.db, userId);

    // `/api/me` is reachable without a membership (design.md §6) — the global org
    // gate bypasses this route rather than 403ing it, so the membership lookup is
    // this route's own responsibility, not `c.var.orgId`.
    const membership = await getMembershipByUserId(deps.db, userId);
    if (!membership) {
      return c.json({
        user: { id: userId, email: authUser?.email ?? null },
        org: null,
        orgId: null,
        personalNumberE164: null,
        personalNumberVerifiedAt: null,
        emergencyAckAt: null,
      });
    }
    const org = await getOrgById(deps.db, membership.orgId);
    // Top-level orgId is part of the pinned API surface (org-scoping contract sweep).
    return c.json({
      user: { id: userId, email: authUser?.email ?? null },
      org,
      orgId: membership.orgId,
      personalNumberE164: membership.personalNumberE164,
      personalNumberVerifiedAt: membership.personalNumberVerifiedAt,
      emergencyAckAt: membership.emergencyAckAt,
    });
  });

  return app;
}

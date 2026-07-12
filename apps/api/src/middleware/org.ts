/**
 * Org + role middleware (design.md §6 "Org-scoping pattern" step 1, "Roles seam").
 * Must run after `requireSession` (needs `c.var.userId`). 403 (not 404 — that's
 * reserved for cross-org id probing, design.md §3 org-scoping pattern point 4) when the
 * session's user has no membership yet — only `POST /api/orgs` and `GET /api/me` are
 * reachable without one (design.md §6).
 */

import { getMembershipByUserId } from '@telocc/core/repos/memberships';
import type { Db } from '@telocc/db';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../lib/context.ts';

export function requireOrg(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const userId = c.get('userId');
    if (!userId) {
      // Should not happen if requireSession ran first, but fail closed rather than throw.
      return c.json({ error: 'unauthorized' }, 401);
    }
    const membership = await getMembershipByUserId(db, userId);
    if (!membership) {
      return c.json({ error: 'no_org' }, 403);
    }
    c.set('orgId', membership.orgId);
    c.set('role', membership.role);
    return next();
  };
}

/** `requireRole(ctx, 'owner')` helper (design.md §6) — called on mutating routes. Only
 * `owner` exists today; adding roles later is a new enum value + this check, no
 * redesign (the roles seam). */
export function requireRole(role: 'owner'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.get('role') !== role) {
      return c.json({ error: 'forbidden' }, 403);
    }
    return next();
  };
}

/**
 * Org bootstrap + settings routes (design.md §6, §7). `POST /api/orgs` is the one
 * session-but-orgless route a brand new user must reach; `GET`/`PATCH /api/org` are
 * owner-only against the already-resolved org.
 */

import { zValidator } from '@hono/zod-validator';
import { createMembership, getMembershipByUserId } from '@telocc/core/repos/memberships';
import { createOrg, getOrgById, updateOrg } from '@telocc/core/repos/orgs';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Deps } from '../deps.ts';
import type { AppEnv } from '../lib/context.ts';
import { requireRole } from '../middleware/org.ts';
import { rateLimit } from '../middleware/rate-limit.ts';

/** Signed copy version for the business-capacity declaration (ER-B2B-1). Bump when the
 * declaration/waiver copy changes. */
export const DECLARATION_VERSION = 'v1';

const createOrgSchema = z.object({
  name: z.string().min(1).max(120),
  businessCapacityDeclared: z.literal(true),
  waiverAccepted: z.boolean().optional(),
});

const updateOrgSchema = z.object({
  name: z.string().min(1).max(120).optional(),
});

export function orgsRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.post(
    '/orgs',
    // design.md §7: 5/h per user.
    rateLimit({
      db: deps.db,
      now: deps.now,
      scope: 'org_create',
      windowSeconds: 60 * 60,
      limit: 5,
      identifier: (c) => c.get('userId') ?? null,
    }),
    zValidator('json', createOrgSchema),
    async (c) => {
      const userId = c.get('userId');
      if (!userId) return c.json({ error: 'unauthorized' }, 401);
      const body = c.req.valid('json');

      const existing = await getMembershipByUserId(deps.db, userId);
      if (existing) {
        return c.json({ error: 'org_already_exists' }, 409);
      }

      const isNbicsPosture = deps.env.COMPLIANCE_POSTURE === 'nbics_provider';
      if (isNbicsPosture && body.waiverAccepted !== true) {
        return c.json({ error: 'waiver_required' }, 400);
      }

      const now = deps.now();
      const org = await createOrg(deps.db, {
        name: body.name,
        businessCapacityDeclaredAt: now,
        declarationVersion: DECLARATION_VERSION,
        contractSummaryShownAt: isNbicsPosture ? now : null,
        waiverAcceptedAt: isNbicsPosture ? now : null,
      });
      await createMembership(deps.db, { orgId: org.id, userId, role: 'owner' });

      return c.json(org, 201);
    },
  );

  app.get('/org', requireRole('owner'), async (c) => {
    const orgId = c.get('orgId');
    if (!orgId) return c.json({ error: 'no_org' }, 403);
    const org = await getOrgById(deps.db, orgId);
    return c.json(org);
  });

  app.patch('/org', requireRole('owner'), zValidator('json', updateOrgSchema), async (c) => {
    const orgId = c.get('orgId');
    if (!orgId) return c.json({ error: 'no_org' }, 403);
    const body = c.req.valid('json');
    const org = await updateOrg(deps.db, orgId, body);
    return c.json(org);
  });

  return app;
}

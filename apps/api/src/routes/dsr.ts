/**
 * Data-subject-rights routes (ER-DSR-1..2, design.md §7, §10.2-10.3): `GET /api/export`,
 * `GET /api/export/calls.csv`, `POST /api/account/delete`. All three are owner-only and
 * org-scoped by construction — every read inside `@telocc/core/dsr` takes `orgId` first.
 */
import { zValidator } from '@hono/zod-validator';
import { buildAccountExport, callsToCsv, eraseAccount } from '@telocc/core/dsr';
import { getOrgById } from '@telocc/core/repos/orgs';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Deps } from '../deps.ts';
import type { AppEnv } from '../lib/context.ts';
import { requireRole } from '../middleware/org.ts';
import { rateLimit } from '../middleware/rate-limit.ts';

const deleteSchema = z.object({ confirmName: z.string().min(1) });

export function dsrRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  r.get(
    '/export',
    requireRole('owner'),
    // design.md §7: 5/h per org.
    rateLimit({
      db: deps.db,
      now: deps.now,
      scope: 'export_json',
      windowSeconds: 60 * 60,
      limit: 5,
      identifier: (c) => c.get('orgId') ?? null,
    }),
    async (c) => {
      const orgId = c.get('orgId');
      const userId = c.get('userId');
      if (!orgId || !userId) return c.json({ error: 'no_org' }, 403);
      const bundle = await buildAccountExport(deps.db, orgId, userId);
      return c.json(bundle);
    },
  );

  r.get(
    '/export/calls.csv',
    requireRole('owner'),
    // design.md §7: 5/h per org.
    rateLimit({
      db: deps.db,
      now: deps.now,
      scope: 'export_csv',
      windowSeconds: 60 * 60,
      limit: 5,
      identifier: (c) => c.get('orgId') ?? null,
    }),
    async (c) => {
      const orgId = c.get('orgId');
      const userId = c.get('userId');
      if (!orgId || !userId) return c.json({ error: 'no_org' }, 403);
      const bundle = await buildAccountExport(deps.db, orgId, userId);
      const csv = callsToCsv(bundle.calls);
      return c.body(csv, 200, { 'content-type': 'text/csv; charset=utf-8' });
    },
  );

  r.post(
    '/account/delete',
    requireRole('owner'),
    // design.md §7: 3/h per org (ER-DSR-2).
    rateLimit({
      db: deps.db,
      now: deps.now,
      scope: 'account_delete',
      windowSeconds: 60 * 60,
      limit: 3,
      identifier: (c) => c.get('orgId') ?? null,
    }),
    zValidator('json', deleteSchema),
    async (c) => {
      const orgId = c.get('orgId');
      const userId = c.get('userId');
      if (!orgId || !userId) return c.json({ error: 'no_org' }, 403);

      const org = await getOrgById(deps.db, orgId);
      if (!org) return c.json({ error: 'not_found' }, 404);

      const { confirmName } = c.req.valid('json');
      if (confirmName !== org.name) {
        return c.json({ error: 'name_mismatch' }, 400);
      }

      await eraseAccount(deps.db, deps.provider, orgId, userId, deps.now);
      return c.json({ ok: true });
    },
  );

  return r;
}

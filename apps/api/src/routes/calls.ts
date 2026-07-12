/**
 * Call-log routes (design.md §7, §5.3, ER-AUD-1): `GET /api/calls` (paginated,
 * filterable list) and `GET /api/calls/:id` (single row, org-scoped — decisions.md
 * #37). Deliberately no `PUT`/`DELETE` handler on either path: the log is append-only
 * by construction (design.md §3.2 "no UPDATE path exists in application code"), so an
 * attempted mutation falls straight through to Hono's default 404 for the unmatched
 * method — nothing to implement, nothing to guard.
 */
import { type CallRow, getCallById, listCallsForOrg } from '@telocc/core/repos/calls';
import { Hono } from 'hono';
import type { Deps } from '../deps.ts';
import type { AppEnv } from '../lib/context.ts';
import { requireRole } from '../middleware/org.ts';

function serializeCall(row: CallRow) {
  return {
    id: row.id,
    direction: row.direction,
    status: row.status,
    reason: row.reason,
    fromE164: row.fromE164,
    toE164: row.toE164,
    initiatingUserId: row.initiatingUserId,
    startedAt: row.startedAt,
    answeredAt: row.answeredAt,
    endedAt: row.endedAt,
    durationSeconds: row.durationSeconds,
    providerCallRef: row.providerCallRef,
    providerErrorCode: row.providerErrorCode,
  };
}

export function callsRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  r.get('/calls', requireRole('owner'), async (c) => {
    const orgId = c.get('orgId');
    if (!orgId) return c.json({ error: 'no_org' }, 403);

    const directionQuery = c.req.query('direction');
    const direction =
      directionQuery === 'inbound' || directionQuery === 'outbound' ? directionQuery : undefined;
    const fromQuery = c.req.query('from');
    const toQuery = c.req.query('to');
    const cursor = c.req.query('cursor');

    const result = await listCallsForOrg(deps.db, orgId, {
      direction,
      from: fromQuery ? new Date(fromQuery) : undefined,
      to: toQuery ? new Date(toQuery) : undefined,
      cursor: cursor || undefined,
    });

    return c.json({
      items: result.items.map(serializeCall),
      nextCursor: result.nextCursor,
    });
  });

  r.get('/calls/:id', requireRole('owner'), async (c) => {
    const orgId = c.get('orgId');
    if (!orgId) return c.json({ error: 'no_org' }, 403);

    const call = await getCallById(deps.db, orgId, c.req.param('id'));
    if (!call) return c.json({ error: 'not_found' }, 404);
    return c.json(serializeCall(call));
  });

  return r;
}

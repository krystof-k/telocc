/**
 * Office-hours settings routes (design.md §7, §8): `GET`/`PUT /api/office-hours`. Zod
 * validates shape (mode enum, `HH:MM` rule times, ≤7 rules); `validateOfficeHoursInput`
 * (core/office-hours.ts) validates the cross-field business rules zod can't express
 * (unique weekday, `opensAt < closesAt`, well-formed IANA timezone) before anything
 * reaches the database.
 */
import { zValidator } from '@hono/zod-validator';
import {
  getOfficeHoursForOrg,
  setOfficeHoursForOrg,
  validateOfficeHoursInput,
} from '@telocc/core/office-hours';
import { writeAuditEvent } from '@telocc/core/repos/audit';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Deps } from '../deps.ts';
import type { AppEnv } from '../lib/context.ts';
import { requireRole } from '../middleware/org.ts';

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const putSchema = z.object({
  mode: z.enum(['schedule', 'always_open', 'always_closed']),
  timezone: z.string().min(1).max(64),
  rules: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        opensAt: z.string().regex(HHMM_PATTERN, 'must be HH:MM'),
        closesAt: z.string().regex(HHMM_PATTERN, 'must be HH:MM'),
      }),
    )
    .max(7),
});

export function officeHoursRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  r.get('/office-hours', requireRole('owner'), async (c) => {
    const orgId = c.get('orgId');
    if (!orgId) return c.json({ error: 'no_org' }, 403);

    const settings = await getOfficeHoursForOrg(deps.db, orgId);
    if (!settings) return c.json({ error: 'not_found' }, 404);
    return c.json(settings);
  });

  r.put('/office-hours', requireRole('owner'), zValidator('json', putSchema), async (c) => {
    const orgId = c.get('orgId');
    if (!orgId) return c.json({ error: 'no_org' }, 403);
    const body = c.req.valid('json');

    const validation = validateOfficeHoursInput(body);
    if (!validation.ok) {
      return c.json({ error: validation.error ?? 'invalid_office_hours' }, 400);
    }

    await setOfficeHoursForOrg(deps.db, orgId, body);
    await writeAuditEvent(deps.db, {
      orgId,
      actorUserId: c.get('userId') ?? null,
      type: 'settings_changed',
      meta: { setting: 'office_hours', mode: body.mode },
    });

    const settings = await getOfficeHoursForOrg(deps.db, orgId);
    return c.json(settings);
  });

  return r;
}

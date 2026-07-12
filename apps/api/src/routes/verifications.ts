/**
 * SMS-PIN verification routes (design.md §6 "Verify personal number", §7, §9.3).
 * `POST /api/verifications` issues a fresh challenge and sends the PIN through the
 * telephony seam (`deps.provider.sendSms`, never any other path); `POST
 * /api/verifications/:id/confirm` checks it. Confirming stamps the membership's
 * verified personal number + `emergency_ack_at` (ER-EMG-3) — changing the personal
 * number later is the same issue/confirm cycle run again against a new number, so
 * routing stays on the old number until the new one is confirmed (design brief).
 */

import { zValidator } from '@hono/zod-validator';
import { writeAuditEvent } from '@telocc/core/repos/audit';
import { confirmPhoneVerification, issuePhoneVerification } from '@telocc/core/verification';
import { t } from '@telocc/i18n';
import { parseE164 } from '@telocc/telephony';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Deps } from '../deps.ts';
import type { AppEnv } from '../lib/context.ts';
import { requireRole } from '../middleware/org.ts';
import { clientIp, rateLimit } from '../middleware/rate-limit.ts';

const E164_PATTERN = /^\+[1-9][0-9]{1,14}$/;

const issueSchema = z.object({
  phoneE164: z.string().regex(E164_PATTERN, 'invalid E.164 phone number'),
});

const confirmSchema = z.object({
  pin: z.string().regex(/^\d{6}$/, 'PIN must be 6 digits'),
});

/** Composes the SMS body around the PIN through i18n (design.md §11: all user-facing
 * copy — including API-side SMS text — goes through it). */
function renderSmsBody(pin: string): string {
  return `${t('verification.smsCodeIntro')} ${pin}. ${t('verification.smsExpiryNotice')}`;
}

/** Reads `phoneE164` from the JSON body via a clone (mirrors routes/auth.ts's
 * `requestEmail`) so the rate-limit identifier callbacks can inspect it without
 * consuming the stream the later `zValidator` needs to read for real. */
async function requestPhoneE164(c: Context<AppEnv>): Promise<string | null> {
  const body = await c.req.raw
    .clone()
    .json()
    .catch(() => null);
  const phone =
    body && typeof body === 'object' ? (body as { phoneE164?: unknown }).phoneE164 : null;
  return typeof phone === 'string' && phone.length > 0 ? phone : null;
}

export function verificationsRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  r.post(
    '/',
    requireRole('owner'),
    // design.md §7: 1/60s per phone (resend cooldown, decisions.md #32), then 3/10min
    // + 5/day per phone, 10/day per org, 10/h per IP (ER-RATE-1, ER-SEC-3).
    rateLimit({
      db: deps.db,
      now: deps.now,
      scope: 'verification_resend_cooldown',
      windowSeconds: 60,
      limit: 1,
      identifier: (c) => requestPhoneE164(c),
    }),
    rateLimit({
      db: deps.db,
      now: deps.now,
      scope: 'verification_phone_10min',
      windowSeconds: 10 * 60,
      limit: 3,
      identifier: (c) => requestPhoneE164(c),
    }),
    rateLimit({
      db: deps.db,
      now: deps.now,
      scope: 'verification_phone_daily',
      windowSeconds: 24 * 60 * 60,
      limit: 5,
      identifier: (c) => requestPhoneE164(c),
    }),
    rateLimit({
      db: deps.db,
      now: deps.now,
      scope: 'verification_org_daily',
      windowSeconds: 24 * 60 * 60,
      limit: 10,
      identifier: (c) => c.get('orgId') ?? null,
    }),
    rateLimit({
      db: deps.db,
      now: deps.now,
      scope: 'verification_ip',
      windowSeconds: 60 * 60,
      limit: 10,
      identifier: (c) => clientIp(c),
    }),
    zValidator('json', issueSchema),
    async (c) => {
      const orgId = c.get('orgId');
      const userId = c.get('userId');
      if (!orgId || !userId) return c.json({ error: 'unauthorized' }, 401);

      const body = c.req.valid('json');
      const phoneE164 = parseE164(body.phoneE164);
      if (!phoneE164) return c.json({ error: 'invalid_phone' }, 400);

      const result = await issuePhoneVerification(
        {
          db: deps.db,
          now: deps.now,
          pepper: deps.env.PIN_PEPPER,
          sendSms: deps.provider.sendSms,
          renderSmsBody,
        },
        { orgId, userId, phoneE164 },
      );

      await writeAuditEvent(deps.db, {
        orgId,
        actorUserId: userId,
        type: 'pin_issued',
        meta: { phoneLast4: phoneE164.slice(-4) },
      });

      return c.json({ id: result.id, expiresAt: result.expiresAt.toISOString() }, 201);
    },
  );

  r.post(
    '/:id/confirm',
    requireRole('owner'),
    // design.md §7: 20/h per IP (the 5-attempts-per-challenge cap lives in
    // core/verification.ts against the row itself, not a rate-limit counter).
    rateLimit({
      db: deps.db,
      now: deps.now,
      scope: 'verification_confirm_ip',
      windowSeconds: 60 * 60,
      limit: 20,
      identifier: (c) => clientIp(c),
    }),
    zValidator('json', confirmSchema),
    async (c) => {
      const orgId = c.get('orgId');
      const userId = c.get('userId');
      if (!orgId || !userId) return c.json({ error: 'unauthorized' }, 401);

      const challengeId = c.req.param('id');
      const body = c.req.valid('json');

      const outcome = await confirmPhoneVerification(
        { db: deps.db, now: deps.now, pepper: deps.env.PIN_PEPPER },
        { orgId, challengeId, pin: body.pin },
      );

      if (outcome.ok) {
        await writeAuditEvent(deps.db, {
          orgId,
          actorUserId: userId,
          type: 'pin_verified',
          meta: {},
        });
        return c.json({ verified: true }, 200);
      }

      if (outcome.reason === 'invalid_pin' || outcome.reason === 'attempts_exceeded') {
        await writeAuditEvent(deps.db, {
          orgId,
          actorUserId: userId,
          type: 'pin_attempt_failed',
          meta: {},
        });
      }

      return c.json({ error: outcome.reason }, 400);
    },
  );

  return r;
}

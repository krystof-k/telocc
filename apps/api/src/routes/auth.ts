/**
 * Magic-link auth routes (design.md §6, §7, §9.4). Wraps Better Auth's `magic-link`
 * plugin endpoints with our own Postgres fixed-window rate limiting (§9.1) and a
 * fake-clock-respecting TTL pre-check (see lib/auth.ts's header comment for why).
 * Everything else Better Auth needs (session lookup, sign-out, …) falls through to
 * `auth.handler` unchanged.
 */
import { writeAuditEvent } from '@telocc/core/repos/audit';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { Deps } from '../deps.ts';
import type { BetterAuthInstance } from '../lib/auth.ts';
import { invalidatePreviousMagicLinkTokens, isMagicLinkTokenExpired } from '../lib/auth.ts';
import type { AppEnv } from '../lib/context.ts';
import { clientIp, rateLimit } from '../middleware/rate-limit.ts';

/** Reads the request body once (via `.clone()`, before anything else touches the
 * stream) and caches it on the Hono context so both the rate-limit identifier and the
 * route handler can read `email` without double-consuming `c.req.raw`. */
async function requestEmail(c: Context<AppEnv>) {
  const cached = c.get('bodyEmail');
  if (cached !== undefined) return cached;
  const body = await c.req.raw
    .clone()
    .json()
    .catch(() => null);
  const email = body && typeof body === 'object' ? (body as { email?: unknown }).email : null;
  const normalized = typeof email === 'string' && email.length > 0 ? email.toLowerCase() : null;
  c.set('bodyEmail', normalized);
  return normalized;
}

export function authRoutes(deps: Deps, auth: BetterAuthInstance) {
  const app = new Hono<AppEnv>();

  app.post(
    '/sign-in/magic-link',
    // design.md §7: 3/15 min per email, 10/h per IP.
    rateLimit({
      db: deps.db,
      now: deps.now,
      scope: 'magic_link_email',
      windowSeconds: 15 * 60,
      limit: 3,
      identifier: (c) => requestEmail(c),
    }),
    rateLimit({
      db: deps.db,
      now: deps.now,
      scope: 'magic_link_ip',
      windowSeconds: 60 * 60,
      limit: 10,
      identifier: (c) => clientIp(c),
    }),
    async (c) => {
      const email = await requestEmail(c);
      // design.md §6/§9.4: a new magic link invalidates the previous unused one.
      if (email) await invalidatePreviousMagicLinkTokens(deps, email);
      const res = await auth.handler(c.req.raw);
      if (res.status < 300) {
        await writeAuditEvent(deps.db, {
          type: 'magic_link_issued',
          meta: email ? { emailDomain: email.split('@')[1] } : {},
        });
      }
      return res;
    },
  );

  app.get(
    '/magic-link/verify',
    // design.md §7: 30/h per IP.
    rateLimit({
      db: deps.db,
      now: deps.now,
      scope: 'magic_link_verify_ip',
      windowSeconds: 60 * 60,
      limit: 30,
      identifier: (c) => clientIp(c),
    }),
    async (c) => {
      const token = c.req.query('token');
      if (token && (await isMagicLinkTokenExpired(deps, token))) {
        return c.json({ error: 'invalid_or_expired_token' }, 400);
      }
      const res = await auth.handler(c.req.raw);
      // We never pass callbackURL, so Better Auth's magic-link verify endpoint only
      // redirects (3xx) on failure (invalid/consumed token, sign-up disabled, …) —
      // success returns JSON directly. Callers here are API/fetch consumers, not a
      // browser following a Location header, so failures are surfaced as a generic
      // 400 JSON error rather than a redirect.
      if (res.status >= 300 && res.status < 400) {
        return c.json({ error: 'invalid_or_expired_token' }, 400);
      }
      if (res.status < 300) {
        const cloned = res.clone();
        const body = await cloned.json().catch(() => null);
        const userId =
          body && typeof body === 'object' ? (body as { user?: { id?: string } }).user?.id : null;
        await writeAuditEvent(deps.db, {
          actorUserId: typeof userId === 'string' ? userId : null,
          type: 'magic_link_used',
        });
      }
      return res;
    },
  );

  // Everything else Better Auth needs under /api/auth/* (session introspection,
  // sign-out, …) — unwrapped, no rate limiting beyond what's above.
  app.all('*', (c) => auth.handler(c.req.raw));

  return app;
}

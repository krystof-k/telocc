/**
 * Better Auth wiring (design.md §6, §9.4, decisions.md #31). Magic-link plugin,
 * hashed tokens, session cookie config, IP/UA tracking off.
 *
 * Clock note: Better Auth computes token expiry from the *real* system clock
 * internally (`new Date(Date.now() + expiresIn*1000)` — it has no injectable `now`),
 * but the contract-test harness drives TTL behaviour through a fake clock (`deps.now`,
 * tests/helpers/clock.ts) so tests never sleep 15 real minutes. Comparing Better
 * Auth's own `expiresAt` column against `deps.now()` would be meaningless (one's real
 * time, one's fake). Instead, `sendMagicLink` below stamps the verification row's
 * `value` JSON with our own `issuedAt` (per `deps.now()`) right after Better Auth
 * creates it; `isMagicLinkTokenExpired`/`invalidatePreviousMagicLinkTokens` work off
 * that stamp instead of the column. In production `deps.now` is the real clock, so
 * this is simply a second, consistent way of tracking the same thing.
 *
 * Reissue note: this Better Auth version's magic-link plugin does not invalidate a
 * previous unused token when a new one is issued for the same email (design.md §6/§9.4
 * require it) — `invalidatePreviousMagicLinkTokens` does that ourselves before Better
 * Auth creates the new row.
 */
import { createHash } from 'node:crypto';
import { verification as verificationTable } from '@telocc/db';
import { t } from '@telocc/i18n';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins/magic-link';
import { eq } from 'drizzle-orm';
import type { Deps } from '../deps.ts';

export const MAGIC_LINK_TTL_SECONDS = 15 * 60;
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Deliberately plain SHA-256 (not HMAC) — the token itself is already a CSPRNG
 * secret; hashing here is purely so the raw value never sits in the database
 * (ER-SEC-2), not a second authentication factor. */
export function hashMagicLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface VerificationValue {
  email?: string;
  name?: string;
  issuedAt?: string;
}

function parseVerificationValue(raw: string): VerificationValue {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as VerificationValue) : {};
  } catch {
    return {};
  }
}

/** Stamps the just-created verification row for `token` with `issuedAt: deps.now()`. */
async function stampIssuedAt(deps: Deps, token: string): Promise<void> {
  const hashed = hashMagicLinkToken(token);
  const rows = await deps.db
    .select({ value: verificationTable.value })
    .from(verificationTable)
    .where(eq(verificationTable.identifier, hashed));
  const row = rows[0];
  if (!row) return;
  const value = parseVerificationValue(row.value);
  value.issuedAt = deps.now().toISOString();
  await deps.db
    .update(verificationTable)
    .set({ value: JSON.stringify(value) })
    .where(eq(verificationTable.identifier, hashed));
}

/** Deletes any not-yet-consumed magic-link verification rows previously issued for
 * `email` (design.md §6/§9.4: "invalidated on use and on new issuance"). */
export async function invalidatePreviousMagicLinkTokens(deps: Deps, email: string): Promise<void> {
  const rows = await deps.db
    .select({ id: verificationTable.id, value: verificationTable.value })
    .from(verificationTable);
  const staleIds = rows
    .filter((r) => parseVerificationValue(r.value).email === email)
    .map((r) => r.id);
  for (const id of staleIds) {
    await deps.db.delete(verificationTable).where(eq(verificationTable.id, id));
  }
}

export function buildBetterAuth(deps: Deps) {
  return betterAuth({
    baseURL: deps.env.APP_BASE_URL,
    basePath: '/api/auth',
    secret: deps.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(deps.db, {
      provider: 'pg',
      // neon-http has no multi-statement transactions (decisions.md #7/#28).
      transaction: false,
    }),
    session: {
      expiresIn: SESSION_TTL_SECONDS,
    },
    advanced: {
      cookiePrefix: 'telocc',
      // Not `useSecureCookies: true` — that option also prepends a `__Secure-` name
      // prefix (per Better Auth's cookie-name convention), which would break the
      // exact `telocc.session_token` cookie name pinned by the contract tests. The
      // `Secure` attribute is instead forced directly below, so the outcome decisions.md
      // #31 describes (Secure present unconditionally, identical across environments)
      // still holds — just not via that literal flag.
      cookies: {
        session_token: {
          attributes: { secure: true, httpOnly: true, sameSite: 'lax' },
        },
      },
      ipAddress: {
        // ER-SEC-4: IP/UA tracking disabled (design.md §3.1/§6).
        disableIpTracking: true,
      },
    },
    // Our own Postgres fixed-window limiter wraps these routes (middleware/rate-limit.ts,
    // design.md §9.1) — Better Auth's built-in limiter would double up.
    rateLimit: { enabled: false },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SECONDS,
        disableSignUp: false,
        storeToken: {
          type: 'custom-hasher',
          hash: async (token: string) => hashMagicLinkToken(token),
        },
        sendMagicLink: async ({ email, url, token }) => {
          await deps.email.send({
            to: email,
            subject: t('auth.magicLinkEmailSubject'),
            text: `${t('auth.magicLinkEmailIntro')}\n\n${url}`,
          });
          await stampIssuedAt(deps, token);
        },
      }),
    ],
  });
}

export type BetterAuthInstance = ReturnType<typeof buildBetterAuth>;

/**
 * True when the magic-link `token` names a `verification` row stamped with an
 * `issuedAt` (per `deps.now()`) at least `MAGIC_LINK_TTL_SECONDS` in the past. False
 * (never expired per our check) if no matching row or stamp exists — an
 * invalid/unknown token is left for Better Auth's own handler to reject with its
 * normal "invalid token" response, keeping error shapes consistent.
 */
export async function isMagicLinkTokenExpired(deps: Deps, token: string): Promise<boolean> {
  const hashed = hashMagicLinkToken(token);
  const rows = await deps.db
    .select({ value: verificationTable.value })
    .from(verificationTable)
    .where(eq(verificationTable.identifier, hashed));
  const row = rows[0];
  if (!row) return false;
  const { issuedAt } = parseVerificationValue(row.value);
  if (!issuedAt) return false;
  const ageSeconds = (deps.now().getTime() - new Date(issuedAt).getTime()) / 1000;
  return ageSeconds >= MAGIC_LINK_TTL_SECONDS;
}

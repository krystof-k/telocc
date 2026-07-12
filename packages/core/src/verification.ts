/**
 * SMS-PIN issue/confirm: hashing, attempt caps, TTL, cooldowns/caps (design.md §9.3,
 * ER-SEC-3, ER-RET-3). Provider-free domain logic — SMS delivery happens only through
 * the injected `sendSms` (the telephony seam, design.md §4); this module never imports
 * a concrete provider.
 *
 * decisions.md #15: PIN is 6 digits, `HMAC-SHA256(PIN_PEPPER, pin ‖ challengeId)` hex.
 * decisions.md #32: the 60s resend cooldown is its own fixed-window rate-limit counter
 * (implemented at the route layer, apps/api/src/routes/verifications.ts) — this module
 * owns only the challenge row's own lifecycle (TTL + attempt cap), per design.md §9.3's
 * "no multi-statement DB transactions" rule: attempt counting is a single atomic
 * `UPDATE ... RETURNING`.
 */
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Db } from '@telocc/db';
import { memberships, phoneVerifications } from '@telocc/db';
import type { E164 } from '@telocc/telephony';
import { and, eq, sql } from 'drizzle-orm';

/** design.md §9.3: TTL 10 min, hard cap 5 attempts. */
export const PIN_TTL_MINUTES = 10;
export const PIN_MAX_ATTEMPTS = 5;
const PIN_DIGITS = 6;

/** CSPRNG 6-digit PIN, zero-padded (decisions.md #15). */
export function generatePin(): string {
  return String(randomInt(0, 10 ** PIN_DIGITS)).padStart(PIN_DIGITS, '0');
}

/** `HMAC-SHA256(PIN_PEPPER, pin ‖ challengeId)` hex — never the PIN itself
 * (design.md §3 phone_verifications.pin_hash). */
export function hashPin(pin: string, challengeId: string, pepper: string): string {
  return createHmac('sha256', pepper).update(`${pin}:${challengeId}`).digest('hex');
}

/** Timing-safe compare of a candidate PIN against a stored hash (design.md §9.3). */
export function verifyPinHash(
  pin: string,
  challengeId: string,
  pepper: string,
  expectedHash: string,
): boolean {
  const candidate = Buffer.from(hashPin(pin, challengeId, pepper), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export interface BaseVerificationDeps {
  db: Db;
  now: () => Date;
  /** `env.PIN_PEPPER` — never logged, never stored. */
  pepper: string;
}

export interface IssueVerificationDeps extends BaseVerificationDeps {
  /** The telephony seam's SMS delivery (design.md §4) — the only way this module ever
   * sends anything. */
  sendSms: (msg: { to: E164; body: string }) => Promise<{ messageRef: string }>;
  /** Composes the SMS body text around the PIN. Injected so this module never depends
   * on `@telocc/i18n` directly — the caller (apps/api) owns copy (design.md §11 "all
   * user-facing copy ... goes through it"). */
  renderSmsBody: (pin: string) => string;
}

export interface IssueVerificationInput {
  orgId: string;
  userId: string;
  phoneE164: E164;
}

export interface IssueVerificationResult {
  id: string;
  expiresAt: Date;
}

/** Issues a fresh SMS-PIN challenge: generates + hashes the PIN, inserts the challenge
 * row, and sends it through the seam. Caller (the route) is responsible for the
 * per-phone/per-org/per-IP rate limiting (design.md §7) — this function always issues
 * when called. */
export async function issuePhoneVerification(
  deps: IssueVerificationDeps,
  input: IssueVerificationInput,
): Promise<IssueVerificationResult> {
  const id = randomUUID();
  const pin = generatePin();
  const now = deps.now();
  const expiresAt = new Date(now.getTime() + PIN_TTL_MINUTES * 60_000);
  const pinHash = hashPin(pin, id, deps.pepper);

  await deps.db.insert(phoneVerifications).values({
    id,
    orgId: input.orgId,
    userId: input.userId,
    phoneE164: input.phoneE164,
    pinHash,
    expiresAt,
  });

  await deps.sendSms({ to: input.phoneE164, body: deps.renderSmsBody(pin) });

  return { id, expiresAt };
}

export type ConfirmVerificationFailureReason =
  | 'not_found'
  | 'expired'
  | 'invalid_pin'
  | 'attempts_exceeded';

export type ConfirmVerificationOutcome =
  | { ok: true }
  | { ok: false; reason: ConfirmVerificationFailureReason };

export interface ConfirmVerificationInput {
  orgId: string;
  challengeId: string;
  pin: string;
}

/** Confirms a PIN. On success: deletes the challenge row and stamps the membership's
 * verified personal number + `emergency_ack_at` (ER-EMG-3) — this is also how changing
 * the personal number re-verifies (the same challenge/confirm cycle against a new
 * number simply overwrites the previous one once confirmed). On failure: atomically
 * increments the attempt counter (single `UPDATE ... RETURNING`, design.md §1's
 * no-multi-statement-transaction rule) and deletes the row outright once the 5th
 * attempt is spent (design.md §9.3, rows are deleted, never merely flagged). */
export async function confirmPhoneVerification(
  deps: BaseVerificationDeps,
  input: ConfirmVerificationInput,
): Promise<ConfirmVerificationOutcome> {
  const rows = await deps.db
    .select()
    .from(phoneVerifications)
    .where(
      and(eq(phoneVerifications.id, input.challengeId), eq(phoneVerifications.orgId, input.orgId)),
    );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'not_found' };

  const now = deps.now();
  if (row.expiresAt.getTime() < now.getTime()) {
    await deps.db.delete(phoneVerifications).where(eq(phoneVerifications.id, row.id));
    return { ok: false, reason: 'expired' };
  }

  if (verifyPinHash(input.pin, row.id, deps.pepper, row.pinHash)) {
    await deps.db.delete(phoneVerifications).where(eq(phoneVerifications.id, row.id));
    await deps.db
      .update(memberships)
      .set({
        personalNumberE164: row.phoneE164,
        personalNumberVerifiedAt: now,
        emergencyAckAt: now,
      })
      .where(eq(memberships.userId, row.userId));
    return { ok: true };
  }

  const [updated] = await deps.db
    .update(phoneVerifications)
    .set({ attempts: sql`${phoneVerifications.attempts} + 1` })
    .where(eq(phoneVerifications.id, row.id))
    .returning();
  const attempts = updated?.attempts ?? row.attempts + 1;

  if (attempts >= PIN_MAX_ATTEMPTS) {
    await deps.db.delete(phoneVerifications).where(eq(phoneVerifications.id, row.id));
    return { ok: false, reason: 'attempts_exceeded' };
  }
  return { ok: false, reason: 'invalid_pin' };
}

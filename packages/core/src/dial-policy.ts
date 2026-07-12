/**
 * DTMF normalisation + emergency/premium dial policy (ER-EMG-1/2, design.md §5.2).
 * Pure, I/O-free — the webhook route/`routing/dialin.ts` supply the seeded deny-prefix
 * rows and the org's own numbers; this module only classifies.
 *
 * Emergency short codes are hard-coded here, never data-driven (decisions.md #11) —
 * a safety property, not configuration.
 */
import { type E164, parseE164 } from '@telocc/telephony';

/** ER-EMG-1: hard-coded, never sourced from the seeded `dial_policy_prefixes` table. */
export const EMERGENCY_SHORT_CODES: readonly string[] = ['112', '150', '155', '156', '158'];

export interface DialPolicyDenyPrefix {
  prefix: string; // e.g. '+42090' (design.md §3.2 `dial_policy_prefixes`)
}

export type DialPolicyClassification =
  | { kind: 'emergency' }
  | { kind: 'short_code' }
  | { kind: 'international' }
  | { kind: 'premium' }
  | { kind: 'invalid_target' }
  | { kind: 'valid'; target: E164 };

function stripFinishKey(raw: string): string {
  // The DTMF finish key ('#') sometimes rides along in the reported digit string
  // (design.md §5.2 "emergency numbers with terminator variations (112#)").
  return raw.endsWith('#') ? raw.slice(0, -1) : raw;
}

const BARE_INTERNATIONAL_CZ_PATTERN = /^420\d{9}$/; // bare '420…' (no leading 00/+)
const BARE_NATIONAL_PATTERN = /^[2-9]\d{8}$/; // 9 digits starting 2-9 (CZ national form)
const SHORT_CODE_PATTERN = /^\d{3,6}$/;
const CZ_E164_PATTERN = /^\+420\d{9}$/;

/**
 * design.md §5.2 normalisation: strip '#'; '00' prefix → international form; bare
 * '420…' → '+420…'; bare 9-digit national (starting 2-9) → '+420…' national. Anything
 * else (short codes, garbage) is returned unchanged for `classifyDialedDigits` to sort
 * into its own bucket.
 */
export function normalizeDialedDigits(raw: string): string {
  const stripped = stripFinishKey(raw);
  if (stripped.startsWith('00')) {
    return `+${stripped.slice(2)}`;
  }
  if (BARE_INTERNATIONAL_CZ_PATTERN.test(stripped)) {
    return `+${stripped}`;
  }
  if (BARE_NATIONAL_PATTERN.test(stripped)) {
    return `+420${stripped}`;
  }
  return stripped;
}

/**
 * The full DTMF-validate decision (design.md §5.2 steps a-g), in order:
 * emergency hard-deny → short code → non-CZ international (OFF) → seeded premium/
 * shared-cost prefix → self/own-number target → not-a-valid-CZ-E.164 → valid.
 */
export function classifyDialedDigits(params: {
  digitsRaw: string;
  businessNumberE164: string;
  personalNumberE164: string;
  denyPrefixes: readonly DialPolicyDenyPrefix[];
}): DialPolicyClassification {
  const normalized = normalizeDialedDigits(params.digitsRaw);

  if (EMERGENCY_SHORT_CODES.includes(normalized)) {
    return { kind: 'emergency' };
  }
  if (SHORT_CODE_PATTERN.test(normalized)) {
    return { kind: 'short_code' };
  }
  if (normalized.startsWith('+') && !normalized.startsWith('+420')) {
    return { kind: 'international' };
  }
  if (
    normalized.startsWith('+420') &&
    params.denyPrefixes.some((p) => normalized.startsWith(p.prefix))
  ) {
    return { kind: 'premium' };
  }
  if (normalized === params.businessNumberE164 || normalized === params.personalNumberE164) {
    return { kind: 'invalid_target' };
  }
  if (!CZ_E164_PATTERN.test(normalized)) {
    return { kind: 'invalid_target' };
  }
  const target = parseE164(normalized);
  if (!target) {
    return { kind: 'invalid_target' };
  }
  return { kind: 'valid', target };
}

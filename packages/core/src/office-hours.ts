/**
 * Office hours model (design.md §8, decisions.md #10): `isOpen(mode, rules, now, tz)` is
 * a pure function — zero dependencies, DST-correct by construction via
 * `Intl.DateTimeFormat.formatToParts` (full tz data on Workers and Node 22). The rest of
 * this file is the DB-backed half: reading/writing an org's `orgs.office_hours_mode`/
 * `timezone` + `office_hour_rules` rows for the `/api/office-hours` route, and the
 * business-rule validation (≤7 rules, unique weekday, `opensAt < closesAt`, well-formed
 * IANA timezone) that lets the route return 400 before ever touching the database
 * (its `office_hour_rules` CHECK/UNIQUE constraints would otherwise surface as a raw
 * DB error, not a clean 400).
 */
import type { Db } from '@telocc/db';
import { officeHourRules, orgs } from '@telocc/db';
import { eq } from 'drizzle-orm';

export type OfficeHoursMode = 'schedule' | 'always_open' | 'always_closed';

export interface OfficeHourRule {
  weekday: number; // 0 (Mon) – 6 (Sun)
  opensAt: string; // 'HH:MM' (or 'HH:MM:SS' as read back from Postgres `time`)
  closesAt: string;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

function minutesOf(hhmmss: string): number {
  const [h, m] = hhmmss.split(':');
  return Number(h ?? 0) * 60 + Number(m ?? 0);
}

/**
 * `isOpen(mode, rules, now, tz)` (design.md §8) — converts `now` to the org-local
 * weekday + minutes via `Intl.DateTimeFormat`, then checks the matching rule (absent
 * row for that weekday = closed all day). `always_open`/`always_closed` short-circuit
 * without consulting `rules`/`tz` at all.
 */
export function isOpen(
  mode: OfficeHoursMode,
  rules: readonly OfficeHourRule[],
  now: Date,
  timezone: string,
): boolean {
  if (mode === 'always_open') return true;
  if (mode === 'always_closed') return false;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const weekdayShort = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const weekday = WEEKDAY_INDEX[weekdayShort];
  if (weekday === undefined) return false;

  const rule = rules.find((r) => r.weekday === weekday);
  if (!rule) return false;
  const minutesNow = hour * 60 + minute;
  return minutesNow >= minutesOf(rule.opensAt) && minutesNow < minutesOf(rule.closesAt);
}

/** True iff `Intl` can resolve `tz` as a timezone — the cheapest available well-formed
 * IANA-name check with zero dependencies (an unresolvable zone throws `RangeError`). */
export function isValidIanaTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface OfficeHoursRuleInput {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

export interface OfficeHoursSettingsInput {
  mode: OfficeHoursMode;
  timezone: string;
  rules: OfficeHoursRuleInput[];
}

export interface OfficeHoursValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Business-rule validation for `PUT /api/office-hours` (design.md §7): well-formed IANA
 * `timezone`, ≤7 `rules`, unique `weekday` per rule, `opensAt < closesAt`. Zod handles
 * shape (types, `HH:MM` pattern, array length); this catches the cross-field rules the
 * `office_hour_rules` table itself only enforces via CHECK/UNIQUE constraints — running
 * it before any DB write turns what would otherwise be a raw constraint-violation error
 * into a clean `400`.
 */
export function validateOfficeHoursInput(
  input: OfficeHoursSettingsInput,
): OfficeHoursValidationResult {
  if (!isValidIanaTimeZone(input.timezone)) {
    return { ok: false, error: 'invalid_timezone' };
  }
  if (input.rules.length > 7) {
    return { ok: false, error: 'too_many_rules' };
  }
  const seenWeekdays = new Set<number>();
  for (const rule of input.rules) {
    if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6) {
      return { ok: false, error: 'invalid_weekday' };
    }
    if (seenWeekdays.has(rule.weekday)) {
      return { ok: false, error: 'duplicate_weekday' };
    }
    seenWeekdays.add(rule.weekday);
    if (!HHMM_PATTERN.test(rule.opensAt) || !HHMM_PATTERN.test(rule.closesAt)) {
      return { ok: false, error: 'invalid_time_format' };
    }
    if (rule.opensAt >= rule.closesAt) {
      return { ok: false, error: 'opens_not_before_closes' };
    }
  }
  return { ok: true };
}

export interface OfficeHoursSettings {
  mode: OfficeHoursMode;
  timezone: string;
  rules: OfficeHoursRuleInput[];
}

/** Reads an org's office-hours configuration: `mode`/`timezone` from `orgs`, `rules`
 * from `office_hour_rules` (sorted by weekday for a stable response shape). */
export async function getOfficeHoursForOrg(
  db: Db,
  orgId: string,
): Promise<OfficeHoursSettings | null> {
  const orgRows = await db.select().from(orgs).where(eq(orgs.id, orgId));
  const org = orgRows[0];
  if (!org) return null;

  const ruleRows = await db.select().from(officeHourRules).where(eq(officeHourRules.orgId, orgId));
  return {
    mode: org.officeHoursMode,
    timezone: org.timezone,
    rules: ruleRows
      .map((r) => ({
        weekday: r.weekday,
        opensAt: r.opensAt.slice(0, 5),
        closesAt: r.closesAt.slice(0, 5),
      }))
      .sort((a, b) => a.weekday - b.weekday),
  };
}

/**
 * Replaces an org's office-hours configuration: updates `orgs.office_hours_mode`/
 * `timezone`, then deletes and re-inserts all `office_hour_rules` rows. Caller must run
 * `validateOfficeHoursInput` first — this function assumes already-valid input (no
 * multi-statement transactions on the neon-http driver, decisions.md #7; this route is
 * owner-only and not concurrently contended, so sequential statements are safe here).
 */
export async function setOfficeHoursForOrg(
  db: Db,
  orgId: string,
  input: OfficeHoursSettingsInput,
): Promise<void> {
  await db
    .update(orgs)
    .set({ officeHoursMode: input.mode, timezone: input.timezone })
    .where(eq(orgs.id, orgId));

  await db.delete(officeHourRules).where(eq(officeHourRules.orgId, orgId));

  if (input.rules.length > 0) {
    await db.insert(officeHourRules).values(
      input.rules.map((r) => ({
        orgId,
        weekday: r.weekday,
        opensAt: r.opensAt,
        closesAt: r.closesAt,
      })),
    );
  }
}

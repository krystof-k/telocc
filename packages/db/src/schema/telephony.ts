import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import {
  businessNumberStatusEnum,
  callDirectionEnum,
  callSessionKindEnum,
  callSessionStateEnum,
  callStatusEnum,
  numberClassEnum,
} from './enums.ts';
import { E164_REGEX_SQL, timestamptz } from './helpers.ts';
import { regulatoryBundles } from './kyc.ts';
import { orgs } from './org.ts';

/** One active business number per org (multi-number seam = drop the partial unique). */
export const businessNumbers = pgTable(
  'business_numbers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    e164: text('e164').notNull().unique(),
    numberClass: numberClassEnum('number_class').notNull().default('geographic'),
    status: businessNumberStatusEnum('status').notNull().default('requested'),
    areaCode: text('area_code'), // TC prefix (e.g. '2' Prague)
    providerNumberRef: text('provider_number_ref'), // provider-neutral opaque ref
    bundleId: uuid('bundle_id').references(() => regulatoryBundles.id, { onDelete: 'set null' }),
    providerRejectionReason: text('provider_rejection_reason'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    activatedAt: timestamptz('activated_at'),
    releasedAt: timestamptz('released_at'),
  },
  (table) => [
    uniqueIndex('business_numbers_one_active_per_org')
      .on(table.orgId)
      .where(sql`${table.status} <> 'released'`),
    check('business_numbers_e164_check', sql`${table.e164} ~ ${E164_REGEX_SQL}`),
  ],
);

/** Mutable working state for in-flight calls (Workers have no memory between webhooks). */
export const callSessions = pgTable(
  'call_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    businessNumberId: uuid('business_number_id')
      .notNull()
      .references(() => businessNumbers.id, { onDelete: 'cascade' }),
    providerCallRef: text('provider_call_ref').notNull().unique(), // idempotency anchor
    kind: callSessionKindEnum('kind').notNull(),
    state: callSessionStateEnum('state').notNull(),
    fromE164: text('from_e164'),
    targetE164: text('target_e164'),
    digitsRaw: text('digits_raw'),
    answeredAt: timestamptz('answered_at'), // set on call.leg answered
    lastLegStatus: text('last_leg_status'),
    lastLegErrorCode: text('last_leg_error_code'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    // Structural concurrent-bridge cap (=1, ER-RATE-2): the INSERT conflict *is* the
    // reject-busy path (decisions.md #29).
    uniqueIndex('call_sessions_one_active_dialin_per_org')
      .on(table.orgId)
      .where(
        sql`${table.kind} = 'dialin' AND ${table.state} IN ('collecting', 'bridging', 'bridged')`,
      ),
    check(
      'call_sessions_from_e164_check',
      sql`${table.fromE164} IS NULL OR ${table.fromE164} ~ ${E164_REGEX_SQL}`,
    ),
    check(
      'call_sessions_target_e164_check',
      sql`${table.targetE164} IS NULL OR ${table.targetE164} ~ ${E164_REGEX_SQL}`,
    ),
  ],
);

/**
 * The append-only call log (ER-AUD-1). Written exactly once per logical call, at its
 * terminal state, by `core/call-log.ts`. No UPDATE path exists in application code
 * except the purge job's anonymisation (decisions.md #19).
 */
export const calls = pgTable(
  'calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    businessNumberId: uuid('business_number_id')
      .notNull()
      .references(() => businessNumbers.id, { onDelete: 'cascade' }),
    direction: callDirectionEnum('direction').notNull(),
    status: callStatusEnum('status').notNull(),
    reason: text('reason'),
    fromE164: text('from_e164'), // NULL-able (strippable)
    toE164: text('to_e164'), // NULL-able (strippable)
    initiatingUserId: text('initiating_user_id').references(() => user.id, {
      onDelete: 'set null',
    }), // outbound only; strippable
    startedAt: timestamptz('started_at').notNull(),
    answeredAt: timestamptz('answered_at'),
    endedAt: timestamptz('ended_at'),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    providerCallRef: text('provider_call_ref'),
    providerErrorCode: text('provider_error_code'),
    anonymisedAt: timestamptz('anonymised_at'),
  },
  (table) => [
    index('calls_org_started_at_idx').on(table.orgId, table.startedAt.desc()),
    uniqueIndex('calls_provider_call_ref_unique')
      .on(table.providerCallRef)
      .where(sql`${table.providerCallRef} IS NOT NULL`),
    check(
      'calls_from_e164_check',
      sql`${table.fromE164} IS NULL OR ${table.fromE164} ~ ${E164_REGEX_SQL}`,
    ),
    check(
      'calls_to_e164_check',
      sql`${table.toE164} IS NULL OR ${table.toE164} ~ ${E164_REGEX_SQL}`,
    ),
  ],
);

/** Seedable region catalog (ER-KYC-2), sourced from Decree 117/2007 Sb. */
export const regionAreaCodes = pgTable('region_area_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  regionName: text('region_name').notNull(),
  tcPrefix: text('tc_prefix').notNull().unique(),
});

/** Deny-list of premium/shared-cost prefixes (ER-EMG-2). Emergency short codes are
 * deliberately hard-coded in `core/dial-policy.ts`, not here (decisions.md #11). */
export const dialPolicyPrefixes = pgTable('dial_policy_prefixes', {
  id: uuid('id').primaryKey().defaultRandom(),
  prefix: text('prefix').notNull().unique(), // e.g. '+42090'
  label: text('label').notNull(),
});

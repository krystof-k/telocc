import { sql } from 'drizzle-orm';
import {
  char,
  check,
  integer,
  pgTable,
  smallint,
  text,
  time,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { membershipRoleEnum, officeHoursModeEnum } from './enums.ts';
import { E164_REGEX_SQL, timestamptz } from './helpers.ts';

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Europe/Prague'),
  officeHoursMode: officeHoursModeEnum('office_hours_mode').notNull().default('schedule'),
  businessCapacityDeclaredAt: timestamptz('business_capacity_declared_at').notNull(),
  declarationVersion: text('declaration_version').notNull(),
  tosVersion: text('tos_version'),
  tosAcceptedAt: timestamptz('tos_accepted_at'),
  // § 63a step — only set under COMPLIANCE_POSTURE=nbics_provider (ER-POST-1)
  contractSummaryShownAt: timestamptz('contract_summary_shown_at'),
  waiverAcceptedAt: timestamptz('waiver_accepted_at'),
  dialinHourlyCap: integer('dialin_hourly_cap').notNull().default(6),
  outboundDailyMinutesCap: integer('outbound_daily_minutes_cap').notNull().default(180),
  country: char('country', { length: 2 }).notNull().default('CZ'),
  // Billing-dormant (ER-BILL-1), exercised only by tests:
  vatId: text('vat_id'),
  vatViesStatus: text('vat_vies_status'),
  vatViesCheckedAt: timestamptz('vat_vies_checked_at'),
  customerType: text('customer_type').notNull().default('business'),
  billingStreet: text('billing_street'),
  billingCity: text('billing_city'),
  billingPostal: text('billing_postal'),
  billingCountry: text('billing_country'),
  ibanCountry: text('iban_country'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

/** The roles seam. One row per (org,user); MVP exactly one org per user (decisions.md). */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: membershipRoleEnum('role').notNull().default('owner'),
    // The verified number — the linchpin. NULL means routing/outbound inactive.
    personalNumberE164: text('personal_number_e164'),
    personalNumberVerifiedAt: timestamptz('personal_number_verified_at'),
    // ER-EMG-3 disclosure acknowledgment
    emergencyAckAt: timestamptz('emergency_ack_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('memberships_org_user_unique').on(table.orgId, table.userId),
    // one org per user in MVP — dropping this unique is the multi-org path
    unique('memberships_user_unique').on(table.userId),
    check(
      'memberships_personal_number_e164_check',
      sql`${table.personalNumberE164} IS NULL OR ${table.personalNumberE164} ~ ${E164_REGEX_SQL}`,
    ),
  ],
);

/** SMS-PIN challenges (ER-SEC-3, ER-RET-3). Rows are deleted, never merely flagged. */
export const phoneVerifications = pgTable(
  'phone_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    phoneE164: text('phone_e164').notNull(),
    // HMAC-SHA256(PIN_PEPPER, pin ‖ challengeId) hex — never the PIN itself.
    pinHash: text('pin_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    check('phone_verifications_phone_e164_check', sql`${table.phoneE164} ~ ${E164_REGEX_SQL}`),
  ],
);

/** 0–1 interval per weekday, org-local wall-clock time. Absent row = closed that day. */
export const officeHourRules = pgTable(
  'office_hour_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    weekday: smallint('weekday').notNull(), // 0 (Mon) – 6 (Sun)
    opensAt: time('opens_at').notNull(),
    closesAt: time('closes_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('office_hour_rules_org_weekday_unique').on(table.orgId, table.weekday),
    check('office_hour_rules_opens_before_closes', sql`${table.opensAt} < ${table.closesAt}`),
    check('office_hour_rules_weekday_range', sql`${table.weekday} BETWEEN 0 AND 6`),
  ],
);

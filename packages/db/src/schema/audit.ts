import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { auditRetentionClassEnum } from './enums.ts';
import { timestamptz } from './helpers.ts';
import { orgs } from './org.ts';

/**
 * ER-AUD-2. `type` is one of: login, magic_link_issued, magic_link_used, pin_issued,
 * pin_attempt_failed, pin_verified, settings_changed, number_lifecycle, export_requested,
 * webhook_rejected, webhook_ignored, anomaly_flagged, dsr_erasure. `meta` is minimal —
 * no secrets, no full phone numbers (last-4 only where needed).
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').references(() => orgs.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    retentionClass: auditRetentionClassEnum('retention_class').notNull().default('security'),
    meta: jsonb('meta').notNull().default({}),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_org_created_idx').on(table.orgId, table.createdAt),
    index('audit_events_retention_created_idx').on(table.retentionClass, table.createdAt),
  ],
);

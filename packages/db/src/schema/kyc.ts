import { sql } from 'drizzle-orm';
import { check, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { bundleStatusEnum } from './enums.ts';
import { bytea, timestamptz } from './helpers.ts';
import { orgs } from './org.ts';

/** Org KYC identity, shaped like Twilio's EndUser resource (ER-KYC-2). */
export const endUsers = pgTable('end_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .unique()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  legalName: text('legal_name').notNull(),
  ico: text('ico').notNull(),
  street: text('street').notNull(), // app-layer validation rejects PO-box patterns
  city: text('city').notNull(),
  postalCode: text('postal_code').notNull(),
  country: text('country').notNull().default('CZ'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

/** Shaped like Twilio's Bundle resource. */
export const regulatoryBundles = pgTable('regulatory_bundles', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  providerBundleRef: text('provider_bundle_ref'),
  status: bundleStatusEnum('status').notNull().default('draft'),
  submittedAt: timestamptz('submitted_at'),
  decidedAt: timestamptz('decided_at'),
  rejectionReason: text('rejection_reason'),
});

/** Shaped like Twilio's SupportingDocument resource. ≤5 MB (decisions.md #33). */
export const kycDocuments = pgTable(
  'kyc_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    endUserId: uuid('end_user_id')
      .notNull()
      .references(() => endUsers.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    bytes: bytea('bytes').notNull(),
    uploadedAt: timestamptz('uploaded_at').notNull().defaultNow(),
    deletedAt: timestamptz('deleted_at'), // hard-deleted by erasure / once no longer required
  },
  (table) => [check('kyc_documents_max_5mb', sql`octet_length(${table.bytes}) <= 5242880`)],
);

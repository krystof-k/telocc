import { boolean, integer, numeric, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './helpers.ts';
import { orgs } from './org.ts';

/**
 * Billing-dormant tables (ER-BILL-1). Exist and are exercised only by tests; marked
 * dormant-by-design (decisions.md #24) — a register-driven requirement, not gold-plating.
 */
export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(), // sequential per org
  issuedAt: timestamptz('issued_at').notNull().defaultNow(),
  currency: text('currency').notNull().default('CZK'),
  reverseCharge: boolean('reverse_charge').notNull().default(false),
  reverseChargeLegend: text('reverse_charge_legend'),
  totalNet: numeric('total_net', { precision: 14, scale: 2 }).notNull(),
  totalVat: numeric('total_vat', { precision: 14, scale: 2 }).notNull(),
});

export const invoiceLines = pgTable('invoice_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  qty: integer('qty').notNull().default(1),
  unitNet: numeric('unit_net', { precision: 14, scale: 2 }).notNull(),
  vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull(),
  amountNet: numeric('amount_net', { precision: 14, scale: 2 }).notNull(),
  amountVat: numeric('amount_vat', { precision: 14, scale: 2 }).notNull(),
});

/** Checked against CZK 2,000,000 / 2,536,500 thresholds by a test (ER-BILL-1). */
export const orgTurnoverYears = pgTable(
  'org_turnover_years',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    netCzk: numeric('net_czk', { precision: 14, scale: 2 }).notNull(),
  },
  (table) => [unique('org_turnover_years_org_year_unique').on(table.orgId, table.year)],
);

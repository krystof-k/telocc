import { integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './helpers.ts';

/**
 * ER-RATE-1. Fixed-window counters — one atomic
 * `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count` per hit.
 * `key = sha256(scope ‖ identifier ‖ windowStart)` so raw identifiers never persist.
 */
export const rateLimitCounters = pgTable('rate_limit_counters', {
  key: text('key').primaryKey(),
  scope: text('scope').notNull(), // for ops visibility only
  count: integer('count').notNull().default(0),
  windowStartsAt: timestamptz('window_starts_at').notNull(),
  expiresAt: timestamptz('expires_at').notNull(),
});

/** ER-RET-1 purge-audit — counts only, no personal data. */
export const purgeRuns = pgTable('purge_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ranAt: timestamptz('ran_at').notNull().defaultNow(),
  stats: jsonb('stats').notNull().default({}),
});

/** ER-DSR-2 — no org reference, no personal data, counts only. */
export const deletionTombstones = pgTable('deletion_tombstones', {
  id: uuid('id').primaryKey().defaultRandom(),
  deletedAt: timestamptz('deleted_at').notNull().defaultNow(),
  stats: jsonb('stats').notNull().default({}),
});

import { sql } from 'drizzle-orm';
import { customType, timestamp } from 'drizzle-orm/pg-core';

/** `timestamptz` — used everywhere per design.md §3 conventions. */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Postgres `bytea` — used for KYC document blobs (design.md §3.2). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/** E.164 CHECK constraint expression (decisions.md #18): `^\+[1-9][0-9]{1,14}$`. */
export const E164_REGEX = '^\\+[1-9][0-9]{1,14}$';

/**
 * The E.164 pattern as a raw SQL string literal, for embedding directly into CHECK
 * constraint DDL. CHECK constraints can't bind query parameters, so this must be
 * `sql.raw(...)`, never a plain `sql\`${jsString}\`` interpolation (which drizzle
 * would otherwise parameterise as `$1` — invalid inside a CHECK expression).
 */
export const E164_REGEX_SQL = sql.raw(`'${E164_REGEX}'`);

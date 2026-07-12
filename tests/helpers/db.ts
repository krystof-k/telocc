import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '@telocc/db';
import { createNodeDb } from '@telocc/db/node';
import { seedDialPolicyPrefixes } from '@telocc/db/seed/dial-policy';
import { seedRegionAreaCodes } from '@telocc/db/seed/regions';

/**
 * Per-file database isolation (docs/testing.md "How contract tests run"): a template
 * database is migrated once per test run; each contract test FILE clones a fresh
 * database from that template (`CREATE DATABASE ... WITH TEMPLATE ...`); each TEST
 * truncates the org-scoped tables back to empty via `reset()`.
 *
 * No drizzle-kit/migrator dependency here on purpose — those packages aren't resolvable
 * from `tests/helpers` (only `@telocc/db`/`@telocc/telephony` are workspace deps of the
 * root package). Instead this applies the frozen migration SQL directly, byte for byte.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, '../../packages/db/migrations');
const TEMPLATE_DB_NAME = 'telocc_contract_template';
const MAINTENANCE_DB_NAME = 'postgres';

const BASE_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://telocc:telocc@localhost:54329/telocc';

function urlForDatabase(name: string): string {
  const url = new URL(BASE_DATABASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

type RawHandle = ReturnType<typeof createNodeDb>;

async function withRawConnection<T>(
  databaseName: string,
  fn: (raw: RawHandle) => Promise<T>,
): Promise<T> {
  const raw = createNodeDb(urlForDatabase(databaseName));
  try {
    return await fn(raw);
  } finally {
    await raw.$client.end();
  }
}

async function terminateConnectionsTo(admin: RawHandle, databaseName: string): Promise<void> {
  await admin.$client.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [databaseName],
  );
}

function loadMigrationSql(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    throw new Error(`tests/helpers/db.ts: no migration files found in ${MIGRATIONS_DIR}`);
  }
  return files
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n')
    .replaceAll('--> statement-breakpoint', '');
}

let templateReady: Promise<void> | null = null;

/** Idempotent within a test process: only the first caller actually builds the template. */
function ensureTemplateDatabase(): Promise<void> {
  templateReady ??= (async () => {
    await withRawConnection(MAINTENANCE_DB_NAME, async (admin) => {
      await terminateConnectionsTo(admin, TEMPLATE_DB_NAME);
      await admin.$client.query(`DROP DATABASE IF EXISTS "${TEMPLATE_DB_NAME}"`);
      await admin.$client.query(`CREATE DATABASE "${TEMPLATE_DB_NAME}"`);
    });
    await withRawConnection(TEMPLATE_DB_NAME, async (template) => {
      await template.$client.query(loadMigrationSql());
    });
    // Reference/catalog data every contract test can rely on being present (design.md
    // §3.2): CZ region area codes + the premium/shared-cost deny-list. Reuses the real
    // seed modules rather than re-deriving the data.
    const templateDb = createNodeDb(urlForDatabase(TEMPLATE_DB_NAME));
    try {
      await seedRegionAreaCodes(templateDb);
      await seedDialPolicyPrefixes(templateDb);
    } finally {
      await templateDb.$client.end();
    }
  })();
  return templateReady;
}

/** Tables reset between tests. Deliberately excludes `region_area_codes` and
 * `dial_policy_prefixes` — shared reference data seeded once into the template. */
const RESETTABLE_TABLES = [
  'invoice_lines',
  'invoices',
  'org_turnover_years',
  'kyc_documents',
  'regulatory_bundles',
  'end_users',
  'calls',
  'call_sessions',
  'business_numbers',
  'office_hour_rules',
  'phone_verifications',
  'audit_events',
  'rate_limit_counters',
  'purge_runs',
  'deletion_tombstones',
  'memberships',
  'orgs',
  'verification',
  'account',
  'session',
  '"user"',
] as const;

export interface IsolatedDatabase {
  /** Injected as `deps.db` — matches the union type `buildApp` expects. */
  db: Db;
  databaseName: string;
  /** Connection string for this file's database — e.g. to spawn `scripts/esd-report.ts`
   * against the exact same isolated data a test seeded (posture-flip.contract.test.ts). */
  databaseUrl: string;
  /** Truncates every non-reference table (call once per test, e.g. in `beforeEach`). */
  reset(): Promise<void>;
  /** Closes the pool and drops the per-file database (call once, e.g. in `afterAll`). */
  cleanup(): Promise<void>;
}

export async function createIsolatedDatabase(): Promise<IsolatedDatabase> {
  await ensureTemplateDatabase();
  const name = `telocc_contract_${randomBytes(4).toString('hex')}`;
  await withRawConnection(MAINTENANCE_DB_NAME, async (admin) => {
    await admin.$client.query(`CREATE DATABASE "${name}" WITH TEMPLATE "${TEMPLATE_DB_NAME}"`);
  });

  const raw = createNodeDb(urlForDatabase(name));
  const truncateSql = `TRUNCATE TABLE ${RESETTABLE_TABLES.join(', ')} RESTART IDENTITY CASCADE`;

  return {
    db: raw,
    databaseName: name,
    databaseUrl: urlForDatabase(name),
    async reset() {
      await raw.$client.query(truncateSql);
    },
    async cleanup() {
      await raw.$client.end();
      await withRawConnection(MAINTENANCE_DB_NAME, async (admin) => {
        await terminateConnectionsTo(admin, name);
        await admin.$client.query(`DROP DATABASE IF EXISTS "${name}"`);
      });
    },
  };
}

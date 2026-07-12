/**
 * neon-http driver factory — imported ONLY by `apps/api/src/entry.workers.ts`
 * (design.md §1, decisions.md #28). Keeping this in its own module means the Workers
 * bundle never sees `pg`/node-only modules and no `nodejs_compat` flag is required.
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema/index.ts';

export function createNeonDb(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return drizzle({ client: sql, schema });
}

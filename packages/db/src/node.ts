/**
 * node-postgres driver factory — imported ONLY by `apps/api/src/entry.node.ts`
 * (design.md §1, decisions.md #7/#28). Never imported by entry.workers.ts.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.ts';

export function createNodeDb(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  return drizzle({ client: pool, schema });
}

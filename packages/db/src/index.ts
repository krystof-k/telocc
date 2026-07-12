/**
 * Schema + types ONLY — no driver imports (design.md §1). `pg` and its
 * `node:net/tls/fs/dns` dependencies must never enter the Workers bundle; the two
 * `Db` union members below are `import type`-only, so they are erased entirely at
 * compile time and never resolved by the bundler (decisions.md #28).
 */
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema/index.ts';

export * from './schema/index.ts';
export type Schema = typeof schema;

/** The composed db handle used by `buildApp(deps)` — built by a per-entry factory. */
export type Db = NodePgDatabase<Schema> | NeonHttpDatabase<Schema>;

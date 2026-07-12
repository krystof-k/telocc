import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Root .env is the single source of local config (repo convention); this package's
// cwd may be either the repo root or packages/db depending on how it's invoked.
config({ path: new URL('../../.env', import.meta.url).pathname });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('drizzle.config.ts: DATABASE_URL must be set (see .env.example)');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});

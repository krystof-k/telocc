import { defineConfig } from 'vitest/config';

/**
 * Two projects in one root config so both `pnpm test` (implementation layer) and the
 * documented `pnpm vitest run tests/contract` (docs/testing.md, docs/milestones.md)
 * work without extra flags:
 *
 * - `implementation`: co-located `*.test.ts` across apps/packages, freely rewritten.
 * - `contract`: the frozen executable spec (`tests/contract/**`, docs/testing.md). Each
 *   file gets its own database (template-cloned, dropped after the file — see
 *   tests/helpers/db.ts), so files run one at a time (`fileParallelism: false`) rather
 *   than racing each other over `CREATE DATABASE`.
 *
 * `pnpm test:contract` targets only the contract project directly for a faster,
 * single-purpose run.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'implementation',
          include: ['{apps,packages}/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/.wrangler/**'],
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'contract',
          include: ['tests/contract/**/*.contract.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          pool: 'forks',
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});

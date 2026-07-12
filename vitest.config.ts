import { defineConfig } from 'vitest/config';

/**
 * Implementation-layer tests only (co-located `*.test.ts`, testing.md). The contract
 * layer (`tests/contract/**`) is a separate Vitest project run via `pnpm test:contract`
 * once M1 lands; e2e is Playwright, not Vitest.
 */
export default defineConfig({
  test: {
    include: ['{apps,packages}/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.wrangler/**'],
    passWithNoTests: true,
  },
});

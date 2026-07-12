import type { Env } from '../../apps/api/src/env.ts';
import { loadEnv } from '../../apps/api/src/env.ts';

/**
 * The mock webhook signing secret used by every contract test (tests/helpers/telco.ts
 * signs with this, `buildTestEnv` wires it in as `MOCK_WEBHOOK_SECRET` so the app's
 * webhook route — once M4 lands — verifies against the same value).
 */
export const TEST_MOCK_WEBHOOK_SECRET = 'contract-test-mock-webhook-secret-0123456789';

/** Deliberately not a real EU host / not a real secret — `APP_ENV` stays 'test' unless a case overrides it. */
const BASE_TEST_ENV: Record<string, string> = {
  APP_ENV: 'test',
  APP_BASE_URL: 'http://localhost:3001',
  DATABASE_URL: 'postgresql://telocc:telocc@localhost:54329/telocc_unused_by_tests',
  BETTER_AUTH_SECRET: 'contract-test-better-auth-secret-0123456789',
  PIN_PEPPER: 'contract-test-pin-pepper-0123456789',
  TELEPHONY_PROVIDER: 'mock',
  MOCK_WEBHOOK_SECRET: TEST_MOCK_WEBHOOK_SECRET,
  EMAIL_PROVIDER: 'dev',
  COMPLIANCE_POSTURE: 'app_layer',
  RETENTION_CALL_LOG_MONTHS: '13',
  RETENTION_SECURITY_LOG_DAYS: '90',
  // z.coerce.boolean() treats ANY non-empty string (incl. 'false') as true, so the only
  // way to get `false` out of loadEnv is to omit the key (default) or pass ''.
  ENABLE_DEV_ROUTES: '',
};

/**
 * Builds a validated `Env` for a test, layering `overrides` on top of `BASE_TEST_ENV`.
 * Pass `undefined` for a key to omit it entirely (falls back to the zod schema default)
 * rather than sending the literal string `'undefined'`.
 */
export function buildTestEnv(overrides: Record<string, string | undefined> = {}): Env {
  const merged: Record<string, string | undefined> = { ...BASE_TEST_ENV, ...overrides };
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  return loadEnv(merged);
}

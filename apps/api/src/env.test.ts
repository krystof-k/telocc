import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.ts';

const baseEnv = {
  APP_BASE_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://telocc:telocc@localhost:54329/telocc',
  BETTER_AUTH_SECRET: 'test-secret',
  PIN_PEPPER: 'test-pepper',
};

describe('loadEnv', () => {
  it('applies documented defaults', () => {
    const env = loadEnv(baseEnv);
    expect(env.APP_ENV).toBe('development');
    expect(env.TELEPHONY_PROVIDER).toBe('mock');
    expect(env.RETENTION_CALL_LOG_MONTHS).toBe(13);
    expect(env.COMPLIANCE_POSTURE).toBe('app_layer');
  });

  it('rejects a missing required variable', () => {
    const { DATABASE_URL, ...rest } = baseEnv;
    expect(() => loadEnv(rest)).toThrow();
  });

  it('refuses to boot in production against a non-EU Neon host (ER-RES-1)', () => {
    expect(() =>
      loadEnv({
        ...baseEnv,
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@ep-foo.us-east-2.aws.neon.tech/db',
      }),
    ).toThrow();
  });

  it('accepts an EU Neon host in production (with a non-default mock secret)', () => {
    const env = loadEnv({
      ...baseEnv,
      APP_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@ep-foo.eu-central-1.aws.neon.tech/db',
      MOCK_WEBHOOK_SECRET: 'a-freshly-generated-strong-secret',
    });
    expect(env.APP_ENV).toBe('production');
  });

  it('refuses to boot in production with the dev default mock webhook secret (ER-WEB-1)', () => {
    expect(() =>
      loadEnv({
        ...baseEnv,
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@ep-foo.eu-central-1.aws.neon.tech/db',
      }),
    ).toThrow();
  });
});

import { z } from 'zod';

/**
 * The single config surface (design.md §2). Validated once at boot; the process
 * refuses to start on invalid config.
 */
const envSchema = z
  .object({
    APP_ENV: z.enum(['development', 'production', 'test']).default('development'),
    APP_BASE_URL: z.url(),
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(1),
    PIN_PEPPER: z.string().min(1),
    TELEPHONY_PROVIDER: z.enum(['mock', 'twilio']).default('mock'),
    MOCK_WEBHOOK_SECRET: z.string().default('dev-mock-webhook-secret-change-me'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_REGION: z.string().default('ie1'),
    EMAIL_PROVIDER: z.enum(['dev', 'resend']).default('dev'),
    RESEND_API_KEY: z.string().optional(),
    RETENTION_CALL_LOG_MONTHS: z.coerce.number().int().positive().default(13),
    RETENTION_SECURITY_LOG_DAYS: z.coerce.number().int().positive().default(90),
    COMPLIANCE_POSTURE: z.enum(['app_layer', 'nbics_provider']).default('app_layer'),
    ENABLE_DEV_ROUTES: z.coerce.boolean().default(false),
    ANOMALY_DAILY_CALLS: z.coerce.number().int().positive().default(50),
    ANOMALY_DAILY_MINUTES: z.coerce.number().int().positive().default(180),
    ANOMALY_NIGHT_CALLS: z.coerce.number().int().positive().default(10),
    ANOMALY_CZ_FAILURE_PCT: z.coerce.number().positive().default(20),
    APPSIGNAL_PUSH_API_KEY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV !== 'production') return;

    // ER-RES-1: Neon project region is immutable — refuse to boot against a
    // non-EU host in production (the programmatic half of the deploy-doc warning).
    const isEuNeonHost = /\.eu-(central|west)-\d\./.test(env.DATABASE_URL);
    if (!isEuNeonHost) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'production DATABASE_URL must be an EU Neon region host (ER-RES-1)',
      });
    }

    // ER-WEB-1: the public webhook endpoint must never ship with a well-known
    // signing secret while running against the mock provider in production.
    if (
      env.TELEPHONY_PROVIDER === 'mock' &&
      (!env.MOCK_WEBHOOK_SECRET || env.MOCK_WEBHOOK_SECRET === 'dev-mock-webhook-secret-change-me')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['MOCK_WEBHOOK_SECRET'],
        message:
          'production with TELEPHONY_PROVIDER=mock requires a freshly generated MOCK_WEBHOOK_SECRET (ER-WEB-1)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

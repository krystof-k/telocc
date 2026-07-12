import type { Db } from '@telocc/db';
import type { TelephonyProvider } from '@telocc/telephony';
import { createMockProvider, type MockProviderState } from '@telocc/telephony/mock';
import { TwilioProvider } from '@telocc/telephony/twilio';
import type { Env } from './env.ts';
import { createDevEmailSender, createResendEmailSender, type EmailSender } from './lib/email.ts';

/**
 * `buildApp(deps)` takes `{ db, provider, email, env, now }` so tests and both
 * runtimes assemble identically (design.md §1). DB driver selection happens at the
 * composition point (entry.workers.ts / entry.node.ts), never inside this module.
 */
export interface Deps {
  db: Db;
  provider: TelephonyProvider;
  email: EmailSender;
  env: Env;
  now: () => Date;
  /**
   * Introspectable mock-provider state (sent SMS, rendered instructions, …) — only
   * populated when `TELEPHONY_PROVIDER=mock` (design.md §12 "SMS outbox panel"). The
   * `TelephonyProvider` interface itself stays provider-neutral (design.md §4), so this
   * lives beside it as an optional, mock-only side channel that `routes/dev/index.ts`
   * (M10, env-gated) reads for the demo's SMS-outbox panel — never consumed by any
   * application/routing logic. Contract tests construct `Deps` object literals directly
   * (tests/helpers/app.ts) and never set this field, which is why it must stay optional.
   */
  mockProviderState?: MockProviderState;
}

function notImplemented(method: string): never {
  throw new Error(
    `${method} is not implemented yet — the mock provider lands in M4, Twilio in M9.`,
  );
}

/**
 * Placeholder satisfying the full seam interface. Nothing in M0 routes it (only the
 * health route exists), but the shape must be real from the scaffold onward so later
 * milestones only ever swap `deps.ts`'s wiring, never `buildApp`'s signature.
 */
export const notImplementedProvider: TelephonyProvider = {
  name: 'not-implemented',
  capabilities: {
    czCliDomesticTermination: 'unverified',
    instantProvisioning: false,
    supportedNumberClasses: ['geographic', 'nomadic_910', 'mobile'],
  },
  verifyWebhook: async () => notImplemented('verifyWebhook'),
  parseWebhook: () => notImplemented('parseWebhook'),
  renderInstruction: () => notImplemented('renderInstruction'),
  sendSms: async () => notImplemented('sendSms'),
  hangupCall: async () => notImplemented('hangupCall'),
  searchNumbers: async () => notImplemented('searchNumbers'),
  getRequiredDocuments: async () => notImplemented('getRequiredDocuments'),
  submitBundle: async () => notImplemented('submitBundle'),
  provisionNumber: async () => notImplemented('provisionNumber'),
  releaseNumber: async () => notImplemented('releaseNumber'),
  getProvisioningStatus: async () => notImplemented('getProvisioningStatus'),
  deleteCallRecord: async () => notImplemented('deleteCallRecord'),
};

/** Picks the `EmailSender` per `EMAIL_PROVIDER` (decisions.md #16): `dev` in-process
 * mailbox locally/demo, `resend` in production (owner supplies `RESEND_API_KEY`). */
function buildEmailSender(env: Env): EmailSender {
  if (env.EMAIL_PROVIDER === 'resend') {
    if (!env.RESEND_API_KEY) {
      throw new Error('EMAIL_PROVIDER=resend requires RESEND_API_KEY to be set');
    }
    return createResendEmailSender({
      apiKey: env.RESEND_API_KEY,
      from: `Telocc <noreply@${new URL(env.APP_BASE_URL).hostname}>`,
    });
  }
  return createDevEmailSender();
}

/** Picks the `TelephonyProvider` per `TELEPHONY_PROVIDER` (design.md §2, §4.4). `mock`
 * is fully wired here (M4); `twilio` stays unwired (M9 is "complete against the
 * interface" but deliberately not composed into the running app yet — that wiring is
 * a go-live step, docs/design.md §13) and falls back to the placeholder so a
 * misconfigured `TELEPHONY_PROVIDER=twilio` fails loudly rather than silently. The
 * mock's introspectable `state` (sent SMS, …) is returned alongside the provider so
 * `buildDeps` can surface it as `Deps.mockProviderState` for the dev-only SMS-outbox
 * panel (design.md §12) — `undefined` for every other provider. */
function buildProvider(
  env: Env,
  now: () => Date,
): { provider: TelephonyProvider; mockProviderState?: MockProviderState } {
  if (env.TELEPHONY_PROVIDER === 'mock') {
    const instance = createMockProvider({ webhookSecret: env.MOCK_WEBHOOK_SECRET, now });
    return { provider: instance.provider, mockProviderState: instance.state };
  }
  if (env.TELEPHONY_PROVIDER === 'twilio') {
    // env.ts's superRefine guarantees these are set when the provider is 'twilio'.
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_SMS_FROM) {
      throw new Error('TELEPHONY_PROVIDER=twilio requires TWILIO_* credentials (env.ts)');
    }
    return {
      provider: new TwilioProvider({
        accountSid: env.TWILIO_ACCOUNT_SID,
        authToken: env.TWILIO_AUTH_TOKEN,
        region: env.TWILIO_REGION,
        appBaseUrl: env.APP_BASE_URL,
        smsFrom: env.TWILIO_SMS_FROM,
      }),
    };
  }
  return { provider: notImplementedProvider };
}

/** Wires `db` + `env` (always real) with the real telephony provider and `EmailSender`. */
export function buildDeps(params: { db: Db; env: Env; now?: () => Date }): Deps {
  const now = params.now ?? (() => new Date());
  const { provider, mockProviderState } = buildProvider(params.env, now);
  return {
    db: params.db,
    env: params.env,
    now,
    provider,
    mockProviderState,
    email: buildEmailSender(params.env),
  };
}

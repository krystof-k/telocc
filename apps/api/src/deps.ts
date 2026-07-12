import type { Db } from '@telocc/db';
import type { TelephonyProvider } from '@telocc/telephony';
import { createMockProvider } from '@telocc/telephony/mock';
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
 * misconfigured `TELEPHONY_PROVIDER=twilio` fails loudly rather than silently. */
function buildProvider(env: Env, now: () => Date): TelephonyProvider {
  if (env.TELEPHONY_PROVIDER === 'mock') {
    return createMockProvider({ webhookSecret: env.MOCK_WEBHOOK_SECRET, now }).provider;
  }
  return notImplementedProvider;
}

/** Wires `db` + `env` (always real) with the real telephony provider and `EmailSender`. */
export function buildDeps(params: { db: Db; env: Env; now?: () => Date }): Deps {
  const now = params.now ?? (() => new Date());
  return {
    db: params.db,
    env: params.env,
    now,
    provider: buildProvider(params.env, now),
    email: buildEmailSender(params.env),
  };
}

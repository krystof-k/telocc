import type { Db } from '@telocc/db';
import type { TelephonyProvider } from '@telocc/telephony';
import type { Env } from './env.ts';
import type { EmailSender } from './lib/email.ts';

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

/** Placeholder EmailSender — the `dev`/`resend` implementations land in M2. */
export const notImplementedEmail: EmailSender = {
  send: async () => notImplemented('EmailSender.send'),
};

/** Wires `db` + `env` (always real) with today's placeholder provider/email. */
export function buildDeps(params: { db: Db; env: Env; now?: () => Date }): Deps {
  return {
    db: params.db,
    env: params.env,
    now: params.now ?? (() => new Date()),
    provider: notImplementedProvider,
    email: notImplementedEmail,
  };
}

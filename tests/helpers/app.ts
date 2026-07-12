import type { Db } from '@telocc/db';
import type { TelephonyProvider } from '@telocc/telephony';
import { buildApp } from '../../apps/api/src/app.ts';
import type { Env } from '../../apps/api/src/env.ts';
import type { EmailSender } from '../../apps/api/src/lib/email.ts';
import { buildTestEnv } from './env.ts';

export type { App } from '../../apps/api/src/app.ts';

export interface BuildTestAppParams {
  db: Db;
  provider: TelephonyProvider;
  email: EmailSender;
  now?: () => Date;
  /** Layered on top of the shared test defaults (tests/helpers/env.ts). */
  envOverrides?: Record<string, string | undefined>;
}

/**
 * The one factory every contract file uses (docs/testing.md): assembles the real
 * `buildApp(deps)` — never `apps/api/src/deps.ts`'s `buildDeps`, which always wires the
 * M0 `notImplementedProvider`/`notImplementedEmail` placeholders and has no override
 * hook. Tests construct the full `Deps` object directly instead.
 */
export function buildTestApp(params: BuildTestAppParams) {
  const env: Env = buildTestEnv(params.envOverrides);
  return buildApp({
    db: params.db,
    provider: params.provider,
    email: params.email,
    env,
    now: params.now ?? (() => new Date()),
  });
}

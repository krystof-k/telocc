import type { Db } from '@telocc/db';
import type { TelephonyProvider } from '@telocc/telephony';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import type { App } from '../../apps/api/src/app.ts';
import { buildTestApp } from './app.ts';
import { createFakeClock, type FakeClock } from './clock.ts';
import { createIsolatedDatabase } from './db.ts';
import { TEST_MOCK_WEBHOOK_SECRET } from './env.ts';
import { type CaptureMailbox, createCaptureMailbox } from './mailbox.ts';
import {
  createMockTelco,
  createMockTelephonyProvider,
  type MockProviderSpies,
  type MockTelco,
} from './telco.ts';

export interface ContractTestContext {
  readonly db: Db;
  /** Connection string for this file's isolated database (e.g. to spawn a script). */
  readonly databaseUrl: string;
  readonly clock: FakeClock;
  readonly mailbox: CaptureMailbox;
  readonly provider: TelephonyProvider;
  readonly spies: MockProviderSpies;
  readonly telco: MockTelco;
  readonly app: App;
  /**
   * Rebuilds `ctx.app` with different env overrides mid-test (e.g. a different
   * `COMPLIANCE_POSTURE` or `ENABLE_DEV_ROUTES`) without needing a fresh database.
   * `db`/`provider`/`mailbox`/`clock` are reused as-is.
   */
  rebuildApp(envOverrides?: Record<string, string | undefined>): App;
}

/**
 * One call per contract test file: registers `beforeAll`/`afterAll`/`beforeEach` hooks
 * that give every test a fresh per-file database (cloned from the migrated template,
 * dropped at the end of the file) truncated before each test, a fresh fake clock,
 * mailbox and mock telephony provider, and a `buildApp` instance wired from them
 * (docs/testing.md "How contract tests run").
 */
export function setupContractTest(): ContractTestContext {
  const ctx = {} as {
    db: Db;
    databaseUrl: string;
    clock: FakeClock;
    mailbox: CaptureMailbox;
    provider: TelephonyProvider;
    spies: MockProviderSpies;
    telco: MockTelco;
    app: App;
    rebuildApp: (envOverrides?: Record<string, string | undefined>) => App;
  };
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const isolated = await createIsolatedDatabase();
    ctx.db = isolated.db;
    ctx.databaseUrl = isolated.databaseUrl;
    cleanup = isolated.cleanup;
    // Re-bind reset() onto a closure vitest can call every test:
    (ctx as unknown as { __reset: () => Promise<void> }).__reset = isolated.reset;
  });

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    await (ctx as unknown as { __reset: () => Promise<void> }).__reset();

    ctx.clock = createFakeClock();
    ctx.mailbox = createCaptureMailbox(() => ctx.clock.now());
    const { provider, spies } = createMockTelephonyProvider({
      webhookSecret: TEST_MOCK_WEBHOOK_SECRET,
      now: () => ctx.clock.now(),
    });
    ctx.provider = provider;
    ctx.spies = spies;

    ctx.rebuildApp = (envOverrides) => {
      ctx.app = buildTestApp({
        db: ctx.db,
        provider: ctx.provider,
        email: ctx.mailbox.email,
        now: () => ctx.clock.now(),
        envOverrides,
      });
      return ctx.app;
    };
    ctx.rebuildApp();

    // A thin proxy (not a captured reference) so `telco` keeps working against
    // whichever app instance is current even if a test calls `ctx.rebuildApp()`
    // mid-test (e.g. to flip an env var) after `telco` was already constructed.
    ctx.telco = createMockTelco({
      app: { request: async (input, init) => ctx.app.request(input, init) },
      webhookSecret: TEST_MOCK_WEBHOOK_SECRET,
      now: () => ctx.clock.now(),
    });
  });

  return ctx;
}

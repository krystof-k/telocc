# Contract-test helpers

Support layer for `tests/contract/**` (docs/testing.md). Nothing here is a contract
itself — it is infrastructure so the 17 contract files can boot the real app, drive
real signed webhooks, and read/write the real schema without duplicating boilerplate.

## Quick start

```ts
import { describe, expect, it } from 'vitest';
import { setupContractTest } from '../helpers/context.ts';
import { createReadyOrg } from '../helpers/fixtures.ts';
import { getJson } from '../helpers/http.ts';

describe('some area', () => {
  const ctx = setupContractTest(); // fresh per-file DB, per-test truncation, fake clock,
                                    // mailbox, mock provider, and a live `ctx.app`

  it('does the thing', async () => {
    const { cookieHeader } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
    const res = await getJson(ctx.app, '/api/business-number', { cookieHeader });
    expect(res.status).toBe(200);
  });
});
```

## Files

- **`context.ts`** — `setupContractTest()`. Call once per `describe` block (one per
  file). Registers `beforeAll`/`afterAll` (create/drop the per-file database, cloned
  from a template migrated once per test run) and `beforeEach` (truncate all
  org-scoped + auth tables, fresh `FakeClock`, fresh `CaptureMailbox`, fresh mock
  telephony provider, freshly built `app`). Returns a live `ContractTestContext`:
  `db`, `databaseUrl`, `clock`, `mailbox`, `provider`, `spies`, `telco`, `app`, and
  `rebuildApp(envOverrides?)` to reconstruct `app` with different env vars mid-test
  (e.g. a different `COMPLIANCE_POSTURE` or `ENABLE_DEV_ROUTES`) without a fresh DB.

- **`app.ts`** — `buildTestApp({ db, provider, email, now?, envOverrides? })` calls the
  real `buildApp(deps)` from `apps/api/src/app.ts` directly (never
  `apps/api/src/deps.ts`'s `buildDeps`, which always wires the M0 placeholder
  provider/email with no override hook). Most tests use `setupContractTest()` instead
  of calling this directly.

- **`env.ts`** — `buildTestEnv(overrides?)` builds a validated `Env` via the real
  `loadEnv()`, layered on `BASE_TEST_ENV`. `TEST_MOCK_WEBHOOK_SECRET` is the fixed
  secret every test signs mock webhooks with. **Gotcha carried over from
  `apps/api/src/env.ts`:** `ENABLE_DEV_ROUTES` uses `z.coerce.boolean()`, and
  `Boolean('false')` is `true` in JS — pass `undefined` (omit the key) or `''` for
  false, never the literal string `'false'`.

- **`db.ts`** — `createIsolatedDatabase()`. Migrates a template database once per test
  process (applying `packages/db/migrations/*.sql` directly — no drizzle-kit/migrator
  dependency, since only `@telocc/db`/`@telocc/telephony`/`drizzle-orm` are resolvable
  from `tests/helpers`, see "Dependency notes" below) and seeds it with
  `region_area_codes`/`dial_policy_prefixes` via the real seed modules
  (`@telocc/db/seed/regions`, `@telocc/db/seed/dial-policy`). Each contract FILE clones
  a fresh database from that template (`CREATE DATABASE ... WITH TEMPLATE ...`); each
  TEST truncates every table except the two reference ones. Requires dockerized
  Postgres reachable at `TEST_DATABASE_URL` (default
  `postgresql://telocc:telocc@localhost:54329/telocc`, i.e. `docker compose up -d db`).

- **`clock.ts`** — `createFakeClock(initial?)` → `{ now(), set(), advance*() }`. Every
  `deps.now` in the suite reads from one of these, so TTL/retention/office-hours tests
  never sleep.

- **`mailbox.ts`** — `createCaptureMailbox()` is the `dev` `EmailSender` stand-in;
  `extractMagicLinkToken(email)` regexes a `token=` query param out of the email body.
  **Assumption:** the real `dev` `EmailSender`'s magic-link text must contain the
  verification URL with a `token=` param (matching `GET /api/auth/magic-link/verify`,
  design.md §7) — documented here since design.md doesn't pin the exact copy.

- **`telco.ts`** — `createMockTelephonyProvider({ webhookSecret, now })` returns a
  `{ provider, spies }` pair implementing the full `TelephonyProvider` interface
  per design.md §4.4 (HMAC-SHA256 signing over `timestamp.rawBody`, headers
  `x-mock-signature`/`x-mock-timestamp`, ±300s tolerance; deterministic
  catalog/bundle/number refs). `MockTelco`/`createMockTelco({ app, webhookSecret, now })`
  is the "fake network": `incomingCall`/`dtmf`/`legAnswered`/`legEnded`/`completed`/
  `provisioningUpdate` each sign and POST a neutral `TelephonyEvent` to
  `/webhooks/telephony/mock` and return `{ status, instruction, bodyText }` decoded from
  the JSON response. **SCAFFOLD GAP:** `packages/telephony/src/mock/{provider,telco}.ts`
  (M4) don't exist yet, so this is a hand-written stand-in, not an import of the real
  mock — see the M1 report for why (M1 must compile today; importing a nonexistent
  module would block the whole suite). It implements exactly what design.md §4.4
  documents, so it doubles as the wire-contract M4 must match. One resolved ambiguity:
  design.md's example wire body for `reject` (`{do:'reject',cause:'busy'}`) uses a `do`
  key, but the neutral `CallInstruction` type uses `kind`; this helper renders/parses
  `kind` (the canonical, typed field) — treat the `do` example as documentation
  shorthand, not a literal wire-format requirement, unless corrected in `docs/decisions.md`.

- **`auth.ts`** — `requestMagicLink`/`loginViaMagicLink` drive the *real*
  `/api/auth/sign-in/magic-link` → capture mailbox → `/api/auth/magic-link/verify` path
  and return a `Cookie:` header value. Used everywhere a test needs "a logged-in
  owner", not just in `auth.contract.test.ts` — deliberately never a DB-fixture
  shortcut around session cookies (brief.md: "validate at real boundaries").
  `findUserIdByEmail` looks up the Better Auth `user.id` created by that login.

- **`fixtures.ts`** — direct-DB builders for preconditions that are *not* the boundary
  a given file is testing: `createOrgFixture`, `createMembershipFixture`,
  `createBusinessNumberFixture`, `createOfficeHourRules`, `createEndUserFixture`, and
  the composite `createReadyOrg(app, db, mailbox, opts)` (logs in for real, then
  fixtures an org with a verified personal number + active business number + Mon-Fri
  9-17 hours) — the common precondition for inbound/outbound/call-log/scoping cases.

- **`http.ts`** — `getJson`/`postJson`/`putJson`/`deleteJson`/`jsonBody` thin wrappers
  around `app.request()` with a `cookieHeader` option.

## Dependency notes (why some files avoid certain imports)

`tests/helpers` and `tests/contract` are not their own pnpm package, so only packages
that are direct dependencies of the **root** `package.json` are resolvable here:
`@telocc/core`, `@telocc/db`, `@telocc/telephony`, `drizzle-orm` (root deps/devDeps
added for this reason — see the M1 report). `drizzle-kit`, `pg`, `hono`, etc. are
deliberately NOT added; `db.ts` reaches the underlying `pg.Pool` via
`createNodeDb(...).$client` instead of importing `pg` directly, and `apps/api`'s own
transitive deps (hono, zod, better-auth, ...) resolve fine when *their* files import
them, since Node/Vite resolve relative to the importing file's own `node_modules`.

## Known ambiguities carried from testing.md/design.md (see the M1 report for the full list)

- Rate-limit "per IP" identifiers are read from an `X-Forwarded-For` header (the only
  IP signal available to an in-process `app.request()` call).
- `auth.contract.test.ts`'s unauthenticated-route sweep excludes `/api/auth/*` and
  `POST /api/orgs` per testing.md's "except auth and org-creation preflight" wording.
- `org-scoping.contract.test.ts`'s by-id 404 case assumes `GET /api/calls/:id` and
  `GET /api/kyc/documents/:id` as the plausible detail routes (design.md's API table
  has no by-id GET route documented for either resource).
- `call-log.contract.test.ts` assumes `GET /api/calls` responds
  `{ items: CallRow[], nextCursor: string | null }`.
- `posture-flip.contract.test.ts`'s ESD case assumes `scripts/esd-report.ts` prints one
  JSON object to stdout shaped `{ inbound: {calls,minutes}, outbound: {calls,minutes} }`.
- `retention-purge.contract.test.ts` calls `runScheduledJobs` through a type-cast (see
  the file's header comment) because the M0 stub's signature (`now`) doesn't yet match
  design.md §10.1's documented one (`db, provider, env, now`) — a compile-shape bridge,
  not a behavioural shortcut.
- `provisioning.contract.test.ts`'s "number release on account deletion" case assumes
  that lifecycle audit event is written with `org_id: null` (like `deletion_tombstones`)
  so it survives the org's cascading delete.

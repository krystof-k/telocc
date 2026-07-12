# Build decisions log

One-liners for every choice the brief left open. Newest at the bottom.

1. **UI language:** English copy through a thin typed i18n layer (owner's call at the question
   gate) — Czech is a translation file away.
2. **Regulatory posture:** Telocc rides on Twilio as the regulated carrier (owner's call at the
   question gate); the register flags own-ČTÚ-registration as an open owner item.
3. **Frontend:** React 19 + Vite + shadcn/ui + Tailwind 4 — the most mainstream half of the
   palette's either/or, and shadcn is React-native.
4. **Node version:** development and CI on Node 22 (what the build environment provides);
   `engines` set to `>=22`, Node 24 recommended and documented for production. No code
   difference for this stack.
5. **CZ number region default:** Prague (+420 2xx geographic range) as the seeded/demo catalog
   region, per the brief's "pick a sensible default" for the number catalog.
6. **Single origin:** the Worker serves the Vite build as static assets — one deploy, same
   origin, no CORS surface.
7. **DB drivers:** drizzle neon-http on Workers, node-postgres locally *(selection mechanism
   superseded by #28 — per-entry factories, not one runtime-branching `createDb`)*;
   consequence stands: no multi-statement transactions — erasure uses FK
   `ON DELETE CASCADE`, counters/attempts use single atomic upserts.
8. **Rate limiting:** fixed-window counters in Postgres (one atomic upsert), identical on
   Workers and Node; identifiers stored only as SHA-256 hashes.
9. **Retention purge = anonymise, not delete:** call rows older than the window get both
   numbers + initiator + provider refs stripped; the aggregate row survives for ESD counts
   (ER-RET-1 offers either; this also serves ER-AUD-3).
10. **Office hours:** 0–1 interval per weekday, org-local time, no overnight spans;
    timezone math via the built-in Intl API (no date library).
11. **Dial policy split:** emergency short codes hard-coded in code (safety, never
    configurable); premium/shared-cost prefixes in a seeded table (ER-EMG-2 data-driven).
12. **Daily-minutes hard cutoff** via the bridge instruction's max-duration (TwiML Dial
    `timeLimit`); imperative `hangupCall` kept only as a backstop.
13. **No DTMF retry:** invalid input or inactivity ends the call with the distinct refusal
    tone / hangup and a logged status — smallest flow satisfying "basic validation only".
14. **Emergency refusal sound:** short SIT-style tone WAV served by the API and played before
    hangup — audibly distinct yet announcement-free (squares ER-EMG-1 with the no-IVR spec).
15. **PIN:** 6 digits fixed (within the brief's 4–6), HMAC-SHA256 with a server pepper.
16. **Email delivery:** two-line EmailSender port — dev in-process mailbox locally, Resend in
    production (owner account at wiring; listed next to Twilio in deploy docs).
17. **Web data layer:** react-router v7 (library mode) + TanStack Query over hono/client RPC
    (`AppType` import — no shared types package).
18. **IDs:** UUID (`gen_random_uuid()`) PKs; E.164 as text with a CHECK constraint.
19. **Call log write-once:** in-flight state lives in a `call_sessions` table; the `calls` row
    is inserted exactly once at the terminal state (satisfies ER-AUD-1 append-only cleanly).
20. **Out-of-hours decline** maps to signalling-level busy (TwiML `<Reject reason="busy"/>`):
    the number is always routed and responds; logged as `declined/out_of_hours` (ER-CLI-2b).
21. **Simulator architecture:** the mock telco lives in the API process behind env-gated
    `/dev/sim/*` routes and always enters the system through the real signed webhook endpoint,
    so demo and tests exercise the production path (ER-WEB-1).
22. **Contract tests** run the real Hono app in-process against dockerized Postgres + mock
    provider; they are written first and are off-limits to implementing milestones.
23. **Full schema + seam types land in the scaffold milestone** so later milestones never
    contend over migrations or the interface — the enabler for parallel milestone work.
24. **Billing tables dormant-by-design** (ER-BILL-1): exist and are exercised only by tests;
    not gold-plating — a register-driven requirement.
25. **Answered-time signalling:** child-leg status callbacks (`statusCallbackEvent="answered
    completed"`, resolved via `ParentCallSid`) are the answered-signal of record on both forward
    and bridge Dials — Twilio's Dial action callback is not requested when the caller hangs up
    first; MockTelco fires the identical timeline (answered at pickup, before any completion).
26. **`call.completed` is the sole finalizer** for forwarded/bridged calls; leg events only
    record onto `call_sessions` (`answered_at`, `last_leg_status`) so retried/re-ordered
    callbacks land on the same write-once `calls` row.
27. **Forward dial timeout 120 s** (was 25 s): the personal carrier's native behaviour
    (voicemail answers → answered; ring-out/reject → missed) decides the outcome, per the
    brief; the timeout is only a backstop and logs missed.
28. **Per-entry DB drivers:** entry.workers.ts builds neon-http, entry.node.ts node-postgres;
    `packages/db` index exports schema only — `pg` never enters the Workers bundle, no
    `nodejs_compat`; M0 gates on `wrangler deploy --dry-run`.
29. **Concurrent-bridge cap is structural:** partial unique index on active dialin
    `call_sessions`; the INSERT conflict is the reject-busy path (atomic on neon-http).
30. **Late/unknown-callRef webhook events** are acked 200, ignored, and counted
    (`webhook_ignored`) — provider redelivery never 5xxes or double-writes.
31. **Better Auth `useSecureCookies: true` unconditionally** — Secure flag identical across
    dev/test/prod (localhost is a trustworthy context), so cookie assertions never vary by
    environment.
32. **PIN resend cooldown = its own 1/60 s per-phone fixed window** alongside the 3/10-min and
    daily caps (aligns the §7 limit table with the pin-verification contract test).
33. **KYC upload cap 5 MB** (hex-encoded bytea ≈2× through the neon-http transport; stays
    inside Neon HTTP request limits); boundary exercised by an implementation test and a
    deploy smoke step.
34. **Production boot guards in env.ts:** refuse non-EU Neon hosts (ER-RES-1) and refuse the
    dev `MOCK_WEBHOOK_SECRET` (or unset) while `TELEPHONY_PROVIDER=mock` in production.
35. **Local Postgres image bumped to `postgres:17-alpine`** (design.md §1's repo-layout
    comment says "Postgres 16"; the build environment ships 17-alpine pre-pulled). No
    schema/behaviour impact; `docker-compose.yml` pins 17-alpine.
36. **shadcn/ui support libraries added** (`clsx`, `tailwind-merge`, `class-variance-authority`,
    `@radix-ui/react-slot`, `lucide-react`): required transitively by the shadcn/ui component
    pattern decisions.md #3 already committed to; not separately named in the pre-warmed
    package list but the same design choice, not a new one.
37. **`GET /api/calls/:id` and `GET /api/kyc/documents/:id` are part of the pinned API
    surface:** design.md §7's route table has no documented by-id GET route for either
    resource; org-scoping.contract.test.ts's cross-org-404 cases assume these two routes.
    This closes a table omission — it is not an open implementation choice.
38. **MockTelco's wire format uses `kind`, not `do`:** design.md §4.4's example reject
    body (`{do:'reject',cause:'busy'}`) is documentation shorthand, not a literal wire
    requirement. The neutral `CallInstruction` type's canonical, typed discriminant is
    `kind`; `tests/helpers/telco.ts` renders/parses `kind` and every contract test
    reads `instruction.kind` (tests/helpers/README.md).
39. **`anomaly_flagged` fires synchronously at rejection time, not only from the nightly
    job:** the invalid-webhook-signature counter trips its alert threshold inline as
    signatures are rejected (rate-limits.contract.test.ts, "invalid webhook signatures
    increment a counter that trips the alert threshold"); design.md §9.9's daily job
    scan is a second, additional source of the same `anomaly_flagged` audit-event type
    (volume/night/CZ-failure-share thresholds), not the only one.
40. **Rate-limit "per IP" identifier:** `X-Forwarded-For` in dev/test (the only IP
    signal available to an in-process `app.request()` call — tests/helpers/README.md);
    in production, `CF-Connecting-IP` is preferred when present (Cloudflare's
    platform-verified origin-IP header, not client-forgeable at the edge), falling back
    to `X-Forwarded-For` when absent.
41. **Better Auth session cookie: `Secure` forced via `advanced.cookies.session_token.attributes`,
    not `useSecureCookies: true`** (refines #31). Better Auth 1.6.23's `useSecureCookies` also
    prepends a `__Secure-` name prefix (browser cookie-prefix convention), which would rename the
    cookie to `__Secure-telocc.session_token` — breaking the exact `telocc.session_token` name
    pinned by the contract tests. Forcing the `secure` attribute directly (leaving
    `useSecureCookies` unset) gets the same outcome #31 describes — `Secure` present
    unconditionally, identical across environments — without the name change.
42. **Magic-link token TTL/reissue-invalidation implemented alongside Better Auth, not purely
    inside it** (design.md §6/§9.4). Better Auth computes `verification.expiresAt` from the real
    system clock with no injectable `now`, so it can't be made to respect the contract-test fake
    clock (`deps.now`); and this Better Auth version's magic-link plugin does not invalidate a
    previously issued, unused token when a new one is issued for the same email. `apps/api/src/
    lib/auth.ts` closes both gaps itself: `storeToken` uses a custom SHA-256 hasher (so the exact
    hash is known), `sendMagicLink` stamps the verification row's `value` JSON with our own
    `issuedAt` (per `deps.now()`), and the `/magic-link/verify` route pre-checks that stamp before
    ever calling into Better Auth's handler; `/sign-in/magic-link` deletes any prior unconsumed
    verification row for the same email before issuing a new one. In production `deps.now` is the
    real clock, so this is simply a second, consistent way of tracking the same thing — no
    behavioural difference from relying on Better Auth alone.
43. **`core/verification.ts` never imports `@telocc/i18n` directly:** design.md §1 states core
    depends only on `db` + `telephony` (types only); `issuePhoneVerification` instead takes an
    injected `renderSmsBody(pin): string` callback, and `apps/api/src/routes/verifications.ts`
    (which already depends on `@telocc/i18n`, same as `lib/auth.ts`) supplies it by composing
    the new `verification.smsCodeIntro`/`smsExpiryNotice` en.ts keys around the PIN — SMS copy
    still goes through i18n (design.md §11) without widening core's dependency surface. The same
    module's `confirmPhoneVerification` takes a narrower `BaseVerificationDeps` (`db`/`now`/
    `pepper`, no `sendSms`/`renderSmsBody`) since confirmation never sends anything.
44. **M4 webhook route implements a minimal inline inbound (customer → business number) flow**
    (office-hours + verified-number gating, `call_sessions` bookkeeping, `call.completed`
    finalization per design.md §5.0) directly in `apps/api/src/routes/webhooks.ts`, rather than
    waiting on `core/routing/inbound.ts`/`core/office-hours.ts`/`core/call-log.ts` — those remain
    M5/M6 stubs and are outside M4's file list. It never creates a `dialin`-kind `call_sessions`
    row (that entry condition is M6's dial-policy/dialin machine), so `call.dtmf` is always
    acked-and-ignored under this milestone. M5/M6 will likely refactor this file to delegate to
    their state machines once those land.
45. **`provisioning.update` webhook resolves a `business_numbers`/bundle row by a `number_<id>` /
    `bundle_<id>` fallback** when the stored `provider_number_ref`/bundle ref is `NULL` (e.g. a
    fixture-seeded number that never went through `provisionNumber`) — `provisioning.contract.
    test.ts`'s "rejected bundle" case sends exactly this `numberRef` shape when the fixture number
    has no stored ref, so this fallback is required for that case to resolve at all, not just a
    convenience.
46. **`packages/telephony/src/mock/{provider,telco}.ts` use Web Crypto (`crypto.subtle`), not
    `node:crypto`** — same Workers-bundle-safety rationale already applied to
    `twilio/signature.ts` (design.md "Runtime duality", §1); `packages/telephony`'s tsconfig has
    no Node types, so `node:crypto`/`Buffer` do not typecheck there regardless of runtime target.
47. **`/dev/sim/*` drives `MockTelco` against a standalone instance of `webhooksRoutes(deps)`**
    (constructed fresh inside `devRoutes(deps)`), not a circular reference to the fully-assembled
    top-level app — the top-level app does not exist yet at the point `deps`/`devRoutes` are
    built, and Hono sub-apps are independently `.request()`-able, so this still exercises the
    exact same signature-verification/parse/route code the mounted `/webhooks` router uses
    (decisions.md #21's "always enters through the real signed webhook endpoint").
48. **Invalid-webhook-signature alert threshold = 10 per 10-minute window** (`apps/api/src/
    routes/webhooks.ts`): design.md names no concrete number (only the unrelated nightly
    `ANOMALY_*` thresholds), and rate-limits.contract.test.ts's own header comment calls the
    exact value "an M4/M8 implementation decision" — the counter is a fixed-window row in
    `rate_limit_counters` (scope `webhook_invalid_signature`, a constant "global" identifier,
    since the payload isn't yet trustworthy pre-verification) written on every `verifyWebhook`
    failure; `anomaly_flagged` fires once when the count first crosses the threshold
    (decisions.md #39).
49. **Discovered defect in `provisioning.contract.test.ts`'s own local `ownerWithoutKyc()`
    helper** (not a file this milestone may edit — testing.md: contract-test fixes go through
    the architect/orchestrator): it logs in and creates an org row via `createOrgFixture`, but
    never creates the matching `memberships` row, so every subsequent API call made with its
    `cookieHeader` hits `requireOrg` and 403s with `no_org` before reaching any KYC/catalog/
    provisioning logic — regardless of what those routes do. Confirmed by re-running the exact
    same steps with a `createMembershipFixture(...)` call added: `PUT /api/kyc`, `GET /api/
    numbers/catalog`, `POST /api/numbers/provision`, and `GET /api/business-number` all then
    behave exactly as the three affected test cases ("the catalog returns only numbers…", "KYC
    rejects a PO-box…", "the mock auto-approves…") expect. This affects 3 of
    `provisioning.contract.test.ts`'s 9 cases; a 4th ("number release on account deletion…")
    separately depends on `POST /api/account/delete`, which is M8's `routes/dsr.ts` (unmounted
    until M8 lands) — `packages/core/src/repos/numbers.ts::releaseOrgBusinessNumbers` is added
    now as the ready-to-call, PII-free (`org_id: null`, last-4-only meta) helper M8's route
    should use.
50. **M5 refactor:** M4's inline inbound-routing/finalization flow (decisions.md #44) is now
    delegated to `packages/core/src/{office-hours.ts,routing/inbound.ts,call-log.ts}` —
    `isOpen`/`validateOfficeHoursInput` (office-hours), `decideInboundIncoming` (the pure §5.1
    decision), `deriveLegRecordUpdate`/`deriveFinalization` (the shared §5.0 record/finalize
    logic both machines will use), `writeTerminalCall` (the sole `calls` writer). `webhooks.ts`
    is now a thin adapter: I/O (loading business number/org/membership/rules/session, applying
    session/`calls` writes) around these pure functions. One pitfall found while doing this:
    `calls.provider_call_ref`'s unique index is **partial** (`WHERE provider_call_ref IS NOT
    NULL`); `drizzle`'s `.onConflictDoNothing({ target: calls.providerCallRef })` emits a plain
    `ON CONFLICT (provider_call_ref) DO NOTHING` with no `WHERE` clause, which Postgres rejects
    outright ("no unique or exclusion constraint matching the ON CONFLICT specification") since
    it doesn't match a partial index's arbiter — `writeTerminalCall` uses a plain `INSERT`
    instead, relying on the pre-existing convention (the webhook route's outer catch-all, §4.3
    "never a 5xx") to swallow the resulting constraint-violation on redelivery, exactly as M4's
    inline version already did.
51. **Discovered defect in `tests/helpers/fixtures.ts`'s `createReadyOrg()`** (not a file this
    milestone may edit): its default `businessNumberE164` is the fixed literal
    `'+420212345678'`, but `business_numbers.e164` is globally unique (design.md §3.2) — any
    test calling `readyOrg()`/`createReadyOrg()` twice without an explicit distinct
    `businessNumberE164` override collides on insert with a raw `23505` duplicate-key error
    before any route code runs. This affects 5 of `org-scoping.contract.test.ts`'s 7 cases (all
    but the two already excluded by M5's `-t` filter) and `call-log.contract.test.ts`'s
    "filters by direction and date range are org-scoped" case. Confirmed by temporarily
    randomizing the default locally (reverted, not committed): with that one change alone, "an
    owner fetching their own KYC document by id…" and "the business-number route returns only…"
    pass outright, and (combined with #52 below) so do the other two affected cases.
52. **Also discovered while investigating #51:** two `org-scoping.contract.test.ts` cases ("an
    owner fetching their own call by id…", "webhook-driven writes land on the org owning the
    called business number") drive only `ctx.telco.incomingCall(...)` — never `.completed(...)`
    — against a `readyOrg()` fixture (`officeHoursMode: 'always_open'`), then assert a `calls`
    row already exists. Per design.md §5.0/§5.1 and decisions.md #19, a forwarded (non-declined)
    call only gets its one `calls` row at `call.completed` finalization; a bare `call.incoming`
    correctly leaves it in-flight in `call_sessions` (state `forwarding`) with no `calls` row
    yet — this is the write-once-at-terminal-state model working as designed, not a routing
    bug. Confirmed by temporarily adding the missing `.completed(...)` calls locally (reverted,
    not committed): both cases then pass cleanly against this milestone's routes.
53. **Also discovered while investigating #51/#52:** `org-scoping.contract.test.ts`'s "every
    authenticated GET route…" case asserts `GET /api/me`'s JSON body exposes `orgId` at the top
    level (`meBody.orgId`). `apps/api/src/routes/me.ts` (M2's file, not in M5's file list)
    currently returns `{ user, org }` with no top-level `orgId`. A one-line addition
    (`orgId: membership?.orgId ?? null`) to that route's response would close this — flagged
    for the orchestrator/M2 owner rather than fixed here, since `me.ts` is outside this
    milestone's touchable files.
54. **M6 "remaining daily outbound minutes" reset boundary:** design.md §5.2/decisions.md #12
    pin the *arithmetic* (cap minus minutes already consumed today) but not what "today" means.
    Implemented as the current UTC calendar day (`Date.UTC(now.getUTCFullYear(), ...)`), summing
    `durationSeconds` of the org's `answered` outbound `calls` rows with `startedAt` on/after
    that boundary — not org-timezone-aware like office hours (design.md §8), since no test
    exercises a midnight/DST boundary; flagged as a candidate for an explicit design.md pin if a
    later milestone needs the org-local definition.
55. **M6 dial-in hourly attempt cap** uses the same fixed-window `rate_limit_counters` mechanism
    as the existing invalid-webhook-signature counter (decisions.md #48), keyed per-org
    (`dialin_attempt org:<id> window:<start>`, 3600s windows) rather than a sliding window —
    consistent with the existing precedent, sufficient for the frozen cap+1 test (which never
    crosses a window boundary), not pinned by design.md.
56. **M6 structural concurrent-bridge cap (decisions.md #29) correctly conflicts on
    `dialin-outbound.contract.test.ts`'s "entering 9 digits without prefix normalises to +420;
    00420-prefixed input normalises to the same target" case:** that case drives two full
    dial-in→bridge flows against one shared `readyOrg()` fixture but never sends
    `ctx.telco.completed(...)` for the first call, so its `call_sessions` row is still in
    `state='bridging'` (matching `call_sessions_one_active_dialin_per_org`'s partial predicate,
    which — correctly per decisions.md #29 — includes `bridging`) when the second call's INSERT
    runs; the second `incomingCall` is (correctly) rejected busy/`concurrent_bridge` before DTMF
    collection ever starts, so its `dtmf(...)` call finds no session and the test's `bridge`
    assertion fails. Confirmed by temporarily adding the missing `ctx.telco.completed({ callRef:
    callRef1, durationSeconds: 1 })` between the two calls locally (reverted, not committed):
    the case then passes outright. Not a routing bug — weakening the structural cap to
    accommodate this would silently reopen the concurrent-bridge safety property the
    "second simultaneous dial-in…" and "(cap+1)-th dial-in…" cases in the same file pin. Flagged
    for the orchestrator/M1 test-suite owner; `tests/contract/**` is out of this milestone's
    touchable files.
57. **M6 discovered the same class of fixture defect as #51, this time in `personalNumberE164`:**
    `tests/helpers/fixtures.ts`'s `createReadyOrg()` defaults `personalNumberE164` to the fixed
    literal `'+420777123456'` for every org unless overridden (unlike `businessNumberE164`,
    which is randomized by default — see #51's fix note there). `personalNumberE164` has no DB
    uniqueness constraint, so two `readyOrg()` calls with no override silently produce two orgs
    with the *identical* verified personal number. This breaks
    `org-scoping.contract.test.ts`'s "org B's verified number dialling org A's business number
    gets customer treatment, not dial-in" case (M6-owned, `-t 'dial-in'`): since org B's number
    literally equals org A's own verified number in the fixture data, design.md §5.2's exact
    E.164 match (ER-CLI-1) correctly treats the call as *org A's own* dial-in entry — passing it
    to `collectDigits`, not `forward` — which is the only correct behaviour given that shared
    literal, not a routing bug. The same collision also spuriously satisfies (rather than
    exercises) the personal-number-leak assertions in "every authenticated GET route…" and
    "export contains only…" (both `/api/export`, M8 scope). Confirmed by temporarily randomizing
    the default (matching #51's fix shape) locally (reverted, not committed): the dial-in case
    passes cleanly against this milestone's routes. Flagged for the orchestrator/M1 test-suite
    owner; `tests/helpers/fixtures.ts` is out of this milestone's touchable files.
58. **M8 confirms #57 also accounts for its two `/api/export` org-scoping cases** ("every
    authenticated GET route…", "export contains only the caller's org's rows"): both assert
    `!exportText.includes(orgB.personalNumberE164)` against a `readyOrg()`-fixtured org A whose
    export legitimately contains *its own* verified number — which, per #57, is the identical
    literal `'+420777123456'` org B also got by default. `buildAccountExport` (`packages/core/
    src/dsr.ts`) is correctly org-scoped throughout (every read takes `orgId`/`userId` first);
    confirmed by temporarily overriding `personalNumberE164` per `readyOrg()` call locally
    (reverted, not committed) — both cases then pass outright. Not re-flagging as a new defect;
    recorded here only so M8's report doesn't read as a second, independent bug.
59. **`packages/core/src/retention.ts`'s `runScheduledJobs` takes a locally-declared
    `ScheduledJobsEnv` (the four `RETENTION_*`/`ANOMALY_*` numeric fields it reads), not
    `apps/api/src/env.ts`'s `Env`:** `packages/core` must never import from `apps/api` (design.md
    §1 layering — the reverse dependency direction is the only one that exists). Structural
    typing means the real `Env` satisfies this interface without a cast; the contract test's own
    frozen 4-arg cast (`retention-purge.contract.test.ts`'s header comment, tests/helpers/
    README.md) bypasses assignability checks entirely regardless, so this has no effect on it.
60. **`apps/api/src/jobs/scheduled.ts` is a thin `runScheduledJob(deps)` wrapper**, not a second
    copy of the purge logic: all steps 1–7 (design.md §10.1) plus the §9.9 anomaly scan live in
    `packages/core/src/retention.ts` (imported directly by the contract test); the wrapper only
    supplies `deps.{db,provider,env,now}` and logs the outcome via `safeLog` (counts only) so
    `entry.workers.ts`'s `scheduled()`, `entry.node.ts`'s 24h interval, and `scripts/
    run-jobs.mjs` share one call site instead of three.
61. **`eraseAccount` (`packages/core/src/dsr.ts`) calls `provider.releaseNumber` directly, in
    addition to calling `repos/numbers.ts`'s pre-existing `releaseOrgBusinessNumbers`:**
    `releaseOrgBusinessNumbers` only invokes the seam's `releaseNumber` when a number already has
    a stored `providerNumberRef` (skipping the provider call, but still writing the required
    PII-free `org_id: null` lifecycle audit event, for a directly-fixtured number with none) —
    correct for its own contract (`provisioning.contract.test.ts`'s "number release on account
    deletion" case only asserts the audit event exists). `dsr.contract.test.ts`'s "deletion calls
    releaseNumber and deleteCallRecord… for every provider call ref" case additionally asserts
    `provider.releaseNumber` was actually invoked, against a `createReadyOrg()`-fixtured business
    number that (like every such fixture) has no `providerNumberRef` set. `eraseAccount` closes
    this by attempting release for every releasable number first, using the same `number_<id>`
    fallback convention `repos/numbers.ts` already documents for resolving such rows by id, then
    still calling `releaseOrgBusinessNumbers` for the audit trail — best-effort, so a real
    provider's redundant second release attempt (a 404) is swallowed the same way a missing
    number would be.
62. **`scripts/esd-report.ts` and `scripts/run-jobs.impl.ts` wrap their bodies in an `async
    main()` rather than using top-level `await`:** both scripts are executed directly by `tsx`
    (`node_modules/.bin/tsx scripts/….ts`, per `posture-flip.contract.test.ts` and `scripts/
    run-jobs.mjs`'s `spawnSync`), and since the repo root has no `"type": "module"`, `tsx`/esbuild
    transforms them as CommonJS — which esbuild refuses for top-level `await` outright
    ("Top-level await is currently not supported with the \"cjs\" output format"). This was
    already latent in the M0 stub of `run-jobs.impl.ts` (`const result = await
    runScheduledJobs();` at module scope) before this milestone gave it a real `DATABASE_URL`
    connection to open; `scripts/esd-report.ts`'s M0 stub had no async code at all, so the defect
    only surfaced once M8 added the real query. Both scripts now also explicitly close their
    `pg.Pool` (`db.$client.end()`) at the end of `main()` so the process exits instead of hanging
    on the pool's open socket — the M0 stub's `run-jobs.impl.ts` never opened a real connection,
    so this need didn't previously exist either.
63. **`scripts/esd-report.ts` strips a leading `--` from `process.argv` before calling
    `node:util`'s `parseArgs`:** the documented invocation (`pnpm report:esd -- --year 2026
    --half 1`, milestones.md M8 done-when) forwards that literal `--` token as npm/pnpm's "extra
    args" separator; `parseArgs` treats it as the POSIX end-of-options marker and, without
    `allowPositionals: true`, throws `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL` on the first flag
    after it. Filtering out any `--` token keeps both that invocation and a direct `tsx
    scripts/esd-report.ts --year 2026 --half 1` call working identically.
64. **M11 adds `compatibility_flags: ["nodejs_compat"]` to `apps/api/wrangler.jsonc`,
    correcting #28's "no compatibility flag needed" claim:** #28 and design.md §1/§13 held
    on the premise that only the per-entry DB driver split mattered for Workers-bundle
    safety. Since M0, `packages/core/src/verification.ts`, `apps/api/src/lib/auth.ts`,
    `apps/api/src/routes/webhooks.ts`, and `apps/api/src/middleware/rate-limit.ts` all began
    importing `node:crypto` (HMAC/hash for PIN, magic-link, webhook, and rate-limit keys),
    and Better Auth's own dependency tree imports `node:async_hooks` — `wrangler deploy
    --dry-run` only ever *warned* about this (exit code 0), never failing the milestone
    gates that ran it, so the drift went unnoticed until M11's review. Without the flag,
    auth, webhooks, and rate limiting — i.e. most of the app — would throw at request time
    on real Workers despite a green dry run. The flag is free at this
    `compatibility_date` (no other behavioural change); re-running `wrangler deploy
    --dry-run` afterward confirms both the gate stays green and the warnings disappear.
65. **`apps/api/src/deps.ts`'s `buildProvider()` still has no `twilio` branch — an M11
    finding, deliberately not fixed here** (`deps.ts` is outside M11's file set):
    `TELEPHONY_PROVIDER=twilio` currently falls back to `notImplementedProvider`, which
    throws on every seam call. `docs/deploy.md` §10 step 0 documents the exact
    composition-point change required (construct `TwilioProvider` from
    `@telocc/telephony/twilio`) as a mandatory prerequisite before ever setting that env
    var for real — flagged for whoever executes the mock→Twilio flip.
66. **`TwilioProviderConfig.smsFrom` (`packages/telephony/src/twilio/config.ts`) has no
    corresponding `apps/api/src/env.ts` variable yet:** a Twilio-owned E.164 sender number
    for SMS-PIN delivery, deliberately distinct from any org's business number (design.md
    §6: verification can run before a business number exists). Adding it (e.g.
    `TWILIO_SMS_FROM`) is a prerequisite for writing #65's `buildProvider` twilio branch;
    noted in `docs/deploy.md` §10 step 0 rather than added to `env.ts` here, since that
    file is outside M11's scope.
67. **#65/#66 closed by the orchestrator:** `deps.ts` now constructs `TwilioProvider` for
    `TELEPHONY_PROVIDER=twilio` (mechanical composition; M9's tests cover behaviour),
    `env.ts` gained `TWILIO_SMS_FROM` plus a boot guard requiring all three TWILIO_*
    values in twilio mode, and deploy.md's "step 0 code change" section was replaced by
    configuration-only instructions — the brief's "only credentials and a number stand
    between this and live calls" now holds literally.

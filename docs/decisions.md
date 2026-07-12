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

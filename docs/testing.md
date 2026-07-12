# Telocc — Test Strategy

Three layers, per the brief:

1. **Contract layer** (`tests/contract/`) — human-readable executable spec, written FIRST from the brief + ERs, before implementation. **Off-limits to implementing workers**: no implementing milestone may edit these files; if a contract test is wrong, the fix goes through the architect/orchestrator and gets a one-line note in `docs/decisions.md`.
2. **Implementation layer** — co-located `*.test.ts` in packages/apps; freely written, rewritten, and deleted by whoever owns the code.
3. **E2E** (`e2e/`) — Playwright against the demo stack (real browser, real Node API, dockerized Postgres, mock provider + simulator).

## How contract tests run

- Vitest, workspace project `tests/contract`, `pool: 'forks'`, sequential per file.
- Each file boots the real Hono app **in-process** via `tests/helpers/app.ts` → `buildApp({ db, provider: mockProvider, email: captureMailbox, env: testEnv, now: fakeClock })` against dockerized Postgres (template-database reset per file; truncate per test).
- Telephony is driven through `tests/helpers/telco.ts` (`MockTelco`): it POSTs **signed** webhook payloads to `app.request('/webhooks/telephony/mock', …)` and steps the call state machine synchronously — the full production path (signature → parse → route → instruction) is exercised, never internal shortcuts.
- Time is injectable (`now()` dep) — TTL/retention/office-hours tests never sleep.
- The whole suite: `pnpm test:contract`. Individual file: `pnpm vitest run tests/contract/<file>`.
- Until a feature milestone lands, its contract tests fail; CI tracks the pass-count ratchet per milestone (see `docs/milestones.md` done-when gates). Contract tests are written as real assertions from day one — no `test.todo`.

---

## The contract layer — file by file

### `auth.contract.test.ts` — magic-link boundaries (ER-SEC-2, ER-RATE-1)
- "requesting a magic link for an unknown email returns the same response as for a known email" (enumeration safety)
- "a magic link logs the user in exactly once — the same token is rejected on second use"
- "a magic link older than 15 minutes is rejected"
- "issuing a new magic link invalidates the previous unused one"
- "magic-link tokens are stored hashed — the raw token never appears in the database"
- "a 4th magic-link request for the same email inside 15 minutes returns 429"
- "an 11th magic-link request from the same IP inside an hour returns 429"
- "the session cookie is HttpOnly, Secure, SameSite=Lax"
- "unauthenticated requests to every /api route except auth and org-creation preflight return 401"

### `org-bootstrap.contract.test.ts` — first login → org (ER-B2B-1, roles seam)
- "a first-time user has no org and every org-scoped route returns 403/redirect-to-onboarding shape"
- "creating an org without the business-capacity declaration is rejected by validation"
- "creating an org stores the declaration timestamp and declaration version"
- "a user can create at most one org"
- "the creator's membership has role owner"
- "org name is required, 1–120 chars"

### `pin-verification.contract.test.ts` — SMS-PIN flow (ER-SEC-3, ER-RET-3, ER-EMG-3)
- "requesting verification sends a 6-digit PIN via the telephony seam to the given number"
- "the PIN is stored only as an HMAC hash — the digits never appear in the database"
- "the correct PIN within TTL verifies the number and records verified_at"
- "verification deletes the challenge row (not merely flags it)"
- "the 5th wrong attempt invalidates the challenge; the correct PIN no longer works after that"
- "a PIN older than 10 minutes is rejected"
- "a resend inside the 60-second cooldown returns 429"
- "the 6th SMS to one phone number in a day returns 429"
- "the 11th SMS for one org in a day returns 429"
- "changing the personal number requires a fresh verification — the old number stays active until the new one is confirmed"
- "verifying records the emergency-limitation acknowledgment timestamp"
- "PIN issuance and failed attempts appear in audit_events without any PIN value"

### `webhook-auth.contract.test.ts` — provider callbacks (ER-WEB-1)
- "an unsigned webhook is rejected with 401 before any state changes"
- "a webhook with a wrong signature is rejected with 401 and counted in audit_events"
- "a webhook with a valid signature but a timestamp older than 5 minutes is rejected" (mock scheme)
- "a correctly signed webhook is accepted and processed"
- "a signed webhook with a malformed payload returns 400 and changes nothing"
- "a webhook naming an unknown business number is acknowledged but ignored (no session, no log row)"
- "redelivering the same completed-call webhook twice writes exactly one call row"
- "an event for a callRef that never existed (or whose session was already finalized) is acknowledged 200, changes nothing, and is counted in audit_events" (design §4.3 late/unknown-callRef rule)
- "a completed-call webhook redelivered after the 4-hour session sweep creates no new call row and returns 200"
- "a webhook for the wrong provider path returns 404"

### `office-hours.contract.test.ts` — the routing matrix (ER-CLI-2b)
Pure `isOpen` matrix plus full-path routing:
- "always_open forwards at 3 a.m. Sunday"
- "always_closed declines with busy at noon Wednesday"
- "schedule mode: call at 08:59:59 local is declined, at 09:00:00 forwarded, at 16:59:59 forwarded, at 17:00:00 declined" (boundary minutes)
- "a weekday with no rule is closed all day"
- "evaluation uses the org timezone: 08:00 UTC is in-hours for Europe/Prague 9–17 in winter (09:00 local) — and the same instant maps correctly across the March and October 2026 DST transitions"
- "a non-Prague timezone org evaluates in its own zone"
- "out-of-hours the number still responds: the decline is a busy instruction, never an unrouted/dead number"

### `inbound-routing.contract.test.ts` — customer calls (§5.1, ER-AUD-1)
- "in-hours inbound call produces a forward instruction to the verified personal number with the business number as caller ID"
- "the forwarded-leg caller ID is never the original caller's number" (ER-CLI-2a)
- "out-of-hours inbound call is declined busy and logged declined/out_of_hours with caller CLI and business number"
- "inbound call to an org with no verified personal number is declined busy and logged declined/no_verified_number"
- "answered forwarded call logs answered with the provider-reported duration"
- "the caller hanging up first **after** an answered forward logs exactly one answered row with the talk duration" (the most common real pattern — Twilio's Dial action callback never fires here; the child-leg answered signal must carry it, design §4.4/§5.0)
- "unanswered forward (no_answer) logs missed with zero duration"
- "callee busy logs missed"
- "provider failure on the forward leg logs failed with the provider error code"
- "caller hanging up while ringing logs missed/caller_hangup"
- "a delayed leg callback delivered after call.completed already finalized the row is acknowledged and ignored — the final row is still correct" (order tolerance, design §5.0)
- "a caller with withheld CLI is routed as a normal customer call"
- "every terminal state writes exactly one call row and the row is never updated afterwards"

### `dialin-outbound.contract.test.ts` — the appless bridge (§5.2, ER-CLI-1, ER-RATE-2)
- "a call from the verified personal number is answered with a beep and DTMF collection — not forwarded"
- "the verified match uses provider signalling CLI, exact E.164 — a near-miss number (one digit off) gets customer treatment"
- "dial-in works out of hours" (outbound not gated)
- "an unverified caller can never reach DTMF collection" (unverified-caller failure path)
- "entering a valid CZ mobile number bridges with the business number as caller ID"
- "entering 9 digits without prefix normalises to +420; 00420-prefixed input normalises to the same target"
- "the bridge instruction carries a max duration equal to the org's remaining daily outbound minutes"
- "either leg hanging up ends both legs and logs one answered outbound row with duration, initiator, source CLI and target" (both-legs-drop, ER-AUD-1 fields)
- "the initiating caller hanging up first after an answered bridge logs exactly one answered outbound row with duration" (answered-signal at pickup, design §4.4/§5.0)
- "target busy/no-answer logs missed"
- "caller hangup while the target is still ringing logs missed/caller_hangup"
- "DTMF inactivity timeout hangs up and logs failed/inactivity_timeout"
- "caller hangup during collection logs failed/caller_hangup"
- "invalid digits get the refusal tone and log failed/invalid_target — no retry, no second gather"
- "a second simultaneous dial-in is rejected busy and logged blocked/concurrent_bridge"
- "the (cap+1)-th dial-in within an hour is rejected and logged blocked/rate_limited"
- "with the daily minutes cap exhausted, dial-in is rejected and logged blocked/daily_cap_reached"
- "dialling the business number itself or the own personal number is refused as invalid_target"

### `emergency-refusal.contract.test.ts` — ER-EMG-1/2 (safety-critical)
- "each of 112, 150, 155, 156, 158 gets the distinct refusal tone and a call row with status emergency_refused"
- "no dial/bridge/forward instruction is ever rendered for an emergency number" (seam spy asserts zero dial-capable instructions)
- "emergency numbers with terminator variations (112#) are still refused"
- "other short codes (e.g. 1188) are refused and logged destination_blocked/short_code"
- "a premium-rate prefix from the seeded deny table (+420 90x) is refused and logged destination_blocked/premium"
- "an international target (0044…) is refused and logged destination_blocked/international"
- "the refusal is audible, not silent: the rendered instruction is refuseTone, never bare hangup"
- "emergency refusal rows are never silent failures — reason and timestamps are populated"

### `call-log.contract.test.ts` — the record itself (ER-AUD-1)
- "the log lists inbound and outbound calls newest-first with timestamp, direction, duration, status"
- "outbound rows record the initiating user; inbound rows do not"
- "there is no API route that updates or deletes an individual call row"
- "pagination returns stable cursors and no cross-page duplicates"
- "filters by direction and date range are org-scoped"
- "a full inbound+outbound demo sequence produces log rows matching the terminal-state table in design §5.3, field for field"

### `org-scoping.contract.test.ts` — tenant isolation
Two orgs seeded with full data (numbers, calls, KYC, hours):
- "every authenticated GET route returns only the caller's org's data" (route sweep)
- "fetching another org's call/document/number by id returns 404, not 403"
- "org B's verified number dialling org A's business number gets customer treatment, not dial-in" (cross-org CLI must not match) *(gated in M6 — needs the dialin machine)*
- "export contains only the caller's org's rows" *(gated in M8 — needs the DSR routes)*
- "webhook-driven writes land on the org owning the called business number"

### `rate-limits.contract.test.ts` — abusable surfaces (ER-RATE-1)
- "magic-link, PIN-issue, and PIN-confirm limits return generic 429 bodies with no identifier echo"
- "limits are per-identifier: a second email/phone/IP is unaffected"
- "the window resets: after the fixed window passes, requests succeed again" (fake clock)
- "rate-limit counter keys store no raw identifier (only hashes) in the database"
- "invalid webhook signatures increment a counter that trips the alert threshold" *(gated in M4 — needs the webhook route + signature middleware)*

### `retention-purge.contract.test.ts` — the scheduled job (ER-RET-1..3)
- "calls older than the retention window are anonymised: both numbers, initiator and provider refs stripped; timestamps, direction, duration, status kept"
- "calls inside the window are untouched"
- "security audit events older than 90 days are deleted; lifecycle events survive until the call-log window"
- "expired magic-link hashes and PIN challenges are deleted"
- "expired rate-limit counters are deleted"
- "call sessions stuck for over 4 hours are finalized as failed/session_expired and removed"
- "the run writes a purge_runs row with counts only — no personal data"
- "running the job twice in a row is a no-op the second time" (idempotence)
- "retention windows come from config: shortening the window and re-running purges accordingly"

### `dsr.contract.test.ts` — export & erasure (ER-DSR-1/2)
- "the JSON export contains account email, verified number, settings, office hours, business-number details, KYC record and the full call log"
- "the CSV export has one row per call with the documented columns"
- "deletion requires the exact org name as confirmation"
- "deletion removes every org-scoped row across all tables and the auth user, in one pass" (table-by-table zero-count sweep)
- "deletion calls releaseNumber and deleteCallRecord on the provider for every provider call ref"
- "deletion writes a tombstone containing counts only"
- "the session is invalid after deletion"
- "the other org's data is untouched by a deletion" (paired with scoping)

### `provisioning.contract.test.ts` — number lifecycle (ER-KYC-1..3)
- "the catalog is unavailable until the KYC end-user record is complete"
- "the catalog returns only numbers whose area code matches the requested region (Prague default)"
- "KYC rejects a PO-box street address and a non-CZ country"
- "provisioning transitions requested → … → active only via seam events/polls, never via a direct API write"
- "a rejected bundle surfaces status rejected with the provider reason"
- "the mock auto-approves so a fresh org reaches active synchronously in the demo path"
- "with capability czCliDomesticTermination='unverified', the business-number response carries the deliverability warning flag"
- "number release on account deletion records a lifecycle audit event"
- "a second active business number for the same org is impossible" (partial unique)

### `security-headers.contract.test.ts` — headers & cookies (ER-COOK-1 API half)
- "every API response carries CSP default-src 'self', nosniff, frame-ancestors 'none', referrer-policy"
- "no Set-Cookie other than the Better Auth session cookies is ever issued"
- "dev routes return 404 when ENABLE_DEV_ROUTES is off" (production gate)

### `posture-flip.contract.test.ts` — ER-POST-1
- "under posture app_layer, onboarding has no contract-summary step"
- "under posture nbics_provider, org creation requires the § 63a summary + waiver and records both timestamps"
- "the ESD report script produces per-direction calls and minutes with 30 June / 31 December cutoffs, including from anonymised rows" (ER-AUD-3)

### `seam-isolation.contract.test.ts` — the architectural invariant
- "no file in packages/core or apps/api (except deps.ts) imports twilio or @telocc/telephony/twilio" (static import scan)
- "no provider-specific identifier (TwiML, CallSid) appears outside packages/telephony" (static scan)
- "route files import repos, not the db package directly" (org-scoping convention scan)
- "the redacting logger is the only logger imported in webhook and auth handlers" (ER-SEC-4 scan)
- "billing-dormant tables accept a well-formed invoice with sequential numbering and reverse-charge legend, and the turnover counter compares against both CZK thresholds" (ER-BILL-1 — exercised only here)

---

## Implementation-test layer (freely rewritten)

Owned by each milestone's implementer; no stability promise. Expected clusters:

- `packages/core`: unit tests for `dial-policy` normalisation table, `office-hours` internals, state-machine transition functions (pure, table-driven).
- `packages/telephony/mock`: MockTelco determinism, signing helper, and timeline fidelity (`call.leg answered` fires at pickup before any completion event; `call.completed` fires for every call — design §4.4 timeline-fidelity rule, also pinned by the conformance spec below).
- `packages/telephony/twilio` (M9): signature verification against Twilio's documented test vectors; TwiML rendering snapshots for every `CallInstruction`; fixture webhook payloads → neutral events (initial call, Gather action, Dial action, status callback, bundle callback); request-shape tests for `sendSms`/`searchNumbers`/`submitBundle`/`provisionNumber`/`deleteCallRecord` against recorded fixtures with a stubbed fetch — **no network, no live account**. A shared **provider-conformance spec** (`packages/telephony/src/conformance.ts`) runs fully against the mock and, for the parse/render/sign subset, against the Twilio adapter offline.
- `apps/api`: route-level tests for validation edges and error shapes, incl. a KYC document upload at the exact 5 MB boundary through the real route (accepted) and just over (rejected) — design §3.2 transport rationale.
- `packages/db`: migration snapshot sanity (`drizzle-kit generate` produces no diff on a clean tree).

## E2E scope (Playwright, `e2e/`)

Runs against the demo stack (Playwright `webServer` boots API + web with a dedicated dockerized DB and seeds; same code path as `pnpm demo`). Chromium only.

1. **Login journey:** request magic link as a new user → open link from dev mailbox → onboarding: org + declaration → PIN verify (simulator SMS outbox, emergency disclosure visible and acknowledged) → KYC → pick Prague number → dashboard shows active number.
2. **Inbound flows:** simulator "incoming call" in-hours → call-log row `answered` appears; switch to always_closed → "incoming call" → row `declined`.
3. **Appless outbound:** simulator dial-in → keypad enters a CZ number → state panel shows collect → bridge → hang up callee → both legs drop → row `answered (outbound)` with duration.
4. **Emergency refusal:** dial-in → keypad 112 → refusal tone state → row `emergency_refused`. (The demo walkthrough promise.)
5. **Settings:** edit office hours and see routing change; re-verify personal number flow.
6. **DSR:** download JSON + CSV export; delete account with name confirmation → logged out, login yields fresh onboarding.
7. **Cookie inventory (ER-COOK-1):** after full journey, exactly the expected cookies exist with HttpOnly/Secure/SameSite flags and nothing else; no third-party requests were made (network capture assert).
8. **Accessibility (ER-ACC-1):** `@axe-core/playwright` no-violations gate on login, dashboard, calls, settings.

## Verification commands (canonical)

| Command | What it proves |
|---|---|
| `pnpm typecheck` | strict TS across the workspace |
| `pnpm lint` | Biome clean |
| `pnpm test` | all Vitest projects (implementation + contract) |
| `pnpm test:contract` | the executable spec |
| `pnpm vitest run tests/contract/<file>` | one contract area (used as milestone gates) |
| `pnpm test:e2e` | Playwright suite against demo stack |
| `pnpm demo` | the one-command demo boots and prints the walkthrough |
| `pnpm report:esd -- --year 2026 --half 1` | ER-AUD-3 export runs |

Per-milestone gates are listed in `docs/milestones.md`.

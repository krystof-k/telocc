# Telocc — Technical and Organisational Measures (TOMs)

> **DRAFT — requires legal review and owner sign-off (see `docs/compliance/register.md`
> OWN-8).** Assembled from `docs/compliance/register.md` (item 18) and ER-SEC-1..5
> (`docs/compliance/engineering-requirements.md`). This document is the Art 32 evidence
> referenced by `docs/legal/dpa.md` §4 — it describes measures that are engineered
> (already built), not aspirational, except where marked otherwise.

## 1. Encryption in transit and at rest (ER-SEC-1)

- All traffic to the application is TLS-terminated (Cloudflare Workers / custom
  domain).
- Data at rest lives in Neon Postgres, which encrypts storage by default.
- No secret or personal data is ever committed to the repository.

## 2. Authentication (ER-SEC-2)

- **Magic-link login** (Better Auth): tokens are ≥128-bit CSPRNG, stored **hashed**
  (never in plaintext), **single-use**, **15-minute TTL**, invalidated both on
  consumption and on a new link being issued for the same address, with
  enumeration-safe responses (no "email not found" signal).
- **Session cookie**: `HttpOnly`, `Secure`, `SameSite=Lax`, fixed name
  (`telocc.session_token`); no IP/user-agent tracking is stored against sessions
  (data minimisation).

## 3. SMS-PIN verification (ER-SEC-3)

- 6-digit CSPRNG PIN, hashed at rest as `HMAC-SHA256(PIN_PEPPER, pin ‖ challengeId)`
  (never stored or logged in the clear), compared in constant time.
- 10-minute TTL; hard cap of 5 attempts before the challenge is deleted; 60-second
  resend cooldown per phone plus daily caps per phone and per organisation.
- Every issuance/attempt event (without the PIN value) is recorded in the audit log
  for forensics (ER-AUD-2).

## 4. Webhook authentication (ER-WEB-1)

- Every inbound provider webhook is signature-verified **before** any parsing or
  processing; failures return 401, write a `webhook_rejected` audit event, and
  increment an invalid-signature counter that raises an alert past a threshold.
- Idempotency per call reference means a redelivered, already-processed webhook is a
  safe no-op, bounding the impact of any replay.

## 5. Secrets, least privilege, log hygiene (ER-SEC-4)

- Secrets (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `PIN_PEPPER`, provider credentials)
  are stored via `wrangler secret put` in production, `.env`/`.dev.vars` locally
  (both gitignored) — never in the repository.
- The application database role is intended to be least-privilege (no DDL);
  migrations run under a separate role. `[OWNER TO CONFIRM AT DEPLOY — see
  docs/deploy.md]`.
- All application logging goes through a single redacting logger
  (`apps/api/src/lib/log.ts`) that strips E.164-shaped phone numbers and email
  addresses before anything is emitted; webhook and auth handlers may only log
  through it (enforced by a static test, `seam-isolation.contract.test.ts`). No
  personal data reaches Workers logs/analytics; there is no KV/cache/Durable-Object
  persistence anywhere — Postgres is the single store.

## 6. Rate limiting and anti-abuse (ER-RATE-1..3)

- Fixed-window rate limiting in Postgres (one atomic upsert per hit) on every
  auth-adjacent and abuse-relevant endpoint (magic link, SMS PIN, KYC document
  upload, number provisioning, export, account deletion, outbound dial-in
  attempts). Identifiers (IP, email, phone) are stored only as SHA-256 hashes, never
  in the clear.
- A daily anomaly scan aggregates each organisation's prior day's call volume,
  minutes, night-time (22:00–06:00 UTC) call count, and the failed/blocked share of
  Czech-destination legs against configurable thresholds
  (`ANOMALY_DAILY_CALLS`/`ANOMALY_DAILY_MINUTES`/`ANOMALY_NIGHT_CALLS`/
  `ANOMALY_CZ_FAILURE_PCT`), writing an `anomaly_flagged` audit event when exceeded
  (`packages/core/src/retention.ts`, design.md §9.9).

## 7. Backups, restore testing, regular testing (ER-SEC-5)

- Neon provides automated backups; a restore test is a go-live checklist item
  (`docs/runbook.md`) — `[OWNER TO CONFIRM SCHEDULE]`.
- "Regular testing" of security measures (Art 32(1)(d)) is evidenced by the
  automated contract-test suite (`tests/contract/**`) covering auth, rate limits,
  org scoping, webhook signature verification, retention/DSR, and the e2e suite's
  accessibility/cookie-inventory gates, run in CI on every change, plus routine
  dependency updates.

## 8. Data protection by design and default (Art 25)

- Org-scoping is structural: every data-access function takes the organisation ID
  first and every query is filtered by it; cross-organisation lookups by ID return a
  generic 404, never a 403 that would confirm the resource exists (design.md §3,
  pinned by `org-scoping.contract.test.ts`).
- The call log is append-only (no application-code UPDATE path except the retention
  job's anonymisation); the retention/erasure jobs are the only code paths that
  mutate or remove personal data outside normal user action.
- Security-relevant defaults ship secure: cookies are always `Secure`/`HttpOnly`,
  IP/user-agent tracking is off, dev-only routes are double-gated behind an
  environment flag and 404 in production.

## 9. Incident response

See `docs/runbook.md` §"Incident response" for the breach-notification process this
document's measures feed into.

---

*Last drafted: 2026-07-12. Owner/legal review pending (`docs/compliance/register.md`
OWN-8) for the placeholders above; the engineered measures themselves are current as
of this milestone.*

# Telocc — System Design

**Status:** binding build design. Derived from `docs/brief.md` (spec), `docs/compliance/engineering-requirements.md` (ER-…), `docs/decisions.md` (locked choices). Where this document and the brief diverge, the divergence is compliance-driven and recorded (ER-KYC-1).

Design rules applied throughout: boring and mainstream; smallest design that satisfies brief + ERs; validation only at real boundaries (webhooks, DTMF, tokens, PINs, settings input); no speculative abstraction beyond the three named seams (**telephony provider**, **roles**, **multi-number**).

---

## 1. Repo layout (pnpm workspace)

```
telocc/
├── package.json                 # workspace root: scripts (dev, demo, test, lint, typecheck)
├── pnpm-workspace.yaml
├── tsconfig.base.json           # strict: true, noUncheckedIndexedAccess, engines >=22
├── biome.json
├── docker-compose.yml           # local Postgres 16 for demo/dev/tests (port 54329)
├── README.md                    # incl. the short demo guide
├── scripts/
│   ├── demo.mjs                 # the one-command demo orchestrator
│   ├── run-jobs.mjs             # manual trigger for the scheduled jobs (local)
│   └── esd-report.ts            # ER-AUD-3 half-year volumes report (SQL over calls)
├── docs/                        # brief, compliance, this design, legal drafts, runbook
├── apps/
│   ├── api/                     # Hono app — ALL server code
│   │   ├── wrangler.jsonc       # Workers config: entry, crons, assets (serves web dist)
│   │   ├── src/
│   │   │   ├── app.ts           # buildApp(deps): Hono app assembled from injected deps
│   │   │   ├── env.ts           # zod-validated env/config (single config surface)
│   │   │   ├── deps.ts          # wiring: provider (mock|twilio) + email sender; db comes from the entry (per-driver factories in packages/db)
│   │   │   ├── entry.workers.ts # export default { fetch, scheduled }
│   │   │   ├── entry.node.ts    # @hono/node-server + 24h job interval (local cron)
│   │   │   ├── middleware/      # session, org-scope, rate-limit, security-headers
│   │   │   ├── routes/          # one file per resource (see §7), webhooks.ts, dev/
│   │   │   ├── jobs/            # scheduled.ts (purge + anomaly scan), see §10
│   │   │   └── lib/             # log.ts (redacting logger), csv.ts, http errors
│   │   └── assets/refusal-tone.wav   # SIT-style tone for emergency refusal (ER-EMG-1)
│   └── web/                     # React 19 + Vite + shadcn/ui + Tailwind 4 SPA
│       ├── src/
│       │   ├── api.ts           # hono/client typed RPC client (imports AppType from api)
│       │   ├── routes.tsx       # react-router v7 (library mode)
│       │   ├── pages/           # login, onboarding, dashboard, calls, settings, legal
│       │   └── dev/             # simulator page (dev/demo builds only)
│       └── vite.config.ts       # dev proxy /api + /webhooks + /dev → api
├── packages/
│   ├── db/                      # Drizzle schema, migrations, seed
│   │   ├── src/schema/          # auth.ts (Better Auth), org.ts, telephony.ts, kyc.ts,
│   │   │                        #   audit.ts, ratelimit.ts, billing.ts (dormant)
│   │   ├── src/index.ts         # schema + types ONLY — no driver imports
│   │   ├── src/neon.ts          # createNeonDb: drizzle-orm/neon-http — imported ONLY by entry.workers.ts
│   │   ├── src/node.ts          # createNodeDb: drizzle-orm/node-postgres — imported ONLY by entry.node.ts
│   │   ├── src/seed/            # demo.ts, regions.ts (TC area codes), dial-policy.ts
│   │   ├── drizzle.config.ts    # generate → migrate; never push outside throwaway local
│   │   └── migrations/
│   ├── core/                    # provider-free domain logic (no Hono, no provider imports)
│   │   └── src/
│   │       ├── office-hours.ts  # isOpen(schedule, now, tz) — pure
│   │       ├── dial-policy.ts   # DTMF normalisation + emergency/premium policy (ER-EMG-1/2)
│   │       ├── routing/inbound.ts   # inbound state machine (§5.1)
│   │       ├── routing/dialin.ts    # dial-in→DTMF→bridge state machine (§5.2)
│   │       ├── verification.ts  # SMS-PIN issue/confirm (hashing, caps, TTL)
│   │       ├── call-log.ts      # append-only call writer (the ONLY module inserting calls)
│   │       ├── retention.ts     # purge/anonymise routines (ER-RET-1..3)
│   │       ├── dsr.ts           # export builder + erasure routine (ER-DSR-1..2)
│   │       └── repos/           # org-scoped query helpers — every fn takes orgId first
│   ├── telephony/               # THE SEAM
│   │   └── src/
│   │       ├── types.ts         # events, instructions, capabilities, E164, PresentedCli
│   │       ├── provider.ts      # TelephonyProvider interface (§4)
│   │       ├── mock/
│   │       │   ├── provider.ts  # MockProvider: signs/verifies, renders JSON instructions
│   │       │   └── telco.ts     # MockTelco: deterministic in-process "network" simulator
│   │       └── twilio/
│   │           ├── provider.ts  # TwilioProvider (complete, unwired)
│   │           ├── twiml.ts     # instruction → TwiML rendering
│   │           ├── signature.ts # X-Twilio-Signature HMAC-SHA1 verification
│   │           └── fixtures/    # recorded webhook payloads + API request/response shapes
│   └── i18n/                    # thin typed i18n: en.ts (complete), cs.ts (partial — emergency-disclosure/verification namespace; rest falls back to en)
├── tests/
│   ├── contract/                # THE CONTRACT LAYER — see docs/testing.md; off-limits
│   └── helpers/                 # test app factory, db reset, MockTelco driver, mail capture
└── e2e/                         # Playwright against the demo stack
```

**Package responsibilities & dependency direction:** `i18n` ← everything; `telephony` depends on nothing internal; `db` depends on nothing internal; `core` depends on `db` + `telephony` (types only — it consumes the interface, never a concrete provider); `apps/api` wires `core` + `db` + a concrete provider chosen in `deps.ts`; `apps/web` depends only on the api's exported `AppType` and `i18n`. **No provider types outside `packages/telephony`** — pinned by a contract test that statically scans imports (§4.6).

### Runtime duality (Workers + Node)

One Hono app, two entries. `buildApp(deps)` takes `{ db, provider, email, env, now }` so tests and both runtimes assemble identically. **DB driver selection happens at the composition point, not at runtime:** `entry.workers.ts` constructs the db via `createNeonDb` (`drizzle-orm/neon-http`) and `entry.node.ts` via `createNodeDb` (`drizzle-orm/node-postgres`); `packages/db/src/index.ts` exports schema/types only. `pg` and its `node:net/tls/fs/dns` dependencies therefore never enter the Workers bundle, and no `nodejs_compat` compatibility flag is required (Better Auth runs on the fetch-native path). M0's gate includes a `wrangler deploy --dry-run` bundle check to prove this and catch regressions. Consequence honoured everywhere: **no multi-statement DB transactions** in critical paths (neon-http has none) — erasure cascades via FK `ON DELETE CASCADE` (single statement), PIN attempt counting and rate-limit counters are single atomic `UPDATE`/`UPSERT ... RETURNING` statements, call-session transitions are optimistic single-row updates (`WHERE state = $expected`).

Scheduled work: Workers Cron Trigger (`crons = ["17 2 * * *"]`) calls `runScheduledJobs()`; the Node entry runs the same function on a 24 h `setInterval` plus `scripts/run-jobs.mjs` for manual runs. No VPS.

---

## 2. Configuration surface

`apps/api/src/env.ts` — one zod schema, validated at boot; the process refuses to start on invalid config.

| Variable | Default | Purpose |
|---|---|---|
| `APP_ENV` | `development` | `development` \| `production` \| `test` |
| `APP_BASE_URL` | — | absolute URL for magic links + webhook action URLs |
| `DATABASE_URL` | — | Neon (prod) or local Postgres (dev/demo) |
| `BETTER_AUTH_SECRET` | — | Better Auth signing secret |
| `PIN_PEPPER` | — | server secret for HMAC-SHA256 PIN hashing (ER-SEC-3) |
| `TELEPHONY_PROVIDER` | `mock` | `mock` \| `twilio` |
| `MOCK_WEBHOOK_SECRET` | dev fixed | HMAC secret the mock signs webhooks with (ER-WEB-1) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | — | owner-supplied at wiring |
| `TWILIO_REGION` | `ie1` | ER-RES-3 |
| `EMAIL_PROVIDER` | `dev` | `dev` (in-process mailbox) \| `resend` |
| `RESEND_API_KEY` | — | owner-supplied at wiring |
| `RETENTION_CALL_LOG_MONTHS` | `13` | ER-RET-1 (`retention.callLogMonths`; owner-set, OWN-6) |
| `RETENTION_SECURITY_LOG_DAYS` | `90` | ER-RET-2 |
| `COMPLIANCE_POSTURE` | `app_layer` | `app_layer` \| `nbics_provider` (ER-POST-1) |
| `ENABLE_DEV_ROUTES` | off | `1` only in dev/demo — gates `/dev/*` |
| `ANOMALY_DAILY_CALLS` / `ANOMALY_DAILY_MINUTES` / `ANOMALY_NIGHT_CALLS` | `50`/`180`/`10` | ER-RATE-3 thresholds |
| `ANOMALY_CZ_FAILURE_PCT` | `20` | ER-OBS-1(b): alert when the failed+blocked share of CZ-destination outbound/forward legs exceeds this (min 5 legs/day) |
| `APPSIGNAL_PUSH_API_KEY` | — | optional; observability wiring at deploy |

Per-org caps (`dialin_hourly_cap`, `outbound_daily_minutes_cap`) are columns on `orgs` with safe defaults (ER-RATE-2: "caps configurable per org").

**Production boot guards** (in the same zod schema, fail-fast): when `APP_ENV=production`, (a) the `DATABASE_URL` host must match an EU Neon region pattern (`.eu-central-1.` / `.eu-west-…`) — the programmatic half of ER-RES-1; (b) if `TELEPHONY_PROVIDER=mock` (the deploy-smoke phase), `MOCK_WEBHOOK_SECRET` must be set and must not equal the dev default — the public webhook endpoint is never exposed with a well-known signing secret (ER-WEB-1).

---

## 3. Data model (Drizzle, Postgres)

Conventions: UUID PKs (`gen_random_uuid()`), `timestamptz` everywhere, E.164 stored as `text` with a `CHECK (col ~ '^\+[1-9][0-9]{1,14}$')`, every domain table except `orgs` carries `org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE`. All enums are Postgres enums via Drizzle `pgEnum`.

### 3.1 Better Auth tables (coexistence)

Better Auth (drizzle adapter, magic-link plugin) owns four tables, generated by `npx @better-auth/cli generate` into `packages/db/src/schema/auth.ts` and migrated through the same `drizzle-kit generate` → `migrate` pipeline as everything else (one migration history):

- `user` (text id, email unique, emailVerified, timestamps) — no additional columns; the personal phone lives on `memberships` (it is org-scoped data, not identity data).
- `session` (token unique, userId, expiresAt) — IP/user-agent tracking **disabled** in Better Auth config (data minimisation, ER-SEC-4).
- `account` — required by Better Auth; near-empty under magic-link-only.
- `verification` — magic-link tokens, configured `storeToken: "hashed"` (ER-SEC-2); rows deleted by the purge job after expiry (ER-RET-3).

Better Auth user ids are `text`; domain FKs to users are `text`. Deleting a user goes through Better Auth's delete API after the org cascade (§10.3).

### 3.2 Domain tables

**`orgs`**
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text NOT NULL | |
| `timezone` | text NOT NULL default `'Europe/Prague'` | IANA name |
| `office_hours_mode` | enum `schedule\|always_open\|always_closed` default `schedule` | |
| `business_capacity_declared_at` | timestamptz NOT NULL | ER-B2B-1 contract artifact |
| `declaration_version` | text NOT NULL | i18n copy version signed |
| `tos_version` / `tos_accepted_at` | text / timestamptz | ER-POL-2 artifact |
| `contract_summary_shown_at` / `waiver_accepted_at` | timestamptz NULL | § 63a step, only set under `nbics_provider` posture (ER-POST-1) |
| `dialin_hourly_cap` | int default 6 | ER-RATE-2 |
| `outbound_daily_minutes_cap` | int default 180 | ER-RATE-2 |
| `country` | char(2) default `'CZ'` | ER-BILL-1 |
| `vat_id`, `vat_vies_status`, `vat_vies_checked_at` | text/text/timestamptz NULL | ER-BILL-1, dormant |
| `customer_type` | text default `'business'` | ER-BILL-1 |
| `billing_street/city/postal/country`, `iban_country` | text NULL | ER-BILL-1 location evidence, dormant |
| `created_at` | timestamptz | |

**`memberships`** — the roles seam. One row per (org,user); MVP exactly one per org.
| column | notes |
|---|---|
| `id`, `org_id`, `user_id` (text → `user.id`) | `UNIQUE(org_id, user_id)`, `UNIQUE(user_id)` (one org per user in MVP — dropping this unique is the multi-org path) |
| `role` | enum `owner` — future roles are new enum values + `requireRole()` checks; no other redesign needed |
| `personal_number_e164` | text NULL, E.164 check — the verified number (the linchpin) |
| `personal_number_verified_at` | timestamptz NULL — NULL means routing/outbound inactive |
| `emergency_ack_at` | timestamptz NULL — ER-EMG-3 disclosure acknowledgment |
| `created_at` | |

**`phone_verifications`** — SMS-PIN challenges (ER-SEC-3, ER-RET-3)
| column | notes |
|---|---|
| `id`, `org_id`, `user_id` | |
| `phone_e164` | target of verification |
| `pin_hash` | `HMAC-SHA256(PIN_PEPPER, pin ‖ challengeId)` hex — never the PIN |
| `attempts` | int default 0; hard cap 5 then row deleted |
| `expires_at` | now + 10 min |
| `created_at` | |
Rows are **deleted** on consumption, on 5th failed attempt, and by the purge job after expiry — never merely flagged. Issue/attempt *events* go to `audit_events` without secret values.

**`business_numbers`** — one active per org (multi-number seam = drop the partial unique)
| column | notes |
|---|---|
| `id`, `org_id` | partial unique index: `UNIQUE(org_id) WHERE status NOT IN ('released')` |
| `e164` | unique |
| `number_class` | enum `geographic\|nomadic_910\|mobile` default `geographic` (ER-KYC-3) |
| `status` | enum `requested\|docs_pending\|bundle_submitted\|approved\|rejected\|active\|porting_out\|released` (ER-KYC-1) |
| `area_code` | TC prefix (e.g. `2` Prague) |
| `provider_number_ref` | provider-neutral opaque ref |
| `bundle_id` | FK → `regulatory_bundles` NULL |
| `provider_rejection_reason` | text NULL |
| `created_at`, `activated_at`, `released_at` | lifecycle timestamps; transitions audit-logged (`retention_class='lifecycle'`) |

**`end_users`** (org KYC identity, shaped like Twilio EndUser — ER-KYC-2): `id`, `org_id` unique, `legal_name`, `ico`, `street` (validated no-PO-box), `city`, `postal_code`, `country` default `'CZ'`, timestamps.

**`regulatory_bundles`** (shaped like Twilio Bundle): `id`, `org_id`, `provider_bundle_ref`, `status` enum `draft|submitted|approved|rejected`, `submitted_at`, `decided_at`, `rejection_reason`.

**`kyc_documents`** (SupportingDocument): `id`, `org_id`, `end_user_id`, `type`, `filename`, `content_type`, `bytes bytea` (**≤5 MB** — hex-encoded bytea roughly doubles through the neon-http transport, so the worst-case request stays inside Neon's HTTP limits; the boundary size is exercised by an implementation test through the real route and by a deploy smoke step; EU-stored in Neon, at-rest encrypted — ER-SEC-1), `uploaded_at`, `deleted_at` (hard-deleted by erasure and when no longer required).

**`region_area_codes`** (seedable, ER-KYC-2): `id`, `region_name`, `tc_prefix` — seeded from Decree 117/2007 Sb. list; correctable at wiring without code change.

**`dial_policy_prefixes`** (seedable, ER-EMG-2): `id`, `prefix` (e.g. `+42090`), `label`. Deny-list of premium/shared-cost ranges. Emergency short codes are **hard-coded in `core/dial-policy.ts`**, deliberately not data-driven (safety property, not configuration).

**`office_hour_rules`**: `id`, `org_id`, `weekday` smallint 0(Mon)–6, `opens_at time`, `closes_at time`, `UNIQUE(org_id, weekday)`, `CHECK (opens_at < closes_at)`. Absent row = closed that day. (0–1 interval per weekday, no overnight spans — recorded decision.)

**`call_sessions`** — mutable working state for in-flight calls (Workers have no memory between webhooks)
| column | notes |
|---|---|
| `id`, `org_id`, `business_number_id` | |
| `provider_call_ref` | unique — idempotency anchor for webhook redelivery |
| `kind` | enum `inbound\|dialin` |
| `state` | enum `forwarding\|collecting\|bridging\|bridged` |
| `from_e164`, `target_e164` NULL, `digits_raw` NULL | |
| `answered_at` | timestamptz NULL — set on `call.leg answered`; finalization input (§5.0) |
| `last_leg_status`, `last_leg_error_code` | text NULL — best-known dialled-leg outcome; finalization input (§5.0) |
| `created_at`, `updated_at` | sessions older than 4 h are finalized as `failed/session_expired` and deleted by the purge job |

Partial unique index: `UNIQUE (org_id) WHERE kind = 'dialin' AND state IN ('collecting','bridging','bridged')`. The concurrent-bridge cap (=1, ER-RATE-2) is enforced **structurally** by this index — the dial-in session INSERT's conflict *is* the reject-busy path (one atomic statement; race-safe even when two Workers isolates process `call.incoming` concurrently on the transaction-less neon-http driver — never a read-then-act pre-check).

**`calls`** — the append-only call log (ER-AUD-1). Written exactly once per logical call, at its terminal state, by `core/call-log.ts`. **No UPDATE path exists in application code** except the purge job's anonymisation.
| column | notes |
|---|---|
| `id`, `org_id`, `business_number_id` | index `(org_id, started_at DESC)` |
| `direction` | enum `inbound\|outbound` |
| `status` | enum `answered\|missed\|declined\|failed\|blocked\|emergency_refused\|destination_blocked` |
| `reason` | text NULL — documented values: `out_of_hours`, `no_verified_number`, `invalid_target`, `inactivity_timeout`, `rate_limited`, `concurrent_bridge`, `daily_cap_reached`, `session_expired`, `caller_hangup` |
| `from_e164` | NULL-able (strippable): inbound = customer CLI from signalling; outbound = initiator's verified personal CLI (ER-CLI-1) |
| `to_e164` | NULL-able (strippable): inbound = business number; outbound = dialled target (normalized; raw digits if unparseable) |
| `initiating_user_id` | text NULL (outbound only; strippable) |
| `started_at`, `answered_at` NULL, `ended_at` NULL, `duration_seconds` int default 0 | |
| `provider_call_ref` | unique where not null (idempotent finalization) |
| `provider_error_code` | text NULL — provider disposition surfaced (ER-OBS-1) |
| `anonymised_at` | timestamptz NULL — set by purge; `from_e164`/`to_e164`/`initiating_user_id` nulled, aggregate row kept for ESD counts (ER-RET-1, ER-AUD-3) |

**`audit_events`** (ER-AUD-2): `id`, `org_id` NULL, `actor_user_id` NULL, `type` text (`login`, `magic_link_issued`, `magic_link_used`, `pin_issued`, `pin_attempt_failed`, `pin_verified`, `settings_changed`, `number_lifecycle`, `export_requested`, `webhook_rejected`, `webhook_ignored`, `anomaly_flagged`, `dsr_erasure`), `retention_class` enum `security|lifecycle` default `security`, `meta` jsonb (minimal, no secrets, no full phone numbers — last-4 only where needed), `created_at`. Indexes `(org_id, created_at)`, `(retention_class, created_at)`. Security class purged after `RETENTION_SECURITY_LOG_DAYS`; lifecycle class after `RETENTION_CALL_LOG_MONTHS`.

**`rate_limit_counters`** (ER-RATE-1): `key` text PK = `sha256(scope ‖ identifier ‖ window_start)` (identifiers never stored raw), `scope` text (for ops visibility), `count` int, `window_starts_at`, `expires_at`. Single atomic upsert per hit; expired rows deleted by purge.

**`purge_runs`** (ER-RET-1 purge-audit): `id`, `ran_at`, `stats` jsonb (counts only, no personal data).

**`deletion_tombstones`** (ER-DSR-2): `id`, `deleted_at`, `stats` jsonb (row counts only) — no org reference, no personal data.

**Billing-dormant tables** (ER-BILL-1, exercised only by tests; marked dormant-by-design in decisions.md): `invoices` (`id`, `org_id`, `seq` int sequential per org, `issued_at`, `currency`, `reverse_charge` bool, `reverse_charge_legend` text NULL, `total_net`, `total_vat`), `invoice_lines` (`id`, `invoice_id`, `description`, `qty`, `unit_net`, `vat_rate`, `amount_net`, `amount_vat`), `org_turnover_years` (`org_id`, `year`, `net_czk` — checked against CZK 2,000,000 / 2,536,500 thresholds by a test).

### 3.3 Where each ER data requirement lands (summary)

- Retention timestamps → `calls.anonymised_at`, `phone_verifications.expires_at`, `verification.expiresAt`, `audit_events.retention_class`, `rate_limit_counters.expires_at`, `purge_runs`.
- Audit trail → `calls` (append-only) + `audit_events`.
- Hashed PIN → `phone_verifications.pin_hash`; hashed magic-link → Better Auth `verification` with `storeToken:"hashed"`.
- Refusal logs → `calls.status ∈ {emergency_refused, destination_blocked, blocked}` + `reason`.
- DSR export/erasure → §10; tombstones table; FK cascade topology (every org-owned table cascades from `orgs`).
- § 97 field-set extractability without schema change (Reg #23): `calls` already holds calling/called number, start, duration; direction is the service type — nothing extra built.

### Org-scoping pattern (enforcement)

1. Session middleware resolves `user`; org middleware resolves the single `membership` and sets `ctx.var.orgId`. Requests without a membership can only reach `POST /api/orgs` (onboarding).
2. Every query helper in `packages/core/repos` takes `orgId` as its first parameter and includes it in the `WHERE`; route handlers never touch Drizzle directly (convention pinned by a static contract test that forbids `@telocc/db` imports in `apps/api/src/routes/**` except `webhooks.ts`/`dev/`).
3. Webhook path derives org from the called business number (`business_numbers.e164 = event.to`), never from payload-claimed org ids.
4. Cross-org probing returns 404 (not 403) — pinned by the org-scoping contract test with two seeded orgs.

---

## 4. The telephony seam

`packages/telephony/src/provider.ts` + `types.ts`. This is the architectural invariant: **all** inbound-event handling, outbound dialling, bridging, DTMF collection, hangup, SMS-PIN delivery, number catalog/search + provisioning, and capability flags go through this interface. Application logic (`core`, `apps/api`) imports only these types.

### 4.1 Types

```ts
// types.ts
export type E164 = string & { readonly __brand: 'E164' };            // constructor: parseE164()

/** ER-CLI-3: arbitrary CLI strings are unrepresentable. The only constructor takes a
 *  BusinessNumber row, so the presented identity is always the org's provisioned number. */
export type PresentedCli = { readonly businessNumberId: string; readonly e164: E164;
                             readonly __brand: 'PresentedCli' };
export function presentedCli(bn: { id: string; e164: string; status: 'active' }): PresentedCli;

export type NumberClass = 'geographic' | 'nomadic_910' | 'mobile';

export interface ProviderCapabilities {
  /** ER-OBS-1: may only become `true` on Twilio's written confirmation (go-live gate). */
  czCliDomesticTermination: boolean | 'unverified';
  /** mock: true (demo feels instant); twilio: false (regulatory bundle review). */
  instantProvisioning: boolean;
  supportedNumberClasses: NumberClass[];
}

/** Neutral domain events — what a provider webhook becomes. */
export type TelephonyEvent =
  | { type: 'call.incoming';  callRef: string; to: E164; from: E164 | null; at: Date }
  | { type: 'call.dtmf';      callRef: string; digits: string; at: Date }          // Gather result; '' = timeout
  | { type: 'call.leg';       callRef: string; legStatus: 'answered'|'busy'|'no_answer'|'failed';
      errorCode?: string; at: Date }         // dialled-leg signal: 'answered' fires AT PICKUP; others at leg end
  | { type: 'call.completed'; callRef: string; durationSeconds: number;
      errorCode?: string; at: Date }
  | { type: 'sms.status';     messageRef: string; status: 'sent'|'delivered'|'failed'; at: Date }
  | { type: 'provisioning.update'; bundleRef?: string; numberRef?: string;
      status: 'submitted'|'approved'|'rejected'|'active'; reason?: string; at: Date };

/** Neutral call-control instructions — what the app answers a webhook with. */
export type CallInstruction =
  | { kind: 'reject'; cause: 'busy' }                                              // out-of-hours / not-configured
  | { kind: 'forward'; to: E164; callerId: PresentedCli; timeoutSeconds: number }  // inbound → personal number
  | { kind: 'collectDigits'; prompt: 'beep' | 'silent'; maxDigits: number;
      finishKey: '#'; timeoutSeconds: number }                                     // DTMF phase
  | { kind: 'bridge'; target: E164; callerId: PresentedCli; timeoutSeconds: number;
      maxDurationSeconds?: number }                                                // outbound leg; timeLimit = daily-cap remainder
  | { kind: 'refuseTone' }                                                         // ER-EMG-1: audibly distinct, announcement-free
  | { kind: 'hangup' };

export interface RawWebhookRequest {           // runtime-neutral wrapper (Workers & Node)
  method: string; url: string; headers: Record<string, string>; rawBody: string;
}
export interface RenderContext { webhookBaseUrl: string; callRef: string; }        // Twilio action URLs
export interface ProviderHttpResponse { status: number; contentType: string; body: string; }
```

### 4.2 The interface

```ts
// provider.ts
export interface TelephonyProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  // ---- webhook flow (ER-WEB-1) ----
  /** Cryptographic check FIRST; app logic never sees an unverified payload. */
  verifyWebhook(req: RawWebhookRequest): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Provider payload → neutral event. Throws MalformedWebhookError (→ 400). */
  parseWebhook(req: RawWebhookRequest): TelephonyEvent;
  /** Neutral instruction → provider wire format (TwiML / mock JSON). */
  renderInstruction(i: CallInstruction, ctx: RenderContext): ProviderHttpResponse;

  // ---- imperative call/SMS control ----
  sendSms(msg: { to: E164; body: string }): Promise<{ messageRef: string }>;       // PIN delivery
  hangupCall(callRef: string): Promise<void>;                                      // backstop (cap breach mid-call)

  // ---- number catalog & provisioning (async-capable, ER-KYC-1..3) ----
  searchNumbers(q: { country: 'CZ'; areaCode?: string; numberClass: NumberClass;
                     limit: number }): Promise<{ e164: E164; numberClass: NumberClass;
                     areaCode: string }[]>;
  getRequiredDocuments(q: { country: 'CZ'; numberClass: NumberClass })
    : Promise<{ type: string; label: string }[]>;                                  // Regulations API / fixture
  submitBundle(b: { endUser: EndUserRecord; documents: DocumentRef[] })
    : Promise<{ bundleRef: string; status: 'submitted' | 'approved' }>;
  provisionNumber(p: { e164: E164; bundleRef: string; webhookBaseUrl: string })
    : Promise<{ numberRef: string; status: 'pending' | 'active' }>;
  releaseNumber(numberRef: string): Promise<void>;
  getProvisioningStatus(refs: { bundleRef?: string; numberRef?: string })
    : Promise<{ status: 'submitted'|'approved'|'rejected'|'active'; reason?: string }>; // poll fallback
  deleteCallRecord(callRef: string): Promise<void>;                                // ER-DSR-2 propagate-delete
}
```

### 4.3 Webhook flow (provider POST → neutral event → instruction)

```
Provider/simulator POST /webhooks/telephony/:provider
  → route resolves provider (must equal env TELEPHONY_PROVIDER, else 404)
  → provider.verifyWebhook(raw)          ── fail → 401, count (audit_events webhook_rejected
                                                     + rate counter feeding ER-RATE-3 alert)
  → provider.parseWebhook(raw)           ── malformed → 400
  → zod-validate the *neutral event*     (belt over the seam boundary)
  → core routing engine (§5): load/advance call_session, decide → CallInstruction | void
  → provider.renderInstruction(instr)    → HTTP response body (TwiML / mock JSON)
```

Idempotency & ordering: redelivered events are no-ops — `call_sessions.provider_call_ref` unique + optimistic state transitions; `calls.provider_call_ref` unique makes finalization write-once. Status callbacks are asynchronous and retried, so processing is **order-tolerant**: non-final events only record onto the session and `call.completed` is the sole finalizer for dialled legs (§5.0). **Late/unknown callRefs:** any event whose callRef matches no live session and triggers no finalization — session already swept (4 h expiry) or finalized, ref never existed, duplicate finalization swallowed by the unique constraint — is acknowledged `200` and ignored, counted as a `webhook_ignored` audit event. Never a 5xx: providers redeliver for hours, and a 5xx only provokes more retries.

### 4.4 Mock vs Twilio per concern

| Concern | Mock | Twilio (unwired) |
|---|---|---|
| Webhook signature | HMAC-SHA256 over `timestamp.rawBody` with `MOCK_WEBHOOK_SECRET`; headers `x-mock-signature`, `x-mock-timestamp`; ±300 s replay tolerance | `X-Twilio-Signature` = HMAC-SHA1(authToken, url + sorted form params) per Twilio spec. No timestamp in scheme → replay bounded by call-ref idempotency instead (documented) |
| Event payloads | JSON mirroring `TelephonyEvent` | form-encoded: initial voice webhook (`CallSid,To,From`) → `call.incoming`; Gather action (`Digits`) → `call.dtmf`; **child-leg status callback** (from `statusCallback`/`statusCallbackEvent="answered completed"` on the dialled `<Number>`, resolved to the session via `ParentCallSid` in `parseWebhook`) → `call.leg answered` **at pickup** / `call.leg busy\|no_answer\|failed` at child end; Dial action callback (`DialCallStatus`) → `call.leg` as a redundant belt — Twilio does **not** request the action URL when the caller hangs up first, so the child status callback is the answered-signal of record; parent status callback (final `CallStatus` `completed\|busy\|no-answer\|canceled\|failed`, `CallDuration`) → `call.completed`; Bundle status callback → `provisioning.update` |
| `reject busy` | JSON `{do:'reject',cause:'busy'}`; telco plays busy to caller | `<Reject reason="busy"/>` (declines at signalling level without answering — the number stays routed/callable, satisfying ER-CLI-2(b); logged as `declined`) |
| `forward` | JSON instruction; telco "rings" the personal number and fires `call.leg answered` **at pickup** (same timeline point as Twilio's child status callback — before any completion event), then `call.completed` at call end | `<Dial callerId={business#} timeout={n} action=…><Number statusCallback={…} statusCallbackEvent="answered completed">{personal#}</Number></Dial>` — callerId is always the business number (ER-CLI-2(a)); child-leg callbacks carry `ParentCallSid` for session resolution |
| `collectDigits` | JSON; simulator UI shows keypad; telco fires `call.dtmf` (or `digits:''` on timeout) | `<Play>` short beep (or nothing) then `<Gather input="dtmf" numDigits={16} finishOnKey="#" timeout={10} action=…>`; empty Gather action = timeout |
| `bridge` | JSON; telco rings target, fires `call.leg answered` at target pickup, honours `maxDurationSeconds`; either-leg hangup → single `call.completed` for the session | `<Dial callerId={business#} timeout={30} timeLimit={maxDurationSeconds} action=…><Number statusCallback={…} statusCallbackEvent="answered completed">{target}</Number></Dial><Hangup/>` — Twilio's Dial semantics give both-legs-drop: caller hangup kills the child leg; callee hangup ends Dial and the trailing `<Hangup/>` drops the caller |
| `refuseTone` | JSON `{do:'refuseTone'}`; simulator displays "refusal tone played" | `<Play>{APP_BASE_URL}/assets/refusal-tone.wav</Play><Hangup/>` — SIT-style cadence, announcement-free (ER-EMG-1) |
| `sendSms` | records to in-memory outbox (tests: `provider.sentSms[]`; demo: dev mailbox panel) | Messages API POST (IE1 edge per `TWILIO_REGION`) |
| `hangupCall` | telco drops the call | Calls API `POST .../Calls/{sid}` `Status=completed` |
| `searchNumbers` | deterministic catalog derived from seeded `region_area_codes` (Prague default) | AvailablePhoneNumbers API filtered by area code |
| `getRequiredDocuments` | fixture checklist | Regulations API (fetched at wiring, not hard-coded — ER-KYC-2) |
| `submitBundle` / `provisionNumber` | auto-approves: returns `approved`/`active` immediately, then also emits a signed `provisioning.update` webhook so the async path is exercised | Bundles/EndUsers/SupportingDocuments APIs then IncomingPhoneNumbers purchase; status via callbacks + `getProvisioningStatus` polling |
| `deleteCallRecord` | no-op success | HTTP `DELETE /Calls/{sid}` |
| Capabilities | `{ czCliDomesticTermination: true, instantProvisioning: true, supportedNumberClasses: ['geographic','nomadic_910','mobile'] }` | `{ czCliDomesticTermination: 'unverified', instantProvisioning: false, supportedNumberClasses: [...] }` — UI warns at number selection while `'unverified'` (ER-OBS-1) |

**Timeline-fidelity rule (the seam's honesty guarantee):** MockTelco MUST emit events at the same timeline points and in the same order Twilio does — in particular `call.leg answered` at pickup, *before* any completion event, on both forward and bridge; and a `call.completed` for every call, including declined/refused ones. The mock is only faithful if the most common real pattern — call answered, conversation, the initiating side hangs up first — produces the identical event sequence on both providers. Pinned by the provider-conformance spec and the contract cases in `docs/testing.md`.

### 4.5 The mock's two halves

- **`MockProvider`** implements `TelephonyProvider` deterministically (sequential refs `call_0001…`).
- **`MockTelco`** is the fake network: it holds per-call state, POSTs signed webhooks to the app's real `/webhooks/telephony/mock` endpoint, reads the JSON instruction from the response, and progresses (rings, answers, fires DTMF, completes) — exactly the Twilio interaction shape, so ER-WEB-1's verification path runs end-to-end in tests and demo. In tests it drives `app.request()` in-process and is stepped synchronously; in the demo it lives inside the API process behind `/dev/sim/*` routes and is driven by the simulator page (§12).

### 4.6 Leak prevention

A static contract test walks `packages/core/**` and `apps/api/src/**` (excluding `deps.ts`) and fails on any import from `@telocc/telephony/twilio` or `twilio`-related modules, and on any occurrence of `TwiML`/`CallSid` identifiers outside `packages/telephony`. `deps.ts` is the single composition point.

---

## 5. Call state machines

Both machines live in `packages/core/routing/`, are pure functions of `(session-state, event, org-context, now) → { instruction?, sessionTransition?, callLogWrite? }`, and persist state in `call_sessions`. DTMF/dial timeouts are enforced by the provider (Gather/Dial timeout attributes); the app only handles the resulting events, plus a purge-job sweep for sessions whose webhooks never arrived.

### 5.0 Event recording vs finalization (order tolerance)

Status callbacks are asynchronous and may be retry-delayed past one another. The rule for both machines:

- **Non-final events only record.** `call.leg answered` sets `call_sessions.answered_at` (and advances the state); `call.leg busy|no_answer|failed` records `last_leg_status`/`last_leg_error_code`; `call.dtmf` drives the dial-in machine. None of these writes a `calls` row for a dialled leg.
- **`call.completed` is the sole finalizer** for any session that issued a `forward` or `bridge`. It writes the one `calls` row derived from best-known session data, then deletes the session:
  - `answered_at` set → `answered`, duration from the event (covers the caller-hangs-up-first-after-answer path — the pattern where Twilio's Dial action callback never fires);
  - else `last_leg_status` `busy|no_answer` → `missed`;
  - else `last_leg_status` `failed` → `failed` + `provider_error_code`;
  - else (no dialled-leg outcome — the caller hung up first): inbound FORWARDING or dial-in BRIDGING → `missed/caller_hangup`; dial-in COLLECTING → `failed/caller_hangup`.
- **Decision-time terminals** (declines, pre-check blocks, DTMF refusals/invalid targets) still write their row immediately — they depend on no leg events. The later `call.completed` for those callRefs is swallowed by the `calls.provider_call_ref` unique constraint and acked-ignored (§4.3).
- **A leg event arriving after finalization** is acked and ignored (§4.3). For the one re-orderable pair — a delayed dialled-leg callback vs `call.completed` — the derivation yields the same correct status either way for unanswered calls, and the answered signal fires at pickup, giving it the whole call duration of retry headroom on answered ones.

### 5.1 Inbound routing (customer → business number)

Entry: `call.incoming` where `from` ≠ the org's verified personal number (or `from` is null/withheld).

```
RECEIVED ──(no verified personal number on org)────────────→ reject busy   ▸ LOG declined/no_verified_number
RECEIVED ──(office hours closed: mode=always_closed, or
            mode=schedule ∧ ¬isOpen(now, tz))──────────────→ reject busy   ▸ LOG declined/out_of_hours
RECEIVED ──(open)──→ FORWARDING  instruction: forward(to=personal#, callerId=business#, timeout=120s)
FORWARDING ──call.leg answered (child leg, at pickup)──→ BRIDGED; answered_at recorded
   (carrier voicemail on the personal phone answering counts as `answered` — native behaviour, per brief)
FORWARDING ──call.leg busy|no_answer|failed──→ record last_leg_status (+ error code); await completion
FORWARDING/BRIDGED ──call.completed──→ finalize per §5.0:
    answered_at set          ▸ LOG answered, duration from event  (incl. caller hanging up first after answer)
    last_leg busy|no_answer  ▸ LOG missed
    last_leg failed          ▸ LOG failed + provider_error_code
    no leg outcome (caller hung up while ringing) ▸ LOG missed/caller_hangup
(any state, no webhook for 4h) → purge sweep                 ▸ LOG failed/session_expired
```

Forward dial timeout: **120 s** — deliberately longer than any personal-carrier outcome, so the user's own carrier decides the result per the brief ("native carrier behaviour takes over"): carrier voicemail answers → `answered`; carrier rings out or rejects → `missed`/`busy`. The timeout is only a backstop against a leg that never resolves; if it ever fires, the customer's call ends (ringing stops, then hangup) and the row is `missed`.

### 5.2 Appless outbound (dial-in → DTMF → bridge)

Entry: `call.incoming` where `from` **exactly matches** (E.164, from provider signalling — never user input) the verified `personal_number_e164` of the org owning the called business number (ER-CLI-1). Not gated by office hours. Any non-match → inbound machine (§5.1) — that *is* the unverified-caller failure path: an unverified caller can never reach DTMF collection; out of hours they get busy (decline, logged).

Pre-checks before answering (order matters):
```
1. dial-in attempts/hour ≥ org.dialin_hourly_cap                  → reject busy ▸ LOG blocked/rate_limited
2. remaining daily outbound minutes ≤ 0                           → reject busy ▸ LOG blocked/daily_cap_reached
3. INSERT the dialin call_session — the partial unique index (§3.2, one active dialin per org)
   makes the concurrent-bridge cap (=1) structural: INSERT conflict → reject busy
                                                                  ▸ LOG blocked/concurrent_bridge
   (single atomic statement — no read-then-act race between concurrent isolates; ER-RATE-2)
```

```
→ COLLECTING   instruction: collectDigits(prompt='beep', maxDigits=16, finishKey='#', timeout=10s)
COLLECTING ──call.dtmf digits==''  (inactivity timeout)──→ hangup      ▸ LOG failed/inactivity_timeout
COLLECTING ──call.completed (caller hung up)──────────────→ finalize   ▸ LOG failed/caller_hangup
COLLECTING ──call.dtmf digits──→ VALIDATE (core/dial-policy.ts):
    normalize: strip '#'; '00' prefix → international form; bare '420…' → +420…;
               9 digits starting 2–9 → +420 national
    a. digits ∈ {112,150,155,156,158}            → refuseTone ▸ LOG emergency_refused   (terminal)
    b. any other 3–6-digit short code            → refuseTone ▸ LOG destination_blocked/short_code
    c. non-+420 destination (international OFF)  → refuseTone ▸ LOG destination_blocked/international
    d. matches dial_policy_prefixes deny row     → refuseTone ▸ LOG destination_blocked/premium
    e. target == business number or own personal number → refuseTone ▸ LOG failed/invalid_target
    f. not a valid CZ E.164 after normalisation  → refuseTone ▸ LOG failed/invalid_target
       (no retry — one attempt per call, recorded decision)
    g. valid → BRIDGING
BRIDGING   instruction: bridge(target, callerId=business#, timeout=30s,
                               maxDurationSeconds = 60·remaining daily minutes)
BRIDGING ──call.leg answered (target pickup)──→ BRIDGED; answered_at recorded
BRIDGING ──call.leg busy|no_answer|failed──→ record last_leg_status (+ error code); await completion
BRIDGING/BRIDGED ──call.completed (either side hung up; provider guarantees both legs drop)──→
                                                             finalize per §5.0:
    answered_at set          ▸ LOG answered, duration        (incl. initiating side hanging up first)
    last_leg busy|no_answer  ▸ LOG missed
    last_leg failed          ▸ LOG failed + provider_error_code
    no leg outcome (caller hung up while target ringing)     ▸ LOG missed/caller_hangup
(any state, no webhook 4h) → purge sweep                     ▸ LOG failed/session_expired
```

Emergency refusal never issues a `bridge`/`forward` instruction and never calls any dial-capable seam method — pinned by contract test (the seam spy records zero dial instructions for 112/150/155/156/158).

### 5.3 What the call log records at each terminal state

| Terminal | direction | status/reason | from | to | initiating_user | duration | error code |
|---|---|---|---|---|---|---|---|
| out-of-hours decline | inbound | `declined/out_of_hours` | caller CLI (or null) | business # | — | 0 | — |
| no verified number | inbound | `declined/no_verified_number` | caller CLI | business # | — | 0 | — |
| forwarded, answered (either side may hang up first) | inbound | `answered` | caller CLI | business # | — | from event | — |
| forwarded, not picked up | inbound | `missed` (or `/caller_hangup`) | caller CLI | business # | — | 0 | — |
| forward leg error | inbound | `failed` | caller CLI | business # | — | 0 | provider code |
| dial-in rate/concurrency/cap | outbound | `blocked/…` | personal # | business # | owner | 0 | — |
| DTMF timeout / caller hangup | outbound | `failed/inactivity_timeout` \| `failed/caller_hangup` | personal # | — | owner | 0 | — |
| emergency number entered | outbound | `emergency_refused` | personal # | raw digits | owner | 0 | — |
| short code / intl / premium | outbound | `destination_blocked/…` | personal # | normalized or raw | owner | 0 | — |
| invalid target | outbound | `failed/invalid_target` | personal # | raw digits | owner | 0 | — |
| bridged, completed (either side may hang up first) | outbound | `answered` | personal # | target E164 | owner | from event | — |
| target busy/no answer | outbound | `missed` | personal # | target E164 | owner | 0 | — |
| caller hung up while target ringing | outbound | `missed/caller_hangup` | personal # | target E164 | owner | 0 | — |
| bridge leg error | outbound | `failed` | personal # | target E164 | owner | 0 | provider code |
| stale session sweep | either | `failed/session_expired` | as known | as known | if known | 0 | — |

---

## 6. Auth & org bootstrap

**Magic link (Better Auth):** `POST /api/auth/sign-in/magic-link` (rate-limited §9) → Better Auth issues ≥128-bit CSPRNG token, stored hashed (`storeToken:"hashed"`), TTL 15 min, single-use, invalidated on use and on new issuance; response is enumeration-safe ("if that address exists, we sent a link") whether or not the user exists (ER-SEC-2). Email goes through a two-line `EmailSender` port: `dev` (in-process mailbox exposed at `/dev/mailbox` for demo/tests) or `resend` (production; owner supplies key at wiring).

**Bootstrap flow:** clicking the link creates/loads the Better Auth user and session. The SPA calls `GET /api/me`; if the user has no membership it routes to onboarding:

1. **Create org** — `POST /api/orgs` `{ name, businessCapacityDeclared: true }` (literal `true` required; zod rejects otherwise). Stores `business_capacity_declared_at` + `declaration_version` (ER-B2B-1). Under `COMPLIANCE_POSTURE=nbics_provider`, the same step first renders the § 63a contract summary + waiver and records `contract_summary_shown_at`/`waiver_accepted_at` (ER-POST-1) — the only posture-conditional UI.
2. **Verify personal number** — SMS-PIN flow (§9.3) with the mandatory emergency-limitation disclosure; confirming stores `emergency_ack_at` (ER-EMG-3).
3. **KYC** — end-user record + document upload (ER-KYC-2).
4. **Pick business number** — region → catalog → provision (§ ER-KYC-1 state machine; mock lands on `active` immediately).

The dashboard is reachable after step 1; routing/outbound stay inactive until steps 2 and 4 complete (banner states what's missing).

**Session model:** Better Auth DB-backed cookie sessions; cookie `telocc.session_token`, `HttpOnly; Secure; SameSite=Lax`, 30-day expiry with rolling refresh; IP/UA tracking off. Better Auth is configured `useSecureCookies: true` **unconditionally** — the `Secure` flag is present in every environment (localhost is a trustworthy context, so the http demo and Playwright still work), keeping the contract-test and e2e cookie assertions identical across dev/test/prod instead of varying with the base URL scheme. The cookie inventory (exactly Better Auth's cookies, correct flags, nothing else) is pinned by a Playwright test (ER-COOK-1 — no banner, no analytics, no third-party anything).

**Roles seam:** `memberships.role` enum (`owner` only today) + `requireRole(ctx, 'owner')` helper already called on every mutating route. Adding staff later = new enum value, invite flow, and role checks where they differ — no redesign. One-org-per-user is a single unique constraint to drop.

---

## 7. API surface

All under `/api` (JSON, session-cookie auth, org-scoped via middleware) except webhooks and dev routes. Every body/query zod-validated; unknown keys stripped; errors are generic shapes (no enumeration).

| Route | Auth | Zod input (summary) | Rate limit |
|---|---|---|---|
| `POST /api/auth/sign-in/magic-link` | — | `{ email: string.email }` | 3/15 min per email, 10/h per IP |
| `GET /api/auth/magic-link/verify` | token | Better Auth (token param) | 30/h per IP |
| `GET/POST /api/auth/*` (session, sign-out) | varies | Better Auth internals | Better Auth defaults |
| `GET /api/me` | session | — | — |
| `POST /api/orgs` | session, no org yet | `{ name: 1..120, businessCapacityDeclared: literal(true), waiverAccepted?: boolean }` | 5/h per user |
| `GET /api/org` / `PATCH /api/org` | owner | PATCH: `{ name? }` | — |
| `POST /api/verifications` | owner | `{ phoneE164: e164() }` | 1/60 s per phone (resend cooldown, its own fixed window), 3/10 min + 5/day per phone, 10/day per org, 10/h per IP (ER-RATE-1, ER-SEC-3) |
| `POST /api/verifications/:id/confirm` | owner | `{ pin: /^\d{6}$/ }` | 5 attempts per challenge (row), 20/h per IP |
| `GET /api/office-hours` / `PUT /api/office-hours` | owner | `{ mode, timezone: IANA, rules: [{weekday:0..6, opensAt:'HH:MM', closesAt:'HH:MM'}] (≤7, unique weekday, opens<closes) }` | — |
| `GET /api/kyc/requirements` | owner | — (seam `getRequiredDocuments`) | — |
| `GET /api/kyc` / `PUT /api/kyc` | owner | `{ legalName, ico: /^\d{8}$/, street (PO-box regex reject), city, postalCode, country: 'CZ' }` | — |
| `POST /api/kyc/documents` | owner | multipart, ≤5 MB (§3.2 transport rationale), `content-type ∈ {pdf,png,jpeg}` | 20/day per org |
| `GET /api/numbers/catalog?region=` | owner, KYC complete | `region ∈ region_area_codes` | 30/h per org |
| `POST /api/numbers/provision` | owner, KYC complete | `{ e164: e164() }` (must come from catalog) | 3/day per org |
| `GET /api/business-number` | owner | — (incl. provisioning status + capability warning) | — |
| `GET /api/calls?cursor&direction&from&to` | owner | paging + filters | — |
| `GET /api/export` | owner | — (JSON bundle) | 5/h per org (ER-DSR-1) |
| `GET /api/export/calls.csv` | owner | — | 5/h per org |
| `POST /api/account/delete` | owner | `{ confirmName: must equal org.name }` | 3/h per org (ER-DSR-2) |
| `POST /webhooks/telephony/:provider` | **provider signature** (ER-WEB-1) | neutral-event zod after provider parse | invalid-signature counter → alert threshold; valid traffic idempotent per callRef |
| `GET /assets/refusal-tone.wav` | — | static | — |
| `/dev/*` (§12) | `ENABLE_DEV_ROUTES=1` only; 404 in production | per route | — |

Legal pages (`/legal/privacy`, `/legal/terms`) are static SPA routes rendering the drafted markdown; linked in the footer (ER-POL-1/2, ER-COOK-1 information duty).

The ESD report (ER-AUD-3) is deliberately **not** an HTTP route: `pnpm report:esd -- --year 2026 --half 1` runs `scripts/esd-report.ts` against `DATABASE_URL` (calls/minutes per direction per half-year, 30 Jun/31 Dec cutoffs; works on anonymised rows).

---

## 8. Office hours model

- `orgs.office_hours_mode`: `always_open` | `always_closed` | `schedule`.
- `office_hour_rules`: 0–1 interval per weekday, org-local wall-clock times, no overnight spans (MVP).
- `orgs.timezone`: IANA, default `Europe/Prague`, editable in settings.
- Evaluation: `isOpen(mode, rules, now, tz)` pure function in `core/office-hours.ts`; converts `now` to org-local weekday + minutes via `Intl.DateTimeFormat.formatToParts` (full tz data on Workers and Node 22 — zero dependencies; DST correct by construction). Contract-tested across modes, boundary minutes (open at exactly `opensAt`, closed at exactly `closesAt`), and the 2026 CET↔CEST transition dates.
- Outbound dial-in path never consults office hours (brief: outbound not gated).

---

## 9. Security architecture

**9.1 Rate limiting (Workers + Node identical):** fixed-window counters in Postgres — one atomic `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count` per hit; key = `sha256(scope ‖ identifier ‖ windowStart)` so raw identifiers (IP, email, phone) never persist (ER-SEC-4 hygiene); generic `429 { error: 'rate_limited' }`; windows/limits per the table in §7; expired counters purged daily. No Durable Objects, no KV (ER-RES-2). Hono middleware `rateLimit(scope, identifierFn, limit, windowSec)`.

**9.2 Org scoping:** §3 pattern; pinned by contract tests (two orgs, exhaustive route sweep, 404 on foreign ids).

**9.3 SMS PIN (ER-SEC-3):** 6-digit CSPRNG PIN (within the brief's 4–6; recorded decision); `pin_hash = HMAC-SHA256(PIN_PEPPER, pin ‖ challengeId)`; timing-safe compare; TTL 10 min; hard cap 5 attempts then challenge deleted; resend cooldown **60 s per phone** (its own fixed-window counter — see §7 limits table) + daily caps per phone and per org; challenge rows deleted on consumption/cap/expiry (ER-RET-3); events (no PIN values) → `audit_events`.

**9.4 Magic link (ER-SEC-2):** Better Auth configured: hashed at rest, single-use, 15-min TTL, invalidation on reissue, enumeration-safe responses; expired rows purged (ER-RET-3). Contract test captures a token from the dev mailbox and asserts it dies after first use and after expiry.

**9.5 Webhook auth (ER-WEB-1):** signature verification in seam-level middleware before any parsing/processing; 401 + `webhook_rejected` audit event + counter; mock scheme carries a timestamp (±300 s); Twilio's scheme has no timestamp — replay bounded by per-callRef idempotency (documented in TOMs).

**9.6 Headers & CSRF:** Hono `secureHeaders`: CSP `default-src 'self'` (SPA is same-origin, no third-party origins at all), HSTS, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`, `Referrer-Policy: same-origin`. Web and API share one origin in production (Wrangler serves the Vite build as Worker assets) — no CORS surface. CSRF: SameSite=Lax cookie + Better Auth origin checking + JSON-only content type on mutating routes.

**9.7 Secrets:** Wrangler secrets in production (`wrangler secret put`); `.dev.vars`/`.env` locally (gitignored); no secret ever in the repo; documented inventory in `docs/compliance/toms.md` (ER-SEC-4/5). Least-privilege Neon role for the app (no DDL; migrations run with a separate role).

**9.8 Log hygiene (ER-SEC-4, ER-RES-2):** all logging through `lib/log.ts` — `safeLog()` redacts E.164 patterns and emails before emission; webhook and auth handlers may only import this logger (static contract check). No personal data in Workers logs/analytics; no KV/cache/DO persistence anywhere; Postgres is the single store. Optional AppSignal transport activates when `APPSIGNAL_PUSH_API_KEY` is set (owner wiring step); until then thresholds emit structured redacted log lines.

**9.9 Outbound anomaly guards (ER-RATE-3, ER-OBS-1(b)):** daily job aggregates yesterday per org (call count, minutes, 22:00–06:00 count, new-destination-prefix share, **and the failed+blocked share of CZ-destination outbound/forward legs** from `calls.status` + `provider_error_code` — the deliverability tripwire behind Reg #10) against `ANOMALY_*` thresholds (`ANOMALY_CZ_FAILURE_PCT` for the CZ failure share) → `anomaly_flagged` audit event + alert log line (AppSignal signal when wired). Runbook covers the response (`docs/runbook.md`).

---

## 10. Retention & DSR mechanics

**10.1 `runScheduledJobs(db, provider, env, now)`** — idempotent, org-iterating, counts-only reporting; Workers cron daily 02:17 UTC; Node interval + manual script:

1. Anonymise `calls` older than `RETENTION_CALL_LOG_MONTHS` (13 mo default): null `from_e164`, `to_e164`, `initiating_user_id`, `provider_call_ref`, `provider_error_code`; set `anonymised_at`. Aggregate row survives for ESD counts (ER-RET-1; recorded decision: anonymise, not delete).
2. Delete `audit_events` `security` class older than `RETENTION_SECURITY_LOG_DAYS`; `lifecycle` class older than the call-log window (ER-RET-2, ER-AUD-2).
3. Delete expired `phone_verifications` and expired Better Auth `verification` rows (ER-RET-3).
4. Delete expired `rate_limit_counters`.
5. Sweep `call_sessions` older than 4 h → write `failed/session_expired` call rows, delete sessions.
6. Anomaly scan (§9.9).
7. Insert `purge_runs` row with per-step counts (no personal data).

**10.2 Export (ER-DSR-1):** `GET /api/export` → synchronous JSON `{ account: { email }, org, membership: { personalNumber, verifiedAt }, officeHours, businessNumber (+ lifecycle timestamps), kyc: { endUser, documents: metadata only }, calls: [...] }`; `GET /api/export/calls.csv` → CSV (`started_at,direction,status,reason,from,to,duration_seconds`). Org-scoped by construction; format documented in the privacy notice.

**10.3 Erasure (ER-DSR-2):** `POST /api/account/delete` (org-name confirmation):
1. Best-effort provider propagation: `releaseNumber` for a non-released business number; `deleteCallRecord` for every non-anonymised `provider_call_ref` (Twilio HTTP DELETE; mock no-op) — failures logged, do not block local deletion.
2. `DELETE FROM orgs WHERE id = $org` — FK cascade removes memberships, verifications, numbers, bundles, end_users, kyc_documents, office_hour_rules, call_sessions, calls, audit_events, dormant billing rows in one statement (works on the transaction-less neon-http driver).
3. Better Auth user + sessions deleted via Better Auth API.
4. Insert `deletion_tombstones` row (counts only).
Carve-outs (billing/tax records once billing exists) are documented in the privacy notice draft; nothing to carve out at MVP. DSR intake path + one-month SLA live in `docs/legal/privacy-notice.md` (ER-DSR-3) — text only, no tooling.

---

## 11. Frontend architecture

- **Stack:** React 19 + Vite, shadcn/ui + Tailwind 4, react-router v7 (library mode), TanStack Query over the `hono/client` typed RPC client (`AppType` imported from `apps/api` — no shared package needed).
- **Pages:** `/login`; `/onboarding` (4-step wizard, §6); `/` dashboard (business number + status/capability warning, hours mode toggle, recent calls); `/calls` (paginated log: local-time timestamp, direction, status+reason badge, duration; CSV link); `/settings` (account, personal number + re-verify flow with emergency disclosure, office-hours editor, business-number details incl. provisioning state, danger zone: export JSON/CSV + delete with name confirmation); `/legal/privacy`, `/legal/terms`.
- **i18n:** `packages/i18n` — `en.ts` as a `const` object of namespaced keys (the complete, source-of-truth dictionary); `t('calls.status.emergency_refused')` typed against a dotted-path `MessageKey`. A boring locale mechanism sits on top: `setLocale`/`getLocale` (module-level, default `'en'`) and `cs.ts`, a `DeepPartial<Messages>` covering only the ER-EMG-3 emergency-disclosure/verification namespace (plus the handful of strings shown alongside it) — `t()` resolves through the active locale first, falling back to `en` per-key, so a partial `cs` never produces a missing string. `apps/web`'s `main.tsx` calls `setLocale` once at startup from `navigator.language` (`cs*` → `'cs'`, else `'en'`) — no server negotiation, no stored preference, no re-render on change. All user-facing copy — including API-side email/SMS/disclosure text — goes through `t()`. No library. Czech translation of everything outside that namespace (and of the legal drafts) is an owner/translation backlog item, not a build gap.
- **Dev simulator page** (`/dev/simulator`, compiled only when `VITE_ENABLE_SIM=1`, server routes 404 unless `ENABLE_DEV_ROUTES=1` — double gate):
  - Buttons: **Incoming customer call** (choose caller number), **Out-of-hours call** (one-click sets mode `always_closed`, fires call, restores), **Dial-in from verified phone** → live keypad for DTMF (try 604… → bridge; try 112 → refusal), **Hang up caller / callee**.
  - Panels: live call state (session state machine position, last instruction rendered), dev mailbox (magic links), SMS outbox (PINs), event log; call-log table refreshes by polling every 2 s.
  - Mechanism: page calls `/dev/sim/*`; `MockTelco` fires **signed webhooks at the real endpoint**, so the demo exercises signature verification, routing, and logging identically to production shape.
- **Accessibility (ER-ACC-1):** shadcn/Radix primitives; every input labelled; visible focus rings; AA contrast via Tailwind tokens; full keyboard operability (keypad included); `@axe-core/playwright` pass on login, dashboard, settings, calls in e2e.

---

## 12. Demo mechanics

**The one command** (README, copy-paste single line):

```
corepack enable && pnpm install && pnpm demo
```

`scripts/demo.mjs` then: (1) checks Docker; (2) `docker compose up -d --wait db` (Postgres 16 on 54329); (3) `drizzle-kit migrate`; (4) seed (idempotent reset): org **Demo s.r.o.** (owner `demo@telocc.dev`, business-capacity declaration recorded), verified personal number `+420 777 123 456` (PIN pre-satisfied, `emergency_ack_at` set), KYC complete, business number `+420 2xx xxx xxx` in `active` (Prague catalog), office hours Mon–Fri 09:00–17:00 Europe/Prague, dial-policy prefixes, region catalog, ~12 historical call rows covering every status; (5) starts API (Node entry, `TELEPHONY_PROVIDER=mock`, `ENABLE_DEV_ROUTES=1`, port 3001) and web (Vite, port 5173, `VITE_ENABLE_SIM=1`) concurrently; (6) prints: open `http://localhost:5173`, log in as `demo@telocc.dev`, click the magic link in the simulator page's mailbox panel, then use the three simulator buttons to watch routing + call log fill in.

README demo section: clone → the command → URL → four bullet walkthroughs (in-hours forward, out-of-hours busy, dial-in → DTMF → bridge → both-legs-drop, dial 112 → logged refusal). No cloud accounts, no credentials, no Twilio.

---

## 13. Deploy story

**Shape:** one Worker serves API + SPA assets; Neon EU is the only state. `apps/api/wrangler.jsonc`:

```jsonc
{
  "name": "telocc",
  "main": "src/entry.workers.ts",
  "compatibility_date": "2026-06-01",
  "assets": { "directory": "../web/dist", "not_found_handling": "single-page-application" },
  "triggers": { "crons": ["17 2 * * *"] },
  "vars": { "APP_ENV": "production", "TELEPHONY_PROVIDER": "mock", "TWILIO_REGION": "ie1",
            "RETENTION_CALL_LOG_MONTHS": "13", "RETENTION_SECURITY_LOG_DAYS": "90",
            "COMPLIANCE_POSTURE": "app_layer" }
  // secrets via `wrangler secret put`: DATABASE_URL, BETTER_AUTH_SECRET, PIN_PEPPER,
  //   RESEND_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, MOCK_WEBHOOK_SECRET.
  // MOCK_WEBHOOK_SECRET must be a freshly generated strong value for the mock smoke phase —
  //   env.ts refuses to boot in production with the dev default (or unset) while
  //   TELEPHONY_PROVIDER=mock (§2 production boot guards).
  // No `compatibility_flags` needed: the Workers bundle contains no node-only modules
  //   (per-entry DB driver split, §1) — pinned by the M0 `wrangler deploy --dry-run` check.
}
```

**Documented first-deploy path** (`docs/deploy.md`, written in M11): create Neon project **in an EU region** (explicit warning: region is immutable per project — ER-RES-1; `env.ts` independently refuses to boot in production if the `DATABASE_URL` host does not match an EU Neon region pattern, §2); create least-privilege app role; `pnpm --filter db migrate` against Neon; `pnpm --filter web build`; `wrangler secret put …`; attach a **custom domain** (prerequisite for Cloudflare Regional Services later — ER-RES-2); `wrangler deploy`; smoke check (`/api/auth` reachable, cron visible, one at-cap 5 MB KYC document upload verifying the neon-http transport headroom, §3.2). First deploy ships `TELEPHONY_PROVIDER=mock` for smoke; flipping to `twilio` is the wiring step.

**Exactly what remains for the owner** (checklist in deploy docs + `docs/runbook.md` go-live gates): Twilio account + IE1 region + credentials as secrets; regulatory bundle + number purchase (Regulations API document list — OWN-10); written CZ-domestic-termination confirmation before setting `czCliDomesticTermination: true` (ER-OBS-1/OWN-4); Voice Geographic Permissions (ER-EMG-2); Resend (or other email) account + key; DPAs with Twilio/Cloudflare/Neon/email recorded in the transfer register (OWN-7); Regional Services purchase decision (OWN-7); retention-window sign-off (OWN-6); legal-text sign-off (OWN-8); *identifikovaná osoba* VAT registration after first Twilio invoice (OWN-9); AppSignal key (optional). **None of these block anything in this design** — the system is fully buildable and demoable against the mock.

---

## 14. ER traceability

| ER | Lands in |
|---|---|
| ER-RET-1 | `RETENTION_CALL_LOG_MONTHS` config; purge step 1 (anonymise, strip both numbers, keep aggregates); `purge_runs`; Workers cron + Node interval (§10.1) |
| ER-RET-2 | `RETENTION_SECURITY_LOG_DAYS`; purge steps 2 & 4; `audit_events.retention_class` |
| ER-RET-3 | delete-on-consume challenge rows; purge step 3 (PIN + magic-link hashes) |
| ER-DSR-1 | `GET /api/export` + `/api/export/calls.csv` (§10.2) |
| ER-DSR-2 | `POST /api/account/delete`; FK-cascade topology; seam `deleteCallRecord`/`releaseNumber`; `deletion_tombstones` (§10.3) |
| ER-DSR-3 | privacy-notice draft text (privacy@, 1-month SLA) — `docs/legal/privacy-notice.md` |
| ER-SEC-1 | platform TLS; Neon at-rest; KYC bytea in EU Postgres; TOMs doc |
| ER-SEC-2 | Better Auth config (§6, §9.4) + contract test |
| ER-SEC-3 | `phone_verifications` + `core/verification.ts` (§9.3) + contract tests |
| ER-SEC-4 | Wrangler secrets; least-privilege roles; `lib/log.ts` redactor + static guard (§9.7–9.8) |
| ER-SEC-5 | Neon PITR + restore-test runbook section; test suite as Art 32 process; `docs/compliance/toms.md` |
| ER-RES-1 | deploy docs Neon-EU create step with immutability warning + `env.ts` production boot assertion on the `DATABASE_URL` EU-region host pattern (§2) |
| ER-RES-2 | no KV/DO/cache; redacted edge logs; custom-domain deploy prerequisite; ADR note in deploy docs |
| ER-RES-3 | `TWILIO_REGION=ie1` default in provider config; runbook row |
| ER-WEB-1 | `verifyWebhook` middleware before parse; mock signing; 401 + counter (§4.3, §9.5) |
| ER-RATE-1 | §7 limits on magic-link/PIN routes; Postgres fixed-window counters (§9.1) |
| ER-RATE-2 | dial-in pre-checks (§5.2): hourly cap, concurrent=1 via the partial unique index on active dialin sessions (§3.2 — structural, race-safe), daily minutes w/ `timeLimit` hard cutoff + `hangupCall` backstop; distinct `blocked/…` statuses |
| ER-RATE-3 | anomaly job (§9.9); invalid-signature counter; runbook response section |
| ER-EMG-1 | hard-coded deny in `core/dial-policy.ts`; `refuseTone` instruction (SIT wav on Twilio); `emergency_refused` log rows; contract test incl. "no dial instruction ever issued" |
| ER-EMG-2 | `dial_policy_prefixes` seeded table; +420-only default; Geo Permissions runbook step; `destination_blocked` rows |
| ER-EMG-3 | disclosure in PIN flow (ack stored `emergency_ack_at`), settings page, ToS draft — all i18n-routed |
| ER-CLI-1 | dial-in entry = exact E.164 match on signalling CLI (§5.2); accepted initiations log initiator/source/target |
| ER-CLI-2 | `callerId: PresentedCli` always business number on both forward and bridge; out-of-hours = decline-with-busy, logged, number always routed |
| ER-CLI-3 | `PresentedCli` branded type constructible only from an active business-number row (§4.1) |
| ER-KYC-1 | `business_numbers.status` state machine; transitions only via seam events/polls; mock auto-approve; pending/rejected UI states |
| ER-KYC-2 | `end_users`/`regulatory_bundles`/`kyc_documents`; `region_area_codes` seedable; `getRequiredDocuments` from provider; no catalog before KYC complete |
| ER-KYC-3 | `number_class` enum + seam `supportedNumberClasses` capability list — **schema-level** readiness for more than one class, not a working pivot: today's provisioning (`apps/api/src/routes/numbers.ts`) hard-codes `numberClass: 'geographic'` at catalog search and at provisioning; release flow + lifecycle audit events; OKU placeholder in ToS draft |
| ER-AUD-1 | `calls` append-only (write-once at terminal state; §5.3); org-scoped access with **no in-app admin/"break-glass" route at all** — safe by absence, not by logging; the only bypass is direct database access outside the application, governed by a documented runbook procedure (`docs/runbook.md`) with a manually recorded reasoned entry, never a logged application capability |
| ER-AUD-2 | `audit_events` table + event list (§3.2) |
| ER-AUD-3 | `scripts/esd-report.ts` (half-year cutoffs; survives anonymisation) |
| ER-OBS-1 | `provider_error_code` on calls; CZ-destination failed+blocked share in the daily anomaly scan (`ANOMALY_CZ_FAILURE_PCT`, §9.9); `czCliDomesticTermination` capability + UI warning + runbook gate |
| ER-POL-1..6 | drafts in `docs/legal/` (privacy-notice, tos, dpa, aup) + `docs/compliance/` (ropa, toms, transfer-register, ctu-notification-pack) + `docs/runbook.md` — produced in M8/M11, all marked DRAFT pending OWN-8 |
| ER-COOK-1 | session cookie only; no banner; cookie section in privacy notice; Playwright cookie-inventory test |
| ER-ACC-1 | §11 accessibility baseline + axe pass in e2e |
| ER-B2B-1 | org-creation declaration (literal-true zod) + stored artifact columns |
| ER-BILL-1 | dormant billing tables (§3.2), exercised by tests only |
| ER-POST-1 | `COMPLIANCE_POSTURE` has exactly **one** real code branch today — `routes/orgs.ts`'s `isNbicsPosture` gate on the § 63a contract-summary/waiver step (§6 step 1) — flip exercised by `posture-flip.contract.test.ts`. The other three areas the requirement names are *not* separately code-branched: the ToS § 63a clause is static prose marked `[CONDITIONAL CLAUSE …]` for the owner/reader, not templated per posture; `scripts/esd-report.ts` runs unconditionally regardless of posture; there is no retention branch (retention windows are independent env vars, never read `COMPLIANCE_POSTURE`). This still satisfies the ER under today's `app_layer` default: nothing in ToS/ESD/retention needs to *differ* while posture is `app_layer`, so there is nothing for a second branch to do yet; the org-creation gate is the one place behavior actually changes on flip, and it demonstrates the pattern (a single config point, no redesign) the other three areas would follow if/when OWN-1 flips the posture and that copy/behavior needs to diverge. |

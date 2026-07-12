# Telocc — Milestones

Slicing matched to the orchestrator task list. Every milestone states scope, files (ownership boundaries for parallel work), done-when, and verification commands. Contract tests (`tests/contract/**`) are written in M1 and are **off-limits** to M2–M11 implementers — a milestone is done when *its* contract files (or, where a file's cases span milestones — call-log, org-scoping, rate-limits — its named cases) go green without touching them.

Ground rules for parallelism: two milestones may run concurrently only if their file sets are disjoint. The full Drizzle schema + initial migration land in **M0** (the data model is fully specified in `docs/design.md` §3), so later milestones never contend over migrations. The seam types (`packages/telephony/src/types.ts`, `provider.ts`) also land in M0, freezing the interface for mock (M4) and Twilio (M9) independently.

Dependency graph:

```
M0 ─ M1 ─ M2 ─┬─ M3 ────┬─ M5 ─ M6 ─┬─ M10 ─┐
              └─ M4 ────┘           ├─ M7 ──┤        M9 (Twilio) ∥ anything after M0
                                    └─ M8 ──┴─ M11
```

---

## M0 — Scaffold  *(task #3)*

**Scope:** pnpm workspace; strict tsconfig; Biome; docker-compose Postgres; `packages/db` with the **complete** schema (design §3, incl. Better Auth tables via CLI generate, dormant billing tables) + initial migration + seed skeleton (regions, dial-policy prefixes); `packages/telephony` types + `TelephonyProvider` interface + `presentedCli` (no implementations); `packages/i18n` skeleton (`en.ts` with initial keys, typed `t`); `packages/core` empty module stubs; `apps/api` with `buildApp`, `env.ts` zod config, both entries, security-headers middleware, health route; `apps/web` Vite + Tailwind + shadcn init + router shell; `wrangler.jsonc`; root scripts (`dev`, `demo` placeholder, `test`, `typecheck`, `lint`, `report:esd` stub).

**Files:** everything except `tests/contract/**`, `e2e/**`, `docs/legal/**`.

**Done when:** `pnpm install && pnpm typecheck && pnpm lint && pnpm test` pass on a clean clone; `docker compose up -d db && pnpm --filter @telocc/db migrate` applies the full schema; `pnpm dev` serves API health + web shell; `drizzle-kit generate` produces no diff; `pnpm --filter web build && pnpm --filter api exec wrangler deploy --dry-run` succeeds — proving the Workers bundle excludes `pg`/node-only modules (per-entry DB driver split, design §1) without any `nodejs_compat` flag.

**Verify:** `pnpm typecheck && pnpm lint && pnpm test` · `pnpm --filter @telocc/db migrate` · `pnpm --filter web build && pnpm --filter api exec wrangler deploy --dry-run`

---

## M1 — Contract layer  *(task #4)*

**Scope:** all 17 contract files from `docs/testing.md` + `tests/helpers/` (app factory, DB reset, `MockTelco` driver stub interface, mail capture, fake clock). Tests are complete, compiling, real assertions; nearly all red. CI records the pass-count ratchet.

**Files:** `tests/contract/**`, `tests/helpers/**` only.

**Done when:** `pnpm test:contract` runs (red is expected), zero compile errors; `seam-isolation` static scans pass already (nothing to violate yet); helper API documented in `tests/helpers/README.md`.

**Verify:** `pnpm vitest run tests/contract --reporter=verbose` (counts recorded) · `pnpm typecheck`

**Parallel:** nothing (it freezes the spec everything else builds against).

---

## M2 — Auth + org bootstrap  *(task #5)*

**Scope:** Better Auth wiring (magic-link plugin, hashed tokens, TTL, single-use, cookie config, IP/UA tracking off); `EmailSender` port (`dev` mailbox + `resend` impl); rate-limit middleware (Postgres fixed-window, hashed keys) applied to auth routes; session + org middleware; `POST /api/orgs` with declaration capture (+ posture-conditional § 63a step); `GET /api/me`; `requireRole`; audit-event writer; redacting logger.

**Files:** `apps/api/src/{middleware,routes/auth.ts,routes/orgs.ts,routes/me.ts,lib/log.ts}`, `packages/core/src/repos/{orgs,memberships,audit}.ts`.

**Done when green:** `auth.contract.test.ts`, `org-bootstrap.contract.test.ts`, `rate-limits.contract.test.ts` (magic-link cases), `security-headers.contract.test.ts`, `posture-flip.contract.test.ts` (onboarding half).

**Verify:** `pnpm vitest run tests/contract/auth.contract.test.ts tests/contract/org-bootstrap.contract.test.ts tests/contract/security-headers.contract.test.ts` · `pnpm typecheck && pnpm lint`

---

## M3 — SMS-PIN verified number  *(task #6)*

**Scope:** `core/verification.ts` (HMAC hashing, attempt cap, TTL, cooldowns/caps), `/api/verifications*` routes, emergency-disclosure copy in i18n + `emergency_ack_at`, seam `sendSms` consumption (against the interface; MockProvider's `sendSms` half lands here as a minimal test double if M4 hasn't merged).

**Files:** `packages/core/src/verification.ts`, `apps/api/src/routes/verifications.ts`, `packages/i18n/src/en.ts` (verification namespace).

**Done when green:** `pin-verification.contract.test.ts`; `rate-limits.contract.test.ts` **minus** the magic-link cases (already M2's gate) and **minus** the invalid-webhook-signature-counter case (needs M4's webhook route — it gates M4, running in parallel).

**Verify:** `pnpm vitest run tests/contract/pin-verification.contract.test.ts` · `pnpm vitest run tests/contract/rate-limits.contract.test.ts -t '^(?!.*webhook)'` (name-pattern exclusion of the M4-gated case — per-case split, same pattern as call-log)

**Parallel:** ∥ **M4** (disjoint files; both depend on M2).

---

## M4 — Business number + webhooks  *(task #7)*

**Scope:** full `MockProvider` + `MockTelco`; webhook route with signature-verification middleware, neutral-event zod, idempotency; KYC routes (`/api/kyc*`, document upload); catalog + provisioning routes; provisioning state machine on `business_numbers`; capability-flag surfacing; `/dev/sim/*` + `/dev/mailbox` routes (env-gated).

**Files:** `packages/telephony/src/mock/**`, `apps/api/src/routes/{webhooks.ts,kyc.ts,numbers.ts,dev/**}`, `packages/core/src/repos/{numbers,kyc}.ts`.

**Done when green:** `webhook-auth.contract.test.ts`, `provisioning.contract.test.ts`, **plus** the `rate-limits.contract.test.ts` invalid-webhook-signature-counter case (moved here from M3 — it needs this milestone's webhook route + signature middleware).

**Verify:** `pnpm vitest run tests/contract/webhook-auth.contract.test.ts tests/contract/provisioning.contract.test.ts` · `pnpm vitest run tests/contract/rate-limits.contract.test.ts -t 'webhook'`

**Parallel:** ∥ M3.

---

## M5 — Inbound routing + office hours  *(task #8)*

**Scope:** `core/office-hours.ts`; `/api/office-hours` routes; `core/routing/inbound.ts` state machine; `call_sessions` handling; `core/call-log.ts` write-once writer; `/api/calls` list route.

**Files:** `packages/core/src/{office-hours.ts,routing/inbound.ts,call-log.ts,repos/calls.ts}`, `apps/api/src/routes/{office-hours.ts,calls.ts}`.

**Done when green:** `office-hours.contract.test.ts`, `inbound-routing.contract.test.ts`, `call-log.contract.test.ts` (inbound cases), `org-scoping.contract.test.ts` **minus** the cross-org dial-in case (needs M6's dialin machine — gates M6) and **minus** the export case (needs M8's DSR routes — gates M8); the route sweep covers all data routes existing at M5.

**Verify:** `pnpm vitest run tests/contract/office-hours.contract.test.ts tests/contract/inbound-routing.contract.test.ts` · `pnpm vitest run tests/contract/org-scoping.contract.test.ts -t '^(?!.*(dial-in|export))'` (per-case split, same pattern as call-log)

---

## M6 — Appless outbound / DTMF / bridge  *(task #9)*

**Scope:** `core/dial-policy.ts` (normalisation, emergency hard-deny, prefix table, short-code rule); `core/routing/dialin.ts` (pre-check caps, collect → validate → bridge, both-legs-drop, timeLimit from daily cap); refusal-tone instruction path + wav asset.

**Files:** `packages/core/src/{dial-policy.ts,routing/dialin.ts}`, `apps/api/assets/refusal-tone.wav`.

**Done when green:** `dialin-outbound.contract.test.ts`, `emergency-refusal.contract.test.ts`, rest of `call-log.contract.test.ts`, **plus** the `org-scoping.contract.test.ts` cross-org dial-in case (moved here from M5).

**Verify:** `pnpm vitest run tests/contract/dialin-outbound.contract.test.ts tests/contract/emergency-refusal.contract.test.ts tests/contract/call-log.contract.test.ts` · `pnpm vitest run tests/contract/org-scoping.contract.test.ts -t 'dial-in'`

**Parallel:** ∥ **M7** and ∥ **M9** (disjoint files). Requires M5 (sessions, call-log writer).

---

## M7 — Settings + call log UI  *(task #10)*

**Scope:** all product pages (login, onboarding wizard, dashboard, calls, settings incl. danger zone wired to the contract-frozen DSR routes, legal pages), i18n fill, hono/client + TanStack Query plumbing, accessibility pass. (The simulator page is M10.)

**Files:** `apps/web/src/**` (except `dev/`), `packages/i18n/src/en.ts` (UI namespaces).

**Done when:** manual walkthrough of every page against `pnpm dev`; UI builds with zero type errors against `AppType`; axe checks pass locally on the four key pages (formal e2e gate lands in M10).

**Verify:** `pnpm --filter web build && pnpm typecheck` · manual: `pnpm dev`

**Parallel:** ∥ M6, ∥ M8 (API surface frozen by contract layer; M8 touches no web files).

---

## M8 — Hardening / DSR / retention  *(task #11)*

**Scope:** `core/retention.ts` + `jobs/scheduled.ts` (purge steps 1–7, anomaly scan) + Workers cron + Node interval + `scripts/run-jobs.mjs`; `core/dsr.ts` + export/delete routes; `scripts/esd-report.ts`; billing-dormant table exercising; drafted docs: `docs/legal/{privacy-notice,tos,dpa,aup}.md`, `docs/compliance/{ropa,toms,transfer-register,ctu-notification-pack}.md`, `docs/runbook.md` (all marked DRAFT — never blocking on OWN-* sign-offs).

**Files:** `packages/core/src/{retention.ts,dsr.ts}`, `apps/api/src/jobs/**`, `apps/api/src/routes/dsr.ts`, `scripts/{run-jobs.mjs,esd-report.ts}`, `docs/legal/**`, `docs/compliance/{ropa,toms,transfer-register,ctu-notification-pack}.md`, `docs/runbook.md`.

**Done when green:** `retention-purge.contract.test.ts`, `dsr.contract.test.ts`, the `org-scoping.contract.test.ts` export case (moved here from M5), `posture-flip.contract.test.ts` (ESD half), `seam-isolation.contract.test.ts` (incl. billing cases) — at this point **`pnpm test:contract` is fully green**.

**Verify:** `pnpm test:contract` (all) · `pnpm report:esd -- --year 2026 --half 1`

**Parallel:** ∥ M7, ∥ M9.

---

## M9 — Twilio adapter (unwired)  *(task #12)*

**Scope:** `TwilioProvider` complete against the interface: signature verification, form-payload parsing → neutral events, TwiML rendering for every instruction (incl. Dial callerId/timeLimit semantics and the refusal-tone Play), Messages/Calls/AvailablePhoneNumbers/Bundles/Regulations request builders, IE1 region config, capabilities `{ czCliDomesticTermination: 'unverified', instantProvisioning: false }`. Fixtures only; zero network; no credentials anywhere.

**Files:** `packages/telephony/src/twilio/**` (+ its implementation tests, + conformance-spec run).

**Done when:** Twilio implementation tests + offline conformance subset green; `seam-isolation.contract.test.ts` still green (nothing outside the package imports it except `deps.ts` wiring behind `TELEPHONY_PROVIDER=twilio`).

**Verify:** `pnpm vitest run packages/telephony` · `pnpm test:contract`

**Parallel:** ∥ M5–M8, ∥ M10 (fully disjoint).

---

## M10 — One-command demo  *(task #13)*

**Scope:** `scripts/demo.mjs` (compose up → migrate → seed → run both apps → print walkthrough); full demo seed (design §12); simulator page `apps/web/src/dev/**`; README demo guide; `e2e/**` Playwright suite (it runs against the demo stack, so it lands here).

**Files:** `scripts/demo.mjs`, `packages/db/src/seed/demo.ts`, `apps/web/src/dev/**`, `e2e/**`, `README.md`.

**Done when:** on a clean clone, `corepack enable && pnpm install && pnpm demo` reaches a working app in ≤ ~3 min; all four README walkthroughs work by clicking; `pnpm test:e2e` green (incl. cookie-inventory + axe gates).

**Verify:** clean-clone run of the one command · `pnpm test:e2e`

**Parallel:** ∥ M9, ∥ M11.

---

## M11 — Deploy docs  *(task #14)*

**Scope:** `docs/deploy.md` (Neon EU create with immutability warning, least-privilege roles, migrate, secrets inventory, custom domain, `wrangler deploy`, smoke checks, mock→twilio flip); finalize `wrangler.jsonc`; go-live gates section in `docs/runbook.md` (owner checklist: Twilio creds/IE1/bundle/number, Geo Permissions, CZ-termination confirmation → capability flag, email provider, DPAs + transfer register rows, Regional Services decision, retention sign-off, legal sign-off, VAT registration); `docs/decisions.md` sweep.

**Files:** `docs/deploy.md`, `docs/runbook.md` (go-live section), `apps/api/wrangler.jsonc`, `README.md` (deploy pointer).

**Done when:** a reader can follow deploy.md start-to-finish with only a Cloudflare + Neon account; every owner-remaining item appears exactly once with its ER/OWN reference; `wrangler deploy --dry-run` (or `wrangler versions upload --dry-run` equivalent) validates config locally.

**Verify:** `pnpm --filter web build && pnpm --filter api exec wrangler deploy --dry-run` · doc review against design §13.

**Parallel:** ∥ M10.

---

## Final gate  *(tasks #15–16)*

`pnpm typecheck && pnpm lint && pnpm test && pnpm test:contract && pnpm test:e2e` all green + clean-clone demo run + fresh-context verification against `docs/brief.md` and the ER traceability table in `docs/design.md` §14.

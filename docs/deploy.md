# Telocc — Deploy Guide

This is the linear path from a clean clone to a live, production-shaped Telocc deployment,
running against the **mock** telephony provider — and then, as a separate, deliberate step,
flipping to a live Twilio account. Per `docs/brief.md`'s goal, everything up to and including
the mock-provider deploy needs only a Cloudflare account and a Neon account. Every blank left
for you is marked **[OWNER]**.

Companion documents: `docs/design.md` §13 (deploy story) and §2 (config surface),
`docs/runbook.md`'s "Go-live gates" section (the compliance checklist this guide's flip
section closes items against), `docs/compliance/register.md` (the OWN-1..13 items),
`apps/api/src/env.ts` (the authoritative config schema — this guide mirrors it exactly).

---

## 1. Prerequisites

- **Accounts:** a Cloudflare account (Workers + a domain you control, for the custom-domain
  step in §5) — **[OWNER]**; a Neon account — **[OWNER]**.
- **CLIs:** Node ≥ 22, pnpm (`corepack enable` pulls the pinned version from
  `package.json`'s `packageManager`), and `wrangler` (installed as a dev dependency of
  `apps/api` — no separate global install needed; invoke it via
  `pnpm --filter api exec wrangler …`).
- **Repo:** `git clone` this repository, then `pnpm install` at the root.
- Everything in this section is free. Nothing past this point costs money until you attach
  a custom domain (Cloudflare's free tier covers Workers + Neon's free tier covers the
  database at this scale) or wire a live Twilio account (§8).

---

## 2. Create the Neon project (EU region)

> **⚠️ Region is immutable per project.** Neon's region choice cannot be changed after
> project creation — the only way to move regions later is creating a new project and
> migrating data by hand. Get this right the first time (ER-RES-1).

1. **[OWNER]** In the Neon console, create a new project. Under **Region**, pick an EU
   region (e.g. `eu-central-1` (Frankfurt) or an `eu-west-…` option, depending on what
   Neon currently offers — either satisfies ER-RES-1 as long as it's EU). Do **not** pick a
   US or other non-EU region even for a "just testing" first project — `apps/api/src/env.ts`
   independently refuses to boot in production if `DATABASE_URL`'s host doesn't match
   `/\.eu-(central|west)-\d\./` (the same regex the CI/deploy check below exercises), so a
   non-EU project will fail closed rather than silently violate data residency.
2. **Least-privilege roles.** Neon gives you a default role tied to the project owner (full
   DDL rights). Create a second, narrower role for the running application:
   - **App role** (used by the deployed Worker): `SELECT`/`INSERT`/`UPDATE`/`DELETE` on all
     tables in the schema, but **no DDL** (no `CREATE`/`ALTER`/`DROP`). This is the
     `DATABASE_URL` secret you'll `wrangler secret put` in §5.
   - **Migration role** (used only from your machine/CI when running migrations): full DDL
     rights — this is the one Neon gives you by default, or a dedicated role if you prefer
     to keep the owner role untouched. This role's connection string is only ever used
     locally for `pnpm --filter @telocc/db migrate` (§3); it is never deployed as a Worker
     secret.
   - In Neon's console: **Roles** → create a role (e.g. `telocc_app`) → grant it against the
     `public` schema (`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO
     telocc_app; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE,
     DELETE ON TABLES TO telocc_app;` so future migrations' new tables inherit the grant
     too). Use the project's default/owner role for migrations.
3. Note both connection strings (**Connection Details** in the Neon console, per-role) —
   you'll need the app role's string as the `DATABASE_URL` Worker secret (§5) and the
   migration role's string as your local `.env`'s `DATABASE_URL` when running migrations
   (§3). Both point at the same EU-region database; they differ only in which Postgres role
   they authenticate as.

---

## 3. Run the migration

From the repo root, with the **migration role**'s connection string in your shell/`.env`:

```bash
DATABASE_URL="postgresql://<migration-role>:<password>@<neon-eu-host>/<db>?sslmode=require" \
  pnpm --filter @telocc/db migrate
```

This runs `drizzle-kit migrate` against the full schema in `packages/db/migrations/`
(includes the Better Auth tables, all domain tables, and the dormant billing tables —
`docs/design.md` §3). It is safe to re-run; already-applied migrations are skipped.
`drizzle-kit push` is never used outside a throwaway local database (decisions.md's stack
choice) — only `generate` → `migrate`, and this repository's migrations are already
generated, so you only ever run `migrate` here.

---

## 4. Build the web app

```bash
pnpm --filter web build
```

Produces `apps/web/dist` — the static SPA assets `wrangler.jsonc`'s `assets` binding serves
from the same Worker (single origin, no CORS surface — decisions.md #6).

---

## 5. Secrets inventory and first deploy

Every variable `apps/api/src/env.ts` reads, where it's set, and who supplies the value:

| Variable | Kind | Where set | Owner-supplied? | Purpose |
|---|---|---|---|---|
| `APP_ENV` | var | `wrangler.jsonc` `vars` (already `"production"`) | no | selects the production boot-guard branch (§2 below) |
| `APP_BASE_URL` | secret | `wrangler secret put APP_BASE_URL` | **yes** — depends on the custom domain you attach (§6) | absolute URL for magic links, webhook action URLs, and static-asset URLs (`/assets/refusal-tone.wav`) referenced from TwiML. Not in `wrangler.jsonc`'s committed `vars` because its value is specific to your domain — set as a secret so it never needs a code/config-file change per deployment. |
| `DATABASE_URL` | secret | `wrangler secret put DATABASE_URL` | **yes** — the Neon **app role** connection string from §2 | Postgres connection; production boot guard refuses a non-EU host |
| `BETTER_AUTH_SECRET` | secret | `wrangler secret put BETTER_AUTH_SECRET` | **yes** — generate a fresh value (e.g. `openssl rand -base64 32`); never reuse the value from `.env.example` | Better Auth session/token signing secret |
| `PIN_PEPPER` | secret | `wrangler secret put PIN_PEPPER` | **yes** — generate fresh, same way | HMAC pepper for SMS-PIN hashing (ER-SEC-3) |
| `TELEPHONY_PROVIDER` | var | `wrangler.jsonc` `vars` (`"mock"` for first deploy) | no for the first deploy; **yes** — flips to `"twilio"` at §8 | selects the seam implementation |
| `MOCK_WEBHOOK_SECRET` | secret | `wrangler secret put MOCK_WEBHOOK_SECRET` | **yes** — generate fresh; must differ from the repo's dev default | the mock provider's webhook-signing secret during the mock-provider smoke phase. `env.ts` **refuses to boot** in production with `TELEPHONY_PROVIDER=mock` if this is unset or equals the dev default (ER-WEB-1 production boot guard) — this is not optional. |
| `TWILIO_REGION` | var | `wrangler.jsonc` `vars` (already `"ie1"`) | no | ER-RES-3; only `ie1` is supported by this build |
| `TWILIO_ACCOUNT_SID` | secret | `wrangler secret put TWILIO_ACCOUNT_SID` | **yes** — set only at §8 (the flip) | Twilio credential |
| `TWILIO_AUTH_TOKEN` | secret | `wrangler secret put TWILIO_AUTH_TOKEN` | **yes** — set only at §8 | Twilio credential (also verifies `X-Twilio-Signature`) |
| `TWILIO_SMS_FROM` | secret | `wrangler secret put TWILIO_SMS_FROM` | **yes** — set only at §8 (a Twilio-owned E.164 SMS sender) | SMS-PIN sender number; required (boot-guarded) once `TELEPHONY_PROVIDER=twilio` |
| `EMAIL_PROVIDER` | var | `wrangler.jsonc` `vars` (unset → defaults to `"dev"`; add `"resend"` at §7) | no default needed for first deploy; **yes** at §7 | selects the `EmailSender` |
| `RESEND_API_KEY` | secret | `wrangler secret put RESEND_API_KEY` | **yes** — set at §7 | Resend API key (required once `EMAIL_PROVIDER=resend`) |
| `RETENTION_CALL_LOG_MONTHS` | var | `wrangler.jsonc` `vars` (already `"13"`) | no for the default; **yes** if you sign off on a different window (OWN-6, `docs/runbook.md`) | ER-RET-1 |
| `RETENTION_SECURITY_LOG_DAYS` | var | `wrangler.jsonc` `vars` (already `"90"`) | no | ER-RET-2 |
| `COMPLIANCE_POSTURE` | var | `wrangler.jsonc` `vars` (already `"app_layer"`) | no unless OWN-1's posture decision flips it to `"nbics_provider"` | ER-POST-1 |
| `ENABLE_DEV_ROUTES` | var | **must stay unset** (default `false`) — do not add this to production `vars` | no | gates `/dev/*`; these routes must never be reachable in production |
| `ANOMALY_DAILY_CALLS` / `ANOMALY_DAILY_MINUTES` / `ANOMALY_NIGHT_CALLS` / `ANOMALY_CZ_FAILURE_PCT` | var | `wrangler.jsonc` `vars` (defaults are reasonable; tune later) | no | ER-RATE-3 / ER-OBS-1(b) thresholds |
| `APPSIGNAL_PUSH_API_KEY` | secret | `wrangler secret put APPSIGNAL_PUSH_API_KEY` (optional) | **yes**, optional | activates AppSignal transport for the redacted alert log lines (§9.8) |

Set the minimum set for a first (mock-provider) deploy — `APP_BASE_URL`, `DATABASE_URL`,
`BETTER_AUTH_SECRET`, `PIN_PEPPER`, `MOCK_WEBHOOK_SECRET`:

```bash
pnpm --filter api exec wrangler secret put APP_BASE_URL
pnpm --filter api exec wrangler secret put DATABASE_URL
pnpm --filter api exec wrangler secret put BETTER_AUTH_SECRET
pnpm --filter api exec wrangler secret put PIN_PEPPER
pnpm --filter api exec wrangler secret put MOCK_WEBHOOK_SECRET
```

(Each prompts interactively for the value — nothing goes on the command line or into shell
history.)

Then deploy:

```bash
pnpm --filter api exec wrangler deploy
```

This is the same command whose `--dry-run` form gates this milestone locally
(`pnpm --filter web build && pnpm --filter api exec wrangler deploy --dry-run`) — a real
deploy is that command without the flag, after secrets are set.

---

## 6. Custom domain

Attach a custom domain to the Worker (Cloudflare dashboard → Workers & Pages → your
Worker → **Settings → Domains & Routes** → **Add Custom Domain**) — **[OWNER]**, since this
is your domain. This is a prerequisite, not an optional nicety: it's the value
`APP_BASE_URL` must match, and it's what lets you later switch on Cloudflare **Regional
Services (EU)** without re-architecture (ER-RES-2 — ships as a documented recommended
hardening step, not built by default; decide and record in
`docs/compliance/transfer-register.md`, OWN-7).

Once attached, set `APP_BASE_URL` to `https://<your-domain>` (§5) and redeploy if you set it
before the domain existed.

---

## 7. Smoke checks

Run these against `https://<your-domain>` after the first deploy:

1. **Health.**
   ```bash
   curl -s https://<your-domain>/health
   # expect: {"ok":true,"service":"telocc-api"}
   ```
2. **Cron trigger is registered.** Cloudflare dashboard → your Worker → **Triggers** → Cron
   Triggers should list `17 2 * * *`. (§8 below covers confirming it actually *ran*.)
3. **Signed-webhook self-test** (proves ER-WEB-1's verification path end-to-end against the
   real deployed endpoint, using the mock scheme — `x-mock-signature` /
   `x-mock-timestamp`, HMAC-SHA256 over `timestamp.rawBody`):

   ```bash
   #!/usr/bin/env bash
   # smoke-webhook.sh — self-test the mock webhook signature path against a live deploy.
   set -euo pipefail
   BASE_URL="https://<your-domain>"
   SECRET="<the MOCK_WEBHOOK_SECRET you set in §5>"

   TS=$(date +%s)
   BODY='{"type":"call.incoming","callRef":"smoke_test_001","to":"+420212345678","from":null}'
   SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')

   curl -s -o /dev/stderr -w '\nHTTP %{http_code}\n' \
     -X POST "$BASE_URL/webhooks/telephony/mock" \
     -H "x-mock-timestamp: $TS" \
     -H "x-mock-signature: $SIG" \
     -H 'content-type: application/json' \
     -d "$BODY"
   # A 200 (or a JSON instruction body) proves signature verification + parsing + routing
   # all executed on the deployed instance. A random/wrong SIG should instead 401 — worth
   # trying once to confirm rejection also works, then discard the test call's row
   # (`purge_runs`/the 4h call_sessions sweep will clean it up automatically either way).
   ```

   Since `callRef=smoke_test_001` doesn't correspond to a real org's business number, expect
   this to resolve as an unroutable/ignored event rather than a "successful call" — the point
   of this check is exercising signature verification and the parse→route pipeline on the
   live deploy, not simulating a real customer call (use the local demo's simulator for that,
   §12 of `docs/design.md`, or your own onboarded org + the DTMF flow once you have a real
   number).
4. **KYC upload boundary** (optional, one-time): once you've completed your own org's
   onboarding on the live deploy (§8 needs you to do this anyway before purchasing a real
   number), upload a document at or near the 5 MB cap via the settings/onboarding UI to
   confirm the neon-http transport headroom holds in production (`docs/decisions.md` #33) —
   not scriptable simply since it needs an authenticated session cookie.

---

## 8. Scheduled jobs (retention purge + anomaly scan)

The Cron Trigger (`17 2 * * *` UTC, set in `wrangler.jsonc`) calls `runScheduledJobs` daily —
purge/anonymise steps 1–7 (`docs/design.md` §10.1). To verify the first run actually
executed:

1. Wait until just after 02:17 UTC (or trigger it manually once via the Cloudflare dashboard's
   **Triggers → Cron Triggers → Trigger manually**, if available on your plan).
2. Query the `purge_runs` table (via the Neon SQL console, or `psql` with the migration
   role's connection string):
   ```sql
   select * from purge_runs order by ran_at desc limit 1;
   ```
   A row with a recent `ran_at` and a `stats` JSON blob (counts only — no personal data)
   confirms the job ran end-to-end. If no row appears after 24h, check
   **Workers → your Worker → Logs** for a thrown error in `scheduled()`.

---

## 9. Email provider (Resend) wiring

1. **[OWNER]** Create a Resend account, verify a sending domain (so magic-link emails don't
   land in spam), and generate an API key.
2. `pnpm --filter api exec wrangler secret put RESEND_API_KEY`.
3. Add `"EMAIL_PROVIDER": "resend"` to `wrangler.jsonc`'s `vars` (replacing the implicit
   `dev` default) and redeploy.
4. Record Resend in `docs/compliance/transfer-register.md`'s email-provider row (its DPA,
   region/mechanism) — this vendor row is one of the artifacts ER-POL-5 asks for.
5. Smoke-test: trigger a real magic-link sign-in against the live deploy and confirm the
   email arrives (not just the dev in-process mailbox, which is unreachable in production
   since `ENABLE_DEV_ROUTES` is off).

---

## 10. The mock → Twilio flip

This is the one section of this guide gated on you actually having a Twilio account,
credentials, and (eventually) a purchased number — per `docs/brief.md`'s goal, this and a
purchased number are the *only* things standing between this build and live calls. No code
changes are required: `apps/api/src/deps.ts` constructs the real `TwilioProvider` whenever
`TELEPHONY_PROVIDER=twilio`, and `env.ts` refuses to boot in that mode unless
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_SMS_FROM` are all set (the same
boot-guard pattern as the EU-database check). `TWILIO_SMS_FROM` is a Twilio-owned E.164
sender number for SMS-PIN delivery — deliberately separate from any org's business number,
since verification can run before a business number exists.

### Step 1 — Twilio account, region, credentials

1. **[OWNER]** Create a Twilio account (or use an existing one) and confirm/select the
   **IE1 (Ireland)** region for voice + SMS (ER-RES-3) — this is what `TWILIO_REGION=ie1`
   in `wrangler.jsonc` assumes and what `packages/telephony/src/twilio/config.ts` hard-pins.
2. Set credentials: `pnpm --filter api exec wrangler secret put TWILIO_ACCOUNT_SID` and
   `... TWILIO_AUTH_TOKEN`.
3. Do **not** flip `TELEPHONY_PROVIDER` to `twilio` yet — do that last (step 5), after your
   own org is fully onboarded against these credentials.

### Step 2 — regulatory bundle, KYC, and number purchase (OWN-10)

You (the owner) go through Telocc's own onboarding UI as if you were a customer, against the
live-Twilio-backed deploy (still with `TELEPHONY_PROVIDER=mock` until step 5 — the KYC/number
routes call the seam, so switch providers only once you're ready to actually submit real
data to Twilio):

1. Confirm the exact CZ regulatory-bundle document list by calling
   `GET /api/kyc/requirements` once `TELEPHONY_PROVIDER=twilio` is live (it proxies Twilio's
   Regulations API — `getRequiredDocuments`, `packages/telephony/src/twilio/rest.ts`'s
   `buildRegulationsRequest`/`parseRegulationsResponse`) — do this as your very first
   Twilio-backed action, before relying on any hard-coded assumption about the list.
2. Confirm with Twilio (support ticket or docs) whether **Telocc** or **your customer org**
   is the regulatory end user in this single-tenant-per-deploy setup, and which entity in
   Twilio's CZ number chain is the ČTÚ-registered carrier of record (OWN-10's two open
   sub-questions).
3. Submit your org's KYC (legal name, IČO, CZ street address — no PO box, `docs/design.md`
   §3.2/ER-KYC-2) and documents through the app's onboarding UI; this calls `submitBundle`.
4. Pick a number from the catalog (`GET /api/numbers/catalog?region=…`) and provision it
   (`POST /api/numbers/provision`) — this purchases a real Twilio number and costs money.
   **[OWNER]** confirm you're ready to spend before this step.
5. Confirm the **number-class product decision** (OWN-5): the default catalog serves
   `geographic` numbers; if international-arrival CLI blocking (register item 10) makes a
   `nomadic_910` or `mobile` number the better fit for your traffic pattern, that's a
   `numberClass` change at this step, not a redesign (`business_numbers.number_class`,
   ER-KYC-3).

### Step 3 — webhook URLs on the number

`provisionNumber`'s Twilio request (`buildIncomingPhoneNumberCreateRequest`,
`packages/telephony/src/twilio/rest.ts`) already sets `VoiceUrl`, `VoiceMethod=POST`,
`StatusCallback`, and `StatusCallbackMethod=POST` on the number at purchase time — all
pointing at `${APP_BASE_URL}/webhooks/telephony/twilio` — so **no manual webhook
configuration is needed** for a number purchased through the app's own provisioning flow.
If you ever port in or manually attach a number via the Twilio console instead, set these by
hand to the same URL:

- **Voice URL** (A call comes in): `https://<your-domain>/webhooks/telephony/twilio`,
  method `POST`.
- **Status Callback**: same URL, method `POST` — this is where Twilio also delivers
  Bundle status callbacks and Message status callbacks once configured on those resources.

### Step 4 — Voice Geographic Permissions (ER-EMG-2)

**[OWNER]** In the Twilio console, restrict **Voice Dialing Geographic Permissions** to deny
high-risk/premium-rate ranges, mirroring `dial_policy_prefixes`'s deny-list at the carrier
layer too (belt-and-braces: the app already refuses these targets before ever calling the
seam, ER-EMG-1/2, but Twilio's own AUP requires it independently and it costs nothing to add).

### Step 5 — the CZ→CZ deliverability gate (OWN-4 / ER-OBS-1) — flip the capability flag

Before relying on the appless-outbound feature for real Czech destinations:

1. **[OWNER]** Obtain Twilio's **written confirmation** (support ticket response, or
   documented account-team confirmation) that calls presenting your purchased +420
   geographic CLI to Czech destinations terminate via **domestic Czech interconnection** —
   not international. If Twilio cannot confirm this, both the forwarded and bridged legs
   toward Czech phones are exposed to ČTÚ's anti-spoofing block at international
   interconnection (register item 10) — treat "no answer" from Twilio as "not yet
   confirmed", not as an implicit yes.
2. Only once that written confirmation exists, flip the seam's capability constant from
   `'unverified'` to `true`:
   ```ts
   // packages/telephony/src/twilio/provider.ts
   const TWILIO_CAPABILITIES: ProviderCapabilities = {
     czCliDomesticTermination: true, // was 'unverified' — flip only per OWN-4/ER-OBS-1 above
     instantProvisioning: false,
     supportedNumberClasses: ['geographic', 'nomadic_910', 'mobile'],
   };
   ```
   This is a one-line, reviewable change specifically so the go-live gate is a visible diff,
   not a config toggle that can drift silently — until it happens, the UI keeps warning at
   number selection (`docs/design.md` §4.4).

### Step 6 — flip `TELEPHONY_PROVIDER` and redeploy

```bash
# in wrangler.jsonc's "vars": "TELEPHONY_PROVIDER": "twilio"
pnpm --filter web build && pnpm --filter api exec wrangler deploy --dry-run   # confirm still green
pnpm --filter api exec wrangler deploy
```

### M9 wiring-time spot-check list

`packages/telephony/src/twilio/**` was built entirely from Twilio's published documentation
(zero live traffic, zero credentials, per the brief's constraint) and explicitly flags six
places worth re-checking against Twilio's *current* behaviour once you have a live account,
before trusting them at volume:

1. **Multipart `SupportingDocuments` rebuild** — `rest.ts`'s
   `buildSupportingDocumentRequest` models the KYC document upload as
   form-urlencoded-with-base64 for unit-testability; a real Twilio submission needs a true
   `multipart/form-data` request with a binary file part. Rebuild the body as multipart
   before relying on `submitBundle` in production.
2. **Regulations API response shape** — `parseRegulationsResponse` is a best-effort reader
   over Twilio's documented nested `results[].requirements.{end_user,supporting_document}`
   shape. Confirm against a real response for CZ before trusting the document checklist
   blind.
3. **Regional host convention** — `config.ts`'s `twilioNumbersBase()` assumes the
   `<service>.<region>.twilio.com` pattern (documented for the voice/messaging `api` host)
   also applies to `numbers.twilio.com` for IE1 residency. Confirm against Twilio's current
   regional API docs; if wrong, KYC/bundle/number calls will 404 or silently hit the wrong
   region.
4. **`nomadic_910` → `Mobile` mapping** — Twilio's generic API has no distinct
   AvailablePhoneNumbers type for CZ's 910 range; `rest.ts` maps it to `Mobile` as the
   closest analogue. Confirm this actually returns 910-range numbers (not ordinary mobile
   numbers) before offering it in the catalog.
5. **Bundle `Email` placeholder** — `buildBundleCreateRequest` sends
   `compliance+<ico>@telocc.invalid` as the Bundle's contact email. Replace with a real,
   monitored address before submitting your first real bundle — Twilio may send regulatory
   correspondence there.
6. **Provisioning status semantics** — `getProvisioningStatus` treats a successful GET on
   `IncomingPhoneNumbers/{sid}` as `active` (that resource has no lifecycle `status` field
   of its own). Confirm this matches your actual experience of the pending → active
   transition; if Twilio's real timing differs, the UI's "pending regulatory review" state
   (ER-KYC-1) may need its polling cadence adjusted, not its logic.

### Smoke test for a first live call/SMS (kept behind owner action)

Nothing here fires automatically — every step below is something you, the owner, run once
by hand, deliberately, with a real phone:

1. Send yourself the SMS-PIN verification during your own org's onboarding (already done in
   step 2 if you completed it before the flip; re-verify now that `TELEPHONY_PROVIDER=twilio`
   is live) — confirms `sendSms` reaches a real phone.
2. Call your new business number from an unverified phone during office hours — confirms
   inbound forwarding to your verified personal number, with the business number as caller
   ID.
3. Call your own business number **from** your verified personal number — confirms the
   appless dial-in path: auto-answer, DTMF collection, then dial a real (non-emergency,
   non-premium) CZ number and confirm the bridge connects with the business number
   presented as caller ID, and that hanging up either side drops both legs.
4. Dial `112` through the DTMF flow deliberately — confirm you get the refusal tone, not a
   ringing call, and that `calls.status = 'emergency_refused'` shows up in your call log.
5. Check `docs/runbook.md`'s go-live checklist — steps 1–4 above only prove the technical
   seam works; the regulatory/legal gates in that checklist govern whether you're clear to
   actually rely on this in production for real customers.

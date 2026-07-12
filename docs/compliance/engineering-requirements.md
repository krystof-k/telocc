# Telocc — Compliance-Driven Engineering Requirements

**As of:** 2026-07-12.
**Source:** `docs/compliance/register.md` (register item numbers referenced as "Reg #N").
This file is the buildable translation of the register: every requirement states **what** must exist, **why** (which register item imposes it), and **how it should manifest** in the system design. IDs (`ER-…`) are stable and referenced from the register.

Conventions: "seam" = the telephony-provider abstraction from the brief; "mock" = the mock provider; "wiring time" = the owner's later live-Twilio step. Nothing here requires a live provider account.

---

## 1. Retention & purge

### ER-RET-1 — Call-log retention window + scheduled purge/anonymise job
- **What:** A single, named, documented retention window for call-log rows (timestamp, direction, duration, status, numbers), enforced by a scheduled job that either deletes the row or anonymises it by stripping **both** phone numbers (optionally keeping the aggregate row for counts). Default proposal: **13 months** (year-over-year view + billing-dispute horizon); the value is config, owner-set (Reg OWN-6).
- **Why:** Reg #22 (ePrivacy/ZEK § 90 traffic-data substance + GDPR storage limitation); Reg #23 (deliberately NO § 97 six-month retention capability — do not build retention "for compliance", it conflicts with GDPR minimisation and the NS 30 Dec 2025 ruling).
- **How:** `retention.callLogMonths` config with the documented default; a scheduled worker (Workers Cron Trigger — the one "genuinely persistent" thing the brief allows) that runs daily, org-scoped, idempotent, and writes a purge-audit line (counts only, no personal data). Schema keeps the fields (calling/called number, start, duration, service type) individually strippable so a future legal flip to provider-posture retention is a config/legal change, not a migration. No lawful-intercept or handover hooks anywhere in the seam.

### ER-RET-2 — Short-window purge of auth/security logs
- **What:** Auth events, verification attempts, and rate-limit counters auto-purge after a fixed short window (default 90 days; document it).
- **Why:** Reg #15 (keeps the Art 6(1)(f) legitimate-interest balancing valid — security logs must be minimal and time-limited); Reg #18.
- **How:** Same scheduled job; separate config key `retention.securityLogDays`; window stated in the privacy notice and RoPA.

### ER-RET-3 — Token/PIN artifact cleanup
- **What:** Expired magic-link token hashes and SMS-PIN hashes are deleted promptly after expiry/consumption (not merely flagged).
- **Why:** Reg #18 (Art 32 minimisation of credential material at rest).
- **How:** TTL columns + the scheduled purge job; issuance/attempt *events* (without secret values) may persist under ER-RET-2 for breach forensics.

---

## 2. Erasure & export (data-subject rights)

### ER-DSR-1 — Org-scoped export endpoint
- **What:** An authenticated endpoint producing a machine-readable export (JSON, plus CSV for the call log) of: account data (email, verified number, settings, business-number details) and the full call log.
- **Why:** Reg #17 (GDPR Art 20 portability; also serves Art 15 access).
- **How:** Owner-triggered from settings; org-scoped by construction; synchronous download at MVP scale; format documented in the privacy notice.

### ER-DSR-2 — Cascading deletion with documented carve-outs
- **What:** Account/org deletion flow that cascades: person, verified number, call log, auth artifacts, KYC documents, sessions — with a written carve-out list (billing/tax records kept under legal obligation, retention period stated).
- **Why:** Reg #17 (Art 17 erasure + carve-outs); Reg #14 (deletion on termination is an Art 28 DPA commitment).
- **How:** Single transactional deletion routine + a seam capability `deleteCallRecord`/propagate-delete so provider-side call-record copies can be deleted when live (Twilio supports HTTP DELETE on call records; mock implements it as a no-op success). Deletion writes a minimal non-personal tombstone for the audit trail.

### ER-DSR-3 — DSR handling path and SLA
- **What:** Documented email-based DSR intake (privacy@ address) with a one-month response SLA; processor-side assistance duty to customer orgs (for their callers' requests) written into the DPA.
- **Why:** Reg #17, #14, #20 (privacy contact doubles as DPO-less intake point).
- **How:** Text in the privacy notice + DPA; no self-service tooling beyond ER-DSR-1/2 needed at single-owner scale.

---

## 3. Encryption, hashing, secrets

### ER-SEC-1 — Encryption in transit and at rest
- **What:** TLS on every hop (browser→Worker, Worker→Neon, Worker→provider); Neon encryption at rest; KYC document blobs encrypted, EU-stored.
- **Why:** Reg #18 (Art 32 state-of-the-art baseline); Reg #7 (KYC docs); Reg #25.
- **How:** Platform TLS everywhere (no plaintext listeners anywhere, including the local demo's mock endpoints in production mode); Neon default at-rest encryption documented in the TOMs doc; KYC uploads stored in the EU-region Postgres (bytea/blob or EU object store later), org-scoped, deleted when no longer required.

### ER-SEC-2 — Magic-link token handling
- **What:** ≥128-bit CSPRNG tokens; stored **only as a hash**; single-use; TTL ~15 minutes; invalidated on use and on new issuance; enumeration-safe responses ("if that email exists…").
- **Why:** Reg #18 (Art 32 + EDPB 01/2021 — strong hashing makes a token-store breach arguably non-notifiable; OWASP floor).
- **How:** Configure/verify Better Auth to these parameters (hash-at-rest, single-use, TTL); contract test asserting a captured token is unusable after first use and after expiry.

### ER-SEC-3 — SMS PIN handling
- **What:** 4–6 digit PIN stored hashed with HMAC-with-server-secret or a strong KDF (short PINs are brute-forceable regardless of hash — the real control is attempt limiting); hard cap ~5 verification attempts then invalidate; TTL ~10 minutes; resend cooldown + daily cap per phone number and per org.
- **Why:** Reg #18; brief requirement (PIN stored hashed) tightened to Art 32 evidence level.
- **How:** `pin_hash = HMAC(server_secret, pin || challenge_id)`; attempt counter on the challenge row; issuance/attempt events logged without PIN values (feeds ER-RET-2 and breach forensics); contract tests for cap, TTL, cooldown.

### ER-SEC-4 — Secrets, least privilege, log hygiene
- **What:** All secrets in Wrangler/Neon secret stores (never in repo); least-privilege DB credentials; **no personal data (phone numbers, emails) in application logs at the edge** or in AppSignal payloads.
- **Why:** Reg #18; Reg #25 (edge log hygiene is also the residency mitigation).
- **How:** Log-shaping helper that redacts E.164 patterns and emails before any log call; lint/test guard on the helper's use in webhook handlers; documented secret inventory in the TOMs doc.

### ER-SEC-5 — Backups, restore test, regular testing, TOMs doc
- **What:** Automated backups (Neon PITR) + one documented restore test; the Vitest/Playwright suite + dependency updates documented as the Art 32 "regular testing" process; all measures enumerated in `docs/compliance/toms.md`.
- **Why:** Reg #18 (Art 32 lists restore + regular testing explicitly); Reg #4 (same baseline covers a NIS2 lower-regime flip).
- **How:** Restore-test runbook section with a dated log entry; TOMs doc cross-referenced from the RoPA and DPA.

---

## 4. EU data residency

### ER-RES-1 — Neon project in an EU region
- **What:** The production Neon project is created in an EU region. This choice is **immutable per project** — it must be right at creation.
- **Why:** Reg #25; Reg #16 (transfer register records the region).
- **How:** Deploy docs make the region explicit in the create step; CI/deploy check asserts the connection string's region where detectable.

### ER-RES-2 — Edge processing minimisation + Regional Services readiness
- **What:** Until Cloudflare Regional Services (EU) is purchased/enabled: no personal data in Workers logs/analytics; no caching, KV, or Durable-Object persistence of personal data at the edge; Postgres is the single store. The app/API is served on a **custom domain** so Regional Services can be switched on without re-architecture.
- **Why:** Reg #25 (Workers execute globally by default — that is processing outside the EEA, lawful under the Cloudflare DPA+DPF but to be minimised; Regional Services is the EU-only fix, an owner purchase decision, OWN-7).
- **How:** Architectural rule enforced in review + a short ADR; custom-domain requirement in deploy docs; the Regional Services step listed as "recommended paid hardening" in the go-live runbook.

### ER-RES-3 — Twilio IE1 region at wiring
- **What:** Voice and SMS/verify traffic pinned to Twilio's Ireland (IE1) region when the live account is wired; recorded in the transfer register.
- **Why:** Reg #25; Reg #16.
- **How:** The seam's real-provider config takes an explicit `region` parameter defaulting to `ie1`; go-live runbook step + transfer-register row (OWN-7).

---

## 5. Webhook authentication

### ER-WEB-1 — Provider signature verification on every inbound webhook
- **What:** Every provider callback (voice events, SMS status, inbound call events) is authenticated by verifying the provider's signature before any processing; unsigned/invalid requests are rejected (401) and counted; replay is bounded (timestamp tolerance where the provider scheme supports it).
- **Why:** Brief boundary requirement; Reg #18 (Art 32 integrity measure); Reg #13 (23/2025 Sb. — a spoofed webhook is "use by an unauthorised person"; the initiation path is a compliance control).
- **How:** Signature check in seam-level middleware so application logic never sees unverified payloads; the mock signs its events with a dev secret so the verification path is exercised end-to-end in tests and the local demo; rejected-signature counter feeds ER-RATE-3 alerting.

---

## 6. Rate limits & anti-abuse

### ER-RATE-1 — Auth surfaces (magic-link + SMS PIN)
- **What:** Per-IP and per-identifier rate limits on every endpoint that triggers an email or SMS send; resend cooldowns; daily caps per phone number and per org (SMS-pumping defence).
- **Why:** Reg #18 (OWASP floor; Art 6(1)(f) fraud-prevention basis documented in RoPA); Reg #15.
- **How:** Counter table or DO-free fixed-window counters in Postgres (no personal data at edge per ER-RES-2); generic error responses; limits documented in the TOMs doc.

### ER-RATE-2 — DTMF dial-in bridge limits
- **What:** Per-org: dial-in attempts/hour cap; concurrent-bridge cap = 1 (MVP); daily outbound minutes/spend cap with hard cutoff; inactivity timeout on the DTMF collection phase.
- **Why:** Reg #13 (toll-fraud/IRSF threat model is exactly this feature); Reg #5 (Twilio AUP compliance); brief boundary.
- **How:** Enforced in application logic before the seam's `dial` is called; caps configurable per org with safe defaults; breaches logged as distinct call-log statuses.

### ER-RATE-3 — Outbound anomaly guards
- **What:** Soft caps/alerts on unusual outbound volume, odd-hours calling, or new destination patterns per org, so a compromised account cannot generate fraud-scale traffic under the business CLI.
- **Why:** Reg #13 (23/2025 Sb. operator-side scoring — anomalous traffic gets Telocc's numbers flagged/blocked); Reg #9 (audit defensibility).
- **How:** Daily aggregate job over the call log + AppSignal alert thresholds; runbook section on responding when a provider/operator flags Telocc traffic.

---

## 7. Emergency numbers & destination policy in the DTMF flow

### ER-EMG-1 — Explicit rejection of emergency numbers
- **What:** DTMF target validation MUST reject **112, 150, 155, 156, 158** and short-code patterns generally, with a distinct refusal signal (tone/announcement-free per the no-IVR spec, but audibly distinct — e.g. distinct busy cadence) — never a silent failure; each refusal logged as a distinct call-log status with reason `emergency_refused`.
- **Why:** Reg #5 (ZEK § 33/EECC 109(2) collision with Twilio's CZ emergency prohibition — half-supporting would breach Twilio policy and produce a location-less mis-routed call; the refusal must be auditable). CORE-FEATURE conditional item; posture decision is OWN-1/OWN-2.
- **How:** Validation layer between DTMF collection and the seam; deny-list of emergency short codes + a general "reject non-E.164/short-code targets" rule; contract test: dialing 112 through the demo produces a logged refusal, not a call.

### ER-EMG-2 — Destination allowlist & premium-rate exclusion
- **What:** Default destination policy: **CZ national E.164 (+420) only**, excluding emergency short codes and premium/shared-cost prefixes (90x-style value-added ranges); international dialing OFF by default. At wiring time, mirrored with Twilio Voice Dialing Geographic Permissions (deny high-risk ranges) so policy is enforced at both layers.
- **Why:** Reg #13 (IRSF/toll fraud); Reg #5 (Twilio prohibits premium/shared-cost destinations outright).
- **How:** Policy module consulted by the same validation layer as ER-EMG-1; policy data-driven (prefix table, seedable); go-live runbook step for Geo Permissions; refusals logged with reason `destination_blocked`.

### ER-EMG-3 — Emergency-limitation disclosure at three points
- **What:** Prominent disclosure — "Telocc cannot carry emergency calls. To reach emergency services, hang up and dial 112 (or 150/155/158) directly from your phone's dialer." — shown (1) during personal-number verification, (2) in settings, (3) in the ToS.
- **Why:** Reg #5 (industry practice for VoIP emergency limitation; the mitigation record if the posture question lands badly).
- **How:** i18n-routed copy at points (1) and (2) — `packages/i18n` has a real locale mechanism (`setLocale`/`getLocale`, default `en`, per-key fallback) and a Czech (`cs.ts`) translation of exactly this emergency-disclosure/verification namespace, initialised in `apps/web` from `navigator.language`; verification-flow step requires scrolling past/acknowledging it. Point (3), the ToS, is static drafted prose (`docs/legal/tos.md`, ER-POL-2) — not i18n-templated. Czech translation of the rest of the app, and of the legal drafts, is an owner/translation backlog item, not part of this ER's scope.

---

## 8. CLI binding & call-leg controls

### ER-CLI-1 — Strict initiator binding for outbound presentation
- **What:** Only the SMS-verified personal number of the org that owns the business number may trigger an outbound bridge presenting that number. The initiating caller's number is taken from **provider signalling** (not user input) and matched against the org's verified number; mismatch → decline, logged.
- **Why:** Reg #9 (the linkage that makes CLI presentation defensible under VO-S/2/04.2024-1's real+linked+callable test — a compliance control, not just UX); Reg #13 (CLI is spoofable end-to-end — authentication-by-hint; the audit trail plus ER-RATE-2 caps bound the damage; note in docs that an optional secret DTMF PIN is the cheap hardening if spoofing against the dial-in line is ever observed).
- **How:** Seam delivers the signalling CLI verbatim; application matches exact E.164 against the org's verified number; every accepted initiation writes initiator-person, source CLI, target, timestamps to the call log (ER-AUD-1).

### ER-CLI-2 — Forwarded-leg CLI strategy + always-callable business number
- **What:** (a) The forwarded (inbound→personal) leg presents the **business number** as CLI by default; never pass through an original caller's CLI (a Czech fixed third-party CLI on a leg that may originate abroad would be blocked and is not Telocc's number to present). Strategy configurable at the seam. (b) The business number must **always accept inbound** — out-of-hours handling declines at the signalling level (busy) without ever leaving the number unroutable or unresponsive; the number is never parked unreachable while used as CLI.
- **Why:** Reg #9 ("callable back" limb); Reg #10 (both legs toward Czech phones are exposed to the international-arrival block).
- **How:** `forwardedLegCliStrategy: 'business_number'` seam config (only value implemented in MVP); inbound webhook path has no code path that leaves the number unroutable; office-hours decline is `<Reject reason="busy"/>` — a signalling-level decline, never answered-then-declined (decisions.md #20) — logged as `declined/out_of_hours`. The compliance intent (the number always routed and responsive) is met either way; this documents the actual mechanism.

### ER-CLI-3 — Seam accepts only the org's provisioned number as presented identity
- **What:** The seam's outbound-dial API takes the org's business-number entity (not a free-form CLI string). Arbitrary/user-supplied CLI values are unrepresentable in the interface.
- **Why:** Reg #9 (no spoofing capability exists to misuse); Reg #13.
- **How:** Type-level: `dial({ orgBusinessNumberId, target })`; the provider implementation resolves the E.164 internally; code review invariant.

---

## 9. Number provisioning, KYC, number lifecycle

### ER-KYC-1 — Async provisioning state machine (numbers do NOT activate instantly)
- **What:** Number provisioning modeled as: `requested → docs_pending → bundle_submitted → approved | rejected → active`, plus `porting_out`, `released`. UI honours "pending regulatory review". The mock provider auto-approves so the local demo still feels instant. **This contradicts the brief's "activates immediately" line — the spec tension is recorded in Reg #7 and stands as a compliance-driven correction.**
- **Why:** Reg #7 (verified: CZ numbers require an approved Twilio regulatory bundle; a rejected/pending bundle cannot be mapped to a number).
- **How:** State column on the business-number entity; transitions only via seam callbacks/polls; UI states for pending/rejected with remediation copy; demo seed data starts in `active`.

### ER-KYC-2 — Org KYC capture, validation, and storage
- **What:** Onboarding collects the customer org's end-user regulatory identity: legal name, business-registration identifier (IČO field), CZ **street address** (validated: country=CZ for CZ geographic numbers; no PO boxes), and identity/registration document upload; region → TC-area-code mapping drives the "numbers for your region" catalog and is **data-driven/seedable** so it can be corrected against Decree 117/2007 Sb. at wiring.
- **Why:** Reg #7 (bundle contents; PO-box rule; matching documents); Reg #11 (regional tie of geographic numbers); Reg #6 (accuracy of end-user registration is the binding constraint).
- **How:** KYC tables shaped like Twilio's Bundle/EndUser/SupportingDocument concepts behind the seam; the required-document checklist is fetched from the Regulations API at wiring rather than hard-coded (mock serves a fixture checklist); documents encrypted + EU-stored + org-scoped + deleted when no longer required (ER-SEC-1, ER-DSR-2); bundle SIDs recorded on the org; no number is offered to an org before its end-user record exists.

### ER-KYC-3 — Number-class attribute + end-user-of-record + open-ended lifecycle
- **What:** The business-number entity carries a `number_class` attribute (`geographic | nomadic_910 | mobile`) giving **schema-level** support for more than one class — the column and the seam's `supportedNumberClasses` capability list both already model it — so a future pivot needs a provisioning-flow change, not a schema/data migration; the customer org (not Telocc) is registered as end user of record; lifecycle states stay open-ended (ER-KYC-1 set) even though MVP uses few; on offboarding, numbers are released to the provider pool and the event audit-logged.
- **Why:** Reg #10/OWN-5 (number class may be the practical fix for CZ→CZ blocking); Reg #6 (chain of title); Reg #8 (clean future port-out; ToS OKU placeholder).
- **How:** Enum column + seam capability flags per class (schema-ready); **today's provisioning flow hard-codes `numberClass: 'geographic'`** at both catalog search and provisioning (`apps/api/src/routes/numbers.ts`) — supporting `nomadic_910`/`mobile` in practice still needs that call-site change, just not a data-model one; release flow through the seam; ToS clauses in ER-POL-2.

---

## 10. Audit trail & observability

### ER-AUD-1 — Call log as immutable audit trail
- **What:** Append-only call log, org-scoped: timestamp, direction, duration, status (answered / missed / declined / failed / blocked / `emergency_refused` / `destination_blocked`), initiating person (outbound), source CLI, target, provider disposition/error code. Access restricted to the org itself; there is no in-app admin/"break-glass" route at all.
- **Why:** Reg #9 (demonstrable CLI legitimacy per presentation); Reg #13 (traffic-legitimacy evidence for carrier/ČTÚ inquiries); Reg #21 (breach scoping); Reg #22 (access restriction); Reg #12 (evidence trail if a customer's calling is challenged).
- **How:** No UPDATE path on call rows in application code (status transitions modeled as final-state writes from webhook events); retention per ER-RET-1. Break-glass is safe by **absence**, not by logging: no code path exists for an admin to read across orgs — the only way to bypass org-scoping is direct database access outside the application, which is a documented runbook procedure (`docs/runbook.md` "Break-glass call-log access"), not a logged application capability; an operator who ever exercises it manually records a reasoned entry per that procedure.

### ER-AUD-2 — Admin & auth event log
- **What:** Log of security-relevant events: logins, magic-link issuance/use, PIN issuance/attempts (no secret values), settings changes (verified-number change, office hours), number lifecycle transitions, deletion/export actions.
- **Why:** Reg #18 (Art 32 testing/forensics); Reg #21 (72-hour breach clock needs scoping data); Reg #4 (NIS2-lower-regime readiness).
- **How:** Single `audit_events` table (actor, org, event type, minimal metadata), purged per ER-RET-2 except lifecycle events which follow ER-RET-1.

### ER-AUD-3 — Regulator-shaped reporting export
- **What:** An admin export that can produce per-service volumes (calls, minutes; revenue once billing exists) with **half-year cutoffs (30 June / 31 December)** — the shape ČTÚ's ESD forms (ART252/ART251) ask of notified providers.
- **Why:** Reg #2 (cheap now, painful to retrofit; only used if posture A is chosen).
- **How:** SQL view/report over the call log keyed by calendar half-years; no UI needed — a documented script/endpoint is enough.

### ER-OBS-1 — CZ deliverability observability + go-live gate
- **What:** (a) Provider disposition/error codes surfaced on every call row; (b) alert on elevated failure rates for CZ-destination legs; (c) a seam **capability flag** `czCliDomesticTermination: boolean | 'unverified'` and a go-live runbook gate: the flag may only be set `true` on Twilio's written confirmation that CZ-bound legs presenting the +420 CLI terminate via domestic interconnection.
- **Why:** Reg #10 (verified: foreign-arriving +420 non-mobile CLI is blocked; the feature's CZ→CZ deliverability is unproven until Twilio confirms routing — OWN-4).
- **How:** Disposition column (ER-AUD-1) + AppSignal alert; capability flag read at provisioning time to warn in the UI if the selected number class is exposed; runbook step with the exact question to put to Twilio.

---

## 11. Disclosures, policies, and drafted legal texts (all DRAFTED — owner legal sign-off required before launch)

### ER-POL-1 — Privacy notice (draft)
- **What:** Draft privacy notice covering: each purpose + lawful basis (account/PIN/magic-link = Art 6(1)(b); anti-abuse logs = 6(1)(f) with the LIA referenced; invoicing = 6(1)(c) when billing exists); exactly which call metadata is kept and for how long (mirrors ZEK § 90(6) information duty); retention table (ER-RET-* windows); DSR intake (privacy@, one-month SLA); sub-processor list link; cookies section (ER-COOK-1); no DPO + privacy contact.
- **Why:** Reg #15, #17, #20, #22, #24.
- **How:** `docs/legal/privacy-notice.md` draft, i18n-ready, linked in the app footer; flagged DRAFT until owner sign-off (OWN-8).

### ER-POL-2 — ToS + Art 28 DPA + AUP (draft)
- **What:** One B2B contract pack: plain, legible ToS (business-capacity declaration, clear termination, non-one-sided liability caps); **Art 28 DPA terms** (processing scope, sub-processor authorisation for Twilio/Cloudflare/Neon/email provider, DSR assistance, breach notice, deletion on termination); **AUP** (fraud/abuse suspension right; § 96 telemarketing warning: "cold marketing calls in CZ require the called party's public-directory opt-in or prior consent — fines up to CZK 50M; you are responsible", with ČTÚ manual link, Czech version carrying the § 96 reference); emergency-limitation clause (ER-EMG-3); number-assignment + port-out cooperation clause with an **OKU placeholder**; customer warranty of KYC accuracy passed to the carrier; modular § 63a contract-summary/waiver slot (activated only under posture A).
- **Why:** Reg #14, #12, #5, #8, #6, #3, #27.
- **How:** `docs/legal/tos.md` (+ `dpa.md`, `aup.md`) drafts; a single config point in the signup flow where the contract artifacts are inserted/recorded (ER-POST-1).

### ER-POL-3 — Records of processing (RoPA)
- **What:** `docs/compliance/ropa.md` — controller section (account/auth/security/billing data) and processor section (customer call data): purposes, categories, recipients/sub-processors, transfers + mechanism, retention periods, TOMs reference; includes the short written legitimate-interest assessment for anti-abuse logging.
- **Why:** Reg #19 (Art 30 duty applies despite size), #15.
- **How:** Maintained in-repo; updated on any sub-processor or data-category change; the purge job's configured windows must match it.

### ER-POL-4 — Incident-response + go-live runbook
- **What:** Runbook covering: breach path (detection sources — AppSignal alerts, auth-anomaly logs; 72-hour clock from awareness; ÚOOÚ e-form path; EDPB 01/2021-based risk template; customer-org notification template; internal breach log per Art 33(5); sub-processor breach contacts); provider/operator traffic-flag response (Reg #13); go-live gates: Twilio DPA + IE1 region + Geo Permissions + CZ-termination confirmation (ER-OBS-1) + *identifikovaná osoba* VAT registration within 15 days of first Twilio invoice + DIČ to Twilio for reverse charge.
- **Why:** Reg #21, #13, #16, #25, #29, #10.
- **How:** `docs/runbook.md`; the go-live section is the checklist OWN-4/7/9/10 execute against.

### ER-POL-5 — Transfer register
- **What:** One-page register: vendor, role, data categories, region selected, transfer mechanism (DPF / SCCs / BCR-P), fallback — for Twilio, Cloudflare, Neon, email provider; watch line for CJEU C-703/25 P.
- **Why:** Reg #16, #25.
- **How:** `docs/compliance/transfer-register.md`; rows completed at wiring when DPAs are executed (OWN-7).

### ER-POL-6 — ČTÚ notification pack (contingency, NOT filed)
- **What:** Draft "Oznámení podnikání" pack: completed form template, service description ("publicly available NB-ICS — call forwarding and outbound bridging on CZ geographic numbers hosted with an authorised operator"), plus a one-page "what changes if we notify" memo (CZK 1,000 fee, ESD reporting, § 63a duties, § 97 caveat per Reg #23, NIS2/NÚKIB 60-day registration).
- **Why:** Reg #1, #2 (owner can file in a day if posture A is chosen; nothing is filed speculatively).
- **How:** `docs/compliance/ctu-notification-pack.md` referencing the official form template URL.

---

## 12. Cookies

### ER-COOK-1 — Strictly-necessary cookies only; no banner
- **What:** Only first-party, strictly necessary cookies: Better Auth session cookie (+ CSRF token if cookie-based), flagged HttpOnly/Secure/SameSite. No analytics, no third-party embeds that set cookies, no fingerprinting/localStorage tracking. **No consent banner.** A "Cookies" section in the privacy notice (name, purpose, lifetime of each cookie) linked in the footer. Deploy-checklist gate: adding any analytics/marketing script requires a CMP first.
- **Why:** Reg #24 (ePrivacy Art 5(3)/ZEK § 89(3) exemptions; ÚOOÚ: technical-only sites need no banner but keep the information duty; EDPB 2/2023 broad reading covers localStorage too).
- **How:** Cookie inventory asserted by a Playwright test (exactly the expected cookies, with the expected flags, and nothing else); checklist item in the deploy docs.

---

## 13. Accessibility

### ER-ACC-1 — WCAG 2.1 AA as engineering hygiene (voluntary target)
- **What:** Apply WCAG 2.1 Level AA basics across the app: semantic HTML, form labels, focus management, contrast, keyboard operability. Track WCAG 2.2 AA (incoming EN 301 549 v4.1.1 baseline, expected harmonised ~Oct 2026). **No accessibility statement or authority notification is produced as if legally mandated** — Telocc is out of EAA scope (B2B + microenterprise).
- **Why:** Reg #26 (out of scope, but hygiene is cheap now and future-proofs the growth/consumer tripwires).
- **How:** Component-level conventions (shadcn primitives are largely accessible by default); axe-check pass in Playwright on the main flows; tripwires recorded in the register (OWN-12).

---

## 14. B2B gating

### ER-B2B-1 — Structural B2B signup
- **What:** Signup captures an **organization** (business name; IČO field when CZ billing lands) and an explicit business-capacity declaration: "I am entering this contract as an entrepreneur within my business activity." i18n-routed.
- **Why:** Reg #26 (factual anchor keeping both EAA angles out of scope), Reg #27 (§ 419 consumer status excluded). Owner confirmation OWN-11.
- **How:** Required checkbox + org-name field at first login (org-creation step); declaration text stored with timestamp as a contract artifact (also feeds ER-POL-2's record).

---

## 15. Billing-ready schema (no billing features)

### ER-BILL-1 — VAT-proof data model, dormant
- **What:** Per-org fields ready for future billing: country; VAT ID + VIES-validation status and timestamp; customer type (business/consumer flag — MVP always business); location-evidence fields (billing address + at least one more datum, e.g. IBAN country); invoice-record shape supporting net/rate/amount per line, reverse-charge legend, sequential numbering; per-calendar-year turnover counters against the CZK 2,000,000 and CZK 2,536,500 thresholds. **No OSS/rate tables, no payment integration.**
- **Why:** Reg #28 (turning billing on must not be a schema migration; the registrations themselves are OWN-9).
- **How:** Columns/tables exist and are exercised only by tests; a `docs/decisions.md` note marks them dormant-by-design (not gold-plating — a register-driven requirement).

---

## 16. Posture-flip configurability

### ER-POST-1 — One config point per posture-dependent behavior
- **What:** The behaviors that change if the owner adopts posture A (NB-ICS provider) are each behind a single, documented config point: contract-flow artifacts (§ 63a summary + waiver step), retention preset (service/billing window only — see Reg #23 for why no § 97 preset is shipped), user-facing "who is the provider" copy in ToS, and the reporting export (ER-AUD-3). No "we are not a telco" claim is hard-coded in user-facing copy.
- **Why:** Reg #1–#4 (the classification is open; the build must not need redesign under either answer).
- **How:** `COMPLIANCE_POSTURE: 'app_layer' | 'nbics_provider'` env config, default `app_layer`. Today it has exactly **one** real code branch — `routes/orgs.ts`'s gate on the § 63a contract-summary/waiver step — exercised by `posture-flip.contract.test.ts`. The other three areas named above are not separately code-branched yet: ToS carries the § 63a clause as static prose (marked `[CONDITIONAL CLAUSE …]` for the reader, not templated), `scripts/esd-report.ts` runs unconditionally regardless of posture, and retention windows are independent env vars that never read `COMPLIANCE_POSTURE`. That's sufficient while posture is `app_layer` — none of those three need to differ yet — and the org-creation gate is the working proof that a posture flip is a config point, not a redesign, for whichever of them need to diverge if OWN-1 ever flips it.

---

## Requirement → register traceability

| ER | Register items |
|---|---|
| ER-RET-1..3 | 22, 23, 15, 18 |
| ER-DSR-1..3 | 17, 14, 20 |
| ER-SEC-1..5 | 18, 7, 25, 4 |
| ER-RES-1..3 | 25, 16 |
| ER-WEB-1 | 18, 13 |
| ER-RATE-1..3 | 18, 15, 13, 5, 9 |
| ER-EMG-1..3 | 5, 13 |
| ER-CLI-1..3 | 9, 10, 13 |
| ER-KYC-1..3 | 7, 11, 6, 8, 10 |
| ER-AUD-1..3, ER-OBS-1 | 9, 13, 21, 22, 12, 18, 4, 2, 10 |
| ER-POL-1..6 | 15, 17, 20, 22, 24, 14, 12, 5, 8, 6, 3, 27, 19, 21, 16, 25, 29, 1, 2 |
| ER-COOK-1 | 24 |
| ER-ACC-1 | 26 |
| ER-B2B-1 | 26, 27 |
| ER-BILL-1 | 28 |
| ER-POST-1 | 1, 2, 3, 4, 23 |

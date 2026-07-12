# Telocc — Operations Runbook

> **DRAFT — requires legal/owner review of the breach-response section and the owner
> sign-offs listed in the go-live gates table below.**
> Assembled from `docs/compliance/register.md` (items 13, 21) and ER-POL-4
> (`docs/compliance/engineering-requirements.md`). The **go-live gates** section was
> completed in M11 (`docs/deploy.md`'s companion); this milestone (M8) shipped the
> incident-response path and the anomaly/abuse response procedure that the retention
> job's anomaly scan (§9.9, `packages/core/src/retention.ts`) feeds into.

## Incident response — personal data breach (register item 21; ER-POL-4)

### 1. Detection sources

- AppSignal alerts, once `APPSIGNAL_PUSH_API_KEY` is wired (owner step) — until then,
  the structured, redacted log lines `safeLog()` emits (`apps/api/src/lib/log.ts`) are
  the detection surface: watch for repeated `webhook_rejected`, `anomaly_flagged`, and
  elevated rate-limit `429`s.
- `anomaly_flagged` audit events written by the daily scheduled job
  (`packages/core/src/retention.ts`, design.md §9.9): elevated daily call
  count/minutes, elevated night-time (22:00–06:00 UTC) volume, or an elevated
  failed/blocked share of Czech-destination legs, each against a configurable
  `ANOMALY_*` threshold.
- Direct reports: a customer organisation, a caller, or our telephony carrier partner
  flagging suspicious traffic.

### 2. The 72-hour clock

On becoming aware of a personal data breach (unauthorised access, loss, or disclosure
of personal data), start a 72-hour clock:

1. **Scope it.** Use the audit log (`audit_events`, org-scoped + admin actions) and the
   call log to determine which organisations/records are affected, without querying
   for more personal data than necessary to scope the incident.
2. **Assess risk** to the rights and freedoms of the individuals affected using the
   EDPB Guidelines 01/2021 examples as a template (register item 18/21) — is this
   "unlikely to result in a risk"? If genuinely no, notification may not be required;
   document that reasoning either way.
3. **Notify the Czech Data Protection Authority (ÚOOÚ)** within 72 hours of awareness
   where feasible, via the dedicated e-form:
   `https://portal.gov.cz/sluzby-vs/ohlaseni-poruseni-zabezpeceni-osobnich-udaju-data-breach-S30277`.
   If notification takes longer than 72 hours, the delay must be reasoned in the
   notification itself.
4. **Notify affected individuals directly** if the breach is high-risk to them (Art
   34) — via the affected customer organisation, since Telocc is processor for call
   data (§5 below covers processor→controller notification specifically).
5. **Log it internally** regardless of whether ÚOOÚ notification was required (Art
   33(5)) — what happened, when discovered, scope, actions taken, and the
   risk-assessment reasoning from step 2.

### 3. Customer-organisation notification (processor duty, `docs/legal/dpa.md` §5)

Notify the affected customer organisation(s) **without undue delay** once scoped,
using a template along these lines:

> Subject: Telocc security notice — action may be required
>
> We identified [what happened] affecting [scope: which of your data / how many
> records] on [date/window]. Our assessment of risk to individuals is [assessment].
> We have [containment/remediation actions taken]. You may wish to [any action the
> customer should take]. Contact us at security@[domain] with questions.

### 4. Sub-processor breach contacts

| Sub-processor | Breach contact | Notes |
|---|---|---|
| Twilio | `[OWNER TO CONFIRM — per Twilio's DPA breach-notification clause]` | — |
| Cloudflare | `[OWNER TO CONFIRM]` | — |
| Neon | `[OWNER TO CONFIRM — Neon's DPA states an SLA around 72h]` | — |
| Email provider | `[OWNER TO CONFIRM]` | — |

## Provider/operator traffic-flag response (register item 13)

If our telephony carrier partner or a Czech network operator flags Telocc's traffic
(e.g. for anomalous CLI presentation patterns or elevated failure rates):

1. Pull the `anomaly_flagged` audit events and the affected organisation(s)' recent
   call-log rows (status/`provider_error_code`) for the flagged window.
2. Check whether the flagged pattern correlates with a specific organisation
   (possible account compromise — consider temporarily suspending its outbound bridge
   per the AUP, `docs/legal/aup.md` §6) or is systemic (possible CZ-termination
   deliverability issue — see `docs/design.md` §9.9/ER-OBS-1, and the go-live gate
   below on Twilio's written CZ-termination confirmation).
3. Respond to the carrier/operator with the scoping data above; do not disclose more
   personal data than necessary to resolve the inquiry.
4. Record the incident and resolution in the internal breach/incident log even if it
   turns out not to be a personal-data breach — this is also register item 13
   evidence of a working anti-abuse framework.

## Break-glass call-log access (ER-AUD-1)

The application has **no in-app admin/"break-glass" route** — every API path that
reads `calls`/`audit_events` is org-scoped by construction, with no operator role or
endpoint that reads across organisations. This is safe by **absence of a code path**,
not by an application-level access log.

If an operator ever genuinely needs cross-org access to the call log (e.g. to scope a
breach per the incident-response section above, or to answer a carrier/ČTÚ inquiry
where the affected organisation cannot be identified any other way), the only route is
direct database access outside the application, using the least-privilege database
role (ER-SEC-4):

1. Confirm no in-app path (export, settings, org-scoped API) already answers the
   question — this procedure is a last resort.
2. Connect with the least-privilege application role (never a superuser/owner role)
   and run the minimum query needed to scope the incident.
3. **Manually** record a reasoned entry in the internal incident/breach log (there is
   no automated audit event for this — the runbook procedure itself is the control):
   who, when, why, what was queried, and what was found.
4. If this was triggered by a suspected breach, continue per "Incident response" above.

## Anomaly-scan alert triage (day-to-day)

When the daily scheduled job (`packages/core/src/retention.ts`) writes an
`anomaly_flagged` event for an organisation:

1. Check which threshold was exceeded (`ANOMALY_DAILY_CALLS`, `ANOMALY_DAILY_MINUTES`,
   `ANOMALY_NIGHT_CALLS`, or `ANOMALY_CZ_FAILURE_PCT`) from the event's `meta`.
2. For a calls/minutes/night-time spike: contact the organisation if it looks
   unexpected for their normal usage; consider tightening their `dialinHourlyCap`/
   `outboundDailyMinutesCap` (settings) as an interim measure.
3. For an elevated CZ-destination failure share: this is the deliverability tripwire
   behind register item 10 (anti-spoofing blocking at international interconnection) —
   check whether it correlates with a provider-side routing issue rather than abuse
   (see the go-live gate below) before assuming account compromise.

## Backups and restore testing (ER-SEC-5)

- Neon automated backups are the recovery mechanism; a restore-test schedule and
  result log go here once run. `[OWNER TO SCHEDULE AND RECORD FIRST RESTORE TEST]`.

---

## Go-live gates

Every row below is an item only the owner (with counsel/accountant/vendor where noted) can
close — engineering has built everything that can be built ahead of it. None of these block
anything already shipped: the system is fully buildable and demoable against the mock
provider today, per `docs/brief.md`'s goal. This checklist is the owner-facing companion to
`docs/deploy.md` §10 (the mock→Twilio flip); each row cites the exact register item(s) it
closes (`docs/compliance/register.md`) and the concrete artifact that closes it. Every
numbered item from that register's "Open items needing the owner" table appears in exactly
one row below.

| # | Gate | ER/OWN reference | Concrete artifact that closes it |
|---|---|---|---|
| 1 | **Regulatory posture decision** — pick posture A (notify ČTÚ, operate as NB-ICS provider) or posture B (application layer over Twilio, the brief's default) | OWN-1 | A written counsel opinion or a documented informal ČTÚ inquiry response, filed under `docs/compliance/`; if posture flips to A, the drafted `docs/compliance/ctu-notification-pack.md` is filed with ČTÚ (currently drafted, not filed) |
| 2 | **Emergency-calling posture confirmation** — confirm "block emergency numbers + prominent disclosure" is a lawful stance under the chosen posture | OWN-2 | Counsel/ČTÚ written confirmation, filed alongside item 1's opinion; no code change either way (ER-EMG-1..3 are already built to the "block + disclose" stance) |
| 3 | **Lawful CLI presentation confirmation** — confirm VO-S/2/04.2024-1 permits Telocc's CLI-insertion pattern (a bridging service inserting the org's own hosted number) | OWN-3 | CZ telecom counsel's written confirmation, filed under `docs/compliance/` |
| 4 | **Twilio account, IE1 region, credentials** — create the account and generate API credentials | — (`docs/brief.md` GOAL: "my provider credentials") | `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` set via `wrangler secret put` (`docs/deploy.md` §10 step 1) |
| 5 | **Twilio wiring confirmations** — confirm the exact CZ regulatory-bundle document list, whether Telocc or the customer org is the regulatory end user, and which entity is the ČTÚ-registered carrier of record | OWN-10 | `GET /api/kyc/requirements` response captured against a live Twilio account, plus a Twilio support-ticket confirmation of the end-user/carrier-of-record questions, both filed under `docs/compliance/` |
| 6 | **Number-class product decision** — confirm geographic vs. `nomadic_910` vs. mobile is the right fit given the international-arrival CLI-blocking risk (register item 10) | OWN-5 | A recorded decision in `docs/decisions.md` (default remains `geographic` unless changed) and the corresponding `numberClass` used at provisioning (`docs/deploy.md` §10 step 2) |
| 7 | **CZ→CZ deliverability gate** — obtain Twilio's written confirmation that CZ-bound +420-CLI legs terminate via domestic Czech interconnection | OWN-4 / ER-OBS-1 | Twilio's written confirmation on file, followed by flipping `czCliDomesticTermination` from `'unverified'` to `true` in `packages/telephony/src/twilio/provider.ts`'s `TWILIO_CAPABILITIES` constant (`docs/deploy.md` §10 step 5) — a reviewable, one-line diff |
| 8 | **Voice Geographic Permissions** — restrict Twilio's Voice Dialing Geographic Permissions to deny high-risk/premium-rate destination ranges, mirroring the app's own `dial_policy_prefixes` deny-list at the carrier layer | ER-EMG-2 | Geographic Permissions configuration saved in the Twilio console (Twilio account setting, no repo artifact) |
| 9 | **Business number purchased** | — (`docs/brief.md` GOAL: "a purchased number") | A `business_numbers` row in `status = 'active'` for the org, provisioned through `POST /api/numbers/provision` against the live Twilio account |
| 10 | **B2B gating confirmation** — confirm signup stays explicitly B2B (business-capacity declaration now, IČO field once CZ billing lands), keeping the EAA-consumer and § 419 consumer-status arguments out of scope | OWN-11 | A recorded owner sign-off in `docs/decisions.md` confirming no consumer-facing signup path will be added |
| 11 | **Email provider account** — create the production transactional-email account (Resend, or an alternative behind the same `EmailSender` port) | ER-POL-5 | Account created, `RESEND_API_KEY` set via `wrangler secret put`, `EMAIL_PROVIDER=resend` set in `wrangler.jsonc`'s `vars`, and a completed row in `docs/compliance/transfer-register.md` (`docs/deploy.md` §9) |
| 12 | **Vendor DPAs, Twilio IE1 selection, and Cloudflare Regional Services decision** — execute/accept the Twilio, Cloudflare, and Neon DPAs; select Twilio's IE1 region; decide whether to purchase Cloudflare Regional Services (EU) on the custom domain or accept transient non-EU edge processing under the Cloudflare DPA+DPF | OWN-7 | Executed DPAs on file; completed rows (replacing every `[OWNER TO CONFIRM/DECIDE]` placeholder) in `docs/compliance/transfer-register.md` |
| 13 | **Call-log retention window sign-off** — confirm the call-log retention/anonymisation window | OWN-6 / ER-RET-1 | A recorded owner sign-off in `docs/decisions.md` (default: 13 months, `RETENTION_CALL_LOG_MONTHS`) and the matching value reflected in `docs/legal/privacy-notice.md` once it is itself signed off (item 14) |
| 14 | **Legal sign-off on all drafted texts** — privacy notice, ToS (incl. Art 28 DPA terms, AUP with the § 96 telemarketing warning, emergency-limitation disclosure, port-out clause, OKU placeholder), and the § 63a micro/small-enterprise waiver approach | OWN-8 | Counsel-reviewed, approved copies of `docs/legal/{privacy-notice,tos,dpa,aup}.md` with their `DRAFT` status lifted and a sign-off date recorded |
| 15 | **VAT / accountant registration** — register as *identifikovaná osoba* (or voluntary plátce) within 15 days of the first cross-border Twilio invoice; at billing launch, confirm telecom-vs-e-service VAT classification and plátce/OSS registrations | OWN-9 | Filed *identifikovaná osoba* registration (or plátce registration) confirmation from the accountant, plus the DIČ given to Twilio for reverse-charge invoicing |
| 16 | **Legal watch list acknowledgement** — acknowledge the standing watch items: the EU–US DPF appeal (CJEU C-703/25 P), stability of the mobile-CLI blocking exemption, and the growth tripwires (≥10 staff/€2M → EAA; ≥50 staff/€10M → eIDAS 5f; first paid invoice → VAT; any consumer plan → EAA + consumer law; any AI feature → AI Act) | OWN-12 | A dated acknowledgement note in `docs/decisions.md` that these are being tracked, revisited on any tripwire |
| 17 | **Pre-launch primary-source re-verification** — re-verify verbatim the egress-blocked primary sources listed in the register's methodology caveat (VO-S/2/04.2024-1, ZEK §§ 33/63/63a/63b/88–92/96/97, vyhláška 117/2007 Sb., the NS judgment of 30 Dec 2025, Act 424/2023 Sb., and the live Twilio CZ regulatory/voice guideline pages) before relying on any of the above as settled | OWN-13 | A dated re-verification note (counsel or owner) covering each listed source, filed under `docs/compliance/` |

---

*Last drafted: 2026-07-12 (M8); go-live gates completed 2026-07-12 (M11). Breach-response
templates and sub-processor contacts remain pending owner/legal completion — see items 12
and 14 in the table above for the corresponding vendor-DPA and legal-sign-off gates.*

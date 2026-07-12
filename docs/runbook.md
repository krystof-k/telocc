# Telocc — Operations Runbook

> **DRAFT — requires legal/owner review of the breach-response and go-live sections
> (see `docs/compliance/register.md` OWN-8, and the go-live items OWN-4/7/9/10 below).**
> Assembled from `docs/compliance/register.md` (items 13, 21) and ER-POL-4
> (`docs/compliance/engineering-requirements.md`). The **go-live gates** section is
> completed in M11 (`docs/deploy.md`'s companion); this milestone (M8) ships the
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

*Completed in M11 (`docs/deploy.md`'s companion checklist) — this section will list,
with their ER/OWN references, every item that must be true before flipping to a live
Twilio account: Twilio credentials + IE1 region + regulatory bundle document list
(OWN-10), written CZ-domestic-termination confirmation before setting
`czCliDomesticTermination: true` (ER-OBS-1/OWN-4), Voice Geographic Permissions
(ER-EMG-2), email provider account, vendor DPAs + transfer-register rows (OWN-7),
Cloudflare Regional Services decision (OWN-7), retention-window sign-off (OWN-6),
legal-text sign-off (OWN-8), and *identifikovaná osoba* VAT registration after the
first Twilio invoice (OWN-9). None of these block anything built so far — the system is
fully buildable and demoable against the mock provider.*

---

*Last drafted: 2026-07-12 (M8). Go-live gates section pending M11. Breach-response
templates and sub-processor contacts pending owner/legal completion
(`docs/compliance/register.md` OWN-7/8).*

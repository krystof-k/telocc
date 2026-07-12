# Telocc — Privacy Notice

> **DRAFT — requires legal review and owner sign-off (see `docs/compliance/register.md`
> OWN-8).** This text is a build-time draft, assembled directly from the compliance
> register (`docs/compliance/register.md`) and the engineering requirements it drives
> (`docs/compliance/engineering-requirements.md`, ER-POL-1). It cites register items by
> number and states no legal conclusion the register does not already support. It must
> not be published to end users until counsel and the owner sign off (OWN-8) and every
> `[OWNER TO CONFIRM]` placeholder below is resolved.

## 1. Who this notice covers

Telocc ("we") provides a business phone-forwarding and outbound-bridging service to
organisations ("you", "your organisation"). This notice covers:

- **Account data** — you and the people you authorise to use your organisation's
  account (Telocc is the **controller** for this data — register item 14).
- **Call metadata** generated when your organisation's business number forwards a call
  or bridges an outbound call (Telocc is the **processor**; your organisation is the
  **controller** for its own callers' data — register item 14). If you are a caller to
  or from a Telocc-forwarded number and have a question about how your call data is
  handled, please contact the organisation you called or that called you — Telocc
  processes this data only on that organisation's instructions.

## 2. What we collect, why, and the lawful basis (register item 15)

| Data category | Purpose | Lawful basis |
|---|---|---|
| Account email, organisation name, business-capacity declaration | Account creation, login (magic link), contract performance | Art 6(1)(b) — contract |
| Verified personal phone number, SMS-PIN verification records | Binding call routing/outbound presentation to a verified human, per organisation | Art 6(1)(b) — contract |
| Office-hours settings, business-number configuration | Operating the routing service you configured | Art 6(1)(b) — contract |
| Call metadata (timestamp, direction, duration, status, calling/called number) | Providing and logging the forwarding/bridging service | Art 6(1)(b) — contract (for your organisation as our customer); your organisation is controller for its callers |
| Security/audit logs (logins, magic-link issuance, PIN attempts, admin actions, rate-limit counters) | Fraud prevention, abuse prevention, account security | Art 6(1)(f) — legitimate interest (see the short assessment below) |
| Billing/invoice data (once billing exists) | Invoicing, tax compliance | Art 6(1)(c) — legal obligation, once applicable |

**No consent-based processing exists in this product today.** There is no marketing,
no analytics, no profiling.

**Short legitimate-interest assessment (anti-abuse/security logs, Art 6(1)(f)):** the
interest is preventing account takeover, toll fraud, and abuse of the outbound-bridge
feature (register item 13, ER-RATE-3); the logs collected (login/magic-link/PIN
events, rate-limit counters, anomaly flags) are the minimum needed to detect and
investigate such abuse; they are held only for a short, fixed window (below) and never
used for any other purpose (e.g. never for marketing); an equivalent legitimate
interest of the data subject (not having their account misused) points the same way,
so the balance favours processing.

## 3. What call metadata we keep, and for how long (register item 22; ER-RET-1..3)

We keep the following about each call your organisation's business number handles:
timestamp, direction (inbound/outbound), duration, status (e.g. answered, missed,
declined, blocked, "emergency call refused"), and the calling/called number.

- **Call-log retention window:** **13 months** `[OWNER TO CONFIRM — OWN-6]` from the
  call date. After this window, a scheduled job strips both phone numbers and the
  initiating person from the row; the timestamp/direction/duration/status survive in
  anonymised form only for internal reporting counts (ER-RET-1).
- **Security/admin audit logs** (logins, magic-link issuance, PIN attempts, settings
  changes): retained **90 days**, then deleted (ER-RET-2). Number-lifecycle audit
  events (e.g. a business number being released) are retained for the same window as
  the call log, since they document that lifecycle.
- **SMS-PIN and magic-link login artifacts:** deleted promptly on expiry or first use,
  never merely flagged (ER-RET-3).
- **Rate-limit counters:** deleted once their window expires.

We do **not** retain traffic data for six months "for law-enforcement purposes" under
Czech Act No. 127/2005 Sb. (ZEK) § 97(3) — see `docs/compliance/register.md` item 23 for
why: current Czech Supreme Court case law (30 Cdo 2556/2025, 30 December 2025) found
blanket retention of this kind unlawful under EU law, and building it "for compliance"
would conflict with GDPR data minimisation. If that legal position changes, this notice
and the retention window will be updated first.

## 4. Who we share data with (register items 14, 16)

- **Twilio** (telephony platform; sub-processor, EU voice/SMS data residency region
  "IE1" `[OWNER TO CONFIRM AT WIRING — OWN-7]`).
- **Cloudflare** (hosting/edge; sub-processor).
- **Neon** (database, hosted in an EU region; sub-processor).
- **[Email provider name] `[OWNER TO CONFIRM]`** (transactional email for magic links).

Full details — role, data categories, region, and transfer mechanism (EU–US Data
Privacy Framework / Standard Contractual Clauses) for each — are in
`docs/compliance/transfer-register.md`. We do not sell personal data and do not share
it for advertising.

## 5. Cookies (register item 24; ER-COOK-1)

We use only first-party, strictly necessary cookies:

| Cookie | Purpose | Lifetime |
|---|---|---|
| `telocc.session_token` | Keeps you signed in (Better Auth session) | 30 days |

No analytics, marketing, or third-party cookies are set, and no consent banner is
shown — Czech and EU ePrivacy rules exempt strictly-necessary cookies like this one
from the consent requirement (register item 24). Adding any analytics or marketing
script in future requires a consent-management step first (deploy-checklist gate).

## 6. Your rights (register item 17; ER-DSR-1..3)

You can, at any time from your organisation's settings page:

- **Export** your organisation's account data and full call log (JSON and CSV) —
  Art 20 portability / Art 15 access.
- **Delete** your organisation's account — Art 17 erasure. This removes your account,
  verified number, call log, KYC/regulatory documents, and sessions in one step, with a
  best-effort request to our telephony provider to delete its own copies of your call
  records. **Carve-out:** at MVP we hold no billing/invoice records yet; once billing
  exists, invoices are kept for the legally required period (Czech tax law) even after
  account deletion, and that period will be stated here (OWN-6/OWN-9).

For any other request (e.g. if you cannot use the settings page, or you are a caller
with a question about a specific organisation's data), email **privacy@[domain]**
`[OWNER TO CONFIRM DOMAIN]`. We respond within **one month** of a verified request
(register item 17/20).

## 7. No Data Protection Officer

We have not appointed a Data Protection Officer. At our current scale (a single-owner
B2B service), our processing does not meet the "large scale" threshold that would
require one under GDPR Art 37 (register item 20). This is reviewed as the business
grows. The privacy contact above is the intake point for any privacy question in the
meantime.

## 8. International transfers

See `docs/compliance/transfer-register.md` for the vendor-by-vendor detail. In short:
our infrastructure providers are US-headquartered companies operating EU regions/data
residency options; transfers rely on the EU–US Data Privacy Framework and/or Standard
Contractual Clauses as each vendor's DPA specifies (register item 16). We are watching
the pending CJEU appeal against the Data Privacy Framework (case C-703/25 P) and will
update this notice if that changes.

## 9. Changes to this notice

We will post any material change here with an updated date, and — once we have your
verified contact details — notify affected customers of significant changes.

---

*Last drafted: 2026-07-12. Not yet reviewed by counsel or signed off by the owner
(`docs/compliance/register.md` OWN-8). Do not treat as final or publish without that
sign-off.*

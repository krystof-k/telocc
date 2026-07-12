# Telocc — Records of Processing Activities (RoPA)

> **DRAFT — requires legal review and owner sign-off (see `docs/compliance/register.md`
> OWN-8).** Assembled from `docs/compliance/register.md` (item 19) and ER-POL-3
> (`docs/compliance/engineering-requirements.md`). Maintained in-repo; update this file
> whenever a sub-processor, data category, or retention window changes — the purge
> job's configured windows (`packages/core/src/retention.ts`) must match what is stated
> here. This is a working record, not itself a document requiring legal sign-off in the
> way the customer-facing texts do — but the retention windows it states depend on the
> owner's sign-off in `docs/legal/privacy-notice.md` (OWN-6).

Art 30 GDPR requires these records despite Telocc's small size: register item 19
concludes the Art 30(5) small-organisation exemption does not apply, because Telocc's
continuous call-metadata processing is its core business, not "occasional" processing.

## Part 1 — Controller records (Art 30(1)): Telocc's own account/security/billing data

| Purpose | Data subjects | Data categories | Recipients / sub-processors | Transfers | Retention | TOMs reference |
|---|---|---|---|---|---|---|
| Account creation & login | Organisation owners/users | Email, name, org name, business-capacity declaration | Neon (storage), `[email provider — OWN-7]` | See `docs/compliance/transfer-register.md` | Life of account + deletion on request | `docs/compliance/toms.md` §Authentication |
| Personal-number verification | Organisation owners/users | Phone number, SMS-PIN hash, verification timestamp | Twilio (SMS delivery), Neon (storage) | See transfer register | PIN artifacts deleted on expiry/use; verified-number record kept while account active | `docs/compliance/toms.md` §SMS-PIN |
| Security/anti-abuse logging | Organisation owners/users, callers (indirectly, via call metadata referenced in security logs) | Login/magic-link/PIN events, rate-limit counters, anomaly flags | Neon (storage) | See transfer register | 90 days (ER-RET-2) | `docs/compliance/toms.md` §Logging |
| Billing/invoicing (dormant — no billing features shipped yet) | Organisation owners | VAT ID, billing address, invoice line items | `[payment/accounting provider — not yet selected]` | N/A until selected | Statutory Czech tax retention period once billing exists (OWN-9) | N/A yet |

## Part 2 — Processor records (Art 30(2)): customer call data

For call metadata, Telocc processes on behalf of each customer organisation (the
controller for its own callers' data — register item 14).

| Purpose (per customer instruction) | Data subjects | Data categories | Recipients / sub-processors | Transfers | Retention | TOMs reference |
|---|---|---|---|---|---|---|
| Call forwarding (inbound → customer's verified personal number) | Callers to the customer's business number | Calling/called number, timestamp, duration, status | Twilio (call routing) | See transfer register | 13 months, then anonymised (ER-RET-1, OWN-6) | `docs/compliance/toms.md` §Call routing |
| Outbound bridge (dial-in → DTMF → bridge) | The customer's verified user; the destination number called | Calling/called number, digits dialled (not logged beyond routing), timestamp, duration, status | Twilio (call routing) | See transfer register | 13 months, then anonymised (ER-RET-1, OWN-6) | `docs/compliance/toms.md` §Call routing |
| Regulatory KYC (business-number provisioning) | The customer organisation's registered legal entity | Legal name, business ID, registered address, supporting documents | Twilio (regulatory bundle submission) | See transfer register | Held while the number is active; deleted when no longer required by the carrier | `docs/compliance/toms.md` §KYC documents |

## Sub-processors

See `docs/compliance/transfer-register.md` for the full, current list with region and
transfer mechanism per vendor.

## Retention windows referenced here

| Window | Value | Config key | Owner sign-off |
|---|---|---|---|
| Call-log retention | 13 months (proposed default) | `RETENTION_CALL_LOG_MONTHS` | OWN-6 |
| Security/audit log retention | 90 days | `RETENTION_SECURITY_LOG_DAYS` | Engineered default; revisit alongside OWN-6 |

---

*Last drafted: 2026-07-12.*

# Telocc — International Transfer Register

> **DRAFT — requires owner action at wiring time (see `docs/compliance/register.md`
> OWN-7).** Assembled from `docs/compliance/register.md` (items 16, 25) and ER-POL-5
> (`docs/compliance/engineering-requirements.md`). This is the one-page register that
> lets the compliance posture survive handover: vendor, role, data categories, region,
> transfer mechanism, fallback. Rows marked `[OWNER TO CONFIRM AT WIRING]` are completed
> when the corresponding vendor account/DPA is actually executed (OWN-7) — nothing here
> is speculative or filed.

| Vendor | Role | Data categories | Region | Transfer mechanism | Fallback | Notes |
|---|---|---|---|---|---|---|
| Twilio Inc. | Telephony sub-processor (voice, SMS, number provisioning/KYC bundles) | Call metadata (numbers, timestamps, duration, status), SMS-PIN delivery, KYC identity documents | **IE1 (Ireland)** selected for voice/SMS data residency `[OWNER TO CONFIRM AT WIRING]` | EU–US Data Privacy Framework (Twilio is DPF-certified) + 2021 EU Standard Contractual Clauses incorporated in Twilio's DPA; Twilio also holds approved processor Binding Corporate Rules | SCCs stand alone if DPF is invalidated | DPA must be executed before go-live (`docs/runbook.md`); watch CJEU case C-703/25 P (pending appeal against the DPF) |
| Cloudflare, Inc. | Hosting / edge network (Workers runtime, static asset serving) | Request metadata in transit (no call content persisted at the edge) | Global edge by default; **EU Regional Services (Data Localization Suite)** available on a custom domain to restrict TLS termination + Workers execution to the EU `[OWNER TO DECIDE — purchase or accept transient non-EU edge processing, OWN-7]` | Cloudflare Customer DPA (SCCs Modules 2/3 + DPF reliance + express SCC fallback with supplementary measures) | SCC fallback per Cloudflare's DPA | Until Regional Services is purchased, edge minimisation is the mitigation (no personal data in Workers logs/analytics, no KV/cache/Durable-Object persistence, design.md §9.8) |
| Neon, Inc. | Database hosting | All persisted personal data (the single store) | **EU region**, fixed at project creation (immutable per project — ER-RES-1) | Neon DPA (neon.com/dpa); rides AWS infrastructure | Per Neon's DPA / AWS's own transfer mechanisms | Project must be created in an EU region from day one — this cannot be changed later without a new project |
| `[Email provider — OWNER TO SELECT, e.g. Resend]` | Transactional email (magic-link delivery) | Account email address, magic-link token (opaque, single-use) | `[OWNER TO CONFIRM]` | `[OWNER TO CONFIRM — vendor's DPA]` | `[OWNER TO CONFIRM]` | Local/demo default is an in-process dev mailbox (no third party involved) |

## Watch list (register item 16)

- **CJEU case C-703/25 P** — pending appeal against the General Court's dismissal of
  the Latombe challenge to the EU–US Data Privacy Framework (filed 2025-10-31, no
  hearing date as of this drafting). If the DPF is invalidated, the Standard
  Contractual Clause fallbacks above become the operative mechanism for every
  US-headquartered vendor, and transfer impact assessments should be refreshed.

## Process

- This register is updated whenever a sub-processor is added, removed, or changes its
  region/transfer mechanism, and reviewed alongside `docs/compliance/ropa.md`.
- `docs/legal/privacy-notice.md` §4 and `docs/legal/dpa.md` §3 both point here rather
  than duplicating this table, so it only needs to be correct in one place.

---

*Last drafted: 2026-07-12. Rows above are the engineering-side scaffold; the owner
actions in OWN-7 (executing DPAs, selecting Twilio's region, deciding on Cloudflare
Regional Services) are still outstanding.*

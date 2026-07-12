# Telocc — ČTÚ Notification Pack (contingency, NOT filed)

> **DRAFT — contingency only, requires owner decision before any filing (see
> `docs/compliance/register.md` OWN-1).** Assembled from `docs/compliance/register.md`
> (items 1, 2) and ER-POL-6 (`docs/compliance/engineering-requirements.md`). **This pack
> exists so the owner can notify the Czech Telecommunication Office (ČTÚ) within a day
> if they choose posture A (register OWN-1) — nothing here has been submitted, and
> nothing should be submitted without a final read of the owner's chosen posture and,
> ideally, counsel or an informal ČTÚ inquiry first.**

## Why this exists

`docs/compliance/register.md` item 1 identifies the central open question: is Telocc
itself a number-based interpersonal communications service (NB-ICS) provider under
Czech law (Act No. 127/2005 Sb., ZEK), requiring notification to ČTÚ under § 13 — or is
it purely an application layer riding on Twilio(-CZ)'s own carrier registration? Reading
A (notify) is the more likely classification per the verified analysis in the register
(CJEU C-142/18); Reading B (the brief's assumed posture) has no found regulatory
blessing. **Nothing in the build depends on this being resolved** — the system is fully
buildable and demoable under either answer (`compliance.posture` config, ER-POST-1) —
but if the owner chooses posture A, this pack shortens the path to compliance.

## What filing under § 13 costs (register item 2)

- A CZK 1,000 filing fee.
- Ongoing ESD (network/service-volume) reporting duties — the half-year calls/minutes
  report this build already produces (`scripts/esd-report.ts`, ER-AUD-3) is built for
  exactly this.
- § 63a contract-information duties toward customers who are micro/small enterprises
  (already modeled as a config-gated step, ER-POST-1, register item 3).
- Potential NIS2/Czech Cybersecurity Act 264/2025 Sb. self-registration with NÚKIB
  within 60 days of the law applying to a notified provider (register item 4) —
  **not evaluated further here; this is its own OWN-1-dependent decision.**

## Notification form template

- Official ČTÚ "Oznámení podnikání" (notification of undertaking) form:
  `[LINK — official ČTÚ form template URL, to be confirmed at the time of filing since
  the form itself may be updated]`.
- **Service description to use on the form** (drafted, not filed):

  > "Provision of a publicly available number-based interpersonal communications
  > service (NB-ICS): call forwarding from a customer-provisioned Czech geographic
  > business number to the customer's own verified personal number, and an
  > outbound-dialling bridge from that verified personal number through the same
  > business number, delivered as an application layer hosted on an authorised
  > electronic-communications undertaking's network (Twilio's Czech carrier
  > arrangement)."

## What changes if we notify — one-page memo

| Area | Before notification (posture B) | After notification (posture A) |
|---|---|---|
| Regulatory filing | None | ČTÚ notification, CZK 1,000 fee |
| ESD reporting | Not required of Telocc | Required — already built (ER-AUD-3) |
| § 63a contract summary/waiver | Not shown | Shown at org creation (already built behind `COMPLIANCE_POSTURE=nbics_provider`) |
| § 97(3) six-month retention | N/A to Telocc | **Still not built** — register item 23 explains why (current Czech Supreme Court case law found blanket retention of this kind unlawful; do not build it "for compliance" without fresh legal advice at that point) |
| NIS2 / Cybersecurity Act self-registration | Not applicable | Possible 60-day NÚKIB self-registration duty — **separate decision, not automated by this pack** (register item 4) |
| Emergency-calling duty (ZEK § 33) | Ambiguous / lands on Twilio | Squarely on Telocc — see the open item below |

## The one thing this pack does NOT resolve

Register item 5 / OWN-2 (emergency calling): Twilio does not support emergency calling
for Czech numbers and contractually prohibits it. If posture A is chosen, ZEK § 33 may
require Telocc itself to enable free access to emergency numbers — a conflict this
build resolves operationally by blocking and disclosing (ER-EMG-1/3), but whose
**legality is not settled** without counsel or ČTÚ confirmation. **Do not file this pack
without resolving OWN-2 first**, or at least entering the process eyes-open to that
risk.

---

*Last drafted: 2026-07-12. Contingency document — not filed, not to be filed without a
fresh OWN-1 decision and (ideally) counsel review.*

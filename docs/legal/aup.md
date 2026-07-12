# Telocc — Acceptable Use Policy

> **DRAFT — requires legal review and owner sign-off (see `docs/compliance/register.md`
> OWN-8).** Assembled from the compliance register (`docs/compliance/register.md`) and
> ER-POL-2 (`docs/compliance/engineering-requirements.md`, register items 5, 12, 13).
> Do not publish or rely on until counsel and the owner sign off. This policy is part of
> `docs/legal/tos.md` by reference.

## 1. Purpose

This Acceptable Use Policy (AUP) tells you what you may not do with your Telocc
account, and what happens if you do it anyway. It exists because Telocc's outbound
bridge and forwarding features can, if misused, expose Telocc, our telephony carrier
partner, and other Telocc customers to fraud, network abuse, and legal risk (register
item 13).

## 2. Prohibited uses

You may not use Telocc, or allow it to be used, to:

- place calls or send messages you do not have a legal right to send, including
  **cold marketing calls to Czech numbers without the required opt-in/consent** — see
  § 3 below;
- attempt, or knowingly benefit from, **toll fraud**, account takeover, or any use of
  the outbound bridge by a person other than a verified user of your organisation
  (register item 13);
- present a caller ID other than your organisation's own provisioned business number
  (the service does not allow this technically — see `docs/design.md` §5.2/ER-CLI-3 —
  and attempting to work around it is a violation in its own right);
- attempt to dial emergency numbers (112, 150, 155, 156, 158) through the outbound
  bridge, given the limitation disclosed in `docs/legal/tos.md` §5 (ER-EMG-1);
- harass, defraud, or deceive call recipients;
- resell or sub-license the service to a third party without our written consent;
- do anything that would cause our telephony carrier partner to flag, throttle, or
  terminate our upstream service (register item 13; their own AUP and toll-fraud
  policies apply to traffic carried on their network).

## 3. Telemarketing warning (§ 96 ZEK, register item 12)

Marketing/cold calls to Czech phone numbers are **opt-in only** under Czech law (Act
No. 127/2005 Sb., §§ 95–96): you may only make such a call if the recipient is flagged
for marketing calls in a public participant directory, or has given you prior consent.
**This rule applies to business-to-business calls as much as to consumers — there is
no blanket B2B exemption**, and enforcement has diverged from any informal guidance
suggesting otherwise. Fines can reach **CZK 50 million** or 10% of annual turnover.
**You are solely responsible for complying with this rule when using Telocc's outbound
bridge for marketing purposes.** See the Czech Telecommunication Office's guidance:
`[LINK — ČTÚ telemarketing manual/FAQ, register item 12]`.

## 4. Emergency-calling disclosure (cross-reference)

See `docs/legal/tos.md` §5 and the in-app disclosure shown when you verify your
personal number: **Telocc cannot carry calls to emergency numbers.** Always dial 112 (or
another emergency number) directly from your own phone.

## 5. Monitoring and enforcement

We may monitor call metadata (never call content — Telocc does not record calls) for
signs of abuse: elevated failure rates on Czech-destination legs, unusual night-time
volume, or volume spikes against your configured caps (register item 13; ER-RATE-3,
ER-OBS-1). Suspected abuse generates an internal alert; we may ask you to explain
unusual traffic before restricting or suspending the affected feature or account.

## 6. Suspension and termination

We may suspend or restrict any feature (e.g. the outbound bridge) or terminate your
account, with notice where reasonably possible, if we reasonably believe you have
violated this policy, particularly for confirmed toll fraud, account-takeover activity,
or telemarketing complaints. We will explain the reason where we can do so without
compromising our own or a third party's security.

## 7. Reporting abuse

If you believe your account has been compromised, or you have received a call from a
Telocc number that violates this policy, contact **abuse@[domain]**
`[OWNER TO CONFIRM DOMAIN]`.

---

*Last drafted: 2026-07-12. Not yet reviewed by counsel or signed off by the owner
(`docs/compliance/register.md` OWN-8). Do not treat as final or publish without that
sign-off.*

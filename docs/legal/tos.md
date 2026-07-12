# Telocc — Terms of Service

> **DRAFT — requires legal review and owner sign-off (see `docs/compliance/register.md`
> OWN-8).** Assembled from the compliance register (`docs/compliance/register.md`) and
> ER-POL-2 (`docs/compliance/engineering-requirements.md`). Cites register items by
> number; invents no legal claim the register does not already support. Do not publish
> or rely on until counsel and the owner sign off, and every `[OWNER TO CONFIRM]`
> placeholder is resolved. The Art 28 Data Processing Addendum is a separate annex,
> `docs/legal/dpa.md`; the Acceptable Use Policy is `docs/legal/aup.md` — both are part
> of this contract by reference.

## 1. Who this contract is with

These Terms of Service are between Telocc (**"we"**) and the business entity that
creates a Telocc account (**"you"**, **"your organisation"**). **Telocc is a B2B
service.** By creating an account you confirm, and by continuing to use the service you
reaffirm, that you are entering this contract **as an entrepreneur acting within your
business, trade, or professional activity, not as a consumer** (register items 26, 27;
OWN-11). This declaration, and its version/timestamp, is recorded against your account.

## 2. What the service is

Telocc forwards calls made to a business phone number you provision through us to a
verified personal number of your choosing, and lets a verified user of your
organisation dial out through that business number using a simple keypad flow (the
"outbound bridge"). The underlying telephony (numbers, call routing, SMS) is provided
by our telephony platform partner (register items 6, 7 — see `docs/legal/dpa.md`).

## 3. Your business number: provisioning, KYC, and lifecycle (register items 6, 7, 11)

- Numbers do **not** activate instantly. Provisioning a Czech phone number requires a
  regulatory identity check ("KYC bundle") in the name of **your organisation** (not
  Telocc) — legal name, business registration reference, a real street address in the
  number's numbering area (no PO boxes), and supporting documents. This review can take
  time and can be rejected; we will tell you why.
- **You warrant that the identity information and documents you submit are accurate**
  and current, and you authorise us to pass them to our telephony carrier partner for
  regulatory registration of the number in your organisation's name. Inaccurate
  information may result in bundle rejection, number suspension, or account
  termination.
- Geographic numbers are tied to the region they were issued in (Czech numbering plan,
  register item 11) and portable only within that region under Czech law.

## 4. Number portability / port-out (register item 8)

If you leave Telocc, you may keep your business number and port it to another provider
free of charge beyond any statutory limits, using the standard Czech subscriber
verification code ("OKU") process. Your OKU will be stated in your account/contract
documentation: **OKU: `[PLACEHOLDER — completed at wiring, register item 8]`**. We will
cooperate with a port-out request within the statutory timeframe and will not withhold
cooperation as a negotiating tactic.

## 5. Emergency calling — read this before you rely on Telocc for anything urgent

**Telocc cannot carry calls to emergency numbers (112, 150, 155, 156, 158).** If you or
anyone using your organisation's Telocc number needs the police, fire brigade, or an
ambulance, **dial 112 (or another emergency number) directly from your own phone's
native dialler** — never through Telocc. Our outbound-bridge feature explicitly blocks
and logs attempts to dial these numbers rather than silently failing (ER-EMG-1). This
limitation, why it exists, and what to do instead is disclosed to every verified user
at three points: when they verify their personal number, in account settings, and here
(ER-EMG-3; register item 5 — an open question for owner sign-off, OWN-2, on whether
further steps are required depending on our regulatory posture).

## 6. Marketing calls made by you (register item 12) — § 96 telemarketing notice

If your organisation uses a Telocc number to make **marketing/cold calls** to people in
the Czech Republic, Czech law (Act No. 127/2005 Sb., ZEK, §§ 95–96) requires that the
person called has either opted in to marketing calls in a public directory or given you
prior consent. **This applies to business-to-business calls too — there is no general
business exemption.** Fines for non-compliant marketing calls can reach **CZK 50
million** or 10% of turnover. **You, not Telocc, are responsible for complying with
this rule** — see the Czech Telecommunication Office's (ČTÚ) telemarketing guidance:
`[LINK — ČTÚ telemarketing manual, register item 12]`. We may suspend your account for
confirmed abuse under the Acceptable Use Policy (`docs/legal/aup.md`).

## 7. Fair use and anti-abuse

Your organisation's account has daily/hourly caps on outbound dial-in attempts and
minutes (visible in your settings) to protect against toll fraud and account takeover
(register item 13; ER-RATE-2/3). We may flag, throttle, or suspend traffic that looks
anomalous (e.g. a large volume of failed calls to Czech destinations, unusual night-time
volume) and will tell you what triggered it where we can. See the Acceptable Use Policy
for suspension grounds.

## 8. `§ 63a` contract-summary step — conditional, posture-dependent

`[CONDITIONAL CLAUSE — activates only if COMPLIANCE_POSTURE=nbics_provider, register
item 3, OWN-1]`: if Telocc is operating as a notified provider of a number-based
interpersonal communications service under Czech law (ZEK §§ 63/63a), you will be shown
a contract summary in the EU-mandated template before contracting, and — because your
organisation may be a micro/small enterprise entitled to the same protections as a
consumer under that regime — asked to expressly waive certain pre-contract information
duties, or receive them in full, depending on counsel's drafting decision on
granularity (OWN-8). If Telocc operates purely as an application layer on top of a
regulated carrier, this section does not apply and is not shown.

## 9. Liability

`[PLACEHOLDER — non-one-sided liability caps to be drafted by counsel, register item
14; must not be so one-sided as to be unenforceable in a Czech B2B contract]`.

## 10. Term and termination

Either party may terminate as described in your order/plan. On termination, we delete
your account data per the process and carve-outs in our Privacy Notice
(`docs/legal/privacy-notice.md` §6) and our Data Processing Addendum
(`docs/legal/dpa.md`).

## 11. Governing law

`[PLACEHOLDER — Czech law, exclusive jurisdiction of Czech courts, or as counsel
advises]`.

---

*Last drafted: 2026-07-12. Not yet reviewed by counsel or signed off by the owner
(`docs/compliance/register.md` OWN-8). Do not treat as final or publish without that
sign-off.*

# Telocc — Compliance Register

**As of:** 2026-07-12 (all "law as of" dates per item below)
**Scope:** CZ/EU business telephony — the Telocc MVP as specified in `docs/brief.md`.
**Companion document:** `docs/compliance/engineering-requirements.md` (the concrete build requirements this register imposes; items below cross-reference `ER-…` IDs from that file).

> ## ⚠️ This register is a researched map, not legal advice and not a sign-off.
>
> Every claim below is grounded in a cited source with an as-of date, and the load-bearing
> claims were re-checked by an adversarial verification pass. Where verification could not
> confirm a claim against primary text, the item is honestly marked **uncertain** and routed
> to owner sign-off — it is never presented as settled. Nothing here substitutes for advice
> from qualified Czech counsel, and the items in **"Open items needing the owner"** cannot be
> closed by engineering at all.

### Verification methodology caveat (applies register-wide)

The research and verification environment's egress proxy **blocked direct fetches of most
primary sources** (ctu.gov.cz, eur-lex.europa.eu, zakonyprolidi.cz, nsoud.cz, usoud.cz,
uoou.gov.cz, twilio.com, portal.gov.cz). Findings marked "verified — supported" rest on
convergent, mutually consistent search-engine extracts of those primary pages plus multiple
independent secondary reproductions — strong corroboration, but not a first-hand read of the
raw statutory text. **Before launch, re-verify verbatim** (Open item OWN-13): VO-S/2/04.2024-1
conditions, ZEK §§ 33, 63/63a/63b, 88–92, 96, 97 (post-23/2025 Sb. consolidated wording),
vyhláška 117/2007 Sb. annexes, the NS judgment of 30 Dec 2025 (30 Cdo 2556/2025), Act
424/2023 Sb., and the live Twilio CZ regulatory/voice guideline pages.

### Status legend

| Status | Meaning |
|---|---|
| **ENGINEERED** | The build enforces it (or will, per a concrete `ER-…` requirement in the companion file that the system design must implement). |
| **DRAFTED** | Policy/contract text is drafted by the build; **legal sign-off by the owner is pending** before it is relied on. |
| **OPEN — OWNER SIGN-OFF** | Only the owner (with counsel/accountant/vendor where noted) can close it. Exactly what must be decided is stated in the item. |

### Verification legend

- **Verified — SUPPORTED**: survived the adversarial verification pass (subject to the methodology caveat above).
- **Verified — UNCERTAIN**: adversarial pass could not confirm against primary text; treated as open, never as settled.
- **Researcher-sourced (high/medium confidence)**: not put through the adversarial pass; confidence level from the domain researcher.

---

## 0. Open items needing the owner

These are the only items engineering cannot close. Each references the register item(s) with the full analysis.

| # | Decision needed | Register item(s) |
|---|---|---|
| **OWN-1** | **Regulatory posture (the load-bearing one):** choose (A) notify ČTÚ under ZEK § 13 and operate as a number-based interpersonal communications service (NB-ICS) provider, or (B) structure Telocc strictly as an application/agency layer with Twilio('s CZ carrier) as provider of record. Reading A is the more likely legal classification per verified analysis (CJEU C-142/18); Reading B — the posture in the brief — has **no found regulatory blessing**. Cheapest closure: counsel opinion or informal ČTÚ inquiry. Everything in items 2–5 cascades from this. | 1, 2, 3, 4, 5 |
| **OWN-2** | **Emergency-calling posture (conditional core-feature legality):** if posture A is chosen, ZEK § 33 / EECC Art 109(2) obliges Telocc to enable free emergency calls (112/150/155/156/158) — which Twilio cannot carry for CZ and contractually forbids. Is "block emergency numbers at DTMF + prominent disclosure" a lawful stance? No CZ exemption found; needs counsel/ČTÚ confirmation **before live launch**. | 5 |
| **OWN-3** | **Lawful CLI presentation — counsel confirmation:** verification could NOT confirm from primary text that ČTÚ condition VO-S/2/04.2024-1 permits a bridging CPaaS-layer service to insert the org's hosted number as CLI (vs. only the access-line operator). The design matches the mainstream international pattern, but treat as unsettled until CZ telecom counsel signs off. | 9 |
| **OWN-4** | **CZ→CZ deliverability gate (go-live blocker, verified):** obtain Twilio's **written confirmation** that CZ-bound legs presenting a +420 geographic CLI terminate via domestic Czech interconnection. If not, ČTÚ's anti-spoofing rule means those calls **will be blocked**. Mitigations to evaluate: BYOC/local carrier trunk, or a 910-range / mobile-class number. | 10 |
| **OWN-5** | **Number-class product decision:** geographic (regional identity; region-tied; exposed to international-arrival blocking) vs 910 nomadic VoIP (location-independent, sanctioned, less familiar) vs mobile (currently exempt from blocking, but exemption may tighten — Firewall 2.2, EU trend). | 10, 11 |
| **OWN-6** | **Call-log retention window:** pick and document the concrete window (build proposal: **13 months**, then purge or anonymise by stripping both phone numbers). Must be written into the privacy notice, RoPA, and the purge-job config. | 22 |
| **OWN-7** | **Vendor DPAs & residency decisions at wiring time:** execute/accept the Twilio, Cloudflare and Neon DPAs; record each in the transfer register; select Twilio **IE1** region for voice/SMS; decide whether to buy **Cloudflare Regional Services (EU)** on a custom domain or accept transient non-EU edge processing under the Cloudflare DPA+DPF. | 16, 25 |
| **OWN-8** | **Legal sign-off on all drafted texts:** privacy notice, ToS (incl. Art 28 DPA terms, AUP with § 96 telemarketing warning, emergency-limitation disclosure, port-out clause, OKU placeholder), cookie information section, § 63a micro/small-enterprise waiver approach (granularity is a counsel drafting question). Telocc ships **drafts only**. | 12, 14, 3, 5, 8, 24 |
| **OWN-9** | **VAT / accountant items:** register as *identifikovaná osoba* (or voluntary plátce) within 15 days of receiving the first cross-border Twilio invoice; at billing launch, confirm telecom-vs-e-service VAT classification and plátce/OSS registrations. | 28, 29 |
| **OWN-10** | **Twilio wiring confirmations:** exact CZ regulatory-bundle document list (Regulations API) incl. whether the end-user address must be in the number's numbering area or merely in CZ; whether Twilio treats Telocc or the customer org as regulatory end user in an ISV setup; which entity in Twilio's CZ number chain is the ČTÚ-registered carrier of record. | 6, 7 |
| **OWN-11** | **B2B gating confirmation:** keep signup explicitly B2B (business-capacity declaration now, IČO field when CZ billing lands) — this is the factual anchor keeping the EAA consumer angle and § 419 consumer status out of scope. Recommended; owner to confirm. | 26, 27 |
| **OWN-12** | **Legal watch list:** EU–US DPF appeal CJEU C-703/25 P (pending); stability of the mobile-CLI blocking exemption; growth tripwires (≥10 staff / €2M → EAA; ≥50 staff / €10M → eIDAS 5f; first paid invoice → VAT; any consumer plan → EAA + consumer law; any AI feature → AI Act). | 16, 10, 26, 30 |
| **OWN-13** | **Pre-launch primary-source re-verification** of the egress-blocked texts listed in the methodology caveat above. | all |

---

## Part A — Regulatory posture & telecom classification

### 1. Service classification: is Telocc itself a number-based interpersonal communications service (NB-ICS) provider?

- **What it is:** ZEK (Act 127/2005 Sb., as amended by 374/2021 Sb.) § 2 defines an NB-ICS as an interpersonal communications service that connects with — or enables communication with — numbers in national/international numbering plans. Providers of publicly available ECS owe ČTÚ prior notification (§ 13) and carry downstream duties (items 2–5). The EECC (Directive (EU) 2018/1972) is the EU source.
- **Applies:** **UNCLEAR — genuinely contested and load-bearing.** Reading A (Telocc = NB-ICS provider): Telocc sells, for remuneration, a service whose whole point is placing/receiving calls to/from E.164 numbers; CJEU C-142/18 (Skype Communications/SkypeOut, judgment 5 June 2019) rejected exactly the "we just ride on regulated carriers" defence, and Czech MVNO practice requires registration despite riding on another's network. Reading B (application layer over Twilio — the brief's stated posture): defensible structure but **no CZ/EU source blesses it**; Twilio's own docs push regulatory compliance onto the customer and, in at least one jurisdiction, explicitly tell number resellers to register locally. Honest lean: Reading A is more likely correct. Precision caveat: C-142/18 interpreted the old Framework Directive's "ECS" definition; the EECC's NB-ICS term post-dates and codifies it.
- **How the build handles it:** the posture is **not hard-coded** — ToS text, retention windows, reporting exports and the contract flow are config points so either posture works without redesign (ER-POST-1); ESD-shaped reporting export is buildable from the call log (ER-AUD-3); a ČTÚ "Oznámení podnikání" pack is drafted but **not filed** (ER-POL-6).
- **Verification:** **Verified — SUPPORTED** (as the hedged claim "more likely than not NB-ICS"; no contradicting authority found; no adjudicated CPaaS-reseller case exists either way).
- **Status:** **OPEN — OWNER SIGN-OFF** (OWN-1). Owner must pick posture A or B; counsel opinion or informal ČTÚ inquiry is the cheap closure.
- **Sources:**
  - ZEK § 2 consolidated text (mirror) — https://www.pracepropravniky.cz/zakony/zakon-o-elektronickych-komunikacich/paragraf-2/ (as amended by 374/2021 Sb., eff. 2022-01-01); corroborated at official e-Sbírka: https://e-sbirka.gov.cz/sb/2005/127
  - CJEU C-142/18 Skype Communications v IBPT — https://curia.europa.eu/juris/document/document.jsf?text=&docid=214741 (judgment 2019-06-05); CZ commentary: https://www.epravo.cz/top/clanky/i-skype-je-sluzbou-elektronickych-komunikaci-109570.html
  - ČTÚ, Oznamování podnikání — https://ctu.gov.cz/oznamovani-podnikani (seen 2026-07; sole notification exemption = number-INDEPENDENT ICS)
  - ČTÚ, Dělení služeb elektronických komunikací — https://ctu.gov.cz/deleni-sluzeb-elektronickych-komunikaci (seen 2026-07)
  - ČTÚ, Přehled mobilních virtuálních operátorů — https://ctu.gov.cz/prehled-mobilnich-virtualnich-operatoru (seen 2026-07)
  - Twilio regulatory FAQ (compliance pushed to customer/reseller) — https://www.twilio.com/docs/phone-numbers/regulatory/faq (seen 2026-07)

### 2. ČTÚ notification mechanics (ZEK § 13) — what posture A actually costs

- **What it is:** form-based prior notification; authorization arises under § 8 on the day ČTÚ receives it (no approval wait); CZK 1,000 certificate fee (Act 634/2004 Sb.); conditions from general authorization VO-S/1/07.2005-9 as amended (last seen amendment VO-S/1/08.2020-9); then half-yearly ESD data reporting (cutoffs 30 June / 31 December; annual ART252/ART251 forms, electronic only). Notification is **not** available as an optional comfort step — it follows the classification, not vice versa.
- **Applies:** **UNCLEAR** — conditional on item 1 resolving to posture A.
- **How the build handles it:** notification pack drafted, not filed (ER-POL-6); call-log/billing data structured so half-year cutoffs and per-service volume/minutes are queryable (ER-AUD-3); no "we are not a telco" claim baked into user-facing copy (kept in swappable ToS text, ER-POST-1).
- **Verification:** **Verified — SUPPORTED** (mechanics: notification duty, day-of-receipt authorization, CZK 1,000 fee, ESD half-yearly reporting all corroborated; ZEK amendment 23/2025 Sb. did not change the core § 13 duty).
- **Status:** **OPEN — OWNER SIGN-OFF** (derivative of OWN-1; filing is the owner's act).
- **Sources:**
  - ČTÚ, Oznamování podnikání — https://ctu.gov.cz/oznamovani-podnikani (seen 2026-07)
  - ČTÚ, Podnikání v elektronických komunikacích — https://ctu.gov.cz/telekomunikace-podnikani (seen 2026-07)
  - ČTÚ, Elektronický sběr dat (ESD) — https://ctu.gov.cz/elektronicky-sber-dat-esd-elektronicke-komunikace (seen 2026-07)
  - ČTÚ, Všeobecná oprávnění — https://ctu.gov.cz/vseobecna-opravneni (VO-S/1 amendments through 08.2020-9)
  - ČTÚ notification form template — https://ctu.gov.cz/sites/default/files/obsah/stranky/677/soubory/formular_pro_oznameni_podnikani_vzor_0.pdf
  - Zákon č. 23/2025 Sb. — https://www.zakonyprolidi.cz/cs/2025-23 (eff. 2025-07-01; procedural changes only to §13/§10)

### 3. Contract-information duties (ZEK §§ 63/63a/63b) — conditional on posture

- **What it is:** providers of publicly available ECS owe pre-contract information (Annex 1 ZEK), an EU-template contract summary, and related end-user protections. Critically, these are **not consumer-only**: they extend to micro-enterprises, small enterprises and non-profits — exactly Telocc's customer base — unless explicitly waived by documented declaration before contracting.
- **Applies:** **UNCLEAR** — binds Telocc only under posture A; under posture B they bind Twilio toward its customer, and Telocc's contracts stay ordinary B2B civil-law contracts.
- **How the build handles it:** ToS architecture is modular so a contract-summary document and pre-contract information step can be inserted at one config point without redesign; a § 63a waiver declaration is drafted as a recorded pre-contract artifact (checkbox + stored copy), not silence (ER-POL-2, ER-POST-1). Whether a wholesale waiver is valid or must be granular per right is a counsel drafting question (OWN-8).
- **Verification:** Researcher-sourced (medium confidence); not adversarially verified.
- **Status:** **DRAFTED** (templates + waiver clause drafted; legal sign-off pending; activation conditional on OWN-1).
- **Sources:**
  - ZEK § 63 consolidated text (mirror) — https://www.kurzy.cz/zakony/127-2005-zakon-o-elektronickych-komunikacich/paragraf-63/ (post-374/2021, eff. 2022-01-01)
  - ZEK § 63b (mirror) — https://www.pracepropravniky.cz/zakony/zakon-o-elektronickych-komunikacich/paragraf-63b/
  - epravo.cz analysis of §§ 63/64 — https://www.epravo.cz/top/clanky/smlouva-o-poskytovani-verejne-dostupnych-sluzeb-elektronickych-komunikaci-jeji-obsah-a-nalezitosti-dle-63-a-64-zek-113757.html
  - AK Chrenek, Toman, Kotrba — https://www.chrenektomankotrba.cz/clanky/novela-zakona-o-elektronickych-komunikacich-nejcastejsi-otazky-podnikatelu

### 4. NIS2 / Czech Cybersecurity Act 264/2025 Sb. — conditional on posture

- **What it is:** NIS2 (Directive (EU) 2022/2555) Art 2(2) applies **regardless of size** to providers of public electronic communications networks / publicly available ECS; sub-medium providers are "important entities". Czech transposition: Act 264/2025 Sb. (effective 1 Nov 2025) + Decree 408/2025 Sb.; a regulated-service provider must self-register with NÚKIB within 60 days of the law applying, then run the lower-obligations security regime.
- **Applies:** **UNCLEAR** — entirely derivative of item 1. As a plain application-layer SaaS, Telocc is in no Annex I/II category and out of scope; as an ECS provider it is in scope regardless of being a one-person company.
- **How the build handles it:** the security baseline the lower-obligations regime expects is built anyway because it is also GDPR Art 32 hygiene: documented access control, admin/auth audit logging, incident-response runbook, backup/restore, supplier list with security terms (ER-SEC-*, ER-AUD-1, ER-POL-4). **No NÚKIB registration is made** under the current posture — do not register speculatively.
- **Verification:** Researcher-sourced (medium confidence); the NB-ICS trigger itself is Verified — SUPPORTED (item 1); whether NB-ICS sits on the 408/2025 regulated-services annex was not independently confirmed.
- **Status:** **OPEN — OWNER SIGN-OFF** (derivative of OWN-1; if posture flips → NÚKIB registration within 60 days).
- **Sources:**
  - NIS2 Art 2 — https://www.nis-2-directive.com/NIS_2_Directive_Article_2.html (Directive (EU) 2022/2555, applicable from 2024-10-18)
  - NIS2 Art 3 — https://www.nis-2-directive.com/NIS_2_Directive_Article_3.html
  - Zákon č. 264/2025 Sb. — https://www.sagit.cz/_texty/sb25264.htm (eff. 2025-11-01)
  - Advokátní deník on § 6 registration — https://advokatnidenik.cz/2025/12/16/zakon-o-kyberbezpecnosti-od-listopadu-plati-jak-ohlasit-regulovanou-sluzbu/
  - Vyhláška č. 408/2025 Sb. — https://www.aspi.cz/products/lawText/1/104754/1/2/vyhlaska-c-408-2025-sb-o-regulovanych-sluzbach/vyhlaska-c-408-2025-sb-o-regulovanych-sluzbach

### 5. Emergency communications (ZEK § 33 / EECC Art 109(2)) — ⚠️ CONDITIONAL CORE-FEATURE LEGALITY CONCERN

- **What it is:** ZEK § 33 obliges a provider of a publicly available NB-ICS that lets end users originate calls to national-plan numbers to enable **free access to emergency services** (112, 150, 155, 156, 158) including caller localisation/identification handover (details: Decree 267/2017 Sb. as amended by 22/2022 Sb.). Commission Delegated Regulation (EU) 2023/444 contemplates only limited, mainly location-related exceptions for network-independent NB-ICS — **not** a general permission to refuse emergency originations.
- **Applies:** **YES** in substance to the DTMF outbound bridge; whether the *legal duty* lands on Telocc depends on item 1.
- **The collision (verified):** Twilio does not support emergency calling for CZ (its supported-country list omits CZ) and contractually **prohibits** emergency-service traffic on its numbers (only US/CA E911 via Elastic SIP Trunking is carved out). So under posture A, the outbound bridge as specified (emergency numbers blocked, no ČTÚ notification) **may be non-compliant**; under posture B it is fine. No CZ source blessing a "block + disclose" posture for a dial-through service was found. This is the register's one conditional challenge to a core feature's legality — exactly the class of question the brief reserves to the owner.
- **How the build handles it (regardless of posture):** DTMF target validation explicitly rejects 112/150/155/156/158 and short-code patterns with a distinct refusal signal, never a silent failure; refusals logged as a distinct call-log status; mandatory "Telocc cannot carry emergency calls — dial 112 directly from your phone's dialer" disclosure at personal-number verification, in settings, and in ToS. The verification/settings copy is i18n-routed through a real locale mechanism (`packages/i18n`: `setLocale`/`getLocale`, per-key fallback to `en`), with a Czech (`cs.ts`) translation of exactly this emergency-disclosure/verification namespace, initialised in `apps/web` from `navigator.language`; the ToS copy is static drafted prose (`docs/legal/tos.md`), not code-templated. Czech coverage of the rest of the app and of the legal drafts is intentionally out of scope here — an owner/translation backlog item, not a gap in this disclosure (ER-EMG-1, ER-EMG-3). No half-support is attempted (forwarding 112 into Twilio would breach Twilio policy and produce a location-less mis-routed call — worse than refusal). Mitigating context: Telocc's only human user dials from their own mobile, whose native dialer always provides real 112 with handset location; Telocc is never the user's only telephony path.
- **Verification:** **Verified — SUPPORTED** (all limbs: § 33 scope and number list, Art 109(2) NB-ICS trigger, Twilio's CZ omission and contractual prohibition, DR 2023/444's narrow scope, and the absence of a CZ "block + disclose" exemption).
- **Status:** **OPEN — OWNER SIGN-OFF** (OWN-2), with mitigations ENGINEERED.
- **Sources:**
  - ZEK § 33 — https://www.zakonyprolidi.cz/cs/2005-127 (consolidated post-374/2021); mirror: https://www.pracepropravniky.cz/zakony/zakon-o-elektronickych-komunikacich/paragraf-33/
  - EECC Art 109 — https://www.legislation.gov.uk/eudr/2018/1972/article/109 (Directive (EU) 2018/1972); EENA analysis — https://eena.org/wp-content/uploads/2022/09/2022_08_31_Legislation_Update_FINAL2.pdf (2022-08-31)
  - Commission Delegated Regulation (EU) 2023/444 — https://eur-lex.europa.eu/eli/reg_del/2023/444/oj (in force 2023-03-05)
  - Twilio, Emergency Calling for Programmable Voice — https://www.twilio.com/docs/voice/tutorials/emergency-calling-for-programmable-voice (seen 2026-07; CZ absent)
  - Twilio Support, What kind of phone calls can't be made using Twilio — https://support.twilio.com/hc/en-us/articles/223180528 (seen 2026-07)
  - Twilio AUP — https://www.twilio.com/en-us/legal/aup ; Emergency Services Addendum — https://www.twilio.com/en-us/legal/emergency-services-addendum
  - Vyhláška č. 22/2022 Sb. (amending 267/2017 Sb.) — https://www.zakonyprolidi.cz/cs/2022-22 (eff. 2022-02-04); epravo summary — https://www.epravo.cz/top/zakony/sbirka-zakonu/vyhlaska-ze-dne-31-ledna-2022-kterou-se-meni-vyhlaska-c-2672017-sb-24107.html
  - Vonage Emergency Services Acknowledgement (industry practice) — https://www.vonage.com/legal/unified-communications/emergency-services-acknowledgement/

### 6. Number sub-allocation — customer org as end user of a Twilio-hosted number

- **What it is:** ZEK Hlava III Díl 5 ("Správa čísel", §§ 29–32): ČTÚ grants number-range authorisations to undertakings; transfer of a number authorisation between undertakings runs through the joint-application/change-of-holder procedure (§ 30 with § 32; note the 2021 amendment reportedly replaced the older "ČTÚ consent" step with the joint-request mechanism); § 34 porting is separate. End users use numbers through an ordinary subscriber relationship with the authorised undertaking — no ČTÚ act.
- **Applies:** **YES** (the pattern Telocc uses). The working conclusion — the standard CPaaS pattern (Twilio/its CZ partner holds the allocation; the customer org is end user of record; Telocc is the application layer) requires **no ČTÚ number-authorisation act by Telocc**; the binding constraint is *accuracy of end-user registration*.
- **How the build handles it:** per-org end-user regulatory identity stored (legal name, IČO-like identifier, address, document references) linked to the business number with lifecycle states mirroring Twilio bundle states behind the seam; no number presented to an org before its end-user record exists; release/reassign through the provider on offboarding, audit-logged; ToS warranty that the customer's identity data is accurate and passed to the carrier for regulatory registration (ER-KYC-1..3, ER-POL-2).
- **Verification:** **Verified — UNCERTAIN.** Nothing found refutes the conclusion and secondary evidence is consistent with it, but the verifier could not read the statute first-hand (proxy-blocked) and found the claim's "§ 30 consent" framing outdated post-374/2021. **Treated as open, not settled.**
- **Status:** **OPEN — OWNER SIGN-OFF** (fold into OWN-1/OWN-10: re-confirm the current §§ 30/32 mechanism against primary text and resolve the § 13 question before treating as settled). Engineering above ships regardless — it is correct under either reading.
- **Sources:**
  - ZEK Hlava III Díl 5 (mirror) — https://www.kurzy.cz/zakony/127-2005-zakon-o-elektronickych-komunikacich/cast-1-hlava-3-dil-5/ (post-374/2021)
  - ČTÚ, Správa čísel — https://ctu.gov.cz/sprava-cisel ; register of allocated numbers — https://ctu.gov.cz/vyhledavaci-databaze/pridelena-cisla-a-kody
  - ZEK consolidated — https://www.zakonyprolidi.cz/cs/2005-127 ; amendment 374/2021 Sb. — https://www.zakonyprolidi.cz/cs/2021-374
  - Twilio Phone Number Regulatory FAQ — https://www.twilio.com/docs/phone-numbers/regulatory/faq (seen 2026-07)

### 7. Twilio CZ number KYC — regulatory bundles; numbers do NOT activate instantly

- **What it is:** Czech numbers on Twilio require an approved regulatory bundle registering the **customer org (not Telocc)** as end user: legal name, business registration, CZ street address (PO box explicitly not accepted for Local/geographic numbers), matching proof documents. Bundle approval is a review step (statuses draft → pending-review → in-review → twilio-approved/rejected; a number cannot be mapped to a rejected/pending bundle).
- **Applies:** **YES.**
- **Spec tension (flagged):** the brief says the business number "activates immediately". For real CZ numbers this is **not achievable** — provisioning must be an async state machine and the UI must honour "pending regulatory review"; the mock provider may auto-approve so the demo still feels instant (ER-KYC-1).
- **How the build handles it:** onboarding collects org KYC (legal name, IČO, validated CZ street address — no PO box — document upload) shaped as Bundle + EndUser + SupportingDocument behind the seam; required-document checklist driven dynamically from Twilio's Regulations API rather than hard-coded; KYC documents encrypted, EU-stored, org-scoped, deleted when no longer required; bundle SIDs recorded on the org (ER-KYC-1..2).
- **Verification:** **Verified — SUPPORTED** (PO-box rule, end-user-of-record model, matching-documents rule, review-step lifecycle all corroborated; nothing superseding found through Jan 2026). Residual gap: exact CZ document list and whether the address must sit in the number's numbering area vs anywhere in CZ — unverifiable from this environment; confirm via Regulations API at wiring (OWN-10).
- **Status:** **ENGINEERED** (per ER-KYC-1..3), with OWN-10 confirmations outstanding.
- **Sources:**
  - Twilio CZ Regulatory Guidelines — https://www.twilio.com/en-us/guidelines/cz/regulatory (living doc; body not fetchable from this environment)
  - Twilio Regulatory FAQ — https://www.twilio.com/docs/phone-numbers/regulatory/faq (seen 2026-07)
  - Twilio Regulatory Docs Changelog — https://www.twilio.com/docs/phone-numbers/regulatory/changelog (CZ documentation requirements; PO-box rule)
  - Twilio Bundles API — https://www.twilio.com/docs/phone-numbers/regulatory/api/bundles ; EndUsers API — https://www.twilio.com/docs/phone-numbers/regulatory/api/end-users ; Regulations API — https://www.twilio.com/docs/phone-numbers/regulatory/api/regulations
  - Twilio Help, How to Submit a Regulatory Bundle — https://help.twilio.com/articles/8338625205147

### 8. Number portability (ZEK § 34; Decree 58/2022 Sb.)

- **What it is:** subscribers may keep their number free of charge when changing providers (geographic numbers within their numbering area; ≤1 business day service loss; fixed↔mobile excluded). Decree 58/2022 Sb. (eff. 2022-04-01): the subscriber verification code (OKU) must be stated automatically in the subscriber contract; the request goes to the gaining provider; 2-working-day inter-provider deadline. Twilio supports CZ porting via OKU (~1 week end-to-end).
- **Applies:** **YES** (direction-of-travel; no MVP porting features owed). Under posture B the § 34 obligor is Twilio's CZ carrier and Telocc's duty is contractual (don't hold numbers hostage); under posture A Telocc itself owes § 34 mechanics incl. an OKU in customer contracts.
- **How the build handles it:** no porting UI (correct scope); ToS states the number is assigned to the customer org and Telocc will cooperate with port-out at no charge beyond statutory limits; customer org registered as end user of record for clean chain-of-title; number lifecycle states kept open-ended (provisioned/active/porting_out/released); OKU template placeholder in the drafted ToS (ER-KYC-3, ER-POL-2).
- **Verification:** Researcher-sourced (medium confidence).
- **Status:** **DRAFTED** (ToS clause; legal sign-off pending).
- **Sources:**
  - ZEK § 34 (mirror) — http://zakony.centrum.cz/zakon-o-elektronickych-komunikacich/cast-1-hlava-3-dil-5-paragraf-34
  - Vyhláška č. 58/2022 Sb. — https://www.zakonyprolidi.cz/cs/2022-58 (eff. 2022-04-01)
  - Twilio Help, Czech Republic Porting — https://help.twilio.com/articles/360060201633 ; CZ Porting Guidelines — https://www.twilio.com/en-us/guidelines/cz/porting

---

## Part B — Numbering & caller-ID (CLI)

### 9. Lawful CLI presentation on the bridged outbound leg — ⚠️ NOT SETTLED

- **What it is:** ČTÚ general-authorisation amendment VO-S/2/04.2024-1 (eff. 1 June 2024): a number inserted into call signalling must be a **real telephone number linked to a specific subscriber or electronic-communications service and callable back**. EU frame: ePrivacy Directive Art 8 / ZEK § 92 (CLI presentation/restriction facilities) and EECC Arts 115/97(2).
- **Applies:** **YES** — this rule is what makes the appless-outbound feature's caller-ID presentation lawful or not.
- **The honest position:** Telocc's design plausibly satisfies the test — the number is real, linked to the org's service at the bridging operator, always callable back, and only the org's SMS-verified user can trigger presentation; this matches the mainstream international hosted-PBX/CPaaS pattern (cf. Ofcom CLI guidance on legitimate network-number substitution). **But adversarial verification could not confirm the operative text of VO-S/2/04.2024-1**, and found no CZ source resolving the crux: whether the condition permits *any* originating operator/service to insert a number allocated to that subscriber, or only the operator serving the subscriber's access line. Additionally, three of the four originally cited legal bases (§ 92 ZEK, ePrivacy Art 8, EECC Art 115) turned out to be CLIR/COLR presentation-restriction provisions, not insertion-validity rules — the real basis is the ČTÚ general authorisation alone, unverified in primary form. **Not presented as settled.**
- **How the build handles it (defensible under any reading):** strict binding — only the SMS-verified personal number of the org that owns the business number may trigger outbound presentation, verified from provider signalling; the seam accepts **only the org's provisioned business number** as presented identity (no arbitrary CLI values, ever); the business number always accepts inbound (office-hours decline is a signalling-level `<Reject reason="busy"/>`, not answer-then-decline — the number stays routed/responsive, never parked unreachable, decisions.md #20); every CLI presentation is linked in the audit log to initiating verified user, org, target, timestamp; forwarded-leg CLI defaults to the business number, never a passed-through third-party CLI (ER-CLI-1..3, ER-AUD-1).
- **Verification:** **Verified — UNCERTAIN** (nothing refutes it; indirect international support; primary text unobtainable; citation-fit problems found). 
- **Status:** **OPEN — OWNER SIGN-OFF** (OWN-3: qualified CZ telecom counsel confirmation before treating as settled), with the binding controls ENGINEERED.
- **Sources:**
  - ČTÚ press release on VO-S/2/04.2024-1 — https://ctu.gov.cz/tz-od-1.-cervna-budou-platna-prvni-opatreni-proti-spoofingu (conditions eff. 2024-06-01 / 2024-07-01; seen via search extract only)
  - ZEK § 92 (mirror; CLIR/COLR facility, incl. § 92(4)(a) malicious-call tracing) — http://zakony.centrum.cz/zakon-o-elektronickych-komunikacich/cast-1-hlava-5-dil-1-paragraf-92
  - ePrivacy Directive Art 8 — https://service.betterregulation.com/document/204505 (Directive 2002/58/EC as amended 2009) — *presentation/restriction facility, not an insertion-validity rule*
  - EECC — https://eur-lex.europa.eu/eli/dir/2018/1972/oj/eng (2018-12-11; Art 115 CLI facilities; Art 97(2) blocking powers — tangential)
  - Ofcom CLI Guidance 2024 (analogous UK framework; originating-CP responsibility, legitimate network-number substitution) — https://www.ofcom.org.uk/siteassets/resources/documents/consultations/category-2-6-weeks/276698---further-action-to-tackle--scam-calls/associated-documents/annex-2-cli-guidance-2024-update.pdf
  - ECC Report 338 (CLI spoofing) — https://docdb.cept.org/download/4027 (referenced, not opened)

### 10. Anti-spoofing blocking at international interconnection — the practical deliverability gate

- **What it is (verified):** since **1 July 2024** (VO-S/2/04.2024-1), operators at Czech international interconnection points must **not connect** calls arriving from abroad whose CLI is a Czech **non-mobile** number (fixed/geographic, short codes, special numbers). Mobile CLIs are exempt (roaming), handled instead by operator self-regulation ("Firewall 2.2", O2/T-Mobile/Vodafone, real-time cross-network verification since April 2025). ČTÚ reports large operators blocked 50–99% of such foreign-arriving calls (millions/month), and 2025/2026 monitoring shows the regime still in force.
- **Applies:** **YES — highest practical risk to the product.** If Twilio originates the bridged outbound leg (or the inbound forwarding leg) outside CZ so it enters via international interconnection, a Czech geographic business-number CLI **will be blocked** for calls to Czech destinations — both legs toward any Czech phone are exposed. Twilio publicly guarantees local CLI survival only for +1 destinations; whether its CZ termination is domestic is **not publicly documented**. The feature is lawful but its CZ→CZ deliverability depends entirely on provider routing.
- **How the build handles it:** "CZ CLI survives to CZ destinations" is modeled as an explicit, testable provider capability — a seam capability flag plus a documented verification step in the deploy runbook, recorded as a **go-live gate**; provider disposition/error codes surfaced in the call log (status failed/blocked) with alerting on elevated CZ-destination failure rates; forwarded-leg CLI strategy configurable at the seam (default: business number); number class (geographic / 910 / mobile) modeled as a switchable attribute so the practical fix needs no schema change (ER-OBS-1, ER-CLI-2, ER-KYC-3).
- **Verification:** **Verified — SUPPORTED** (rule, scope, mobile exemption, blocking statistics, Twilio's +1-only guarantee all corroborated; the domestic-termination question is correctly flagged as unverified, not asserted).
- **Status:** **OPEN — OWNER SIGN-OFF** (OWN-4/OWN-5: Twilio written confirmation, or BYOC/domestic trunk, or number-class change), with observability ENGINEERED.
- **Sources:**
  - ČTÚ (EN), First anti-spoofing measures in force from 1 June — https://ctu.gov.cz/en/press-release:-first-anti-spoofing-measures-force-1-june (eff. 2024-06-01)
  - ČTÚ (EN), Both anti-spoofing measures apply — https://ctu.gov.cz/en/both-anti-spoofing-measures-apply-if-you-have-issues-contact-your-service-provider (eff. 2024-07-01)
  - ČTÚ (EN), Anti-spoofing measures are working, millions blocked — https://ctu.gov.cz/en/ctus-anti-spoofing-measures-are-working-millions-calls-month-are-being-blocked-and-number-frauds (evaluation Nov/Dec 2024); CZ version — https://ctu.gov.cz/opatreni-uradu-proti-spoofingu-funguji-blokovany-jsou-miliony-hovoru-mesicne-pocet-podvodu-klesa
  - ČTÚ monitoring reports — https://ctu.gov.cz/sites/default/files/obsah/ctu/monthly-monitoring-report-no.-12/2024/obrazky/mz_12_2024_-_na_web.pdf ; https://ctu.gov.cz/monitorovaci-zprava-082025-regulace-samoregulace-zasadne-omezila-podvodny-spoofing-vypadek-sluzby
  - Twilio Support, Local Caller ID (CLI) international compatibility — https://support.twilio.com/hc/en-us/articles/223132227 ; International Voice Quirks — https://support.twilio.com/hc/en-us/articles/360005772753
  - Prague Daily News, Firewall 2.2 launch — https://www.praguedaily.news/2025/04/22/protection-against-phone-fraud-czech-network-operators-launch-new-anti-spoofing-system/ (April 2025); Telecom Review Europe — https://www.telecomrevieweurope.com/articles/telecom-operators/no-more-fake-calls-o2-vodafone-and-t-mobile-launch-unified-firewall/
  - EU-ETC overview of national CLI regimes — https://eu-etc.com/2025/11/20/anonymisation-or-blocking-of-calls-from-abroad-with-a-national-numbereuropean-countries-are-divided/ (as of Nov 2025)
  - Twilio BYOC — https://www.twilio.com/docs/voice/bring-your-own-carrier-byoc

### 11. Czech numbering plan — regional tie of geographic numbers; the 910 nomadic range

- **What it is:** Decree 117/2007 Sb.: geographic numbers carry a TC area code per numbering area (2 = Prague/Central Bohemia; 3x–5x other regions); regional affiliation follows the fixed-network termination point; geographic numbers are portable **only within their numbering area**. Mobile ranges start 6/7. The **910** range (911–919 reserved) is designated for location-independent (nomadic) VoIP. There is no EU right to use Czech geographic numbers extraterritorially (EECC Art 93 covers only non-geographic/non-interpersonal ranges). Twilio enforces the address side: CZ Local numbers need a local street address, no PO boxes, matching documents.
- **Applies:** **YES** — shapes the "catalog of local numbers for its region" flow.
- **How the build handles it:** signup captures the org's Czech business street address, validates it (no PO box), maps region → TC area code, and offers only numbers whose numbering area matches; address/identity persisted in Twilio-bundle-exportable shape; number class an attribute of the number entity; region/area-code mapping data-driven and seedable so it can be corrected against the current decree at wiring; owner-facing docs note the regional-tie principle and 910 as the sanctioned location-independent class (ER-KYC-2..3).
- **Verification:** Researcher-sourced (medium confidence); the numbering-area portability rule was independently corroborated during verification of item 7.
- **Status:** **ENGINEERED** (per ER-KYC-2..3).
- **Sources:**
  - Vyhláška č. 117/2007 Sb. — https://www.zakonyprolidi.cz/cs/2007-117 (eff. 2007-07-01; consolidated to 2024-01-01)
  - ČTÚ, sdělení ke geografickým číslům — https://ctu.gov.cz/sdeleni-ceskeho-telekomunikacniho-uradu-ke-zmene-rozsahu-ciselnych-rad-pridelovanych-geografickych
  - Lupa.cz on the 910 range — https://www.lupa.cz/clanky/predcisli-910-to-neni-eroticka-linka-to-je-voip/
  - BEREC, Numbering Database for extra-territorial use — https://www.berec.europa.eu/en/tools/numbering-database-for-extra-territorial-use (EECC Art 93)
  - Twilio CZ Regulatory Guidelines — https://www.twilio.com/en-us/guidelines/cz/regulatory ; Regulatory FAQ — https://www.twilio.com/docs/phone-numbers/regulatory/faq

### 12. Telemarketing opt-in (ZEK §§ 95–96) — binds Telocc's customers, not Telocc

- **What it is:** since 1 July 2022 (Act 374/2021 Sb.), marketing calls in CZ are opt-in: prohibited unless the called party is flagged for marketing in a public participant directory or gave prior consent; no consumer/business distinction on the statute's face; fines up to CZK 50M or 10% of turnover; ČTÚ's interpretive opinion (e.g. on B2B outreach to self-published contacts) is explicitly non-binding and enforcement has diverged from it — no safe harbour.
- **Applies:** **YES** — to Telocc's customers when they make marketing calls; not to Telocc directly (no dialer/campaign features in MVP).
- **How the build handles it:** warning copy in outbound-related onboarding/settings and in the ToS/AUP ("cold marketing calls in CZ require opt-in/consent — fines up to CZK 50M; you are responsible"), routed through i18n so the Czech version carries the § 96 reference and a link to ČTÚ's manual; AUP right to suspend on abuse/complaints; per-call initiator attribution retained as the evidence trail; no number-list dialing feature may be added later without revisiting this regime (ER-POL-2).
- **Verification:** Researcher-sourced (high confidence).
- **Status:** **DRAFTED** (AUP/ToS text; legal sign-off pending).
- **Sources:**
  - ČTÚ, výkladové stanovisko + FAQ (PDF) — https://ctu.gov.cz/sites/default/files/obsah/ctu-new/telekomunikace/telemarketing/vykladove-stanovisko-telemarketing-a-faq.pdf (regime eff. 2022-07-01)
  - ČTÚ, marketingové hovory manuál — https://ctu.gov.cz/nevyzadane-marketingove-hovory-navod
  - ÚOOÚ Telemarketing Q&A — https://uoou.gov.cz/verejnost/qa-otazky-a-odpovedi/telemarketing
  - Právní prostor analysis — https://www.pravniprostor.cz/clanky/ostatni-pravo/navolavani-jen-se-souhlasem-analyza-novely-zakona-o-elektronickych-komunikacich-pro-oblast-telemarketingu (amendment 374/2021 Sb.)
  - SEDLAKOVA LEGAL on B2B telemarketing — https://www.sedlakovalegal.cz/cs/b2b-telemarketing

### 13. Network-abuse framework (Act 23/2025 Sb., eff. 1 July 2025)

- **What it is:** defines abuse of e-comms networks/services (use by an unauthorised person, prohibited manner/purposes, malicious calls), authorises operators to deploy proportionate anti-abuse measures, score traffic riskiness, and share traffic/location data between undertakings without user consent to identify/limit abuse; expands ČTÚ powers.
- **Applies:** **YES** — Czech operators now have statutory backing to score/filter/block anomalous traffic; a bridged-call service presenting one CLI at volume can be flagged; account takeover of a Telocc org (spoofed initiator, toll fraud via the DTMF bridge) is "use by an unauthorised person".
- **How the build handles it:** initiation-path security treated as a compliance control (signalling-verified caller number, webhook signature verification, per-org rate limits on dial-in and DTMF sessions); call-metadata logs sufficient to demonstrate traffic legitimacy (timestamps, initiator, direction, disposition) within the chosen retention window; per-org outbound anomaly guards (soft caps/alerts) so a compromised account cannot generate fraud-scale traffic; runbook section on responding if a provider/operator flags Telocc traffic (ER-RATE-2..3, ER-WEB-1, ER-AUD-1, ER-POL-4). Related contractual layer (Twilio AUP, toll-fraud/IRSF controls, Geo Permissions at wiring) is covered in ER-EMG-2.
- **Verification:** Researcher-sourced (medium confidence); the amendment's existence and thrust independently corroborated during verification of items 10/23.
- **Status:** **ENGINEERED** (per ER-RATE-*, ER-WEB-1, ER-AUD-1).
- **Sources:**
  - Zákon č. 23/2025 Sb. — https://www.zakonyprolidi.cz/cs/2025-23 (eff. 2025-07-01)
  - Právní prostor — https://www.pravniprostor.cz/zmeny-v-legislative/vyslo-ve-sbirce-zakonu/novela-zakona-o-elektronickych-komunikacich3
  - e15 — https://www.e15.cz/finexpert/banky-a-ucty/omezeni-spoofingu-sdileni-udaju-mezi-operatory-i-rozsireni-pravomoci-ctu-co-zavadi-novela-zakona-o-elektronickych-komunikacich-1422411
  - MPO press release — https://mpo.gov.cz/cz/rozcestnik/pro-media/tiskove-zpravy/poslanecka-snemovna-schvalila-novelu-zakona-o-elektronickych-komunikacich-lepsi-ochrana-spotrebitelu-a-dostupnost-internetu--285296/
  - Twilio AUP — https://www.twilio.com/en-us/legal/aup ; toll fraud — https://www.twilio.com/docs/glossary/what-is-toll-fraud ; Geo Permissions — https://support.twilio.com/hc/en-us/articles/223180228

---

## Part C — Data protection & ePrivacy

### 14. GDPR roles: controller/processor allocation (Telocc / customer org / Twilio)

- **What it is:** roles follow factual function (GDPR Art 4(7)-(8); EDPB Guidelines 07/2020). The customer org determines why calls are made → controller for call metadata and its callers' numbers. Telocc: **processor** for org call data; **independent controller** for its own purposes (account data, owner email, verified personal number, auth, security/rate-limit logs, billing). Twilio: Telocc's sub-processor for service data per its DPA (narrow independent-controller carve-outs, e.g. its own telecom-law compliance), plus regulated-carrier obligations in its own right.
- **Applies:** **YES.**
- **How the build handles it:** Telocc-to-customer DPA (Art 28 terms) shipped as part of the ToS — processing scope, sub-processor authorisation (Twilio, Cloudflare, Neon, email provider), DSR assistance, breach notice, deletion on termination; public sub-processor list page; two documented processing "hats" in the RoPA; org-scoped queries everywhere as the technical expression of the processor boundary (ER-POL-2..3; org scoping is a brief-level invariant).
- **Verification:** Researcher-sourced (high confidence).
- **Status:** **DRAFTED** (DPA/ToS text; legal sign-off pending). Org scoping itself: ENGINEERED.
- **Sources:**
  - EDPB Guidelines 07/2020 on controller/processor — https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-072020-concepts-controller-and-processor-gdpr_en (v2.0 adopted 2021-07-07)
  - Twilio DPA — https://www.twilio.com/en-us/legal/data-protection-addendum (current as of July 2026)

### 15. Lawful bases per purpose

- **What it is:** Art 6(1)(b) (contract) covers account, SMS-PIN verification, magic-link login, operating the routing; Art 6(1)(f) (legitimate interests) covers fraud prevention/rate limiting/security logging (Recital 47 names fraud prevention expressly; balancing test required); Art 6(1)(c) for invoicing/tax when billing exists. For call metadata Telocc is processor — the basis is the customer-controller's; Telocc supports it via the DPA. **No consent-based processing anywhere in the MVP.**
- **Applies:** **YES.**
- **How the build handles it:** basis documented per purpose in the RoPA; short written legitimate-interest assessment for anti-abuse logs; security logs minimal and auto-purged after a short fixed window so the 6(1)(f) balancing holds; privacy notice states each purpose + basis; no consent UI in core flows (ER-POL-1, ER-POL-3, ER-RET-2).
- **Verification:** Researcher-sourced (high confidence).
- **Status:** **DRAFTED** (RoPA + notice text; legal sign-off pending). Purge mechanics: ENGINEERED (ER-RET-2).
- **Sources:**
  - GDPR Recital 47 — https://gdpr-info.eu/recitals/no-47/ (GDPR applicable since 2018-05-25)

### 16. International transfers: vendor DPAs, SCCs, DPF status

- **What it is:** Twilio, Cloudflare and Neon are US-headquartered → GDPR Chapter V transfer tools needed even with EU regions. Twilio: DPA incorporates the 4 June 2021 EU SCCs, holds approved processor BCRs, certified under EU–US DPF. Cloudflare: customer DPA v6.3 (2025-06-20) — SCCs Modules 2/3, DPF reliance, express SCC fallback with supplementary measures. Neon: DPA at neon.com/dpa, sub-processor list, rides AWS. DPF status: General Court dismissed Latombe (2025-09-03); appeal **C-703/25 P pending at CJEU** (filed 2025-10-31, no hearing date as of May 2026) — DPF is valid law today with residual Schrems-style risk.
- **Applies:** **YES.**
- **How the build handles it:** one-page transfer register in the repo (vendor, role, data categories, region, mechanism DPF/SCCs/BCR-P, fallback) so the posture survives handover; Neon project created in an EU region (immutable per project); watch item for C-703/25 P — if DPF falls, SCC fallbacks carry the transfers but transfer impact assessments must be refreshed (ER-POL-5, ER-RES-1).
- **Verification:** Researcher-sourced (high confidence).
- **Status:** **OPEN — OWNER SIGN-OFF** (OWN-7: the owner must actually execute/accept each DPA when wiring live accounts). Transfer-register scaffold and Neon region: ENGINEERED.
- **Sources:**
  - Twilio, Revised DPA for new EU SCCs — https://help.twilio.com/articles/4405290603803 (SCCs of 2021-06-04)
  - Twilio BCR Processor Policy — https://www.twilio.com/en-us/legal/bcr/processor ; Twilio Privacy Notice (DPF statement) — https://www.twilio.com/en-us/legal/privacy
  - Cloudflare Customer DPA — https://www.cloudflare.com/cloudflare-customer-dpa/ (v6.3, 2025-06-20)
  - Neon DPA — https://neon.com/dpa ; sub-processors — https://neon.com/subprocessors
  - IAPP on Latombe dismissal — https://iapp.org/news/a/european-general-court-dismisses-latombe-challenge-upholds-eu-us-data-privacy-framework (judgment 2025-09-03)
  - WilmerHale on the C-703/25 P appeal — https://www.wilmerhale.com/en/insights/blogs/wilmerhale-privacy-and-cybersecurity-law/20251201-european-court-of-justice-to-review-challenge-to-eu-us-data-privacy-framework (filed 2025-10-31; pending as of May 2026)

### 17. Data-subject rights: access, erasure, export/portability

- **What it is:** Art 20 portability (structured, machine-readable export of data provided by the data subject under contract/consent; one-month response); Art 17 erasure with carve-outs (legal-obligation retention, claims). For call-log data Telocc is processor — callers' requests go to the org as controller; Telocc's DPA commits assistance. Twilio supports per-record deletion via API DELETE and purges after account closure (~30 days content, ~60 days account data).
- **Applies:** **YES.**
- **How the build handles it:** org-scoped export endpoint (JSON/CSV: account data + full call log); cascading account/org deletion (user, verified number, call log, auth artifacts) with a documented carve-out list (billing records, stated retention); telephony seam exposes an optional `deleteCallRecord`/propagate-delete capability for provider-side copies; DSR intake documented in the privacy notice with the one-month SLA — email-based handling is adequate at single-owner scale (ER-DSR-1..3).
- **Verification:** Researcher-sourced (high confidence).
- **Status:** **ENGINEERED** (per ER-DSR-1..3).
- **Sources:**
  - GDPR Art 20 — https://gdpr-text.com/read/article-20/?lang1=en (applicable since 2018-05-25)
  - Twilio, Delete Call Logs/Recordings — https://help.twilio.com/articles/223133047
  - Twilio, Data Retention and Deletion — https://help.twilio.com/articles/4410585868443

### 18. Security of processing (Art 32) + data protection by design (Art 25), incl. SMS-PIN and magic-link hardening

- **What it is:** state-of-the-art technical/organisational measures — pseudonymisation/encryption, confidentiality-integrity-availability-resilience, restore, and regular testing; binds Telocc in both roles. EDPB Guidelines 01/2021 treat exfiltration of strongly hashed+salted credentials as potentially non-notifiable and recommend hashing for credentials plus anti-credential-stuffing controls. OWASP supplies the technical floor for tokens/PINs.
- **Applies:** **YES.**
- **How the build handles it:** TLS every hop; Neon encryption at rest; magic-link tokens ≥128-bit CSPRNG, stored hashed, single-use, ~15-min TTL, invalidated on use/new issuance, enumeration-safe responses; SMS PIN 4–6 digits stored hashed (HMAC-with-server-secret or strong KDF) with hard attempt cap (~5) then invalidate, ~10-min TTL, resend cooldown + daily caps; per-IP and per-identifier rate limits on all SMS/email-triggering endpoints; webhook signature verification as an integrity measure; least-privilege DB credentials; secrets in Wrangler/Neon stores, never in repo; no personal data in edge logs; automated backups + documented restore test; Vitest/Playwright suite + dependency updates as the documented "regular testing"; all enumerated in a SECURITY/TOMs doc as Art 32 evidence (ER-SEC-1..5, ER-RATE-1, ER-WEB-1).
- **Verification:** Researcher-sourced (high confidence).
- **Status:** **ENGINEERED** (per ER-SEC-*), TOMs doc DRAFTED.
- **Sources:**
  - GDPR Art 32 — https://gdpr-info.eu/art-32-gdpr/ (applicable since 2018-05-25)
  - EDPB Guidelines 01/2021 (breach examples) — https://www.edpb.europa.eu/sites/default/files/consultation/edpb_guidelines_202101_databreachnotificationexamples_v1_en.pdf (v2.0 adopted 2021-12-14)
  - OWASP Authentication Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
  - OWASP Forgot Password Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
  - NIS2 Art 2 (relevant only if ECS-classified) — https://www.nis-2-directive.com/NIS_2_Directive_Article_2.html

### 19. Records of processing (Art 30) — the <250-employee exemption does NOT apply

- **What it is:** Art 30(5) exempts small organisations only if processing is occasional (among alternative conditions); WP29/EDPB: "occasional" = outside the regular course of business. Telocc's continuous call-metadata processing is its core business → records required despite size: controller records (Art 30(1)) for account/auth/security data, processor records (Art 30(2)) for customer call data.
- **Applies:** **YES.**
- **How the build handles it:** `docs/compliance/ropa.md` maintained in-repo — two sections (controller + processor): purposes, data-subject/data categories, recipients/sub-processors, transfers + mechanism, retention periods, TOMs reference; updated on any sub-processor/data-category change; anchors the purge-job retention windows (ER-POL-3).
- **Verification:** Researcher-sourced (high confidence).
- **Status:** **DRAFTED** (RoPA document; kept current by the build process).
- **Sources:**
  - EDPB position paper on Art 30(5) derogations — https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/position-paper-derogations-obligation-maintain-records_en (WP29, 2018-04-19)
  - ICO, who needs to document processing — https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/documentation/who-needs-to-document-their-processing-activities/

### 20. DPO designation (Art 37) — not required at MVP scale

- **What it is:** DPO mandatory only for public bodies, large-scale regular/systematic monitoring, or large-scale special-category processing. Telocc's core activity is regular/systematic but a single-owner B2B MVP fails the "large scale" limb on every WP243 factor; Czech Act 110/2019 Sb. adds no broader duty.
- **Applies:** **NO** (documented non-designation; revisit on customer/volume growth).
- **How the build handles it:** privacy contact (privacy@ address) published in the notice as DSR/breach intake; one-paragraph WP243 non-designation reasoning recorded here so the revisit trigger is explicit (ER-POL-1).
- **Verification:** Researcher-sourced (high confidence).
- **Status:** **DRAFTED** (reasoning recorded; contact published in notice draft).
- **Sources:**
  - GDPR Art 37 — https://gdpr-info.eu/art-37-gdpr/ (applicable since 2018-05-25)
  - WP243 rev.01 DPO Guidelines — https://www.dataguidance.com/sites/default/files/wp243_rev01_enpdf_2.pdf (adopted 2017-04-05, EDPB-endorsed)

### 21. Personal data breach notification (Arts 33/34; ÚOOÚ)

- **What it is:** controller notifies ÚOOÚ without undue delay, where feasible within 72h (delay must be reasoned), unless unlikely to risk rights/freedoms; high-risk breaches also to individuals; **as processor**, Telocc notifies the affected customer-org controller without undue delay; all breaches documented internally (Art 33(5)). ÚOOÚ runs a dedicated e-form; Czech Act 110/2019 Sb. mirrors the regime. Sub-processor DPAs (Neon ~72h, Twilio, Cloudflare) feed the chain.
- **Applies:** **YES.**
- **How the build handles it:** incident-response runbook — detection sources (AppSignal alerts, auth-anomaly logs), 72-hour clock from awareness, ÚOOÚ e-form path, risk-assessment template (EDPB 01/2021 examples), customer-org notification template, internal breach log, sub-processor breach contacts; audit logging rich enough to scope a breach (which orgs, which records) without logging excess personal data (ER-POL-4, ER-AUD-1).
- **Verification:** Researcher-sourced (high confidence).
- **Status:** **DRAFTED** (runbook; sign-off pending). Supporting audit logging: ENGINEERED.
- **Sources:**
  - ÚOOÚ, porušení zabezpečení — https://uoou.gov.cz/profesional/poruseni-zabezpeceni-osobnich-udaju
  - Portál veřejné správy breach service — https://portal.gov.cz/sluzby-vs/ohlaseni-poruseni-zabezpeceni-osobnich-udaju-data-breach-S30277
  - Zákon č. 110/2019 Sb. — https://www.zakonyprolidi.cz/cs/2019-110 (eff. 2019-04-24)
  - EDPB Guidelines 01/2021 — https://www.edpb.europa.eu/sites/default/files/consultation/edpb_guidelines_202101_databreachnotificationexamples_v1_en.pdf (v2.0, 2021-12-14)

### 22. ePrivacy traffic data (Arts 5/6/9; ZEK §§ 88–91) & the call-log retention window

- **What it is:** ePrivacy/ZEK § 90 oblige providers of public networks/publicly available ECS to erase or anonymise traffic data once not needed for transmission (billing/dispute retention excepted) and to inform subscribers what traffic data is kept and for how long. Whether these bind **Telocc directly** is the item-1 classification question (C-142/18 makes a SkypeOut-like bridge look like an ECS; post-EECC the ZEK definition covers interpersonal services). Regardless, the call log is personal data and GDPR storage limitation applies in full.
- **Applies:** **UNCLEAR** as a direct ZEK duty; **YES** in substance via GDPR.
- **How the build handles it (so the classification doesn't matter operationally):** call log treated as traffic data — documented retention window tied to service/billing-dispute purposes (owner to set; proposal 13 months, OWN-6) with a scheduled purge/anonymise job (strip both numbers; optional aggregate row); privacy notice/customer docs state exactly which metadata is kept (timestamp, direction, duration, status, numbers) and for how long — mirroring the ZEK § 90(6) information duty; call-log access restricted to the org — no in-app admin/"break-glass" route exists (safe by absence, not by logging); the only bypass is direct database access outside the application, which is a documented runbook procedure with a manually recorded reasoned entry (`docs/runbook.md`), never a logged application capability; **no use of traffic data for marketing/analytics** (ER-RET-1, ER-POL-1, ER-AUD-1).
- **Verification:** Researcher-sourced (medium confidence); the classification limb is Verified — SUPPORTED under item 1.
- **Status:** **ENGINEERED** (design satisfies the substance either way), with the window itself **OPEN — OWNER SIGN-OFF** (OWN-6).
- **Sources:**
  - ePrivacy Directive 2002/58/EC (consolidated) — https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32002L0058 (consolidated 2009-12-19)
  - ZEK § 90 (mirror) — https://www.kurzy.cz/zakony/127-2005-zakon-o-elektronickych-komunikacich/paragraf-90/
  - CJEU C-142/18 — https://curia.europa.eu/juris/liste.jsf?num=C-142/18 (2019-06-05)
  - IAPP on EECC × ePrivacy OTT extension — https://iapp.org/news/a/new-european-electronic-communications-code-means-the-application-of-the-eprivacy-directive-to-otts (EECC definitions from 2020-12-21)
  - Zákon č. 374/2021 Sb. — https://www.zakonyprolidi.cz/cs/2021-374 (eff. 2022-01-01)

### 23. ZEK § 97(3) six-month data retention — deliberately NOT built

- **What it is:** § 97(3) obliges providers of public networks/publicly available ECS to retain traffic and location data 6 months for authorised bodies (mechanics: Decree 357/2012 Sb., amended — not repealed — alongside 23/2025 Sb.). Trajectory: original regime annulled (Pl. ÚS 24/10, 2011); amended regime upheld domestically (Pl. ÚS 45/17, May 2019); on **30 December 2025 the Czech Supreme Court (30 Cdo 2556/2025) held blanket, indiscriminate § 97(3) retention violates EU law** (Art 15(1) of Directive 2002/58) in a serious and prolonged manner. Nuance (verified): that is a civil judgment, not an annulment — the provision remains formally on the books and was still being applied months later; repeal awaits the legislature.
- **Applies:** **UNCLEAR/NO for Telocc** — the duty attaches to the regulated provider; under the ride-on-Twilio posture it lands on Twilio's Czech carrier chain. Pl. ÚS 45/17 itself flagged that the duty does not reach OTT/app-layer services. If Telocc were classified as ECS, § 97 would nominally attach — but its enforceability is itself in doubt.
- **How the build handles it:** **no § 97 retention capability is built** — voluntarily retaining 6 months of traffic data "for compliance" would conflict with GDPR minimisation and current Czech case law. Retention is set purely by service/billing purposes (item 22). The schema stores call metadata such that the § 97/Decree 357/2012 field set (calling/called number, start, duration, service type) is *extractable without schema change* if a legal flip ever demands it — a config/legal step, not a re-architecture. No lawful-intercept/retention hooks in the seam. If the classification flips, obtain legal advice before implementing any retention, citing NS 30 Dec 2025 and Pl. ÚS 45/17 (ER-RET-1, ER-POST-1).
- **Verification:** **Verified — SUPPORTED** (scope of § 97(3), the NS ruling's existence and characterization, the "binds carriers not app layer" reading, and the caution against voluntary retention all corroborated; formal-status nuance incorporated above).
- **Status:** **ENGINEERED** (minimal-retention design; no § 97 tooling), with the posture contingency noted under OWN-1.
- **Sources:**
  - NS press release, 30 Dec 2025 — https://www.nsoud.cz/pro-verejnost-a-media/tiskove-zpravy/detail/nejvyssi-soud-potvrdil-protipravnost-plosneho-uchovavani-dat-o-elektronicke-komunikaci-1 ; judgment PDF (30 Cdo 2556/2025) — https://www.nsoud.cz/fileadmin/user_upload/Uredni_deska/UD_-_civilni/Vyhlas._zneni_rozsudku_30_Cdo_2556_2025.pdf
  - Lupa.cz report — https://www.lupa.cz/aktuality/plosne-uchovavani-dat-o-elektronicke-komunikaci-v-cesku-je-protipravni-potvrdil-nejvyssi-soud/ ; Digitální svobody — https://digitalnisvobody.cz/blog/2026/01/08/tz-dobra-zprava-pro-soukromi-shromazdovani-dat-z-mobilu-je-nelegalni-potvrdil-nejvyssi-soud/ and follow-up (2026-05-20) showing continued state application — https://digitalnisvobody.cz/blog/2026/05/20/tz-stat-neresi-problem-nelegalniho-sberu-komunikacnich-dat-naopak-dalsi-urad-k-nim-chce-pristup/
  - Ústavní soud Pl. ÚS 45/17 — https://www.usoud.cz/aktualne/soucasna-pravni-uprava-data-retention-je-ustavne-konformni (May 2019)
  - Pl. ÚS 24/10 (MUNI ICT judikatura) — https://ictjudikatura.law.muni.cz/wiki/Pl._%C3%9AS_24/10_-_Shroma%C5%BE%C4%8Fov%C3%A1n%C3%AD_provozn%C3%ADch_a_lokaliza%C4%8Dn%C3%ADch_%C3%BAdaj%C5%AF (2011)
  - Vyhláška č. 357/2012 Sb. — https://www.zakonyprolidi.cz/cs/2012-357 ; amendment note (43/25, eff. 2025-07-01) — https://www.komora.cz/pravni-predpis/43-25-novela-vyhl-c-357-2012-sb-o-uchovavani-predavani-a-likvidaci-provoznich-a-lokalizacnich-udajut20-3-2025/
  - ZEK § 97 (mirror) — http://zakony.centrum.cz/zakon-o-elektronickych-komunikacich/cast-1-hlava-5-dil-1-paragraf-97

### 24. Cookies / terminal-equipment access (ePrivacy Art 5(3); ZEK § 89(3)) — no banner needed

- **What it is:** storing/accessing information on terminal equipment needs consent, except (a) transmission-only and (b) strictly necessary for a service the user explicitly requested — authentication/session tokens are the canonical exempt case. Czech opt-in regime since 1 Jan 2022 (§ 89(3), Act 374/2021 Sb.) keeps the same exemptions. ÚOOÚ's own Q&A: technical-cookies-only sites need **no banner**, but must keep the information duty (visible link describing the cookies). ÚOOÚ actively inspects cookie bars; dark patterns are an enforcement target — another reason not to ship one unnecessarily. EDPB Guidelines 2/2023 read Art 5(3) broadly across storage technologies.
- **Applies:** **YES.**
- **How the build handles it:** first-party strictly necessary cookies only — Better Auth session cookie (+ CSRF token if cookie-based), HttpOnly/Secure/SameSite; no analytics, no third-party embeds, no fingerprinting/localStorage tracking; **no consent banner**; "Cookies" section in the privacy notice (name, purpose, lifetime of each cookie) linked in the footer; deploy-checklist gate: any future analytics/marketing script triggers a CMP requirement first (ER-COOK-1).
- **Verification:** Researcher-sourced (high confidence).
- **Status:** **ENGINEERED** (per ER-COOK-1); notice text DRAFTED.
- **Sources:**
  - ÚOOÚ Cookies Q&A — https://uoou.gov.cz/verejnost/qa-otazky-a-odpovedi/cookies (post-2022 regime)
  - ÚOOÚ, cookies only with consent from 2022 — https://uoou.gov.cz/novinky/nezarazene/cookies-od-zacatku-roku-2022-pouze-se-souhlasem (2022-01-01)
  - Právní prostor on § 89(3) — https://www.pravniprostor.cz/clanky/ostatni-pravo/novela-zakona-o-elektronickych-komunikacich-zavadi-povinnost-predchoziho-souhlasu-pro-pouziti-cookies-od-1-ledna-2022
  - EDPB Guidelines 2/2023 (technical scope of Art 5(3)) — https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf (v2, Oct 2024)

### 25. EU data residency: Neon EU + globally-executing Workers + Twilio regions

- **What it is:** storing data in an EU Neon region does not keep *processing* in the EU: Cloudflare Workers execute by default at whatever PoP serves the request, worldwide — request payloads with personal data transit non-EEA points. That is lawful today as a documented transfer under Cloudflare's DPA (SCCs + DPF + supplementary measures) but is not EU-only processing. Mitigation: Cloudflare **Regional Services (Data Localization Suite)** on a custom domain restricts TLS termination and Workers execution to EU. Twilio offers the **IE1 (Ireland)** region: voice data processed/stored in-region; SMS data residency keeps body + end-user number in the EU up to carrier hand-off. Competitor claims of residual US CLOUD-Act exposure for US-parent vendors are a risk note, not a blocker — DPF/SCCs are the operative mechanism.
- **Applies:** **YES.**
- **How the build handles it:** Neon project in EU region at creation (immutable); API/app served on a custom domain so Regional Services (EU) can be switched on — documented as a recommended paid hardening step; until enabled, minimise what transits the Worker: no personal data in Workers logs/analytics, no edge caching/KV/Durable-Object persistence of personal data, DB as the single store; Twilio IE1 selected at wiring and recorded, with all three residency decisions + mechanisms in the transfer register (ER-RES-1..3, ER-POL-5).
- **Verification:** Researcher-sourced (high confidence).
- **Status:** **ENGINEERED** (Neon EU, edge minimisation, custom domain), with the Regional Services purchase and Twilio IE1 selection **OPEN — OWNER SIGN-OFF** (OWN-7).
- **Sources:**
  - Cloudflare Data Localization — Workers — https://developers.cloudflare.com/data-localization/how-to/workers/ ; Regional Services — https://developers.cloudflare.com/data-localization/regional-services/ ; GDPR Trust Hub — https://www.cloudflare.com/trust-hub/gdpr/
  - Twilio Regions — https://www.twilio.com/docs/global-infrastructure/understanding-twilio-regions ; SMS EU Data Residency (IE1) — https://www.twilio.com/docs/global-infrastructure/sms-eu-data-residency

---

## Part D — Commercial & horizontal

### 26. European Accessibility Act (Directive (EU) 2019/882; Act 424/2023 Sb.)

- **What it is:** EAA services obligations (applicable since 28 June 2025; CZ transposition Act 424/2023 Sb., eff. 28 June 2025; supervisors ČOI, and ČTÚ for the ECS category) cover electronic-communications and e-commerce services — but **only "services provided to consumers"** (Art 2(2) chapeau; Art 3(22) consumer = natural person outside trade/business; Art 3(30) e-commerce requires a consumer contract). "The EAA covers ECS even B2B" is false on the directive text.
- **Applies:** **NO** — Telocc is pure B2B business telephony sold to organizations. Two independent shields: (1) consumer-only scope; (2) even if in scope, the Art 4(5) microenterprise exemption (<10 persons AND ≤€2M turnover/balance, carried into 424/2023 Sb.) exempts Telocc from all EAA obligations. **Fragility:** holds only while the offering is genuinely closed to consumers — a signup any natural person can complete for personal use weakens it (hence ER-B2B-1).
- **How the build handles it:** B2B character made structural (organization capture at signup; business-capacity declaration; IČO when CZ billing arrives); WCAG 2.1 AA applied anyway as engineering hygiene (semantic HTML, labels, focus management, contrast, keyboard operability), watching WCAG 2.2 / EN 301 549 v4.1.1 (harmonisation expected ~Oct 2026); **no accessibility statement drafted as if legally mandated**; growth tripwires recorded (OWN-12) (ER-B2B-1, ER-ACC-1).
- **Verification:** **Verified — SUPPORTED** (both legs; no amendment/repeal found; the signup-gating caveat is the claim's own condition, preserved here).
- **Status:** **ENGINEERED** (B2B gating + voluntary WCAG target).
- **Sources:**
  - Directive (EU) 2019/882 — https://eur-lex.europa.eu/eli/dir/2019/882/oj/eng (adopted 2019-04-17; services duties from 2025-06-28)
  - MPO on Act 424/2023 Sb. — https://mpo.gov.cz/cz/podnikani/standardizace/pristupnost-vyrobku-a-sluzeb/zakon-c--424-2023-sb---o-pozadavcich-na-pristupnost-nekterych-vyrobku-a-sluzeb--279601/ (eff. 2025-06-28)
  - ČOI supervisory page — https://coi.gov.cz/pro-podnikatele/pristupnost-vyrobku-a-sluzeb-pro-podnikatele/
  - CCPC microenterprise guidance (Art 4(5)) — https://www.ccpc.ie/business/enforcement/accessibility/european-accessibility-act-guidelines-for-microenterprises/
  - epravo.cz on 424/2023 Sb. — https://www.epravo.cz/top/clanky/nove-pozadavky-na-pristupnost-nekterych-vyrobku-a-sluzeb-118899.html
  - Reed Smith (Art 3 consumer definition) — https://www.reedsmith.com/en/perspectives/2024/04/eu-accessibility-act-whats-the-latest ; Freshfields (Art 3(30)) — https://technologyquotient.freshfields.com/post/102lu76/inclusivity-by-design-the-european-accessibility-act-as-a-new-imperative-for-e ; iubenda B2B guide — https://www.iubenda.com/en/help/181280-european-accessibility-act-b2b-guide/
  - Level Access (EN 301 549 v3.2.1 = WCAG 2.1 AA; v4.1.1 expected ~Oct 2026 under M/587) — https://www.levelaccess.com/compliance-overview/european-accessibility-act-eaa/ ; EC on EN 301 549 status — https://digital-strategy.ec.europa.eu/en/policies/web-accessibility-directive-standards-and-harmonisation

### 27. Consumer protection law — pure-B2B boundary

- **What it is:** Czech consumer protection hangs on Civil Code § 419 (consumer = natural person acting outside their business); only natural persons can be consumers; a sole trader contracting within their business is not one. Consumer provisions (§ 1810 ff withdrawal/information duties; Act 634/1992 Sb.) don't apply to Telocc's B2B contracts; no Czech extension of consumer protections to small businesses exists. What still applies B2B: weaker-party/adhesion-contract protections (§ 433, §§ 1798–1801) — courts can strike illegible, incomprehensible or grossly disadvantageous clauses even between entrepreneurs.
- **Applies:** **NO** (consumer regime), with the B2B adhesion baseline respected.
- **How the build handles it:** signup asserts business capacity ("entering this contract as an entrepreneur within my business activity") + organization name (IČO field once CZ billing exists), i18n-routed; ToS drafted as short, legible, non-abusive B2B terms — no 14-day withdrawal, no consumer ADR — but with clear pricing (when it exists), termination, and non-one-sided liability caps (ER-B2B-1, ER-POL-2).
- **Verification:** Researcher-sourced (high confidence).
- **Status:** **ENGINEERED** (gating) + **DRAFTED** (ToS; sign-off pending).
- **Sources:**
  - profipravo.cz on § 419 — https://www.profipravo.cz/index.php?page=article&id_category=51&id_article=264512&csum=0f3ed897 (Civil Code 89/2012 Sb.)
  - AK Plesník, § 419 — https://akplesnik.cz/novy-obcansky-zakonik/paragraf-419-spotrebitel
  - ARROWS on B2B weaker-party review — https://arws.cz/news-at-arrows/vendor-contracts-in-the-czech-republic
  - Taylor Wessing on the 2023 amendment (no B2B extension) — https://www.taylorwessing.com/en/insights-and-events/insights/2023/01/amendment-to-the-czech-consumer-protection-act (eff. 2023-01-06)

### 28. VAT on Telocc's own sales — future trigger (billing off in MVP)

- **What it is:** no output VAT while free. When billing turns on: the bundle is almost certainly a "telecommunications service" (VAT Directive Art 24(2)) or at minimum an e-service — both TBE. B2B cross-border EU: reverse charge (Art 44) — invoice without VAT, reverse-charge legend, VIES-validate customer VAT ID, EC Sales List. B2C: Art 58 destination country; €10k Art 59c threshold; OSS above it. Domestic: 21% once plátce. CZ registration (2025 rules): CZK 2,000,000/yr (plátce from next 1 Jan) and CZK 2,536,500 (plátce next day); application within 10 working days. The CZ domestic wholesale reverse charge for e-comms services (NV 361/2014 Sb. as amended by 296/2016 Sb.) covers only wholesale between e-comms entrepreneurs — irrelevant unless Telocc resells capacity to operators.
- **Applies:** **NO today**; fires at first paid invoice.
- **How the build handles it:** billing-ready schema now so activation is not a migration — per-org country, VAT ID + VIES status/timestamp, business/consumer flag, location evidence (billing address + one more datum), invoice-line shape (net/rate/amount, reverse-charge legend, sequential numbering), per-calendar-year turnover counter against both CZK thresholds; **no OSS/rate tables built** (ER-BILL-1). Register tripwire: before first paid invoice → accountant confirms classification and registrations (OWN-9).
- **Verification:** Researcher-sourced (high confidence).
- **Status:** **ENGINEERED** (schema readiness only); the registrations are **OPEN — OWNER SIGN-OFF** (OWN-9).
- **Sources:**
  - VAT Directive Art 24 — https://lexparency.org/eu/32006L0112/ART_24/ (consolidated 2025); Art 58 — https://lexparency.org/eu/32006L0112/ART_58/
  - EC, place of taxation — https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/place-taxation_en
  - amavat on the €10k OSS threshold — https://amavat.eu/vat-oss-threshold-explained-what-happens-after-e10000/
  - Finanční správa, 2025 plátce changes — https://financnisprava.gov.cz/cs/financni-sprava/novinky/novinky-2025/informace-ke-zmenam-v-platcovstvi-dph-2025 (from 2025-01-01)
  - GFŘ information on the e-comms wholesale reverse charge — https://financnisprava.gov.cz/assets/cs/prilohy/d-seznam-dani/2016-09-29-Informace-GFR.pdf (from 2016-10-01)

### 29. VAT on Telocc's purchases — "identifikovaná osoba" duty at live Twilio wiring

- **What it is:** the moment the Czech-established, non-VAT-payer entity receives a service with CZ place of supply from a non-established supplier (Twilio invoicing from IE/US), it becomes an *identifikovaná osoba* (§ 6h, Act 235/2004 Sb.) — no de-minimis: register within 15 days, self-assess CZ VAT under § 108(1)(c), file for affected months, **no input deduction** (so the VAT is a real cost; voluntary plátce registration restores deduction — accountant's call).
- **Applies:** **YES** — fires at the first live Twilio invoice; lands on the owner/accountant, not the codebase.
- **How the build handles it:** go-live runbook item: register within 15 days (or voluntary plátce); give Twilio the DIČ so invoices come under EU B2B reverse charge; keep Twilio invoices/usage exports downloadable for the accountant (ER-POL-4 runbook).
- **Verification:** Researcher-sourced (high confidence).
- **Status:** **OPEN — OWNER SIGN-OFF** (OWN-9).
- **Sources:**
  - Portál POHODA on § 6h — https://portal.pohoda.cz/dane-ucetnictvi-mzdy/dph/identifikovana-osoba-podle-zakona-o-dph/ (Act 235/2004 Sb., in force 2025)
  - DAUC — https://www.dauc.cz/clanky/6681/povinnosti-spojene-s-prijetim-sluzby-od-osoby-neusazene-v-tuzemsku

---

## Ruled out

One-line justifications; each re-opens only on the stated tripwire.

| Regime | Why ruled out | Re-open if | Source |
|---|---|---|---|
| **DSA** (Reg. (EU) 2022/2065) | Telocc hosts no user content for public dissemination, and DSA recital 14 expressly places EECC interpersonal communication services (a phone call) outside the online-platform concept. | Telocc ever hosts/disseminates user content publicly. | https://www.cms-digitallaws.com/en/dsa/recital-14/ (DSA fully applicable 2024-02-17) |
| **AI Act** (Reg. (EU) 2024/1689) | No AI system anywhere — no recordings, transcripts, ML routing; DTMF is deterministic keypad input; obligations attach only to AI-system providers/deployers (Art 2). | Any AI feature (transcription, voicebot, spam scoring) is added. | https://artificialintelligenceact.eu/article/2/ (staged application 2025–2027) |
| **PSD2** (Dir. (EU) 2015/2366) | Telocc provides no Annex I payment service; as a future merchant it collects its own fees via a licensed PSP, on whom the SCA/3DS burden sits. | Telocc ever holds/routes third parties' funds. | https://www.eba.europa.eu/single-rule-book-qa/qna/view/publicId/2021_6283 ; https://www.lw.com/admin/Upload/Documents/PSD2-QSG.2.pdf (PSD2 applicable since 2018-01-13) |
| **eIDAS / eIDAS 2** (Reg. 910/2014 as amended by 2024/1183) | No trust service; magic-link login is private authentication eIDAS doesn't govern; the Art 5f(2) telecom-sector EUDI-Wallet acceptance duty (~end-2027) requires mandatory strong user authentication Telocc doesn't have, and micro/small enterprises are exempt anyway. | >50 staff/€10M AND telecom-sector classification AND mandatory strong user authentication. | https://www.european-digital-identity-regulation.com/Article_5a_(Regulation_EU_2024_1183).html ; https://www.arthurcox.com/knowledge/the-eu-digital-identity-wallet-what-companies-need-to-know/ (eIDAS 2 in force 2024-05-20) |
| **EAA** (full analysis in item 26) | Consumer-only services scope + microenterprise exemption; Telocc is B2B and micro. Verified — SUPPORTED. | Consumer plan, or ≥10 staff / €2M. | See item 26. |
| **DPO duty** (full analysis in item 20) | "Large scale" limb fails on every WP243 factor at single-owner B2B MVP scale. | Many orgs / large call volumes. | See item 20. |
| **§ 97(3) retention tooling** (full analysis in item 23) | Duty binds the regulated carrier, and the Czech Supreme Court (30 Dec 2025) held blanket retention violates EU law — building it voluntarily would conflict with GDPR minimisation. | ECS classification flips AND counsel advises after NS ruling fallout settles. | See item 23. |

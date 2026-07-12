# Telocc — build brief (the spec)

> This is the complete product spec for Telocc, verbatim from the owner. Everything not
> specified here is a build decision recorded in `docs/decisions.md`.

## GOAL

Ship Telocc as a real, production-grade, deployable running system — taken as far as it can go
without a live phone provider.

"Done" means:
- The full MVP (described under **The product**) is implemented and green against a **mocked
  telephony provider**.
- The system is genuinely production-grade: real security, proper data handling, deployable with
  a documented path to a first deploy — not a prototype or a happy-path demo.
- All applicable regulation has been researched first and the build reflects it, with a cited
  compliance register handed back (see **Compliance — do this first**).
- The real telephony provider is written in behind a clean, swappable seam but **not wired to a
  live account**. The only things standing between this and live calls should be my provider
  credentials and a purchased number.
- A dead-simple **local demo** exists so I can verify what you built in a couple of minutes with no
  telco setup (see **Local demo** below).

## WHY

Small businesses can't cleanly run a shared business line. Today they end up with a physical
cellphone that gets handed between the owner and staff. Telocc replaces that: one business
number, calls routed to the right person during office hours, and outbound calls placed **from
your normal phone's own dialer — no app, no dashboard** — that present the business number to the
customer. The appless-ness and the routing *are* the point; that's what makes it worth more than
the incumbent handset-on-a-string.

This is a build-and-see spike, but build it like the thing that ships if the spike works — not a
throwaway.

---

## The product (this is the spec — behaviours, not implementation)

Everything here describes **what must be true for the user**. How you build it — data model,
module boundaries, sequencing, libraries within the palette below — is yours.

**Identity & auth.** Login is email magic-link only; no passwords. One person per organization,
who is the Owner; org and user are created on first login. Model access so more people/roles can
be added later without a redesign, but the MVP ships single-owner. Before forwarding or outbound
calling can work, the user verifies one personal phone number via a short SMS PIN (4–6 digits,
stored hashed). That verified personal number is the linchpin of both inbound routing and
outbound initiation.

**Business number.** Each organization gets exactly one business number, chosen at setup from a
catalog of local numbers for its region. It activates immediately and belongs to the org.

**Office hours & inbound routing.** Office hours decide when the business number reaches the user,
in three modes: follow a weekly schedule, always open, always closed. In hours, an incoming
customer call is forwarded to the user's single verified personal number. Out of hours, the call
is declined with a busy signal — deliberately no voicemail, no greeting, no message playback. If
the user doesn't pick up, native carrier behaviour takes over; no queueing, no fallback chain.

**Appless outbound (dial-in caller-ID).** The user makes business-identity calls with no app and
no dashboard. They dial their own business number from their verified personal phone; the system
recognises the verified caller, auto-answers (silent or a short beep), takes the target number via
keypad DTMF, places an outbound call to the target presenting the business number as caller ID,
and bridges the two legs. When either side hangs up, both legs drop. Only the SMS-verified
personal number may initiate. No IVR, no voice prompts, basic number validation only, inactivity
timeout. Outbound is not gated by office hours. This bridged caller-ID presentation is legitimate
precisely because the call is bridged through the provider that controls the number — how CLI is
presented lawfully is something the compliance research must settle, and it shapes this seam.

**Call log.** A minimal record of every inbound and outbound call on the business number:
timestamp, direction, duration, status (answered / missed / declined). No recordings, no
transcripts, no analytics.

**Settings.** Manage the verified personal/forwarding number (re-verify via SMS PIN on change),
office hours, basic account info (email, verified number), and business-number details.

**Entity shape (behaviour, not schema — you own the tables).** An Organization owns the business
number and holds routing and office-hour settings; one org per signup. A Person has the login
email and the verified personal number, with full org access in the MVP. Every call belongs to
the org's business number; outbound records the initiating person, inbound records the forwarding
outcome.

---

## Compliance — do this first

Before building, research the full regulatory surface for a CZ/EU business-telephony product and
let the findings shape the system. This is not GDPR alone — treat data protection as one item on a
longer list (expect at least: GDPR **and** ePrivacy / traffic-and-metadata handling, telecom rules
around number use and lawful caller-ID presentation, KYC/number-allocation obligations,
emergency-calling considerations, consumer/billing/VAT rules if it ever charges, and accessibility).
Research what actually applies today — law changes, so cite sources and note the as-of date.

Then build to what you find, and hand back a **compliance register**: what applies, how the build
satisfies each item, the source cited for each, and the open questions that need a human with
authority to close.

Two hard rules here:
- **Your research is a map, not a sign-off.** Ground every legal claim in a cited source. Where you
  can't, flag it as open rather than asserting a conclusion — do not fabricate confident legal
  findings. A few items (lawful CLI presentation, number allocation/KYC, emergency obligations)
  will legitimately need my sign-off; mark them clearly and leave them for me.
- Build the engineering side of every applicable regime properly (retention limits, erasure/export,
  encryption, scoping, audit trail, lawful-basis handling, etc.). You may **draft** policy/DPA text;
  legal sign-off is mine.

If the research puts the **legality of a core feature itself** in question — not an implementation
detail, but whether the feature can lawfully exist as described — stop and ask me. That's the one
compliance question only I can decide.

---

## Stack — a preference, not a mandate

Here is a known-good default palette for this kind of product. Treat it as the strong default, not
a straitjacket: stay inside it, or reach for a **mainstream, boring, well-documented** tool you'd
find in any standard SaaS build. Do **not** pick something niche or clever where an ordinary tool
does the job — I need to be able to maintain whatever you choose without learning an obscure stack.
Wherever the palette offers a choice, take the simplest option that ships and note the choice in one
line. Keep the whole thing vibecoding-friendly and **easy to deploy**.

- Language/runtime: TypeScript (strict) on Node 24; pnpm.
- API: Hono (targets Cloudflare Workers and Node from one codebase); Zod for validation.
- DB/ORM: Drizzle + Neon serverless Postgres in an **EU region** (branch-per-PR suits agentic work;
  never `drizzle-kit push` outside throwaway local — always `generate` then `migrate`).
- Auth: Better Auth (magic-link, self-hosted in the Postgres).
- Frontend: **your call — React 19 + Vite or Svelte 5 + SvelteKit.** Both are fine and both are
  TypeScript. Pick whichever you'll produce the most reliable code in; shadcn(-svelte) + Tailwind 4.
- Tests: Vitest + Playwright, with a small human-readable contract layer at the boundaries you write
  first and treat as the executable spec, plus a freely-rewritten implementation layer.
- Tooling/monitoring: Biome; AppSignal.
- Deploy: Workers-first (this is almost entirely a stateless webhook surface, so target
  `wrangler deploy` + Neon). Only introduce a VPS/scheduled worker if something genuinely persistent
  appears (e.g. a scheduled retention purge), and keep even that boring.

## The telephony seam

Put the provider behind a clean abstraction: all inbound-event handling, outbound dialling,
bridging, and SMS-PIN delivery live behind one interface, so the provider is swappable and the whole
system is testable against a mock. Write a real provider implementation (Twilio is the intended
first one) to that interface, but **do not wire it to a live account, buy numbers, or send real
SMS/calls.** Build and test everything against the mock. The live wiring is mine to do later.

Don't let provider-specific code leak into application logic — that seam is the one architectural
invariant I care about.

## Local demo

Ship a way for me to see the whole thing working locally, fast, with **no Twilio and no external
accounts**. The bar: I clone the repo, run **one copy-paste command**, and within a couple of minutes
I'm looking at the app exercising its real flows against the mock provider. The demo is the fastest
way for me to verify what you actually built, so make it genuinely one-step.

Outcome, not mechanism — you decide how, but it should give me:
- **A single command** that stands the whole thing up: install, local database up and migrated,
  demo data seeded, app and mock telephony provider running. No cloud accounts, no credentials, no
  Twilio, no manual steps in between. (Production still targets the palette's cloud database; the
  *demo* must be self-contained — a local/containerised DB is fine for it.)
- **A short markdown guide** (a README section is fine) that is: clone → the one command → open this
  URL → here's what to click/trigger to watch each core flow happen. Since there's no real phone,
  give me a simple way to fire the telephony events through the mock — a tiny script, seeded buttons,
  or a dev-only page that simulates an inbound customer call, an out-of-hours busy, and the appless
  dial-in → DTMF → outbound → bridge path — so I can watch the routing and the call log fill in
  without a handset.
- Enough seeded state (an org, a verified number, office hours, a business number) that the flows
  work immediately on first run, with the PIN/verification pre-satisfied for the demo user so I'm not
  hand-entering codes.

Keep the guide short and plain — written for someone who wants to confirm it works, not read an essay.

## Boundaries

- **Build only what this brief asks for.** The MVP is deliberately minimal. No voicemail, greetings,
  IVR, recordings, transcripts, analytics, call queueing, multi-user, or any "nice to have." Don't
  gold-plate, don't add speculative abstractions beyond the seams already named (future roles, many
  numbers), and don't design for hypothetical future needs.
- Validate at **real boundaries** — webhook payloads, DTMF input, magic-link tokens, SMS PINs,
  settings input — not between your own internal functions. Trust your own code and framework
  guarantees.
- **Don't spend money or touch real telco.** No live provider account, no number purchases, no real
  SMS or calls, no paid infra spun up.
- Scope every query to the org. Rate-limit the abusable surfaces (magic-link, inbound callbacks, SMS
  PIN requests). Verify provider signatures on inbound webhooks.

## Owner decisions (from the question gate)

- **UI language:** English copy now, routed through i18n scaffolding so Czech is a translation file
  away.
- **Regulatory posture:** Telocc rides on Twilio (or similar) as the regulated carrier holding the
  CZ numbers; Telocc is an application layer. The compliance register maps what still lands on
  Telocc and flags "register with ČTÚ ourselves?" as an open item for owner sign-off.

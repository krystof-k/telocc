# Telocc

Telocc gives a small business one shared phone number without a shared handset: calls
to the business number are routed to whoever's covering it during office hours, and
staff place outbound calls that show the business number as caller ID — straight from
their own phone's dialer, no app, no dashboard. Everything here runs against a mocked
telephony provider; a real provider (Twilio) is written in behind the same interface but
deliberately not wired to a live account (see [`docs/deploy.md`](docs/deploy.md)).

## Quickstart

Clone the repo, then run:

```
corepack enable && pnpm install && pnpm demo
```

That one command checks for Docker, brings up a local Postgres, migrates it, seeds a
fully-configured demo organisation, and starts the API (mock telephony provider) and the
web app. No cloud accounts, no credentials, no Twilio, no manual steps in between —
usually ready in well under a minute.

When it's done you'll see something like:

```
== Telocc demo is ready ==

App:        http://localhost:5173
Demo user:  demo@telocc.example (org "Demo s.r.o.", fully set up already — verified number,
            active Prague business number, Mon-Fri 09:00-17:00 office hours)

Sign in instantly — open this link, then go to http://localhost:5173/:
  http://localhost:5173/api/auth/magic-link/verify?token=...

Press Ctrl+C to stop the demo.
```

Open the printed sign-in link (it logs you straight in, then navigate to
`http://localhost:5173/`), or use the login form at `/login` with
`demo@telocc.example` and fetch the emailed link from the dev mailbox at
`http://localhost:5173/dev/mailbox` — there's no real email, magic-link emails and
verification-PIN texts are captured in-process instead of sent.

`pnpm demo` is idempotent: re-run it any time to reset the demo org back to its seeded
state without losing your local Postgres data for anything else.

## The four walkthroughs

Once you're logged in, open **`http://localhost:5173/dev/simulator`** — a dev-only page
(never shipped in a production build) that fires simulated telephony events through the
mock provider, exactly the way a real call would arrive, so you can watch routing and the
call log fill in without a handset.

1. **Login.** Covered by the quickstart above: magic-link only, no passwords. The demo
   organisation is pre-onboarded (verified personal number, KYC, an active business
   number) so you land straight on the dashboard.
2. **Inbound, in hours and out of hours.** Under *Inbound customer call*, click **Call
   now** — the simulated customer call forwards to the demo's verified personal number;
   choose **Answer** or **Don't pick up** to see `answered`/`missed` land in the call
   log. Under *Out-of-hours call*, click **Simulate an out-of-hours call** — it
   temporarily forces office hours closed, fires the same kind of call, and you'll see it
   declined busy (no greeting, no voicemail), then office hours are restored.
3. **Appless outbound (dial-in → DTMF → bridge).** Under *Appless outbound*, click
   **Dial in from ...** to simulate calling your own business number from the verified
   personal phone — it auto-answers with a beep and shows an on-screen keypad. Enter a
   number (or use **Fill valid CZ number**) and **Send digits** to bridge the call with
   the business number presented as caller ID; **Target answers** or **Target doesn't
   answer** completes it. Try **Fill 112 (emergency)** instead to see the distinct
   refusal tone and a `emergency_refused` row — emergency numbers can never be dialled
   through Telocc.
4. **Call log & settings.** Every flow above lands a row in the live call log panel on
   the simulator page and on the app's own `/calls` page (with a CSV export). On
   `/settings` you can edit office hours and re-verify the personal number — the SMS
   outbox panel on the simulator page shows PIN codes since no real SMS is ever sent —
   and the danger zone offers a full data export and account deletion.

## Tests

| Command | What it runs |
|---|---|
| `pnpm typecheck` | strict TypeScript across the whole workspace |
| `pnpm lint` | Biome |
| `pnpm test` | unit/implementation tests (Vitest) |
| `pnpm test:contract` | the frozen executable spec against the brief (`tests/contract/**`) |
| `pnpm test:e2e` | Playwright end-to-end against the demo stack (login, all three simulator flows, settings-changes-routing, cookie inventory, accessibility — see `docs/testing.md`) |
| `pnpm demo` | the one-command local demo itself |

`pnpm test:e2e` starts the same demo stack `pnpm demo` does (see `playwright.config.ts`),
so there's nothing extra to set up first.

Sign-in is rate-limited to 3 magic links per 15 minutes per email (a real security
control, ER-RATE-1 — not relaxed for the demo). One `pnpm demo` plus one `pnpm
test:e2e` fits comfortably inside that budget; running either repeatedly within the
same 15-minute window can trip a `429` — if that happens, wait a few minutes and retry.

## Repo layout

```
apps/api/          Hono API — auth, routing, webhooks, dev-only /dev/* simulator routes
apps/web/           React SPA — login/onboarding/dashboard/calls/settings + dev/ (simulator page)
packages/core/      Provider-free domain logic: office hours, dial policy, call log, DSR, retention
packages/telephony/ The seam: neutral types + the mock provider/network and the (unwired) Twilio adapter
packages/db/        Drizzle schema, migrations, and seed data (incl. the demo seed)
packages/i18n/      Typed English copy (source of truth for all user-facing text)
scripts/            demo.mjs (this README's one command), run-jobs.mjs, esd-report.ts
tests/contract/     The executable spec written from the brief — off-limits to feature work
e2e/                Playwright suite against the demo stack
docs/               Design, compliance, and deploy documentation (see below)
```

## More documentation

- **Deploying for real** (Cloudflare Workers + Neon, flipping from the mock provider to
  Twilio): [`docs/deploy.md`](docs/deploy.md).
- **Go-live checklist and operational runbook**: [`docs/runbook.md`](docs/runbook.md).
- **System design** (data model, the telephony seam, call state machines, security
  architecture): [`docs/design.md`](docs/design.md).
- **Compliance register** — what regulation applies, how the build satisfies each item,
  sources, and open items needing an owner's sign-off:
  [`docs/compliance/register.md`](docs/compliance/register.md).

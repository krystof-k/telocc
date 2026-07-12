# Build decisions log

One-liners for every choice the brief left open. Newest at the bottom.

1. **UI language:** English copy through a thin typed i18n layer (owner's call at the question
   gate) — Czech is a translation file away.
2. **Regulatory posture:** Telocc rides on Twilio as the regulated carrier (owner's call at the
   question gate); the register flags own-ČTÚ-registration as an open owner item.
3. **Frontend:** React 19 + Vite + shadcn/ui + Tailwind 4 — the most mainstream half of the
   palette's either/or, and shadcn is React-native.
4. **Node version:** development and CI on Node 22 (what the build environment provides);
   `engines` set to `>=22`, Node 24 recommended and documented for production. No code
   difference for this stack.
5. **CZ number region default:** Prague (+420 2xx geographic range) as the seeded/demo catalog
   region, per the brief's "pick a sensible default" for the number catalog.
6. **Single origin:** the Worker serves the Vite build as static assets — one deploy, same
   origin, no CORS surface.
7. **DB drivers:** drizzle neon-http on Workers, node-postgres locally *(selection mechanism
   superseded by #28 — per-entry factories, not one runtime-branching `createDb`)*;
   consequence stands: no multi-statement transactions — erasure uses FK
   `ON DELETE CASCADE`, counters/attempts use single atomic upserts.
8. **Rate limiting:** fixed-window counters in Postgres (one atomic upsert), identical on
   Workers and Node; identifiers stored only as SHA-256 hashes.
9. **Retention purge = anonymise, not delete:** call rows older than the window get both
   numbers + initiator + provider refs stripped; the aggregate row survives for ESD counts
   (ER-RET-1 offers either; this also serves ER-AUD-3).
10. **Office hours:** 0–1 interval per weekday, org-local time, no overnight spans;
    timezone math via the built-in Intl API (no date library).
11. **Dial policy split:** emergency short codes hard-coded in code (safety, never
    configurable); premium/shared-cost prefixes in a seeded table (ER-EMG-2 data-driven).
12. **Daily-minutes hard cutoff** via the bridge instruction's max-duration (TwiML Dial
    `timeLimit`); imperative `hangupCall` kept only as a backstop.
13. **No DTMF retry:** invalid input or inactivity ends the call with the distinct refusal
    tone / hangup and a logged status — smallest flow satisfying "basic validation only".
14. **Emergency refusal sound:** short SIT-style tone WAV served by the API and played before
    hangup — audibly distinct yet announcement-free (squares ER-EMG-1 with the no-IVR spec).
15. **PIN:** 6 digits fixed (within the brief's 4–6), HMAC-SHA256 with a server pepper.
16. **Email delivery:** two-line EmailSender port — dev in-process mailbox locally, Resend in
    production (owner account at wiring; listed next to Twilio in deploy docs).
17. **Web data layer:** react-router v7 (library mode) + TanStack Query over hono/client RPC
    (`AppType` import — no shared types package).
18. **IDs:** UUID (`gen_random_uuid()`) PKs; E.164 as text with a CHECK constraint.
19. **Call log write-once:** in-flight state lives in a `call_sessions` table; the `calls` row
    is inserted exactly once at the terminal state (satisfies ER-AUD-1 append-only cleanly).
20. **Out-of-hours decline** maps to signalling-level busy (TwiML `<Reject reason="busy"/>`):
    the number is always routed and responds; logged as `declined/out_of_hours` (ER-CLI-2b).
21. **Simulator architecture:** the mock telco lives in the API process behind env-gated
    `/dev/sim/*` routes and always enters the system through the real signed webhook endpoint,
    so demo and tests exercise the production path (ER-WEB-1).
22. **Contract tests** run the real Hono app in-process against dockerized Postgres + mock
    provider; they are written first and are off-limits to implementing milestones.
23. **Full schema + seam types land in the scaffold milestone** so later milestones never
    contend over migrations or the interface — the enabler for parallel milestone work.
24. **Billing tables dormant-by-design** (ER-BILL-1): exist and are exercised only by tests;
    not gold-plating — a register-driven requirement.
25. **Answered-time signalling:** child-leg status callbacks (`statusCallbackEvent="answered
    completed"`, resolved via `ParentCallSid`) are the answered-signal of record on both forward
    and bridge Dials — Twilio's Dial action callback is not requested when the caller hangs up
    first; MockTelco fires the identical timeline (answered at pickup, before any completion).
26. **`call.completed` is the sole finalizer** for forwarded/bridged calls; leg events only
    record onto `call_sessions` (`answered_at`, `last_leg_status`) so retried/re-ordered
    callbacks land on the same write-once `calls` row.
27. **Forward dial timeout 120 s** (was 25 s): the personal carrier's native behaviour
    (voicemail answers → answered; ring-out/reject → missed) decides the outcome, per the
    brief; the timeout is only a backstop and logs missed.
28. **Per-entry DB drivers:** entry.workers.ts builds neon-http, entry.node.ts node-postgres;
    `packages/db` index exports schema only — `pg` never enters the Workers bundle, no
    `nodejs_compat`; M0 gates on `wrangler deploy --dry-run`.
29. **Concurrent-bridge cap is structural:** partial unique index on active dialin
    `call_sessions`; the INSERT conflict is the reject-busy path (atomic on neon-http).
30. **Late/unknown-callRef webhook events** are acked 200, ignored, and counted
    (`webhook_ignored`) — provider redelivery never 5xxes or double-writes.
31. **Better Auth `useSecureCookies: true` unconditionally** — Secure flag identical across
    dev/test/prod (localhost is a trustworthy context), so cookie assertions never vary by
    environment.
32. **PIN resend cooldown = its own 1/60 s per-phone fixed window** alongside the 3/10-min and
    daily caps (aligns the §7 limit table with the pin-verification contract test).
33. **KYC upload cap 5 MB** (hex-encoded bytea ≈2× through the neon-http transport; stays
    inside Neon HTTP request limits); boundary exercised by an implementation test and a
    deploy smoke step.
34. **Production boot guards in env.ts:** refuse non-EU Neon hosts (ER-RES-1) and refuse the
    dev `MOCK_WEBHOOK_SECRET` (or unset) while `TELEPHONY_PROVIDER=mock` in production.
35. **Local Postgres image bumped to `postgres:17-alpine`** (design.md §1's repo-layout
    comment says "Postgres 16"; the build environment ships 17-alpine pre-pulled). No
    schema/behaviour impact; `docker-compose.yml` pins 17-alpine.
36. **shadcn/ui support libraries added** (`clsx`, `tailwind-merge`, `class-variance-authority`,
    `@radix-ui/react-slot`, `lucide-react`): required transitively by the shadcn/ui component
    pattern decisions.md #3 already committed to; not separately named in the pre-warmed
    package list but the same design choice, not a new one.

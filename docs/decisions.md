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

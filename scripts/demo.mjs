#!/usr/bin/env node
/**
 * The one-command demo orchestrator (design.md §12): compose up → migrate → seed →
 * run both apps → print the walkthrough. This is the M0 placeholder — the full
 * sequence (idempotent demo seed, concurrent API + web start, walkthrough banner)
 * lands in M10.
 */
console.log('pnpm demo: the full one-command demo lands in M10 (see docs/milestones.md).');
console.log('For now: docker compose up -d db && pnpm --filter @telocc/db migrate && pnpm dev');

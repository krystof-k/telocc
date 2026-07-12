/**
 * `GET /assets/refusal-tone.wav` (design.md §7 API surface table, §4.4's `refuseTone`
 * row: `<Play>{APP_BASE_URL}/assets/refusal-tone.wav</Play>` — decisions.md #14, a
 * short SIT-style tone, audibly distinct yet announcement-free, ER-EMG-1). Static,
 * unauthenticated (design.md §7: "—" auth column) — the provider fetches it directly.
 *
 * NOT YET MOUNTED: `app.ts` is out of this milestone's file ownership (M8 owns it for
 * the DSR route mounts running concurrently). Wiring this in is a one-line addition —
 * `app.route('/assets', assetsRoutes(deps))` in `apps/api/src/app.ts`, before the
 * `/api/*` session gate, same as `/webhooks` and `/dev` — flagged for whichever
 * milestone next touches `app.ts` (M8/M11).
 *
 * Reads the file via `node:fs` at request time — correct for the Node entry today.
 * The Workers entry currently only declares a static-assets binding for `../web/dist`
 * (`wrangler.jsonc`); serving this file there too (or embedding its bytes) is a
 * deploy-story detail for M11, not a per-request concern this route needs to solve.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import type { Deps } from '../deps.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REFUSAL_TONE_PATH = join(HERE, '../../assets/refusal-tone.wav');

export function assetsRoutes(_deps: Deps) {
  const r = new Hono();

  r.get('/refusal-tone.wav', async (c) => {
    try {
      const bytes = await readFile(REFUSAL_TONE_PATH);
      return new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'audio/wav', 'cache-control': 'public, max-age=86400' },
      });
    } catch {
      return c.json({ error: 'not_found' }, 404);
    }
  });

  return r;
}

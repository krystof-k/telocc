/**
 * `GET /assets/refusal-tone.wav` (design.md §7 API surface table, §4.4's `refuseTone`
 * row: `<Play>{APP_BASE_URL}/assets/refusal-tone.wav</Play>` — decisions.md #14, a
 * short SIT-style tone, audibly distinct yet announcement-free, ER-EMG-1) and
 * `GET /assets/dtmf-beep.wav` (the optional short beep the Twilio adapter's
 * collectDigits instruction references — brief: auto-answer "silent or a short beep").
 *
 * Static, unauthenticated (design.md §7: "—" auth column) — the provider fetches these
 * directly. Bytes are embedded base64 (src/assets-data.ts) so this module stays
 * runtime-neutral: no `node:fs` may enter the Workers bundle (decisions.md #28 gate).
 * Source .wav files live in apps/api/assets/.
 */
import { Hono } from 'hono';
import { DTMF_BEEP_WAV_BASE64, REFUSAL_TONE_WAV_BASE64 } from '../assets-data.ts';
import type { Deps } from '../deps.ts';

function decodeBase64(b64: string): Uint8Array {
  // atob is available in both Workers and Node >= 16.
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const WAVS: Record<string, Uint8Array> = {
  'refusal-tone.wav': decodeBase64(REFUSAL_TONE_WAV_BASE64),
  'dtmf-beep.wav': decodeBase64(DTMF_BEEP_WAV_BASE64),
};

export function assetsRoutes(_deps: Deps) {
  const r = new Hono();

  r.get('/:file{.+\\.wav}', (c) => {
    const wav = WAVS[c.req.param('file')];
    if (!wav) return c.json({ error: 'not_found' }, 404);
    return new Response(new Uint8Array(wav), {
      status: 200,
      headers: { 'content-type': 'audio/wav', 'cache-control': 'public, max-age=86400' },
    });
  });

  return r;
}

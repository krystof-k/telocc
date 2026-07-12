import type { RawWebhookRequest } from '../types.ts';

/**
 * Twilio's request-validation algorithm (documented at
 * twilio.com/docs/usage/security#validating-requests, baked into this module from the
 * docs — no live traffic was used): `X-Twilio-Signature` = base64(HMAC-SHA1(authToken,
 * url + concat(sortedKey1, value1, sortedKey2, value2, ...))) over every POST param,
 * sorted alphabetically by key. Unlike the mock scheme (design.md §4.4: HMAC-SHA256 over
 * `timestamp.rawBody` with a replay window), Twilio's scheme carries no timestamp —
 * replay is bounded by callRef idempotency downstream instead (documented, not this
 * package's concern).
 *
 * Implemented with Web Crypto (`crypto.subtle`) rather than `node:crypto` so this module
 * stays import-safe in a Workers bundle (design.md "Runtime duality").
 */

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

/** Constant-time string comparison — avoids leaking signature match progress via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function parseFormParams(rawBody: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!rawBody) return params;
  for (const [key, value] of new URLSearchParams(rawBody).entries()) {
    params[key] = value;
  }
  return params;
}

/** Computes the expected `X-Twilio-Signature` value for a given URL + POST param set. */
export async function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): Promise<string> {
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, key) => `${acc}${key}${params[key]}`, url);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return bytesToBase64(new Uint8Array(digest));
}

/**
 * Verifies a raw webhook request against Twilio's signature scheme. `req.url` must be
 * the exact absolute URL Twilio requested (including query string) — the same value the
 * app's webhook route received, before any rewriting.
 */
export async function verifyTwilioSignature(
  authToken: string,
  req: RawWebhookRequest,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const header = getHeader(req.headers, 'X-Twilio-Signature');
  if (!header) return { ok: false, reason: 'missing X-Twilio-Signature header' };

  const params = req.method.toUpperCase() === 'GET' ? {} : parseFormParams(req.rawBody);
  const expected = await computeTwilioSignature(authToken, req.url, params);
  return timingSafeEqual(expected, header)
    ? { ok: true }
    : { ok: false, reason: 'signature mismatch' };
}

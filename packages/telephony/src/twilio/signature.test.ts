import { describe, expect, it } from 'vitest';
import {
  FIXTURE_AUTH_TOKEN,
  incomingCallForm,
  toRawWebhookRequest,
  WEBHOOK_URL,
} from './fixtures/webhooks.ts';
import { computeTwilioSignature, verifyTwilioSignature } from './signature.ts';

describe('computeTwilioSignature', () => {
  it('matches a hand-computed HMAC-SHA1 over url + sorted key/value concatenation', async () => {
    const url = 'https://example.com/hook';
    const params = { b: '2', a: '1' };
    // Twilio's algorithm: url + sorted("a"+"1"+"b"+"2")
    const expectedInput = `${url}a1b2`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(FIXTURE_AUTH_TOKEN),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    );
    const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(expectedInput));
    let binary = '';
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
    const expected = btoa(binary);

    const actual = await computeTwilioSignature(FIXTURE_AUTH_TOKEN, url, params);
    expect(actual).toBe(expected);
  });

  it('is order-independent in the input param object (sorts internally)', async () => {
    const url = 'https://example.com/hook';
    const a = await computeTwilioSignature(FIXTURE_AUTH_TOKEN, url, { z: '1', a: '2' });
    const b = await computeTwilioSignature(FIXTURE_AUTH_TOKEN, url, { a: '2', z: '1' });
    expect(a).toBe(b);
  });
});

describe('verifyTwilioSignature', () => {
  it('accepts a validly signed request', async () => {
    const req = await toRawWebhookRequest({ form: incomingCallForm });
    const result = await verifyTwilioSignature(FIXTURE_AUTH_TOKEN, req);
    expect(result).toEqual({ ok: true });
  });

  it('rejects a request signed with the wrong auth token', async () => {
    const req = await toRawWebhookRequest({
      form: incomingCallForm,
      authToken: 'a-different-token',
    });
    const result = await verifyTwilioSignature(FIXTURE_AUTH_TOKEN, req);
    expect(result.ok).toBe(false);
  });

  it('rejects a request whose body was tampered with after signing', async () => {
    const req = await toRawWebhookRequest({ form: incomingCallForm });
    const tampered = { ...req, rawBody: req.rawBody.replace('ringing', 'completed') };
    const result = await verifyTwilioSignature(FIXTURE_AUTH_TOKEN, tampered);
    expect(result).toEqual({ ok: false, reason: 'signature mismatch' });
  });

  it('rejects a request whose URL was tampered with after signing', async () => {
    const req = await toRawWebhookRequest({ form: incomingCallForm });
    const tampered = { ...req, url: `${WEBHOOK_URL}?evil=1` };
    const result = await verifyTwilioSignature(FIXTURE_AUTH_TOKEN, tampered);
    expect(result.ok).toBe(false);
  });

  it('rejects a request with a missing signature header', async () => {
    const req = await toRawWebhookRequest({ form: incomingCallForm, sign: false });
    const result = await verifyTwilioSignature(FIXTURE_AUTH_TOKEN, req);
    expect(result).toEqual({ ok: false, reason: 'missing X-Twilio-Signature header' });
  });

  it('is case-insensitive when locating the signature header', async () => {
    const req = await toRawWebhookRequest({ form: incomingCallForm });
    const lowered = {
      ...req,
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v]),
      ),
    };
    const result = await verifyTwilioSignature(FIXTURE_AUTH_TOKEN, lowered);
    expect(result).toEqual({ ok: true });
  });
});

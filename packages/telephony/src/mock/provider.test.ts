import { describe, expect, it } from 'vitest';
import { type E164, parseE164, presentedCli } from '../types.ts';
import { createMockProvider } from './provider.ts';

const SECRET = 'test-mock-webhook-secret';

/** Mirrors the provider's own Web-Crypto-based signer (no `node:crypto` — this
 * package must stay import-safe in a Workers bundle, see provider.ts's header). */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sign(timestamp: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  return bytesToHex(new Uint8Array(digest));
}

/** Test-only helper so fixture E.164 values don't need `parseE164(...)!`. */
function mustE164(value: string): E164 {
  const parsed = parseE164(value);
  if (!parsed) throw new Error(`mustE164: ${value} is not a well-formed E.164 fixture value`);
  return parsed;
}

describe('MockProvider.verifyWebhook — wire scheme (design.md §4.4)', () => {
  it('accepts a correctly signed, fresh request', async () => {
    const now = () => new Date('2026-01-01T12:00:00Z');
    const { provider } = createMockProvider({ webhookSecret: SECRET, now });
    const rawBody = JSON.stringify({ type: 'call.incoming', callRef: 'call_0001' });
    const timestamp = String(Math.floor(now().getTime() / 1000));
    const result = await provider.verifyWebhook({
      method: 'POST',
      url: 'http://localhost/webhooks/telephony/mock',
      headers: {
        'x-mock-signature': await sign(timestamp, rawBody),
        'x-mock-timestamp': timestamp,
      },
      rawBody,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a request with no signature headers', async () => {
    const { provider } = createMockProvider({ webhookSecret: SECRET, now: () => new Date() });
    const result = await provider.verifyWebhook({
      method: 'POST',
      url: 'http://localhost/x',
      headers: {},
      rawBody: '{}',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a wrong signature', async () => {
    const now = () => new Date('2026-01-01T12:00:00Z');
    const { provider } = createMockProvider({ webhookSecret: SECRET, now });
    const timestamp = String(Math.floor(now().getTime() / 1000));
    const result = await provider.verifyWebhook({
      method: 'POST',
      url: 'http://localhost/x',
      headers: { 'x-mock-signature': 'deadbeef'.repeat(8), 'x-mock-timestamp': timestamp },
      rawBody: '{}',
    });
    expect(result.ok).toBe(false);
  });

  it('accepts a timestamp exactly at the 300s replay-tolerance boundary', async () => {
    const now = () => new Date('2026-01-01T12:00:00Z');
    const { provider } = createMockProvider({ webhookSecret: SECRET, now });
    const rawBody = '{}';
    const staleTimestamp = String(Math.floor(now().getTime() / 1000) - 300);
    const result = await provider.verifyWebhook({
      method: 'POST',
      url: 'http://localhost/x',
      headers: {
        'x-mock-signature': await sign(staleTimestamp, rawBody),
        'x-mock-timestamp': staleTimestamp,
      },
      rawBody,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a timestamp one second past the 300s replay-tolerance boundary', async () => {
    const now = () => new Date('2026-01-01T12:00:00Z');
    const { provider } = createMockProvider({ webhookSecret: SECRET, now });
    const rawBody = '{}';
    const staleTimestamp = String(Math.floor(now().getTime() / 1000) - 301);
    const result = await provider.verifyWebhook({
      method: 'POST',
      url: 'http://localhost/x',
      headers: {
        'x-mock-signature': await sign(staleTimestamp, rawBody),
        'x-mock-timestamp': staleTimestamp,
      },
      rawBody,
    });
    expect(result.ok).toBe(false);
  });
});

describe('MockProvider.parseWebhook', () => {
  const { provider } = createMockProvider({ webhookSecret: SECRET, now: () => new Date() });

  it('throws MalformedWebhookError on invalid JSON', () => {
    expect(() =>
      provider.parseWebhook({ method: 'POST', url: 'x', headers: {}, rawBody: '{ not json' }),
    ).toThrow('body is not valid JSON');
  });

  it('parses every neutral event type round-trip', () => {
    const at = '2026-01-01T12:00:00.000Z';
    const cases: Record<string, unknown> = {
      'call.incoming': {
        type: 'call.incoming',
        callRef: 'call_0001',
        to: '+420212345678',
        from: null,
        at,
      },
      'call.dtmf': { type: 'call.dtmf', callRef: 'call_0001', digits: '604123456#', at },
      'call.leg': { type: 'call.leg', callRef: 'call_0001', legStatus: 'answered', at },
      'call.completed': { type: 'call.completed', callRef: 'call_0001', durationSeconds: 42, at },
      'sms.status': { type: 'sms.status', messageRef: 'sms_0001', status: 'delivered', at },
      'provisioning.update': {
        type: 'provisioning.update',
        numberRef: 'number_0001',
        status: 'active',
        at,
      },
    };
    for (const [type, body] of Object.entries(cases)) {
      const event = provider.parseWebhook({
        method: 'POST',
        url: 'x',
        headers: {},
        rawBody: JSON.stringify(body),
      });
      expect(event.type).toBe(type);
    }
  });
});

describe('MockProvider.renderInstruction', () => {
  it('renders the `kind` discriminant as JSON (decisions.md #38)', () => {
    const { provider } = createMockProvider({ webhookSecret: SECRET, now: () => new Date() });
    const rendered = provider.renderInstruction(
      { kind: 'reject', cause: 'busy' },
      { webhookBaseUrl: 'http://localhost', callRef: 'call_0001' },
    );
    expect(rendered.status).toBe(200);
    expect(rendered.contentType).toBe('application/json');
    expect(JSON.parse(rendered.body)).toEqual({ kind: 'reject', cause: 'busy' });
  });

  it('records rendered instructions in state for demo/simulator introspection', () => {
    const { provider, state } = createMockProvider({
      webhookSecret: SECRET,
      now: () => new Date(),
    });
    provider.renderInstruction(
      {
        kind: 'forward',
        to: mustE164('+420777123456'),
        callerId: presentedCli({ id: 'bn_1', e164: '+420212345678', status: 'active' }),
        timeoutSeconds: 120,
      },
      { webhookBaseUrl: 'http://localhost', callRef: 'call_0002' },
    );
    expect(state.renderedInstructions).toHaveLength(1);
    expect(state.renderedInstructions[0]?.callRef).toBe('call_0002');
  });
});

describe('MockProvider — imperative + catalog/provisioning methods', () => {
  it('sendSms assigns sequential message refs and records the outbox', async () => {
    const { provider, state } = createMockProvider({
      webhookSecret: SECRET,
      now: () => new Date(),
    });
    const first = await provider.sendSms({ to: mustE164('+420777123456'), body: 'PIN: 123456' });
    const second = await provider.sendSms({ to: mustE164('+420777123457'), body: 'PIN: 654321' });
    expect(first.messageRef).toBe('sms_0001');
    expect(second.messageRef).toBe('sms_0002');
    expect(state.sentSms).toHaveLength(2);
  });

  it('searchNumbers returns a deterministic Prague-default catalog (decisions.md #5)', async () => {
    const { provider } = createMockProvider({ webhookSecret: SECRET, now: () => new Date() });
    const results = await provider.searchNumbers({
      country: 'CZ',
      numberClass: 'geographic',
      limit: 3,
    });
    expect(results).toHaveLength(3);
    for (const entry of results) {
      expect(entry.e164.startsWith('+4202')).toBe(true);
      expect(entry.areaCode).toBe('2');
    }
  });

  it('searchNumbers honours an explicit area code', async () => {
    const { provider } = createMockProvider({ webhookSecret: SECRET, now: () => new Date() });
    const results = await provider.searchNumbers({
      country: 'CZ',
      areaCode: '5',
      numberClass: 'geographic',
      limit: 2,
    });
    for (const entry of results) {
      expect(entry.e164.startsWith('+4205')).toBe(true);
    }
  });

  it('submitBundle and provisionNumber auto-approve synchronously (design.md §4.4)', async () => {
    const { provider } = createMockProvider({ webhookSecret: SECRET, now: () => new Date() });
    const bundle = await provider.submitBundle({
      endUser: {
        legalName: 'Acme s.r.o.',
        ico: '12345678',
        street: 'Vaclavske namesti 1',
        city: 'Praha',
        postalCode: '11000',
        country: 'CZ',
      },
      documents: [],
    });
    expect(bundle.status).toBe('approved');

    const number = await provider.provisionNumber({
      e164: mustE164('+420212345678'),
      bundleRef: bundle.bundleRef,
      webhookBaseUrl: 'http://localhost',
    });
    expect(number.status).toBe('active');
  });

  it('capabilities match the demo-instant profile (design.md §4.4)', () => {
    const { provider } = createMockProvider({ webhookSecret: SECRET, now: () => new Date() });
    expect(provider.capabilities).toEqual({
      czCliDomesticTermination: true,
      instantProvisioning: true,
      supportedNumberClasses: ['geographic', 'nomadic_910', 'mobile'],
    });
  });
});

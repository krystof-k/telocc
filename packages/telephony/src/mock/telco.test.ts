import { describe, expect, it } from 'vitest';
import { type E164, parseE164 } from '../types.ts';
import { createMockProvider } from './provider.ts';
import { createMockTelco, MOCK_WEBHOOK_PATH } from './telco.ts';

const SECRET = 'test-mock-webhook-secret';

function mustE164(value: string): E164 {
  const parsed = parseE164(value);
  if (!parsed) throw new Error(`mustE164: ${value} is not a well-formed E.164 fixture value`);
  return parsed;
}

/**
 * A minimal in-process "app" standing in for the real `webhooksRoutes(deps)` sub-app:
 * verifies the signature exactly as the real route does, then always answers `reject
 * busy` so these tests can focus on MockTelco's own wire-format and determinism
 * without needing the full apps/api call-session machinery.
 */
function createFakeWebhookApp(now: () => Date) {
  const { provider } = createMockProvider({ webhookSecret: SECRET, now });
  return {
    async request(input: string, init?: RequestInit): Promise<Response> {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key] = value;
      });
      const verification = await provider.verifyWebhook({
        method: init?.method ?? 'GET',
        url: `http://localhost${input}`,
        headers,
        rawBody: String(init?.body ?? ''),
      });
      if (!verification.ok) {
        return new Response(JSON.stringify({ error: 'invalid_signature' }), { status: 401 });
      }
      provider.parseWebhook({
        method: init?.method ?? 'GET',
        url: `http://localhost${input}`,
        headers,
        rawBody: String(init?.body ?? ''),
      });
      const rendered = provider.renderInstruction(
        { kind: 'reject', cause: 'busy' },
        { webhookBaseUrl: 'http://localhost', callRef: 'call_0001' },
      );
      return new Response(rendered.body, {
        status: rendered.status,
        headers: { 'content-type': rendered.contentType },
      });
    },
  };
}

describe('MockTelco', () => {
  it('nextCallRef is sequential and zero-padded', () => {
    const now = () => new Date('2026-01-01T12:00:00Z');
    const telco = createMockTelco({ app: createFakeWebhookApp(now), webhookSecret: SECRET, now });
    expect(telco.nextCallRef()).toBe('call_0001');
    expect(telco.nextCallRef()).toBe('call_0002');
  });

  it('signs every event so the real verifyWebhook scheme accepts it round-trip', async () => {
    const now = () => new Date('2026-01-01T12:00:00Z');
    const telco = createMockTelco({ app: createFakeWebhookApp(now), webhookSecret: SECRET, now });
    const result = await telco.incomingCall({ to: mustE164('+420212345678'), from: null });
    expect(result.status).toBe(200);
    expect(result.instruction).toEqual({ kind: 'reject', cause: 'busy' });
  });

  it('omitSignatureHeaders / signatureOverride reach the app unsigned/wrongly-signed (401)', async () => {
    const now = () => new Date('2026-01-01T12:00:00Z');
    const telco = createMockTelco({ app: createFakeWebhookApp(now), webhookSecret: SECRET, now });
    const unsigned = await telco.incomingCall(
      { to: mustE164('+420212345678'), from: null },
      { omitSignatureHeaders: true },
    );
    expect(unsigned.status).toBe(401);

    const wrongSig = await telco.incomingCall(
      { to: mustE164('+420212345678'), from: null },
      { signatureOverride: 'deadbeef'.repeat(8) },
    );
    expect(wrongSig.status).toBe(401);
  });

  it('posts to the configured path (MOCK_WEBHOOK_PATH) by default', async () => {
    const now = () => new Date('2026-01-01T12:00:00Z');
    let seenPath: string | undefined;
    const spyApp = {
      async request(input: string, _init?: RequestInit): Promise<Response> {
        seenPath = input;
        return new Response('{}', { status: 200 });
      },
    };
    const telco = createMockTelco({ app: spyApp, webhookSecret: SECRET, now });
    await telco.incomingCall({ to: mustE164('+420212345678'), from: null });
    expect(seenPath).toBe(MOCK_WEBHOOK_PATH);
  });

  it(
    'timeline fidelity (design.md §4.4): a forward scenario driven answered-before-completed ' +
      'is representable and the low-level senders never reorder what the caller tells them to send',
    async () => {
      const now = () => new Date('2026-01-01T12:00:00Z');
      const order: string[] = [];
      const spyApp = {
        async request(_input: string, init?: RequestInit): Promise<Response> {
          const body = JSON.parse(String(init?.body ?? '{}'));
          order.push(body.type);
          return new Response('{}', { status: 200 });
        },
      };
      const telco = createMockTelco({ app: spyApp, webhookSecret: SECRET, now });
      const callRef = telco.nextCallRef();
      await telco.incomingCall({ callRef, to: mustE164('+420212345678'), from: null });
      await telco.legAnswered({ callRef });
      await telco.completed({ callRef, durationSeconds: 30 });

      expect(order).toEqual(['call.incoming', 'call.leg', 'call.completed']);
      // `call.leg answered` before any completion event, and a `call.completed` closes
      // every call — the two invariants design.md §4.4 pins as the timeline-fidelity
      // rule.
      expect(order.indexOf('call.leg')).toBeLessThan(order.indexOf('call.completed'));
      expect(order.at(-1)).toBe('call.completed');
    },
  );
});

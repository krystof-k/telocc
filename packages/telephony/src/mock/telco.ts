import type { CallInstruction, E164, TelephonyEvent } from '../types.ts';

/**
 * `MockTelco` — the fake network (design.md §4.5). Holds per-call state, POSTs signed
 * webhooks to the app's real `/webhooks/telephony/mock` endpoint, reads the JSON
 * instruction the route renders back, and progresses (rings, answers, fires DTMF,
 * completes) — the same interaction shape a real carrier's callbacks would produce.
 * In the demo it lives inside the API process behind `/dev/sim/*` (decisions.md #21);
 * `apps/api/src/routes/dev/index.ts` supplies the `AppRequester` by constructing a
 * standalone instance of the real `webhooksRoutes(deps)` sub-app and calling
 * `.request()` on it directly — Hono sub-apps are independently fetchable, so this
 * still goes through the exact same signature-verification/parse/route handler code
 * the mounted app uses, without needing a circular reference to the fully-assembled
 * top-level app (which does not exist yet at the point `deps` is built).
 *
 * Wire format matches `tests/helpers/telco.ts` exactly (decisions.md #38): HMAC-SHA256
 * over `${timestamp}.${rawBody}`, headers `x-mock-signature`/`x-mock-timestamp`.
 *
 * Implemented with Web Crypto (`crypto.subtle`), not `node:crypto` — same Workers-safety
 * rationale as `mock/provider.ts`/`twilio/signature.ts`.
 */

export const MOCK_WEBHOOK_PATH = '/telephony/mock';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sign(secret: string, timestamp: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
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

export interface AppRequester {
  request(input: string, init?: RequestInit): Promise<Response>;
}

export interface SendEventOptions {
  path?: string;
  timestampOverride?: number;
  signatureOverride?: string;
  omitSignatureHeaders?: boolean;
  rawBodyOverride?: string;
}

export interface WebhookResult {
  status: number;
  bodyText: string;
  instruction: CallInstruction | null;
}

export class MockTelco {
  private callCounter = 0;

  constructor(
    private readonly app: AppRequester,
    private readonly webhookSecret: string,
    private readonly now: () => Date,
  ) {}

  nextCallRef(): string {
    this.callCounter += 1;
    return `call_${String(this.callCounter).padStart(4, '0')}`;
  }

  async sendEvent(event: TelephonyEvent, opts: SendEventOptions = {}): Promise<WebhookResult> {
    const rawBody = opts.rawBodyOverride ?? JSON.stringify(event);
    const timestamp = String(opts.timestampOverride ?? Math.floor(this.now().getTime() / 1000));
    const signature =
      opts.signatureOverride ?? (await sign(this.webhookSecret, timestamp, rawBody));

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (!opts.omitSignatureHeaders) {
      headers['x-mock-signature'] = signature;
      headers['x-mock-timestamp'] = timestamp;
    }

    const res = await this.app.request(opts.path ?? MOCK_WEBHOOK_PATH, {
      method: 'POST',
      headers,
      body: rawBody,
    });
    const bodyText = await res.text();
    let instruction: CallInstruction | null = null;
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed && typeof parsed === 'object' && 'kind' in parsed) {
        instruction = parsed as CallInstruction;
      }
    } catch {
      instruction = null;
    }
    return { status: res.status, bodyText, instruction };
  }

  incomingCall(
    params: { callRef?: string; to: E164; from: E164 | null; at?: Date },
    opts?: SendEventOptions,
  ) {
    return this.sendEvent(
      {
        type: 'call.incoming',
        callRef: params.callRef ?? this.nextCallRef(),
        to: params.to,
        from: params.from,
        at: params.at ?? this.now(),
      },
      opts,
    );
  }

  dtmf(params: { callRef: string; digits: string; at?: Date }, opts?: SendEventOptions) {
    return this.sendEvent(
      {
        type: 'call.dtmf',
        callRef: params.callRef,
        digits: params.digits,
        at: params.at ?? this.now(),
      },
      opts,
    );
  }

  legAnswered(params: { callRef: string; at?: Date }, opts?: SendEventOptions) {
    return this.sendEvent(
      {
        type: 'call.leg',
        callRef: params.callRef,
        legStatus: 'answered',
        at: params.at ?? this.now(),
      },
      opts,
    );
  }

  legEnded(
    params: {
      callRef: string;
      legStatus: 'busy' | 'no_answer' | 'failed';
      errorCode?: string;
      at?: Date;
    },
    opts?: SendEventOptions,
  ) {
    return this.sendEvent(
      {
        type: 'call.leg',
        callRef: params.callRef,
        legStatus: params.legStatus,
        errorCode: params.errorCode,
        at: params.at ?? this.now(),
      },
      opts,
    );
  }

  completed(
    params: { callRef: string; durationSeconds: number; errorCode?: string; at?: Date },
    opts?: SendEventOptions,
  ) {
    return this.sendEvent(
      {
        type: 'call.completed',
        callRef: params.callRef,
        durationSeconds: params.durationSeconds,
        errorCode: params.errorCode,
        at: params.at ?? this.now(),
      },
      opts,
    );
  }

  provisioningUpdate(
    params: {
      bundleRef?: string;
      numberRef?: string;
      status: 'submitted' | 'approved' | 'rejected' | 'active';
      reason?: string;
      at?: Date;
    },
    opts?: SendEventOptions,
  ) {
    return this.sendEvent(
      {
        type: 'provisioning.update',
        bundleRef: params.bundleRef,
        numberRef: params.numberRef,
        status: params.status,
        reason: params.reason,
        at: params.at ?? this.now(),
      },
      opts,
    );
  }
}

export function createMockTelco(params: {
  app: AppRequester;
  webhookSecret: string;
  now: () => Date;
}): MockTelco {
  return new MockTelco(params.app, params.webhookSecret, params.now);
}

import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type CallInstruction,
  type DocumentRef,
  type E164,
  type EndUserRecord,
  MalformedWebhookError,
  type NumberClass,
  type ProviderHttpResponse,
  parseE164,
  type RawWebhookRequest,
  type RenderContext,
  type TelephonyEvent,
  type TelephonyProvider,
} from '@telocc/telephony';

/**
 * A hand-rolled stand-in for `packages/telephony/src/mock/{provider,telco}.ts` (M4 —
 * doesn't exist yet at M1). This is deliberately NOT a friendly shortcut: it implements
 * exactly the wire contract design.md §4.4 documents (HMAC-SHA256 over
 * `timestamp.rawBody`, headers `x-mock-signature`/`x-mock-timestamp`, ±300s tolerance,
 * JSON event/instruction bodies) so every webhook still goes through
 * `POST /webhooks/telephony/mock` → `verifyWebhook` → `parseWebhook` → routing →
 * `renderInstruction`, once that route exists. See tests/helpers/README.md for the
 * scaffold-gap note this represents.
 */

export const MOCK_WEBHOOK_PATH = '/webhooks/telephony/mock';
const SIGNATURE_HEADER = 'x-mock-signature';
const TIMESTAMP_HEADER = 'x-mock-timestamp';
const REPLAY_TOLERANCE_SECONDS = 300;

function sign(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// The provider half — injected as `deps.provider` (design.md §4.2).
// ---------------------------------------------------------------------------

export interface RenderedInstructionRecord {
  callRef: string;
  instruction: CallInstruction;
  at: Date;
}

export interface SentSmsRecord {
  to: E164;
  body: string;
  messageRef: string;
}

export interface SubmittedBundleRecord {
  endUser: EndUserRecord;
  documents: DocumentRef[];
  bundleRef: string;
}

export interface ProvisionedNumberRecord {
  e164: E164;
  bundleRef: string;
  numberRef: string;
}

/** Everything a contract test needs to assert against the provider side of the seam. */
export interface MockProviderSpies {
  renderedInstructions: RenderedInstructionRecord[];
  sentSms: SentSmsRecord[];
  hungUpCallRefs: string[];
  releasedNumberRefs: string[];
  deletedCallRefs: string[];
  submittedBundles: SubmittedBundleRecord[];
  provisionedNumbers: ProvisionedNumberRecord[];
}

export interface MockTelephony {
  provider: TelephonyProvider;
  spies: MockProviderSpies;
}

/**
 * Builds the fake `TelephonyProvider` + its spies. `webhookSecret`/`now` must match
 * whatever `buildTestEnv`/fake clock the test wires into `deps` so signatures and
 * replay-tolerance checks line up.
 */
export function createMockTelephonyProvider(params: {
  webhookSecret: string;
  now: () => Date;
}): MockTelephony {
  const { webhookSecret, now } = params;
  const spies: MockProviderSpies = {
    renderedInstructions: [],
    sentSms: [],
    hungUpCallRefs: [],
    releasedNumberRefs: [],
    deletedCallRefs: [],
    submittedBundles: [],
    provisionedNumbers: [],
  };

  let smsCounter = 0;
  let bundleCounter = 0;
  let numberCounter = 0;

  const provider: TelephonyProvider = {
    name: 'mock',
    capabilities: {
      czCliDomesticTermination: true,
      instantProvisioning: true,
      supportedNumberClasses: ['geographic', 'nomadic_910', 'mobile'],
    },

    async verifyWebhook(req: RawWebhookRequest) {
      const signature = req.headers[SIGNATURE_HEADER];
      const timestamp = req.headers[TIMESTAMP_HEADER];
      if (!signature || !timestamp) {
        return { ok: false, reason: 'missing signature headers' };
      }
      const expected = sign(webhookSecret, timestamp, req.rawBody);
      if (!timingSafeEqualHex(signature, expected)) {
        return { ok: false, reason: 'signature mismatch' };
      }
      const timestampMs = Number(timestamp) * 1000;
      if (!Number.isFinite(timestampMs)) {
        return { ok: false, reason: 'malformed timestamp' };
      }
      const skewSeconds = Math.abs(now().getTime() - timestampMs) / 1000;
      if (skewSeconds > REPLAY_TOLERANCE_SECONDS) {
        return { ok: false, reason: 'timestamp outside replay tolerance' };
      }
      return { ok: true };
    },

    parseWebhook(req: RawWebhookRequest): TelephonyEvent {
      let raw: unknown;
      try {
        raw = JSON.parse(req.rawBody);
      } catch {
        throw new MalformedWebhookError('body is not valid JSON');
      }
      if (typeof raw !== 'object' || raw === null || !('type' in raw)) {
        throw new MalformedWebhookError('missing event type');
      }
      const event = raw as Record<string, unknown>;
      const at = typeof event.at === 'string' ? new Date(event.at) : new Date(NaN);
      if (Number.isNaN(at.getTime())) {
        throw new MalformedWebhookError('missing or invalid "at" timestamp');
      }
      switch (event.type) {
        case 'call.incoming':
          if (typeof event.callRef !== 'string' || typeof event.to !== 'string') {
            throw new MalformedWebhookError('call.incoming requires callRef and to');
          }
          return {
            type: 'call.incoming',
            callRef: event.callRef,
            to: event.to as E164,
            from: (event.from as E164 | null) ?? null,
            at,
          };
        case 'call.dtmf':
          if (typeof event.callRef !== 'string' || typeof event.digits !== 'string') {
            throw new MalformedWebhookError('call.dtmf requires callRef and digits');
          }
          return { type: 'call.dtmf', callRef: event.callRef, digits: event.digits, at };
        case 'call.leg':
          if (typeof event.callRef !== 'string' || typeof event.legStatus !== 'string') {
            throw new MalformedWebhookError('call.leg requires callRef and legStatus');
          }
          return {
            type: 'call.leg',
            callRef: event.callRef,
            legStatus: event.legStatus as 'answered' | 'busy' | 'no_answer' | 'failed',
            errorCode: event.errorCode as string | undefined,
            at,
          };
        case 'call.completed':
          if (typeof event.callRef !== 'string' || typeof event.durationSeconds !== 'number') {
            throw new MalformedWebhookError('call.completed requires callRef and durationSeconds');
          }
          return {
            type: 'call.completed',
            callRef: event.callRef,
            durationSeconds: event.durationSeconds,
            errorCode: event.errorCode as string | undefined,
            at,
          };
        case 'sms.status':
          if (typeof event.messageRef !== 'string' || typeof event.status !== 'string') {
            throw new MalformedWebhookError('sms.status requires messageRef and status');
          }
          return {
            type: 'sms.status',
            messageRef: event.messageRef,
            status: event.status as 'sent' | 'delivered' | 'failed',
            at,
          };
        case 'provisioning.update':
          if (typeof event.status !== 'string') {
            throw new MalformedWebhookError('provisioning.update requires status');
          }
          return {
            type: 'provisioning.update',
            bundleRef: event.bundleRef as string | undefined,
            numberRef: event.numberRef as string | undefined,
            status: event.status as 'submitted' | 'approved' | 'rejected' | 'active',
            reason: event.reason as string | undefined,
            at,
          };
        default:
          throw new MalformedWebhookError(`unknown event type: ${String(event.type)}`);
      }
    },

    renderInstruction(instruction: CallInstruction, ctx: RenderContext): ProviderHttpResponse {
      spies.renderedInstructions.push({ callRef: ctx.callRef, instruction, at: now() });
      return { status: 200, contentType: 'application/json', body: JSON.stringify(instruction) };
    },

    async sendSms(msg) {
      smsCounter += 1;
      const messageRef = `sms_${String(smsCounter).padStart(4, '0')}`;
      spies.sentSms.push({ ...msg, messageRef });
      return { messageRef };
    },

    async hangupCall(callRef) {
      spies.hungUpCallRefs.push(callRef);
    },

    async searchNumbers(q) {
      const areaCode = q.areaCode ?? '2'; // Prague default (design.md decisions.md #5)
      const digitsNeeded = 9 - areaCode.length;
      const results: { e164: E164; numberClass: NumberClass; areaCode: string }[] = [];
      for (let i = 1; i <= q.limit; i += 1) {
        const subscriber = String(i).padStart(digitsNeeded, '0');
        const e164 = parseE164(`+420${areaCode}${subscriber}`);
        if (!e164) continue;
        results.push({ e164, numberClass: q.numberClass, areaCode });
      }
      return results;
    },

    async getRequiredDocuments() {
      return [
        { type: 'business_registration', label: 'Business registration extract' },
        { type: 'proof_of_address', label: 'Proof of registered address' },
      ];
    },

    async submitBundle(b) {
      bundleCounter += 1;
      const bundleRef = `bundle_${String(bundleCounter).padStart(4, '0')}`;
      spies.submittedBundles.push({ ...b, bundleRef });
      return { bundleRef, status: 'approved' };
    },

    async provisionNumber(p) {
      numberCounter += 1;
      const numberRef = `number_${String(numberCounter).padStart(4, '0')}`;
      spies.provisionedNumbers.push({ e164: p.e164, bundleRef: p.bundleRef, numberRef });
      return { numberRef, status: 'active' };
    },

    async releaseNumber(numberRef) {
      spies.releasedNumberRefs.push(numberRef);
    },

    async getProvisioningStatus() {
      return { status: 'active' };
    },

    async deleteCallRecord(callRef) {
      spies.deletedCallRefs.push(callRef);
    },
  };

  return { provider, spies };
}

// ---------------------------------------------------------------------------
// The "fake network" half — drives the real HTTP webhook endpoint (design.md §4.5).
// ---------------------------------------------------------------------------

export interface AppRequester {
  request(input: string, init?: RequestInit): Promise<Response>;
}

export interface SendEventOptions {
  path?: string;
  /** Override the signed timestamp (unix seconds) — e.g. to simulate replay/staleness. */
  timestampOverride?: number;
  signatureOverride?: string;
  omitSignatureHeaders?: boolean;
  /** Send this exact body instead of `JSON.stringify(event)` — for malformed-payload cases. */
  rawBodyOverride?: string;
}

export interface WebhookResult {
  status: number;
  bodyText: string;
  /** Parsed as a `CallInstruction` when the response body is JSON; null otherwise. */
  instruction: CallInstruction | null;
}

/**
 * The deterministic fake "telco network": generates sequential call refs, signs and
 * POSTs neutral `TelephonyEvent` payloads to the app's real webhook endpoint, and
 * decodes the JSON `CallInstruction` the route renders back (design.md §4.3/§4.5).
 */
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
    const signature = opts.signatureOverride ?? sign(this.webhookSecret, timestamp, rawBody);

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (!opts.omitSignatureHeaders) {
      headers[SIGNATURE_HEADER] = signature;
      headers[TIMESTAMP_HEADER] = timestamp;
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

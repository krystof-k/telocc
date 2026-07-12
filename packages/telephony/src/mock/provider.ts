import type { TelephonyProvider } from '../provider.ts';
import {
  type CallInstruction,
  type DocumentRef,
  type E164,
  type EndUserRecord,
  MalformedWebhookError,
  type NumberClass,
  type ProviderCapabilities,
  type ProviderHttpResponse,
  parseE164,
  type RawWebhookRequest,
  type RenderContext,
  type TelephonyEvent,
} from '../types.ts';

/**
 * `MockProvider` — the mock half of the telephony seam (design.md §4.4/§4.5).
 *
 * This MUST speak exactly the wire scheme `tests/helpers/telco.ts` hand-rolls (that
 * file is a stand-in written before this module existed, M1; decisions.md #38):
 * HMAC-SHA256 over `${timestamp}.${rawBody}` with `MOCK_WEBHOOK_SECRET`, headers
 * `x-mock-signature`/`x-mock-timestamp`, ±300s replay tolerance, JSON event/instruction
 * bodies keyed on the neutral `type`/`kind` discriminants. The contract-test suite
 * never imports this module (it drives the app through the hand-rolled stand-in
 * instead), so byte-for-byte conformance here is what keeps this module honest against
 * the same spec, not something the contract run itself checks.
 *
 * Implemented with Web Crypto (`crypto.subtle`) rather than `node:crypto` — same
 * rationale as `twilio/signature.ts`: this keeps the module import-safe in a Workers
 * bundle (design.md "Runtime duality") even though the mock provider itself is only
 * ever wired up outside Workers (dev/demo/tests) today.
 */

const SIGNATURE_HEADER = 'x-mock-signature';
const TIMESTAMP_HEADER = 'x-mock-timestamp';
const REPLAY_TOLERANCE_SECONDS = 300;

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

/** Constant-time comparison of two fixed-length hex strings (avoids leaking signature
 * match progress via timing). */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export interface RenderedInstructionRecord {
  callRef: string;
  instruction: CallInstruction;
  at: Date;
}

export interface SentSmsRecord {
  to: E164;
  body: string;
  messageRef: string;
  at: Date;
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

/**
 * Introspectable state the dev mailbox/simulator panels surface (design.md §4.4
 * "sendSms" row: "demo: dev mailbox panel"; §12 event log panel). Not test spies —
 * production state a route can read, e.g. `GET /dev/sim/state`.
 */
export interface MockProviderState {
  readonly renderedInstructions: RenderedInstructionRecord[];
  readonly sentSms: SentSmsRecord[];
  readonly hungUpCallRefs: string[];
  readonly releasedNumberRefs: string[];
  readonly deletedCallRefs: string[];
  readonly submittedBundles: SubmittedBundleRecord[];
  readonly provisionedNumbers: ProvisionedNumberRecord[];
}

export interface MockProviderInstance {
  provider: TelephonyProvider;
  state: MockProviderState;
}

const MOCK_CAPABILITIES: ProviderCapabilities = {
  czCliDomesticTermination: true,
  instantProvisioning: true,
  supportedNumberClasses: ['geographic', 'nomadic_910', 'mobile'],
};

/**
 * Builds the mock `TelephonyProvider` (sequential refs `sms_0001…`/`bundle_0001…`/
 * `number_0001…`, design.md §4.5). `webhookSecret`/`now` should be the same
 * `MOCK_WEBHOOK_SECRET`/clock the app is built with, so signing and the replay-window
 * check line up with `verifyWebhook`.
 */
export function createMockProvider(params: {
  webhookSecret: string;
  now: () => Date;
}): MockProviderInstance {
  const { webhookSecret, now } = params;
  const state: MockProviderState = {
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
    capabilities: MOCK_CAPABILITIES,

    async verifyWebhook(req: RawWebhookRequest) {
      const signature = req.headers[SIGNATURE_HEADER];
      const timestamp = req.headers[TIMESTAMP_HEADER];
      if (!signature || !timestamp) {
        return { ok: false, reason: 'missing signature headers' };
      }
      const expected = await sign(webhookSecret, timestamp, req.rawBody);
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
      const at = typeof event.at === 'string' ? new Date(event.at) : new Date(Number.NaN);
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
      state.renderedInstructions.push({ callRef: ctx.callRef, instruction, at: now() });
      return { status: 200, contentType: 'application/json', body: JSON.stringify(instruction) };
    },

    async sendSms(msg) {
      smsCounter += 1;
      const messageRef = `sms_${String(smsCounter).padStart(4, '0')}`;
      state.sentSms.push({ ...msg, messageRef, at: now() });
      return { messageRef };
    },

    async hangupCall(callRef) {
      state.hungUpCallRefs.push(callRef);
    },

    async searchNumbers(q: {
      country: 'CZ';
      areaCode?: string;
      numberClass: NumberClass;
      limit: number;
    }) {
      const areaCode = q.areaCode ?? '2'; // Prague default (decisions.md #5)
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
      state.submittedBundles.push({ ...b, bundleRef });
      return { bundleRef, status: 'approved' };
    },

    async provisionNumber(p) {
      numberCounter += 1;
      const numberRef = `number_${String(numberCounter).padStart(4, '0')}`;
      state.provisionedNumbers.push({ e164: p.e164, bundleRef: p.bundleRef, numberRef });
      return { numberRef, status: 'active' };
    },

    async releaseNumber(numberRef) {
      state.releasedNumberRefs.push(numberRef);
    },

    async getProvisioningStatus() {
      return { status: 'active' };
    },

    async deleteCallRecord(callRef) {
      state.deletedCallRefs.push(callRef);
    },
  };

  return { provider, state };
}

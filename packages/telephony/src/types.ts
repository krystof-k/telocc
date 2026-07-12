/**
 * The telephony seam — neutral types shared by every provider implementation
 * (mock, Twilio) and every consumer (packages/core, apps/api). Nothing outside
 * packages/telephony may depend on a concrete provider's wire format.
 *
 * design.md §4.1
 */

/** Branded E.164 phone number. The only way to obtain one is `parseE164`. */
export type E164 = string & { readonly __brand: 'E164' };

const E164_PATTERN = /^\+[1-9][0-9]{1,14}$/;

/** Validates and brands a string as E.164, or returns null if malformed. */
export function parseE164(value: string): E164 | null {
  return E164_PATTERN.test(value) ? (value as E164) : null;
}

/**
 * ER-CLI-3: arbitrary CLI strings are unrepresentable. The only constructor takes a
 * BusinessNumber row, so the presented identity is always the org's provisioned number.
 */
export type PresentedCli = {
  readonly businessNumberId: string;
  readonly e164: E164;
  readonly __brand: 'PresentedCli';
};

export function presentedCli(bn: { id: string; e164: string; status: 'active' }): PresentedCli {
  const e164 = parseE164(bn.e164);
  if (!e164) {
    throw new Error(`presentedCli: business number ${bn.id} has an invalid E.164 value`);
  }
  return { businessNumberId: bn.id, e164, __brand: 'PresentedCli' };
}

export type NumberClass = 'geographic' | 'nomadic_910' | 'mobile';

export interface ProviderCapabilities {
  /** ER-OBS-1: may only become `true` on Twilio's written confirmation (go-live gate). */
  czCliDomesticTermination: boolean | 'unverified';
  /** mock: true (demo feels instant); twilio: false (regulatory bundle review). */
  instantProvisioning: boolean;
  supportedNumberClasses: NumberClass[];
}

/** Neutral domain events — what a provider webhook becomes. */
export type TelephonyEvent =
  | { type: 'call.incoming'; callRef: string; to: E164; from: E164 | null; at: Date }
  | { type: 'call.dtmf'; callRef: string; digits: string; at: Date } // Gather result; '' = timeout
  | {
      type: 'call.leg';
      callRef: string;
      legStatus: 'answered' | 'busy' | 'no_answer' | 'failed';
      errorCode?: string;
      at: Date;
    } // dialled-leg signal: 'answered' fires AT PICKUP; others at leg end
  | {
      type: 'call.completed';
      callRef: string;
      durationSeconds: number;
      errorCode?: string;
      at: Date;
    }
  | { type: 'sms.status'; messageRef: string; status: 'sent' | 'delivered' | 'failed'; at: Date }
  | {
      type: 'provisioning.update';
      bundleRef?: string;
      numberRef?: string;
      status: 'submitted' | 'approved' | 'rejected' | 'active';
      reason?: string;
      at: Date;
    };

/** Neutral call-control instructions — what the app answers a webhook with. */
export type CallInstruction =
  | { kind: 'reject'; cause: 'busy' } // out-of-hours / not-configured
  | { kind: 'forward'; to: E164; callerId: PresentedCli; timeoutSeconds: number } // inbound → personal number
  | {
      kind: 'collectDigits';
      prompt: 'beep' | 'silent';
      maxDigits: number;
      finishKey: '#';
      timeoutSeconds: number;
    } // DTMF phase
  | {
      kind: 'bridge';
      target: E164;
      callerId: PresentedCli;
      timeoutSeconds: number;
      maxDurationSeconds?: number;
    } // outbound leg; timeLimit = daily-cap remainder
  | { kind: 'refuseTone' } // ER-EMG-1: audibly distinct, announcement-free
  | { kind: 'hangup' };

/** Runtime-neutral wrapper (Workers & Node). */
export interface RawWebhookRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  rawBody: string;
}

/** Twilio action URLs etc. */
export interface RenderContext {
  webhookBaseUrl: string;
  callRef: string;
}

export interface ProviderHttpResponse {
  status: number;
  contentType: string;
  body: string;
}

/** Shaped like Twilio's EndUser resource (ER-KYC-2). */
export interface EndUserRecord {
  legalName: string;
  ico: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
}

/** Shaped like Twilio's SupportingDocument resource. */
export interface DocumentRef {
  type: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export class MalformedWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedWebhookError';
  }
}

import type {
  CallInstruction,
  DocumentRef,
  E164,
  EndUserRecord,
  NumberClass,
  ProviderCapabilities,
  ProviderHttpResponse,
  RawWebhookRequest,
  RenderContext,
  TelephonyEvent,
} from './types.ts';

/**
 * THE SEAM. All inbound-event handling, outbound dialling, bridging, DTMF collection,
 * hangup, SMS-PIN delivery, number catalog/search + provisioning, and capability flags
 * go through this interface. Application logic (core, apps/api) imports only these types
 * — never a concrete provider (design.md §4.2).
 */
export interface TelephonyProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  // ---- webhook flow (ER-WEB-1) ----
  /** Cryptographic check FIRST; app logic never sees an unverified payload. */
  verifyWebhook(req: RawWebhookRequest): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Provider payload → neutral event. Throws MalformedWebhookError (→ 400). */
  parseWebhook(req: RawWebhookRequest): TelephonyEvent;
  /** Neutral instruction → provider wire format (TwiML / mock JSON). */
  renderInstruction(i: CallInstruction, ctx: RenderContext): ProviderHttpResponse;

  // ---- imperative call/SMS control ----
  sendSms(msg: { to: E164; body: string }): Promise<{ messageRef: string }>; // PIN delivery
  hangupCall(callRef: string): Promise<void>; // backstop (cap breach mid-call)

  // ---- number catalog & provisioning (async-capable, ER-KYC-1..3) ----
  searchNumbers(q: {
    country: 'CZ';
    areaCode?: string;
    numberClass: NumberClass;
    limit: number;
  }): Promise<{ e164: E164; numberClass: NumberClass; areaCode: string }[]>;
  getRequiredDocuments(q: {
    country: 'CZ';
    numberClass: NumberClass;
  }): Promise<{ type: string; label: string }[]>; // Regulations API / fixture
  submitBundle(b: {
    endUser: EndUserRecord;
    documents: DocumentRef[];
  }): Promise<{ bundleRef: string; status: 'submitted' | 'approved' }>;
  provisionNumber(p: {
    e164: E164;
    bundleRef: string;
    webhookBaseUrl: string;
  }): Promise<{ numberRef: string; status: 'pending' | 'active' }>;
  releaseNumber(numberRef: string): Promise<void>;
  getProvisioningStatus(refs: {
    bundleRef?: string;
    numberRef?: string;
  }): Promise<{ status: 'submitted' | 'approved' | 'rejected' | 'active'; reason?: string }>; // poll fallback
  deleteCallRecord(callRef: string): Promise<void>; // ER-DSR-2 propagate-delete
}

import type { TelephonyProvider } from '../provider.ts';
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
} from '../types.ts';
import type { TwilioProviderConfig } from './config.ts';
import {
  buildAvailableNumbersRequest,
  buildBundleCreateRequest,
  buildBundleGetRequest,
  buildBundleItemAssignmentRequest,
  buildBundleSubmitRequest,
  buildDeleteCallRequest,
  buildEndUserRequest,
  buildHangupCallRequest,
  buildIncomingPhoneNumberCreateRequest,
  buildIncomingPhoneNumberDeleteRequest,
  buildIncomingPhoneNumberGetRequest,
  buildMessagesRequest,
  buildRegulationsRequest,
  buildSupportingDocumentRequest,
  parseRegulationsResponse,
  type TwilioRequestDescriptor,
} from './rest.ts';
import { verifyTwilioSignature } from './signature.ts';
import { renderTwilioInstruction } from './twiml.ts';
import { parseTwilioWebhook } from './webhook-parse.ts';

/**
 * `{ czCliDomesticTermination: 'unverified', instantProvisioning: false }` — the flag may
 * only flip to `true` on Twilio's written CZ-domestic-termination confirmation (ER-OBS-1,
 * go-live gate); provisioning is never instant here because it goes through the
 * Bundles/EndUsers regulatory review flow (design.md §4.4 capabilities row).
 */
const TWILIO_CAPABILITIES: ProviderCapabilities = {
  czCliDomesticTermination: 'unverified',
  instantProvisioning: false,
  supportedNumberClasses: ['geographic', 'nomadic_910', 'mobile'],
};

interface TwilioApiError {
  message?: string;
  code?: number;
}

async function executeJson(
  fetchImpl: typeof fetch,
  descriptor: TwilioRequestDescriptor,
): Promise<unknown> {
  const res = await fetchImpl(descriptor.url, {
    method: descriptor.method,
    headers: descriptor.headers,
    body: descriptor.body,
  });
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = json as TwilioApiError | undefined;
    throw new Error(`Twilio API error (${res.status}): ${err?.message ?? 'unknown error'}`);
  }
  return json;
}

async function execute(
  fetchImpl: typeof fetch,
  descriptor: TwilioRequestDescriptor,
): Promise<Response> {
  const res = await fetchImpl(descriptor.url, {
    method: descriptor.method,
    headers: descriptor.headers,
    body: descriptor.body,
  });
  if (!res.ok) {
    throw new Error(`Twilio API error (${res.status}) for ${descriptor.method} ${descriptor.url}`);
  }
  return res;
}

/**
 * Complete, unwired `TelephonyProvider` implementation against Twilio's real APIs.
 * Nothing outside `packages/telephony` may import this module (design.md §4.6 leak
 * prevention) — the composition point (`apps/api/src/deps.ts`, a later milestone) is the
 * only permitted consumer, behind `TELEPHONY_PROVIDER=twilio`.
 */
export class TwilioProvider implements TelephonyProvider {
  readonly name = 'twilio';
  readonly capabilities = TWILIO_CAPABILITIES;

  private readonly config: TwilioProviderConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: TwilioProviderConfig) {
    this.config = config;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  async verifyWebhook(
    req: RawWebhookRequest,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    return verifyTwilioSignature(this.config.authToken, req);
  }

  parseWebhook(req: RawWebhookRequest): TelephonyEvent {
    return parseTwilioWebhook(req);
  }

  renderInstruction(i: CallInstruction, ctx: RenderContext): ProviderHttpResponse {
    return renderTwilioInstruction(i, ctx, this.config);
  }

  async sendSms(msg: { to: E164; body: string }): Promise<{ messageRef: string }> {
    const descriptor = buildMessagesRequest(this.config, msg);
    const json = (await executeJson(this.fetchImpl, descriptor)) as { sid?: string };
    if (!json.sid) throw new Error('Twilio Messages response missing sid');
    return { messageRef: json.sid };
  }

  async hangupCall(callRef: string): Promise<void> {
    await execute(this.fetchImpl, buildHangupCallRequest(this.config, callRef));
  }

  async searchNumbers(q: {
    country: 'CZ';
    areaCode?: string;
    numberClass: NumberClass;
    limit: number;
  }): Promise<{ e164: E164; numberClass: NumberClass; areaCode: string }[]> {
    const descriptor = buildAvailableNumbersRequest(this.config, q);
    const json = (await executeJson(this.fetchImpl, descriptor)) as {
      available_phone_numbers?: { phone_number: string; locality?: string }[];
    };
    return (json.available_phone_numbers ?? []).map((entry) => ({
      e164: entry.phone_number as E164,
      numberClass: q.numberClass,
      areaCode: q.areaCode ?? '',
    }));
  }

  async getRequiredDocuments(q: {
    country: 'CZ';
    numberClass: NumberClass;
  }): Promise<{ type: string; label: string }[]> {
    const descriptor = buildRegulationsRequest(this.config, q);
    const json = await executeJson(this.fetchImpl, descriptor);
    return parseRegulationsResponse(json);
  }

  async submitBundle(b: {
    endUser: EndUserRecord;
    documents: DocumentRef[];
  }): Promise<{ bundleRef: string; status: 'submitted' | 'approved' }> {
    const endUserJson = (await executeJson(
      this.fetchImpl,
      buildEndUserRequest(this.config, b.endUser),
    )) as { sid?: string };
    if (!endUserJson.sid) throw new Error('Twilio EndUsers response missing sid');

    const documentSids: string[] = [];
    for (const doc of b.documents) {
      const docJson = (await executeJson(
        this.fetchImpl,
        buildSupportingDocumentRequest(this.config, doc, endUserJson.sid),
      )) as { sid?: string };
      if (!docJson.sid) throw new Error('Twilio SupportingDocuments response missing sid');
      documentSids.push(docJson.sid);
    }

    const bundleJson = (await executeJson(
      this.fetchImpl,
      buildBundleCreateRequest(this.config, b.endUser),
    )) as { sid?: string };
    if (!bundleJson.sid) throw new Error('Twilio Bundles response missing sid');

    for (const objectSid of [endUserJson.sid, ...documentSids]) {
      await executeJson(
        this.fetchImpl,
        buildBundleItemAssignmentRequest(this.config, bundleJson.sid, objectSid),
      );
    }

    await executeJson(this.fetchImpl, buildBundleSubmitRequest(this.config, bundleJson.sid));

    // Never auto-approves here (instantProvisioning: false) — approval arrives via the
    // Bundle status callback (webhook-parse.ts) or getProvisioningStatus polling.
    return { bundleRef: bundleJson.sid, status: 'submitted' };
  }

  async provisionNumber(p: {
    e164: E164;
    bundleRef: string;
    webhookBaseUrl: string;
  }): Promise<{ numberRef: string; status: 'pending' | 'active' }> {
    const json = (await executeJson(
      this.fetchImpl,
      buildIncomingPhoneNumberCreateRequest(this.config, p),
    )) as { sid?: string };
    if (!json.sid) throw new Error('Twilio IncomingPhoneNumbers response missing sid');
    // ASSUMPTION: purchase is created eagerly and starts `pending` — real activation is
    // gated on the bundle's regulatory approval, surfaced via getProvisioningStatus / the
    // Bundle status callback (design.md §4.4 "submitBundle / provisionNumber" row).
    return { numberRef: json.sid, status: 'pending' };
  }

  async releaseNumber(numberRef: string): Promise<void> {
    await execute(this.fetchImpl, buildIncomingPhoneNumberDeleteRequest(this.config, numberRef));
  }

  async getProvisioningStatus(refs: {
    bundleRef?: string;
    numberRef?: string;
  }): Promise<{ status: 'submitted' | 'approved' | 'rejected' | 'active'; reason?: string }> {
    if (refs.bundleRef) {
      const json = (await executeJson(
        this.fetchImpl,
        buildBundleGetRequest(this.config, refs.bundleRef),
      )) as { status?: string; rejection_reason?: string };
      const status = mapBundleStatusField(json.status ?? '');
      return status === 'rejected' ? { status, reason: json.rejection_reason } : { status };
    }
    if (refs.numberRef) {
      // ASSUMPTION: IncomingPhoneNumbers has no lifecycle `status` field of its own — a
      // successful GET means the number resource exists and is routed, i.e. `active`.
      await executeJson(
        this.fetchImpl,
        buildIncomingPhoneNumberGetRequest(this.config, refs.numberRef),
      );
      return { status: 'active' };
    }
    throw new Error('getProvisioningStatus requires bundleRef or numberRef');
  }

  async deleteCallRecord(callRef: string): Promise<void> {
    await execute(this.fetchImpl, buildDeleteCallRequest(this.config, callRef));
  }
}

function mapBundleStatusField(status: string): 'submitted' | 'approved' | 'rejected' | 'active' {
  switch (status) {
    case 'draft':
    case 'pending-review':
    case 'in-review':
      return 'submitted';
    case 'twilio-approved':
    case 'provisionally-approved':
      return 'approved';
    case 'twilio-rejected':
      return 'rejected';
    default:
      throw new Error(`unrecognized Bundle status field: ${status}`);
  }
}

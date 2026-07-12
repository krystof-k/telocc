import type { DocumentRef, E164, EndUserRecord, NumberClass } from '../types.ts';
import { type TwilioProviderConfig, twilioApiBase, twilioNumbersBase } from './config.ts';

/**
 * Plain, side-effect-free REST request descriptors for every Twilio resource this seam
 * touches (Messages/Calls/AvailablePhoneNumbers/Bundles/EndUsers/SupportingDocuments/
 * Regulations/IncomingPhoneNumbers). None of these perform network I/O — `provider.ts`
 * hands the descriptor to an injected `fetchImpl` (default `globalThis.fetch`), so this
 * module is fully unit-testable with zero live network, and stays Workers-bundle-safe
 * (no `node:*` imports).
 *
 * ASSUMPTIONS baked in from Twilio's documented shapes (not live traffic) — flagged again
 * in the M9 report for spot-check at wiring time:
 *  - `nomadic_910` (CZ non-geographic 9xx numbers) has no distinct AvailablePhoneNumbers
 *    type in Twilio's generic API; modelled here as `Mobile`, the closest analogue.
 *  - `SupportingDocuments` requires a real multipart/form-data upload with a binary file
 *    part in production; this descriptor represents the same information as a
 *    form-urlencoded body with a base64 `FileData` field for testability within this
 *    seam's string-bodied descriptor shape — the wiring engineer must rebuild the body as
 *    multipart, not just adjust headers.
 *  - The Regulations resource's JSON response shape (nested `requirements`) is
 *    transcribed from Twilio's public docs; `parseRegulationsResponse` below is a
 *    best-effort reader over that shape.
 */

export interface TwilioRequestDescriptor {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly url: string;
  readonly headers: Record<string, string>;
  /** application/x-www-form-urlencoded body, when present. */
  readonly body?: string;
}

function basicAuthHeader(accountSid: string, authToken: string): string {
  const raw = `${accountSid}:${authToken}`;
  let binary = '';
  for (const byte of new TextEncoder().encode(raw)) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function authHeaders(
  config: Pick<TwilioProviderConfig, 'accountSid' | 'authToken'>,
  form: boolean,
) {
  const headers: Record<string, string> = {
    Authorization: basicAuthHeader(config.accountSid, config.authToken),
  };
  if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  return headers;
}

function formBody(fields: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) params.set(key, value);
  }
  return params.toString();
}

type RestConfig = Pick<TwilioProviderConfig, 'accountSid' | 'authToken' | 'region'>;

// ---- Messages (sendSms) ----

export function buildMessagesRequest(
  config: RestConfig & Pick<TwilioProviderConfig, 'smsFrom'>,
  msg: { to: E164; body: string },
): TwilioRequestDescriptor {
  return {
    method: 'POST',
    url: `${twilioApiBase(config)}/Accounts/${config.accountSid}/Messages.json`,
    headers: authHeaders(config, true),
    body: formBody({ To: msg.to, From: config.smsFrom, Body: msg.body }),
  };
}

// ---- Calls (hangupCall / deleteCallRecord) ----

export function buildHangupCallRequest(
  config: RestConfig,
  callSid: string,
): TwilioRequestDescriptor {
  return {
    method: 'POST',
    url: `${twilioApiBase(config)}/Accounts/${config.accountSid}/Calls/${callSid}.json`,
    headers: authHeaders(config, true),
    body: formBody({ Status: 'completed' }),
  };
}

export function buildDeleteCallRequest(
  config: RestConfig,
  callSid: string,
): TwilioRequestDescriptor {
  return {
    method: 'DELETE',
    url: `${twilioApiBase(config)}/Accounts/${config.accountSid}/Calls/${callSid}.json`,
    headers: authHeaders(config, false),
  };
}

// ---- AvailablePhoneNumbers (searchNumbers) ----

const NUMBER_CLASS_TO_TWILIO_TYPE: Record<NumberClass, string> = {
  geographic: 'Local',
  mobile: 'Mobile',
  nomadic_910: 'Mobile', // ASSUMPTION — see module doc.
};

export function buildAvailableNumbersRequest(
  config: RestConfig,
  q: { areaCode?: string; numberClass: NumberClass; limit: number },
): TwilioRequestDescriptor {
  const type = NUMBER_CLASS_TO_TWILIO_TYPE[q.numberClass];
  const url = new URL(
    `${twilioApiBase(config)}/Accounts/${config.accountSid}/AvailablePhoneNumbers/CZ/${type}.json`,
  );
  if (q.areaCode) url.searchParams.set('AreaCode', q.areaCode);
  url.searchParams.set('PageSize', String(q.limit));
  return { method: 'GET', url: url.toString(), headers: authHeaders(config, false) };
}

// ---- Regulations (getRequiredDocuments) ----

export function buildRegulationsRequest(
  config: RestConfig,
  q: { numberClass: NumberClass },
): TwilioRequestDescriptor {
  const url = new URL(`${twilioNumbersBase(config)}/Regulations`);
  url.searchParams.set('IsoCountry', 'CZ');
  url.searchParams.set('NumberType', NUMBER_CLASS_TO_TWILIO_TYPE[q.numberClass].toLowerCase());
  url.searchParams.set('EndUserType', 'business');
  return { method: 'GET', url: url.toString(), headers: authHeaders(config, false) };
}

interface RegulationsResponseShape {
  results?: {
    requirements?: {
      end_user?: { name?: string; friendly_name?: string }[];
      supporting_document?: { name?: string; friendly_name?: string }[][];
    };
  }[];
}

/** Best-effort reader over Twilio's documented Regulations response shape (see module doc). */
export function parseRegulationsResponse(json: unknown): { type: string; label: string }[] {
  const body = (json ?? {}) as RegulationsResponseShape;
  const docs: { type: string; label: string }[] = [];
  for (const result of body.results ?? []) {
    for (const endUser of result.requirements?.end_user ?? []) {
      const name = endUser.name ?? endUser.friendly_name;
      if (name) docs.push({ type: name, label: endUser.friendly_name ?? name });
    }
    for (const group of result.requirements?.supporting_document ?? []) {
      for (const doc of group) {
        const name = doc.name ?? doc.friendly_name;
        if (name) docs.push({ type: name, label: doc.friendly_name ?? name });
      }
    }
  }
  return docs;
}

// ---- EndUsers / SupportingDocuments / Bundles (submitBundle) ----

export function buildEndUserRequest(
  config: RestConfig,
  endUser: EndUserRecord,
): TwilioRequestDescriptor {
  return {
    method: 'POST',
    url: `${twilioNumbersBase(config)}/EndUsers`,
    headers: authHeaders(config, true),
    body: formBody({
      FriendlyName: endUser.legalName,
      Type: 'business',
      Attributes: JSON.stringify({
        business_name: endUser.legalName,
        business_identity_number: endUser.ico,
        business_street: endUser.street,
        business_city: endUser.city,
        business_postal_code: endUser.postalCode,
        business_country: endUser.country,
      }),
    }),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** See module doc — modelled as form-urlencoded for testability; real upload is multipart. */
export function buildSupportingDocumentRequest(
  config: RestConfig,
  doc: DocumentRef,
  endUserSid: string,
): TwilioRequestDescriptor {
  return {
    method: 'POST',
    url: `${twilioNumbersBase(config)}/SupportingDocuments`,
    headers: authHeaders(config, true),
    body: formBody({
      FriendlyName: doc.filename,
      Type: doc.type,
      Attributes: JSON.stringify({ end_user_sid: endUserSid, content_type: doc.contentType }),
      FileData: bytesToBase64(doc.bytes),
    }),
  };
}

export function buildBundleCreateRequest(
  config: RestConfig,
  endUser: EndUserRecord,
): TwilioRequestDescriptor {
  return {
    method: 'POST',
    url: `${twilioNumbersBase(config)}/Bundles`,
    headers: authHeaders(config, true),
    body: formBody({
      FriendlyName: `${endUser.legalName} — CZ regulatory bundle`,
      Email: `compliance+${endUser.ico}@telocc.invalid`, // ASSUMPTION: placeholder contact; owner supplies a real address at wiring.
      IsoCountry: 'CZ',
      EndUserType: 'business',
      NumberType: 'local',
    }),
  };
}

export function buildBundleItemAssignmentRequest(
  config: RestConfig,
  bundleSid: string,
  objectSid: string,
): TwilioRequestDescriptor {
  return {
    method: 'POST',
    url: `${twilioNumbersBase(config)}/Bundles/${bundleSid}/ItemAssignments`,
    headers: authHeaders(config, true),
    body: formBody({ ObjectSid: objectSid }),
  };
}

export function buildBundleSubmitRequest(
  config: RestConfig,
  bundleSid: string,
): TwilioRequestDescriptor {
  return {
    method: 'POST',
    url: `${twilioNumbersBase(config)}/Bundles/${bundleSid}`,
    headers: authHeaders(config, true),
    body: formBody({ Status: 'pending-review' }),
  };
}

export function buildBundleGetRequest(
  config: RestConfig,
  bundleSid: string,
): TwilioRequestDescriptor {
  return {
    method: 'GET',
    url: `${twilioNumbersBase(config)}/Bundles/${bundleSid}`,
    headers: authHeaders(config, false),
  };
}

// ---- IncomingPhoneNumbers (provisionNumber / releaseNumber / getProvisioningStatus) ----

export function buildIncomingPhoneNumberCreateRequest(
  config: RestConfig,
  p: { e164: E164; bundleRef: string; webhookBaseUrl: string },
): TwilioRequestDescriptor {
  return {
    method: 'POST',
    url: `${twilioApiBase(config)}/Accounts/${config.accountSid}/IncomingPhoneNumbers.json`,
    headers: authHeaders(config, true),
    body: formBody({
      PhoneNumber: p.e164,
      BundleSid: p.bundleRef,
      VoiceUrl: p.webhookBaseUrl,
      VoiceMethod: 'POST',
      StatusCallback: p.webhookBaseUrl,
      StatusCallbackMethod: 'POST',
    }),
  };
}

export function buildIncomingPhoneNumberGetRequest(
  config: RestConfig,
  numberSid: string,
): TwilioRequestDescriptor {
  return {
    method: 'GET',
    url: `${twilioApiBase(config)}/Accounts/${config.accountSid}/IncomingPhoneNumbers/${numberSid}.json`,
    headers: authHeaders(config, false),
  };
}

export function buildIncomingPhoneNumberDeleteRequest(
  config: RestConfig,
  numberSid: string,
): TwilioRequestDescriptor {
  return {
    method: 'DELETE',
    url: `${twilioApiBase(config)}/Accounts/${config.accountSid}/IncomingPhoneNumbers/${numberSid}.json`,
    headers: authHeaders(config, false),
  };
}

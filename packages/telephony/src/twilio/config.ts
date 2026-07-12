/**
 * Twilio provider configuration shape. Values are supplied by the composition point
 * (`apps/api/src/deps.ts`, wired behind `TELEPHONY_PROVIDER=twilio` — outside this
 * milestone's scope) from `env.ts`. Nothing in this package reads environment
 * variables or ships a credential — the constructor is the only way in.
 *
 * docs/design.md §2 (env.ts table): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
 * `TWILIO_REGION` (default `ie1`, ER-RES-3), `APP_BASE_URL`.
 */
export interface TwilioProviderConfig {
  /** Twilio Account SID. */
  readonly accountSid: string;
  /** Twilio Auth Token — used for X-Twilio-Signature verification and REST Basic auth. */
  readonly authToken: string;
  /**
   * Twilio Region (ER-RES-3). Only `ie1` is modelled: it is the only region the go-live
   * gate (docs/runbook.md) permits, so there is no owner-facing reason to support others.
   */
  readonly region: 'ie1';
  /**
   * Absolute base URL of the deployed app (`APP_BASE_URL`) — used to build the static
   * asset URLs referenced from TwiML `<Play>` (refusal tone, DTMF prompt beep).
   */
  readonly appBaseUrl: string;
  /**
   * E.164 number Twilio sends SMS-PIN / notification messages from. Deliberately
   * separate from any org's business number: verification can run before a business
   * number exists (docs/design.md §6 onboarding order lists "verify personal number"
   * before "pick business number"). Owner-supplied at wiring, alongside the account
   * credentials above.
   */
  readonly smsFrom: string;
  /**
   * Injectable fetch implementation. Defaults to `globalThis.fetch`. Tests inject a
   * stub so this package performs zero live network calls (M9 scope).
   */
  readonly fetchImpl?: typeof fetch;
}

/** REST API host for the 2010-04-01 Voice/Messaging/Numbers resources, IE1 region. */
export function twilioApiBase(config: Pick<TwilioProviderConfig, 'region'>): string {
  return `https://api.${config.region}.twilio.com/2010-04-01`;
}

/**
 * Host for the v2 Regulatory Compliance resources (Bundles/EndUsers/SupportingDocuments/
 * Regulations). ASSUMPTION (flagged in the M9 report): Twilio's region-pinning convention
 * (`<service>.<region>.twilio.com`) is documented for the voice/messaging `api` host; this
 * package applies the same convention to `numbers.twilio.com` for IE1 data residency. Spot
 * check against Twilio's current regional API docs at wiring time.
 */
export function twilioNumbersBase(config: Pick<TwilioProviderConfig, 'region'>): string {
  return `https://numbers.${config.region}.twilio.com/v2/RegulatoryCompliance`;
}

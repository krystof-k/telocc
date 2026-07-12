import type { RawWebhookRequest } from '../../types.ts';
import { computeTwilioSignature } from '../signature.ts';

/**
 * CONSTRUCTED TEST FIXTURES — not recordings of live Twilio traffic. Field names and
 * value shapes are transcribed from Twilio's publicly documented webhook payloads
 * (Voice request parameters, Dial `<Number>` status callback, Messaging status callback,
 * Regulatory Bundle status callback). Spot-check against a real Twilio account at wiring
 * time — see the M9 report's "Twilio doc assumptions" list.
 */

export const FIXTURE_ACCOUNT_SID = 'AC0000000000000000000000000000fx';
export const FIXTURE_AUTH_TOKEN = 'fixture_auth_token_never_a_real_secret';
export const WEBHOOK_URL = 'https://app.telocc.example/webhooks/telephony/twilio';
export const GATHER_WEBHOOK_URL = `${WEBHOOK_URL}?p=gather`;

/** Turns a plain Twilio-shaped form field record into a `RawWebhookRequest`. */
export async function toRawWebhookRequest(opts: {
  form: Record<string, string>;
  url?: string;
  method?: string;
  sign?: boolean;
  authToken?: string;
}): Promise<RawWebhookRequest> {
  const url = opts.url ?? WEBHOOK_URL;
  const method = opts.method ?? 'POST';
  const rawBody = new URLSearchParams(opts.form).toString();
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (opts.sign !== false) {
    headers['X-Twilio-Signature'] = await computeTwilioSignature(
      opts.authToken ?? FIXTURE_AUTH_TOKEN,
      url,
      method.toUpperCase() === 'GET' ? {} : opts.form,
    );
  }
  return { method, url, headers, rawBody };
}

// ---- Initial voice webhook (call.incoming) ----

const INCOMING_CALL_SID = 'CAincoming000000000000000000000001';

export const incomingCallForm: Record<string, string> = {
  CallSid: INCOMING_CALL_SID,
  AccountSid: FIXTURE_ACCOUNT_SID,
  From: '+420777123456',
  To: '+420212345678',
  CallStatus: 'ringing',
  Direction: 'inbound',
  ApiVersion: '2010-04-01',
};

export const incomingCallAnonymousForm: Record<string, string> = {
  ...incomingCallForm,
  CallSid: 'CAincoming000000000000000000000002',
  From: 'anonymous',
};

// ---- Gather (DTMF) action callback (call.dtmf) ----

export const gatherDigitsForm: Record<string, string> = {
  CallSid: INCOMING_CALL_SID,
  AccountSid: FIXTURE_ACCOUNT_SID,
  From: '+420777123456',
  To: '+420212345678',
  CallStatus: 'in-progress',
  Digits: '00420700123456',
};

export const gatherTimeoutForm: Record<string, string> = {
  CallSid: INCOMING_CALL_SID,
  AccountSid: FIXTURE_ACCOUNT_SID,
  From: '+420777123456',
  To: '+420212345678',
  CallStatus: 'in-progress',
  Digits: '',
};

// ---- Child-leg status callback (statusCallbackEvent="answered completed" on <Number>) ----

const parentCallSid = 'CAparent0000000000000000000000001';

export const childLegAnsweredForm: Record<string, string> = {
  CallSid: 'CAchild00000000000000000000000001',
  ParentCallSid: parentCallSid,
  AccountSid: FIXTURE_ACCOUNT_SID,
  CallStatus: 'in-progress',
  From: '+420212345678',
  To: '+420777123456',
};

export const childLegCompletedNormallyForm: Record<string, string> = {
  ...childLegAnsweredForm,
  CallStatus: 'completed',
  CallDuration: '42',
};

export const childLegBusyForm: Record<string, string> = {
  ...childLegAnsweredForm,
  CallStatus: 'busy',
};

export const childLegNoAnswerForm: Record<string, string> = {
  ...childLegAnsweredForm,
  CallStatus: 'no-answer',
};

export const childLegFailedForm: Record<string, string> = {
  ...childLegAnsweredForm,
  CallStatus: 'failed',
  ErrorCode: '32011',
};

export const childLegCanceledForm: Record<string, string> = {
  ...childLegAnsweredForm,
  CallStatus: 'canceled',
};

// ---- Dial action callback (redundant belt) ----

export const dialActionCompletedForm: Record<string, string> = {
  CallSid: parentCallSid,
  AccountSid: FIXTURE_ACCOUNT_SID,
  CallStatus: 'in-progress',
  DialCallStatus: 'completed',
  DialCallSid: 'CAchild00000000000000000000000001',
  DialCallDuration: '42',
};

export const dialActionNoAnswerForm: Record<string, string> = {
  ...dialActionCompletedForm,
  DialCallStatus: 'no-answer',
  DialCallDuration: '0',
};

// ---- Parent status callback (final) — call.completed ----

export const parentCompletedForm: Record<string, string> = {
  CallSid: parentCallSid,
  AccountSid: FIXTURE_ACCOUNT_SID,
  CallStatus: 'completed',
  CallDuration: '42',
  From: '+420777123456',
  To: '+420212345678',
};

export const parentBusyForm: Record<string, string> = {
  ...parentCompletedForm,
  CallStatus: 'busy',
  CallDuration: '0',
};

export const parentFailedForm: Record<string, string> = {
  ...parentCompletedForm,
  CallStatus: 'failed',
  CallDuration: '0',
  ErrorCode: '32011',
};

// ---- Messages status callback (sms.status) ----

export const smsSentForm: Record<string, string> = {
  MessageSid: 'SMfixture000000000000000000000001',
  AccountSid: FIXTURE_ACCOUNT_SID,
  MessageStatus: 'sent',
  To: '+420777123456',
  From: '+420212345678',
};

export const smsDeliveredForm: Record<string, string> = {
  ...smsSentForm,
  MessageStatus: 'delivered',
};

export const smsFailedForm: Record<string, string> = {
  ...smsSentForm,
  MessageStatus: 'failed',
};

// ---- Regulatory Bundle status callback (provisioning.update) ----

export const bundleSubmittedForm: Record<string, string> = {
  BundleSid: 'BUfixture000000000000000000000001',
  AccountSid: FIXTURE_ACCOUNT_SID,
  Status: 'in-review',
  FriendlyName: 'Demo s.r.o. — CZ regulatory bundle',
};

export const bundleApprovedForm: Record<string, string> = {
  ...bundleSubmittedForm,
  Status: 'twilio-approved',
};

export const bundleRejectedForm: Record<string, string> = {
  ...bundleSubmittedForm,
  Status: 'twilio-rejected',
  RejectionReason: 'Address does not match supporting document',
};

// ---- Unknown / late callRef shapes — parseWebhook has no session knowledge, so these
//      still parse to ordinary neutral events; late/unknown-ref handling (decisions.md
//      #30) is core routing's concern, not this package's. ----

export const lateChildLegForm: Record<string, string> = {
  ...childLegAnsweredForm,
  CallSid: 'CAchild00000000000000000000000099',
  ParentCallSid: 'CAparent0000000000000000000000099', // no session ever existed for this ref
  CallStatus: 'busy',
};

export const unknownIncomingCallForm: Record<string, string> = {
  ...incomingCallForm,
  CallSid: 'CAincoming000000000000000000099999',
};

// ---- Malformed shapes (→ MalformedWebhookError) ----

export const missingCallSidForm: Record<string, string> = {
  AccountSid: FIXTURE_ACCOUNT_SID,
  CallStatus: 'ringing',
};

export const unrecognizedCallStatusForm: Record<string, string> = {
  CallSid: 'CAweird0000000000000000000000001',
  CallStatus: 'some-future-status-twilio-invents',
};

export const invalidToForm: Record<string, string> = {
  CallSid: 'CAincoming000000000000000000000003',
  CallStatus: 'ringing',
  From: '+420777123456',
  To: 'not-a-real-number',
};

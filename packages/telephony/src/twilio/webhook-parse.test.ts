import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MalformedWebhookError } from '../types.ts';
import {
  bundleApprovedForm,
  bundleRejectedForm,
  bundleSubmittedForm,
  childLegAnsweredForm,
  childLegBusyForm,
  childLegCanceledForm,
  childLegCompletedNormallyForm,
  childLegFailedForm,
  childLegNoAnswerForm,
  dialActionCompletedForm,
  dialActionNoAnswerForm,
  GATHER_WEBHOOK_URL,
  gatherDigitsForm,
  gatherTimeoutForm,
  incomingCallAnonymousForm,
  incomingCallForm,
  invalidToForm,
  lateChildLegForm,
  missingCallSidForm,
  parentBusyForm,
  parentCompletedForm,
  parentFailedForm,
  smsDeliveredForm,
  smsFailedForm,
  smsSentForm,
  toRawWebhookRequest,
  unknownIncomingCallForm,
  unrecognizedCallStatusForm,
} from './fixtures/webhooks.ts';
import { parseTwilioWebhook } from './webhook-parse.ts';

const FIXED_NOW = new Date('2026-07-12T10:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('parseTwilioWebhook — call.incoming', () => {
  it('parses the initial voice webhook', async () => {
    const req = await toRawWebhookRequest({ form: incomingCallForm, sign: false });
    expect(parseTwilioWebhook(req)).toEqual({
      type: 'call.incoming',
      callRef: incomingCallForm.CallSid,
      to: '+420212345678',
      from: '+420777123456',
      at: FIXED_NOW,
    });
  });

  it('maps an unparseable From (e.g. anonymous) to null rather than throwing', async () => {
    const req = await toRawWebhookRequest({ form: incomingCallAnonymousForm, sign: false });
    const event = parseTwilioWebhook(req);
    expect(event).toMatchObject({ type: 'call.incoming', from: null });
  });

  it('parses an incoming call fixture with a CallSid unrelated to any known session (no lookup here)', async () => {
    const req = await toRawWebhookRequest({ form: unknownIncomingCallForm, sign: false });
    expect(parseTwilioWebhook(req)).toMatchObject({
      type: 'call.incoming',
      callRef: unknownIncomingCallForm.CallSid,
    });
  });
});

describe('parseTwilioWebhook — call.dtmf', () => {
  it('parses a Gather result with digits', async () => {
    const req = await toRawWebhookRequest({
      form: gatherDigitsForm,
      url: GATHER_WEBHOOK_URL,
      sign: false,
    });
    expect(parseTwilioWebhook(req)).toEqual({
      type: 'call.dtmf',
      callRef: gatherDigitsForm.CallSid,
      digits: gatherDigitsForm.Digits,
      at: FIXED_NOW,
    });
  });

  it('parses a Gather timeout (empty Digits) as digits: ""', async () => {
    const req = await toRawWebhookRequest({
      form: gatherTimeoutForm,
      url: GATHER_WEBHOOK_URL,
      sign: false,
    });
    expect(parseTwilioWebhook(req)).toEqual({
      type: 'call.dtmf',
      callRef: gatherTimeoutForm.CallSid,
      digits: '',
      at: FIXED_NOW,
    });
  });

  it('treats a request missing the Digits field entirely (still ?p=gather) as a timeout', async () => {
    const { Digits: _drop, ...withoutDigits } = gatherTimeoutForm;
    const req = await toRawWebhookRequest({
      form: withoutDigits,
      url: GATHER_WEBHOOK_URL,
      sign: false,
    });
    expect(parseTwilioWebhook(req)).toMatchObject({ type: 'call.dtmf', digits: '' });
  });
});

describe('parseTwilioWebhook — call.leg (child-leg status callback)', () => {
  it('maps in-progress to answered, resolved via ParentCallSid', async () => {
    const req = await toRawWebhookRequest({ form: childLegAnsweredForm, sign: false });
    expect(parseTwilioWebhook(req)).toEqual({
      type: 'call.leg',
      callRef: childLegAnsweredForm.ParentCallSid,
      legStatus: 'answered',
      errorCode: undefined,
      at: FIXED_NOW,
    });
  });

  it('maps a normal completed child leg to answered (idempotent re-affirmation)', async () => {
    const req = await toRawWebhookRequest({ form: childLegCompletedNormallyForm, sign: false });
    expect(parseTwilioWebhook(req)).toMatchObject({ type: 'call.leg', legStatus: 'answered' });
  });

  it('maps busy', async () => {
    const req = await toRawWebhookRequest({ form: childLegBusyForm, sign: false });
    expect(parseTwilioWebhook(req)).toMatchObject({ type: 'call.leg', legStatus: 'busy' });
  });

  it('maps no-answer to no_answer', async () => {
    const req = await toRawWebhookRequest({ form: childLegNoAnswerForm, sign: false });
    expect(parseTwilioWebhook(req)).toMatchObject({ type: 'call.leg', legStatus: 'no_answer' });
  });

  it('maps failed and carries the ErrorCode', async () => {
    const req = await toRawWebhookRequest({ form: childLegFailedForm, sign: false });
    expect(parseTwilioWebhook(req)).toEqual({
      type: 'call.leg',
      callRef: childLegFailedForm.ParentCallSid,
      legStatus: 'failed',
      errorCode: childLegFailedForm.ErrorCode,
      at: FIXED_NOW,
    });
  });

  it('maps canceled to no_answer (documented assumption)', async () => {
    const req = await toRawWebhookRequest({ form: childLegCanceledForm, sign: false });
    expect(parseTwilioWebhook(req)).toMatchObject({ type: 'call.leg', legStatus: 'no_answer' });
  });

  it('parses a late/unknown callRef fixture (no session ever existed) without throwing', async () => {
    const req = await toRawWebhookRequest({ form: lateChildLegForm, sign: false });
    expect(parseTwilioWebhook(req)).toMatchObject({
      type: 'call.leg',
      callRef: lateChildLegForm.ParentCallSid,
      legStatus: 'busy',
    });
  });
});

describe('parseTwilioWebhook — call.leg (Dial action callback, redundant belt)', () => {
  it('maps DialCallStatus completed to answered, keyed by the parent CallSid', async () => {
    const req = await toRawWebhookRequest({ form: dialActionCompletedForm, sign: false });
    expect(parseTwilioWebhook(req)).toMatchObject({
      type: 'call.leg',
      callRef: dialActionCompletedForm.CallSid,
      legStatus: 'answered',
    });
  });

  it('maps DialCallStatus no-answer', async () => {
    const req = await toRawWebhookRequest({ form: dialActionNoAnswerForm, sign: false });
    expect(parseTwilioWebhook(req)).toMatchObject({ type: 'call.leg', legStatus: 'no_answer' });
  });
});

describe('parseTwilioWebhook — call.completed (parent status callback)', () => {
  it('parses a completed call with duration', async () => {
    const req = await toRawWebhookRequest({ form: parentCompletedForm, sign: false });
    expect(parseTwilioWebhook(req)).toEqual({
      type: 'call.completed',
      callRef: parentCompletedForm.CallSid,
      durationSeconds: 42,
      errorCode: undefined,
      at: FIXED_NOW,
    });
  });

  it('parses busy/no-answer/failed/canceled as call.completed with duration 0', async () => {
    const req = await toRawWebhookRequest({ form: parentBusyForm, sign: false });
    expect(parseTwilioWebhook(req)).toMatchObject({ type: 'call.completed', durationSeconds: 0 });
  });

  it('carries the ErrorCode through for a failed call', async () => {
    const req = await toRawWebhookRequest({ form: parentFailedForm, sign: false });
    expect(parseTwilioWebhook(req)).toMatchObject({
      type: 'call.completed',
      errorCode: parentFailedForm.ErrorCode,
    });
  });
});

describe('parseTwilioWebhook — sms.status', () => {
  it.each([
    [smsSentForm, 'sent'],
    [smsDeliveredForm, 'delivered'],
    [smsFailedForm, 'failed'],
  ] as const)('maps MessageStatus %o to %s', async (form, expected) => {
    const req = await toRawWebhookRequest({ form, sign: false });
    expect(parseTwilioWebhook(req)).toEqual({
      type: 'sms.status',
      messageRef: form.MessageSid,
      status: expected,
      at: FIXED_NOW,
    });
  });
});

describe('parseTwilioWebhook — provisioning.update', () => {
  it('maps in-review to submitted', async () => {
    const req = await toRawWebhookRequest({ form: bundleSubmittedForm, sign: false });
    expect(parseTwilioWebhook(req)).toEqual({
      type: 'provisioning.update',
      bundleRef: bundleSubmittedForm.BundleSid,
      status: 'submitted',
      reason: undefined,
      at: FIXED_NOW,
    });
  });

  it('maps twilio-approved to approved', async () => {
    const req = await toRawWebhookRequest({ form: bundleApprovedForm, sign: false });
    expect(parseTwilioWebhook(req)).toMatchObject({
      type: 'provisioning.update',
      status: 'approved',
    });
  });

  it('maps twilio-rejected to rejected and carries the reason', async () => {
    const req = await toRawWebhookRequest({ form: bundleRejectedForm, sign: false });
    expect(parseTwilioWebhook(req)).toEqual({
      type: 'provisioning.update',
      bundleRef: bundleRejectedForm.BundleSid,
      status: 'rejected',
      reason: bundleRejectedForm.RejectionReason,
      at: FIXED_NOW,
    });
  });
});

describe('parseTwilioWebhook — malformed payloads', () => {
  it('throws MalformedWebhookError when CallSid is missing entirely', async () => {
    const req = await toRawWebhookRequest({ form: missingCallSidForm, sign: false });
    expect(() => parseTwilioWebhook(req)).toThrow(MalformedWebhookError);
  });

  it('throws MalformedWebhookError for an unrecognized CallStatus', async () => {
    const req = await toRawWebhookRequest({ form: unrecognizedCallStatusForm, sign: false });
    expect(() => parseTwilioWebhook(req)).toThrow(MalformedWebhookError);
  });

  it('throws MalformedWebhookError when To is not a valid E.164 on an incoming call', async () => {
    const req = await toRawWebhookRequest({ form: invalidToForm, sign: false });
    expect(() => parseTwilioWebhook(req)).toThrow(MalformedWebhookError);
  });
});

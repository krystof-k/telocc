import {
  type E164,
  MalformedWebhookError,
  parseE164,
  type RawWebhookRequest,
  type TelephonyEvent,
} from '../types.ts';

/**
 * Twilio form-payload → neutral event (docs/design.md §4.4 "Event payloads" row;
 * decisions.md #25/#26/#30). Every branch's field-name assumptions are documented inline
 * and repeated in the M9 report for spot-check at wiring time.
 *
 * Dispatch order (each check is a Twilio-native, self-describing discriminator — not a
 * home-grown marker — except the Gather result, see twiml.ts's `gatherActionUrl` comment):
 *   1. BundleSid, no CallSid       → Regulatory Bundle status callback → provisioning.update
 *   2. MessageSid, no CallSid      → Messages status callback          → sms.status
 *   3. `?p=gather` query marker    → Gather action callback            → call.dtmf
 *   4. ParentCallSid present       → child-leg status callback         → call.leg
 *   5. DialCallStatus present      → Dial action callback (redundant)  → call.leg
 *   6. CallStatus terminal         → parent status callback            → call.completed
 *   7. CallStatus ringing/queued   → initial voice webhook             → call.incoming
 */

function parseFormParams(rawBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!rawBody) return out;
  for (const [key, value] of new URLSearchParams(rawBody).entries()) {
    out[key] = value;
  }
  return out;
}

function requireField(value: string | undefined, name: string): string {
  if (!value) throw new MalformedWebhookError(`missing required field: ${name}`);
  return value;
}

function toE164OrNull(value: string | undefined): E164 | null {
  if (!value) return null;
  return parseE164(value);
}

function requireE164(value: string | undefined, name: string): E164 {
  const e164 = toE164OrNull(value);
  if (!e164) throw new MalformedWebhookError(`missing/invalid E.164 field: ${name}`);
  return e164;
}

const TERMINAL_CALL_STATUSES = new Set(['completed', 'busy', 'no-answer', 'failed', 'canceled']);

type LegStatus = 'answered' | 'busy' | 'no_answer' | 'failed';

/**
 * Maps a Twilio child-leg / Dial-action `CallStatus`/`DialCallStatus` value onto the
 * neutral leg-status union (types.ts has no fifth "ended normally" value).
 */
function mapLegStatus(callStatus: string): LegStatus {
  switch (callStatus) {
    case 'in-progress':
      return 'answered';
    case 'completed':
      // Leg connected and ended normally. `answered` was already recorded at pickup;
      // `call.completed` (the parent status callback) is the sole finalizer for the
      // session (decisions.md #26), so re-affirming `answered` here is a harmless,
      // idempotent no-op rather than inventing a status the frozen union doesn't have.
      return 'answered';
    case 'busy':
      return 'busy';
    case 'no-answer':
      return 'no_answer';
    case 'canceled':
      // Caller/parent hung up before this leg was answered. ASSUMPTION flagged in the M9
      // report: the nearest neutral bucket is `no_answer`; design.md §5.0's "no
      // dialled-leg outcome (caller hung up first)" branch would instead want *no*
      // call.leg event at all for this case, which the frozen parseWebhook signature
      // (must return exactly one TelephonyEvent, never void) does not allow expressing
      // from this package. Worth a second look when M5/M6 wire real routing against it.
      return 'no_answer';
    case 'failed':
      return 'failed';
    default:
      throw new MalformedWebhookError(`unexpected CallStatus for leg callback: ${callStatus}`);
  }
}

function mapBundleStatus(status: string): 'submitted' | 'approved' | 'rejected' | 'active' {
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
      throw new MalformedWebhookError(`unrecognized Bundle Status: ${status}`);
  }
}

function mapMessageStatus(status: string): 'sent' | 'delivered' | 'failed' {
  switch (status) {
    case 'accepted':
    case 'queued':
    case 'sending':
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'undelivered':
    case 'failed':
      return 'failed';
    default:
      throw new MalformedWebhookError(`unrecognized MessageStatus: ${status}`);
  }
}

export function parseTwilioWebhook(req: RawWebhookRequest): TelephonyEvent {
  const at = new Date();
  const query = new URL(req.url).searchParams;
  const form = req.method.toUpperCase() === 'GET' ? {} : parseFormParams(req.rawBody);

  // 1. Regulatory Bundle status callback.
  if (form.BundleSid && !form.CallSid) {
    return {
      type: 'provisioning.update',
      bundleRef: form.BundleSid,
      status: mapBundleStatus(requireField(form.Status, 'Status')),
      reason: form.RejectionReason || undefined,
      at,
    };
  }

  // 2. Messages status callback.
  if (form.MessageSid && !form.CallSid) {
    return {
      type: 'sms.status',
      messageRef: form.MessageSid,
      status: mapMessageStatus(requireField(form.MessageStatus, 'MessageStatus')),
      at,
    };
  }

  const callSid = requireField(form.CallSid, 'CallSid');

  // 3. Gather (DTMF) result — this package's own action-URL marker (twiml.ts).
  if (query.get('p') === 'gather') {
    return { type: 'call.dtmf', callRef: callSid, digits: form.Digits ?? '', at };
  }

  // 4. Child-leg status callback — resolved to the session via ParentCallSid
  //    (decisions.md #25: the answered-signal of record).
  if (form.ParentCallSid) {
    return {
      type: 'call.leg',
      callRef: form.ParentCallSid,
      legStatus: mapLegStatus(requireField(form.CallStatus, 'CallStatus')),
      errorCode: form.ErrorCode || undefined,
      at,
    };
  }

  // 5. Dial action callback — redundant belt; not requested if the caller hangs up
  //    before the child leg resolves (design.md §4.4).
  if (form.DialCallStatus) {
    return {
      type: 'call.leg',
      callRef: callSid,
      legStatus: mapLegStatus(form.DialCallStatus),
      errorCode: form.ErrorCode || undefined,
      at,
    };
  }

  const callStatus = requireField(form.CallStatus, 'CallStatus');

  // 6. Parent status callback (final).
  if (TERMINAL_CALL_STATUSES.has(callStatus)) {
    return {
      type: 'call.completed',
      callRef: callSid,
      durationSeconds: Number(form.CallDuration ?? '0'),
      errorCode: form.ErrorCode || undefined,
      at,
    };
  }

  // 7. Initial voice webhook.
  if (callStatus === 'ringing' || callStatus === 'queued') {
    return {
      type: 'call.incoming',
      callRef: callSid,
      to: requireE164(form.To, 'To'),
      from: toE164OrNull(form.From),
      at,
    };
  }

  throw new MalformedWebhookError(`unrecognized CallStatus: ${callStatus}`);
}

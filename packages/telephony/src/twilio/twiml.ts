import type { CallInstruction, ProviderHttpResponse, RenderContext } from '../types.ts';
import type { TwilioProviderConfig } from './config.ts';

/**
 * Instruction → TwiML rendering (docs/design.md §4.4 "Mock vs Twilio per concern" table).
 * Every branch below is a literal transcription of that table's Twilio column.
 */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlResponse(body: string): ProviderHttpResponse {
  return {
    status: 200,
    contentType: 'text/xml; charset=utf-8',
    body: `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,
  };
}

/**
 * Gather is the one action URL this package tags with its own query marker: an initial
 * incoming-call webhook and a Gather result callback can otherwise carry an identical
 * field set (CallSid/To/From/CallStatus) depending on exactly which Twilio fields are
 * present on a given account/edge, so parseWebhook needs an unambiguous, self-controlled
 * signal rather than relying on `Digits` presence (Twilio's behaviour on a no-input
 * timeout is not itself pinned by design.md). Every other callback in this adapter is
 * disambiguated by Twilio's own payload shape (ParentCallSid, DialCallStatus, BundleSid,
 * MessageSid) instead of a home-grown marker.
 */
function gatherActionUrl(ctx: RenderContext): string {
  const url = new URL(ctx.webhookBaseUrl);
  url.searchParams.set('p', 'gather');
  return url.toString();
}

export function renderTwilioInstruction(
  instruction: CallInstruction,
  ctx: RenderContext,
  config: Pick<TwilioProviderConfig, 'appBaseUrl'>,
): ProviderHttpResponse {
  switch (instruction.kind) {
    case 'reject':
      // Declines at the signalling level without answering — the number stays
      // routed/callable (ER-CLI-2(b), decisions.md #20).
      return xmlResponse('<Reject reason="busy"/>');

    case 'hangup':
      return xmlResponse('<Hangup/>');

    case 'refuseTone': {
      // SIT-style cadence, announcement-free (ER-EMG-1, decisions.md #14).
      const src = escapeXml(`${config.appBaseUrl}/assets/refusal-tone.wav`);
      return xmlResponse(`<Play>${src}</Play><Hangup/>`);
    }

    case 'forward': {
      // callerId is always the business number (ER-CLI-2(a)) — never arbitrary CLI (ER-CLI-3).
      const callerId = escapeXml(instruction.callerId.e164);
      const action = escapeXml(ctx.webhookBaseUrl);
      const to = escapeXml(instruction.to);
      const timeout = String(instruction.timeoutSeconds);
      return xmlResponse(
        `<Dial callerId="${callerId}" timeout="${timeout}" action="${action}">` +
          `<Number statusCallback="${action}" statusCallbackEvent="answered completed">${to}</Number>` +
          '</Dial>',
      );
    }

    case 'bridge': {
      const callerId = escapeXml(instruction.callerId.e164);
      const action = escapeXml(ctx.webhookBaseUrl);
      const target = escapeXml(instruction.target);
      const timeout = String(instruction.timeoutSeconds);
      const timeLimit =
        instruction.maxDurationSeconds !== undefined
          ? ` timeLimit="${instruction.maxDurationSeconds}"`
          : '';
      // Twilio's Dial semantics give both-legs-drop for free: caller hangup kills the
      // child leg; callee hangup ends Dial and the trailing <Hangup/> drops the caller
      // (decisions.md #12, design.md §4.4 "bridge" row).
      return xmlResponse(
        `<Dial callerId="${callerId}" timeout="${timeout}"${timeLimit} action="${action}">` +
          `<Number statusCallback="${action}" statusCallbackEvent="answered completed">${target}</Number>` +
          '</Dial><Hangup/>',
      );
    }

    case 'collectDigits': {
      const play =
        instruction.prompt === 'beep'
          ? `<Play>${escapeXml(`${config.appBaseUrl}/assets/dtmf-beep.wav`)}</Play>`
          : '';
      const action = escapeXml(gatherActionUrl(ctx));
      const numDigits = String(instruction.maxDigits);
      const timeout = String(instruction.timeoutSeconds);
      return xmlResponse(
        `${play}<Gather input="dtmf" numDigits="${numDigits}" finishOnKey="${instruction.finishKey}" ` +
          `timeout="${timeout}" action="${action}"/>`,
      );
    }
  }
}

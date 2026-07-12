import { describe, expect, it } from 'vitest';
import type { E164, RenderContext } from '../types.ts';
import { presentedCli } from '../types.ts';
import { renderTwilioInstruction } from './twiml.ts';

const ctx: RenderContext = {
  webhookBaseUrl: 'https://app.telocc.example/webhooks/telephony/twilio',
  callRef: 'CAsomecall00000000000000000000001',
};

const config = { appBaseUrl: 'https://app.telocc.example' };

const businessCli = presentedCli({ id: 'bn_1', e164: '+420212345678', status: 'active' });

describe('renderTwilioInstruction', () => {
  it('renders reject/busy as a signalling-level <Reject>', () => {
    const res = renderTwilioInstruction({ kind: 'reject', cause: 'busy' }, ctx, config);
    expect(res).toEqual({
      status: 200,
      contentType: 'text/xml; charset=utf-8',
      body: '<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="busy"/></Response>',
    });
  });

  it('renders hangup as a bare <Hangup/>', () => {
    const res = renderTwilioInstruction({ kind: 'hangup' }, ctx, config);
    expect(res.body).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  });

  it('renders refuseTone as <Play> of the refusal-tone asset then <Hangup/>', () => {
    const res = renderTwilioInstruction({ kind: 'refuseTone' }, ctx, config);
    expect(res.body).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response>' +
        '<Play>https://app.telocc.example/assets/refusal-tone.wav</Play><Hangup/></Response>',
    );
  });

  it('renders forward as a Dial with business callerId and a child-leg status callback', () => {
    const res = renderTwilioInstruction(
      {
        kind: 'forward',
        to: '+420777123456' as E164,
        callerId: businessCli,
        timeoutSeconds: 120,
      },
      ctx,
      config,
    );
    expect(res.body).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response>' +
        '<Dial callerId="+420212345678" timeout="120" action="https://app.telocc.example/webhooks/telephony/twilio">' +
        '<Number statusCallback="https://app.telocc.example/webhooks/telephony/twilio" ' +
        'statusCallbackEvent="answered completed">+420777123456</Number></Dial></Response>',
    );
  });

  it('renders bridge with timeLimit when maxDurationSeconds is set, plus a trailing Hangup', () => {
    const res = renderTwilioInstruction(
      {
        kind: 'bridge',
        target: '+420700123456' as E164,
        callerId: businessCli,
        timeoutSeconds: 30,
        maxDurationSeconds: 600,
      },
      ctx,
      config,
    );
    expect(res.body).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response>' +
        '<Dial callerId="+420212345678" timeout="30" timeLimit="600" ' +
        'action="https://app.telocc.example/webhooks/telephony/twilio">' +
        '<Number statusCallback="https://app.telocc.example/webhooks/telephony/twilio" ' +
        'statusCallbackEvent="answered completed">+420700123456</Number></Dial><Hangup/></Response>',
    );
  });

  it('omits timeLimit on bridge when maxDurationSeconds is absent', () => {
    const res = renderTwilioInstruction(
      {
        kind: 'bridge',
        target: '+420700123456' as E164,
        callerId: businessCli,
        timeoutSeconds: 30,
      },
      ctx,
      config,
    );
    expect(res.body).toContain('<Dial callerId="+420212345678" timeout="30" action=');
    expect(res.body).not.toContain('timeLimit');
  });

  it('renders collectDigits with a beep prompt before the Gather, tagged with ?p=gather', () => {
    const res = renderTwilioInstruction(
      { kind: 'collectDigits', prompt: 'beep', maxDigits: 16, finishKey: '#', timeoutSeconds: 10 },
      ctx,
      config,
    );
    expect(res.body).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response>' +
        '<Play>https://app.telocc.example/assets/dtmf-beep.wav</Play>' +
        '<Gather input="dtmf" numDigits="16" finishOnKey="#" timeout="10" ' +
        'action="https://app.telocc.example/webhooks/telephony/twilio?p=gather"/></Response>',
    );
  });

  it('renders collectDigits with a silent prompt as a bare Gather (no Play)', () => {
    const res = renderTwilioInstruction(
      { kind: 'collectDigits', prompt: 'silent', maxDigits: 4, finishKey: '#', timeoutSeconds: 5 },
      ctx,
      config,
    );
    expect(res.body).not.toContain('<Play>');
    expect(res.body).toContain('<Gather input="dtmf" numDigits="4" finishOnKey="#" timeout="5"');
  });

  it('XML-escapes special characters appearing in rendered attribute/text values', () => {
    // webhookBaseUrl legitimately carries a query string once other query params exist;
    // exercise escaping through a base URL containing '&' to prove attributes are safe.
    const weirdCtx: RenderContext = {
      webhookBaseUrl: 'https://app.telocc.example/webhooks/telephony/twilio?a=1&b=2',
      callRef: ctx.callRef,
    };
    const res = renderTwilioInstruction(
      {
        kind: 'forward',
        to: '+420777123456' as E164,
        callerId: businessCli,
        timeoutSeconds: 120,
      },
      weirdCtx,
      config,
    );
    expect(res.body).toContain(
      'action="https://app.telocc.example/webhooks/telephony/twilio?a=1&amp;b=2"',
    );
    expect(res.body).not.toContain('a=1&b=2"');
  });
});

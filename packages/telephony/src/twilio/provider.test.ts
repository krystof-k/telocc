import { describe, expect, it, vi } from 'vitest';
import type { DocumentRef, E164, EndUserRecord, RenderContext } from '../types.ts';
import { MalformedWebhookError, presentedCli } from '../types.ts';
import {
  FIXTURE_AUTH_TOKEN,
  incomingCallForm,
  missingCallSidForm,
  toRawWebhookRequest,
} from './fixtures/webhooks.ts';
import { TwilioProvider } from './provider.ts';

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

function baseConfig(fetchImpl: typeof fetch) {
  return {
    accountSid: 'ACfixture000000000000000000000001',
    authToken: FIXTURE_AUTH_TOKEN,
    region: 'ie1' as const,
    appBaseUrl: 'https://app.telocc.example',
    smsFrom: '+420212345600',
    fetchImpl,
  };
}

describe('TwilioProvider — identity and capabilities', () => {
  it('reports name "twilio" and unverified/non-instant capabilities (ER-OBS-1)', () => {
    const provider = new TwilioProvider(baseConfig(vi.fn()));
    expect(provider.name).toBe('twilio');
    expect(provider.capabilities).toEqual({
      czCliDomesticTermination: 'unverified',
      instantProvisioning: false,
      supportedNumberClasses: ['geographic', 'nomadic_910', 'mobile'],
    });
  });
});

describe('TwilioProvider — webhook flow delegation', () => {
  it('verifyWebhook delegates to signature verification', async () => {
    const provider = new TwilioProvider(baseConfig(vi.fn()));
    const req = await toRawWebhookRequest({ form: incomingCallForm });
    await expect(provider.verifyWebhook(req)).resolves.toEqual({ ok: true });

    const tampered = { ...req, rawBody: `${req.rawBody}&extra=1` };
    await expect(provider.verifyWebhook(tampered)).resolves.toEqual({
      ok: false,
      reason: 'signature mismatch',
    });
  });

  it('parseWebhook delegates to the Twilio form parser and throws MalformedWebhookError on bad input', async () => {
    const provider = new TwilioProvider(baseConfig(vi.fn()));
    const req = await toRawWebhookRequest({ form: incomingCallForm, sign: false });
    expect(provider.parseWebhook(req)).toMatchObject({ type: 'call.incoming' });

    const bad = await toRawWebhookRequest({ form: missingCallSidForm, sign: false });
    expect(() => provider.parseWebhook(bad)).toThrow(MalformedWebhookError);
  });

  it('renderInstruction delegates to TwiML rendering', () => {
    const provider = new TwilioProvider(baseConfig(vi.fn()));
    const ctx: RenderContext = {
      webhookBaseUrl: 'https://app.telocc.example/webhooks/telephony/twilio',
      callRef: 'CAx',
    };
    const res = provider.renderInstruction({ kind: 'hangup' }, ctx);
    expect(res.contentType).toBe('text/xml; charset=utf-8');
    expect(res.body).toContain('<Hangup/>');
  });
});

describe('TwilioProvider — sendSms / hangupCall / deleteCallRecord (mocked fetch, zero network)', () => {
  it('sendSms POSTs to Messages.json and returns the messageRef', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ sid: 'SMabc123' }));
    const provider = new TwilioProvider(baseConfig(fetchImpl));
    const result = await provider.sendSms({ to: '+420777123456' as E164, body: 'PIN 123456' });
    expect(result).toEqual({ messageRef: 'SMabc123' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/Messages.json');
    expect(init.method).toBe('POST');
  });

  it('hangupCall POSTs Status=completed to the Calls resource', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const provider = new TwilioProvider(baseConfig(fetchImpl));
    await provider.hangupCall('CAtarget1');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/Calls/CAtarget1.json');
    expect(init.body).toBe('Status=completed');
  });

  it('deleteCallRecord issues a DELETE (ER-DSR-2 propagate-delete)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const provider = new TwilioProvider(baseConfig(fetchImpl));
    await provider.deleteCallRecord('CAtarget1');
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('DELETE');
  });

  it('surfaces a non-ok REST response as a thrown error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'nope' }, false, 401));
    const provider = new TwilioProvider(baseConfig(fetchImpl));
    await expect(provider.hangupCall('CAtarget1')).rejects.toThrow(/401/);
  });
});

describe('TwilioProvider — searchNumbers / getRequiredDocuments', () => {
  it('maps AvailablePhoneNumbers results to the neutral shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        available_phone_numbers: [
          { phone_number: '+420212345601' },
          { phone_number: '+420212345602' },
        ],
      }),
    );
    const provider = new TwilioProvider(baseConfig(fetchImpl));
    const results = await provider.searchNumbers({
      country: 'CZ',
      areaCode: '2',
      numberClass: 'geographic',
      limit: 5,
    });
    expect(results).toEqual([
      { e164: '+420212345601', numberClass: 'geographic', areaCode: '2' },
      { e164: '+420212345602', numberClass: 'geographic', areaCode: '2' },
    ]);
  });

  it('getRequiredDocuments fetches Regulations and flattens the requirement shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            requirements: {
              end_user: [{ name: 'business_information', friendly_name: 'Business info' }],
            },
          },
        ],
      }),
    );
    const provider = new TwilioProvider(baseConfig(fetchImpl));
    const docs = await provider.getRequiredDocuments({ country: 'CZ', numberClass: 'geographic' });
    expect(docs).toEqual([{ type: 'business_information', label: 'Business info' }]);
  });
});

const endUser: EndUserRecord = {
  legalName: 'Demo s.r.o.',
  ico: '12345678',
  street: 'Václavské náměstí 1',
  city: 'Praha',
  postalCode: '11000',
  country: 'CZ',
};

const document: DocumentRef = {
  type: 'business_registration',
  filename: 'extract.pdf',
  contentType: 'application/pdf',
  bytes: new Uint8Array([1, 2, 3]),
};

describe('TwilioProvider — submitBundle (multi-step, mocked fetch)', () => {
  it('walks EndUser → SupportingDocuments → Bundle → ItemAssignments → submit, never auto-approving', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ sid: 'EUsid1' })) // EndUser
      .mockResolvedValueOnce(jsonResponse({ sid: 'SDsid1' })) // SupportingDocument
      .mockResolvedValueOnce(jsonResponse({ sid: 'BUsid1' })) // Bundle create
      .mockResolvedValueOnce(jsonResponse({})) // ItemAssignment (end user)
      .mockResolvedValueOnce(jsonResponse({})) // ItemAssignment (document)
      .mockResolvedValueOnce(jsonResponse({ status: 'pending-review' })); // submit

    const provider = new TwilioProvider(baseConfig(fetchImpl));
    const result = await provider.submitBundle({ endUser, documents: [document] });

    expect(result).toEqual({ bundleRef: 'BUsid1', status: 'submitted' });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    const urls = fetchImpl.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain('/EndUsers');
    expect(urls[1]).toContain('/SupportingDocuments');
    expect(urls[2]).toContain('/Bundles');
    expect(urls[3]).toContain('/Bundles/BUsid1/ItemAssignments');
    expect(urls[4]).toContain('/Bundles/BUsid1/ItemAssignments');
    expect(urls[5]).toContain('/Bundles/BUsid1');
  });
});

describe('TwilioProvider — provisionNumber / releaseNumber / getProvisioningStatus', () => {
  it('provisionNumber purchases the number and starts pending (instantProvisioning: false)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ sid: 'PNsid1' }));
    const provider = new TwilioProvider(baseConfig(fetchImpl));
    const result = await provider.provisionNumber({
      e164: '+420212345601' as E164,
      bundleRef: 'BUsid1',
      webhookBaseUrl: 'https://app.telocc.example/webhooks/telephony/twilio',
    });
    expect(result).toEqual({ numberRef: 'PNsid1', status: 'pending' });
  });

  it('releaseNumber issues a DELETE against the number sid', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const provider = new TwilioProvider(baseConfig(fetchImpl));
    await provider.releaseNumber('PNsid1');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/IncomingPhoneNumbers/PNsid1.json');
    expect(init.method).toBe('DELETE');
  });

  it('getProvisioningStatus(bundleRef) maps bundle status fields', async () => {
    const submitted = vi.fn().mockResolvedValue(jsonResponse({ status: 'in-review' }));
    await expect(
      new TwilioProvider(baseConfig(submitted)).getProvisioningStatus({ bundleRef: 'BUsid1' }),
    ).resolves.toEqual({ status: 'submitted' });

    const approved = vi.fn().mockResolvedValue(jsonResponse({ status: 'twilio-approved' }));
    await expect(
      new TwilioProvider(baseConfig(approved)).getProvisioningStatus({ bundleRef: 'BUsid1' }),
    ).resolves.toEqual({ status: 'approved' });

    const rejected = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ status: 'twilio-rejected', rejection_reason: 'bad address' }),
      );
    await expect(
      new TwilioProvider(baseConfig(rejected)).getProvisioningStatus({ bundleRef: 'BUsid1' }),
    ).resolves.toEqual({ status: 'rejected', reason: 'bad address' });
  });

  it('getProvisioningStatus(numberRef) treats a successful GET as active', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ sid: 'PNsid1' }));
    const provider = new TwilioProvider(baseConfig(fetchImpl));
    await expect(provider.getProvisioningStatus({ numberRef: 'PNsid1' })).resolves.toEqual({
      status: 'active',
    });
  });

  it('getProvisioningStatus throws when neither ref is supplied', async () => {
    const provider = new TwilioProvider(baseConfig(vi.fn()));
    await expect(provider.getProvisioningStatus({})).rejects.toThrow(
      'getProvisioningStatus requires bundleRef or numberRef',
    );
  });
});

describe('TwilioProvider — no network access whatsoever', () => {
  it('never calls the injected fetch for pure webhook/TwiML operations', async () => {
    const fetchImpl = vi.fn();
    const provider = new TwilioProvider(baseConfig(fetchImpl));
    const req = await toRawWebhookRequest({ form: incomingCallForm });
    await provider.verifyWebhook(req);
    provider.parseWebhook(req);
    provider.renderInstruction(
      {
        kind: 'forward',
        to: '+420777123456' as E164,
        callerId: presentedCli({ id: 'bn_1', e164: '+420212345678', status: 'active' }),
        timeoutSeconds: 120,
      },
      { webhookBaseUrl: 'https://app.telocc.example/webhooks/telephony/twilio', callRef: 'CAx' },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

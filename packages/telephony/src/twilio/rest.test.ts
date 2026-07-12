import { describe, expect, it } from 'vitest';
import type { DocumentRef, E164, EndUserRecord } from '../types.ts';
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
} from './rest.ts';

const config = {
  accountSid: 'ACfixture000000000000000000000001',
  authToken: 'fixture_auth_token',
  region: 'ie1' as const,
  smsFrom: '+420212345600',
};

function expectedAuthHeader() {
  const raw = `${config.accountSid}:${config.authToken}`;
  let binary = '';
  for (const byte of new TextEncoder().encode(raw)) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

describe('buildMessagesRequest', () => {
  it('POSTs form-encoded To/From/Body to the IE1 Messages endpoint with Basic auth', () => {
    const req = buildMessagesRequest(config, {
      to: '+420777123456' as E164,
      body: 'Your PIN is 123456',
    });
    expect(req.method).toBe('POST');
    expect(req.url).toBe(
      `https://api.ie1.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
    );
    expect(req.headers.Authorization).toBe(expectedAuthHeader());
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(req.body);
    expect(body.get('To')).toBe('+420777123456');
    expect(body.get('From')).toBe(config.smsFrom);
    expect(body.get('Body')).toBe('Your PIN is 123456');
  });
});

describe('buildHangupCallRequest / buildDeleteCallRequest', () => {
  it('builds the Calls status=completed update', () => {
    const req = buildHangupCallRequest(config, 'CAtarget00000000000000000000001');
    expect(req.method).toBe('POST');
    expect(req.url).toBe(
      `https://api.ie1.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls/CAtarget00000000000000000000001.json`,
    );
    expect(new URLSearchParams(req.body).get('Status')).toBe('completed');
  });

  it('builds a DELETE for deleteCallRecord (ER-DSR-2)', () => {
    const req = buildDeleteCallRequest(config, 'CAtarget00000000000000000000001');
    expect(req.method).toBe('DELETE');
    expect(req.body).toBeUndefined();
    expect(req.headers.Authorization).toBe(expectedAuthHeader());
  });
});

describe('buildAvailableNumbersRequest', () => {
  it('builds a GET against AvailablePhoneNumbers/CZ/Local for geographic numbers', () => {
    const req = buildAvailableNumbersRequest(config, {
      areaCode: '2',
      numberClass: 'geographic',
      limit: 5,
    });
    expect(req.method).toBe('GET');
    const url = new URL(req.url);
    expect(url.pathname).toBe(
      `/2010-04-01/Accounts/${config.accountSid}/AvailablePhoneNumbers/CZ/Local.json`,
    );
    expect(url.searchParams.get('AreaCode')).toBe('2');
    expect(url.searchParams.get('PageSize')).toBe('5');
  });

  it('maps mobile to the Mobile number type', () => {
    const req = buildAvailableNumbersRequest(config, { numberClass: 'mobile', limit: 10 });
    expect(new URL(req.url).pathname).toContain('/Mobile.json');
  });

  it('maps nomadic_910 to Mobile (documented assumption — no Twilio-native nomadic type)', () => {
    const req = buildAvailableNumbersRequest(config, { numberClass: 'nomadic_910', limit: 10 });
    expect(new URL(req.url).pathname).toContain('/Mobile.json');
  });
});

describe('buildRegulationsRequest / parseRegulationsResponse', () => {
  it('builds a GET against the Regulations resource scoped to CZ + business', () => {
    const req = buildRegulationsRequest(config, { numberClass: 'geographic' });
    const url = new URL(req.url);
    expect(url.host).toBe('numbers.ie1.twilio.com');
    expect(url.pathname).toBe('/v2/RegulatoryCompliance/Regulations');
    expect(url.searchParams.get('IsoCountry')).toBe('CZ');
    expect(url.searchParams.get('EndUserType')).toBe('business');
  });

  it('flattens end_user and supporting_document requirements into {type,label} pairs', () => {
    const parsed = parseRegulationsResponse({
      results: [
        {
          requirements: {
            end_user: [{ name: 'business_information', friendly_name: 'Business information' }],
            supporting_document: [
              [{ name: 'business_registration', friendly_name: 'Business registration document' }],
            ],
          },
        },
      ],
    });
    expect(parsed).toEqual([
      { type: 'business_information', label: 'Business information' },
      { type: 'business_registration', label: 'Business registration document' },
    ]);
  });

  it('tolerates an empty/unexpected response shape', () => {
    expect(parseRegulationsResponse({})).toEqual([]);
    expect(parseRegulationsResponse(null)).toEqual([]);
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
  bytes: new Uint8Array([1, 2, 3, 4]),
};

describe('buildEndUserRequest', () => {
  it('POSTs the EndUser resource with business attributes', () => {
    const req = buildEndUserRequest(config, endUser);
    expect(req.method).toBe('POST');
    expect(new URL(req.url).host).toBe('numbers.ie1.twilio.com');
    const body = new URLSearchParams(req.body);
    expect(body.get('FriendlyName')).toBe(endUser.legalName);
    const attrs = JSON.parse(body.get('Attributes') ?? '{}');
    expect(attrs.business_identity_number).toBe(endUser.ico);
    expect(attrs.business_country).toBe('CZ');
  });
});

describe('buildSupportingDocumentRequest', () => {
  it('base64-encodes the document bytes into the form body (documented simplification)', () => {
    const req = buildSupportingDocumentRequest(
      config,
      document,
      'EUsomesid00000000000000000000001',
    );
    const body = new URLSearchParams(req.body);
    expect(body.get('FileData')).toBe(btoa(String.fromCharCode(1, 2, 3, 4)));
    expect(body.get('Type')).toBe('business_registration');
  });
});

describe('Bundle builders', () => {
  it('builds the Bundle create request scoped to CZ/business/local', () => {
    const req = buildBundleCreateRequest(config, endUser);
    const body = new URLSearchParams(req.body);
    expect(body.get('IsoCountry')).toBe('CZ');
    expect(body.get('EndUserType')).toBe('business');
  });

  it('builds an ItemAssignment POST for a given object sid', () => {
    const req = buildBundleItemAssignmentRequest(config, 'BUsid1', 'EUsid1');
    expect(req.url).toContain('/Bundles/BUsid1/ItemAssignments');
    expect(new URLSearchParams(req.body).get('ObjectSid')).toBe('EUsid1');
  });

  it('builds the submit-for-review status transition', () => {
    const req = buildBundleSubmitRequest(config, 'BUsid1');
    expect(new URLSearchParams(req.body).get('Status')).toBe('pending-review');
  });

  it('builds a GET for polling bundle status', () => {
    const req = buildBundleGetRequest(config, 'BUsid1');
    expect(req.method).toBe('GET');
    expect(req.url).toContain('/Bundles/BUsid1');
  });
});

describe('IncomingPhoneNumbers builders', () => {
  it('builds the purchase request with Voice/Status callback URLs and BundleSid', () => {
    const req = buildIncomingPhoneNumberCreateRequest(config, {
      e164: '+420212345601' as E164,
      bundleRef: 'BUsid1',
      webhookBaseUrl: 'https://app.telocc.example/webhooks/telephony/twilio',
    });
    const body = new URLSearchParams(req.body);
    expect(body.get('PhoneNumber')).toBe('+420212345601');
    expect(body.get('BundleSid')).toBe('BUsid1');
    expect(body.get('VoiceUrl')).toBe('https://app.telocc.example/webhooks/telephony/twilio');
    expect(body.get('StatusCallback')).toBe('https://app.telocc.example/webhooks/telephony/twilio');
  });

  it('builds a GET for the number resource', () => {
    const req = buildIncomingPhoneNumberGetRequest(config, 'PNsid1');
    expect(req.method).toBe('GET');
    expect(req.url).toContain('/IncomingPhoneNumbers/PNsid1.json');
  });

  it('builds a DELETE for releaseNumber', () => {
    const req = buildIncomingPhoneNumberDeleteRequest(config, 'PNsid1');
    expect(req.method).toBe('DELETE');
  });
});

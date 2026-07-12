import { describe, expect, it } from 'vitest';
import { parseE164, presentedCli } from './types.ts';

describe('parseE164', () => {
  it('accepts a well-formed E.164 number', () => {
    expect(parseE164('+420777123456')).toBe('+420777123456');
  });

  it('rejects numbers without a leading +', () => {
    expect(parseE164('420777123456')).toBeNull();
  });

  it('rejects a leading zero after the +', () => {
    expect(parseE164('+0420777123456')).toBeNull();
  });

  it('rejects non-digit characters', () => {
    expect(parseE164('+420 777 123 456')).toBeNull();
  });
});

describe('presentedCli', () => {
  it('builds a branded CLI from an active business number', () => {
    const cli = presentedCli({ id: 'bn_1', e164: '+420212345678', status: 'active' });
    expect(cli.businessNumberId).toBe('bn_1');
    expect(cli.e164).toBe('+420212345678');
  });

  it('throws for a business number with a malformed E.164 value', () => {
    expect(() => presentedCli({ id: 'bn_2', e164: 'not-a-number', status: 'active' })).toThrow();
  });
});

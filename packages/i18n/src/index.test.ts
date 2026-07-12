import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale, t } from './index.ts';

describe('t', () => {
  it('resolves a dotted-path key to its English string', () => {
    expect(t('common.appName')).toBe('Telocc');
    expect(t('calls.status.emergency_refused')).toBe('Emergency number refused');
  });

  it('throws for an unknown key at runtime', () => {
    // @ts-expect-error — deliberately not a valid MessageKey
    expect(() => t('nope.not.a.key')).toThrow();
  });
});

describe('locale', () => {
  afterEach(() => {
    setLocale('en');
  });

  it('defaults to en', () => {
    expect(getLocale()).toBe('en');
  });

  it('resolves through cs once set, for a key cs actually has', () => {
    setLocale('cs');
    expect(getLocale()).toBe('cs');
    expect(t('verification.emergencyDisclosure')).toContain('112');
    expect(t('verification.emergencyDisclosure')).not.toBe(
      'Emergency numbers (112, 150, 155, 156, 158) cannot be dialled through Telocc. Always use your personal phone directly for emergencies.',
    );
  });

  it('falls back to en for a key cs does not cover', () => {
    setLocale('cs');
    // `legal.privacyTitle` is intentionally outside cs's scope (owner/translation item).
    expect(t('legal.privacyTitle')).toBe('Privacy notice');
  });
});

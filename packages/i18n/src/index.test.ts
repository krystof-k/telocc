import { describe, expect, it } from 'vitest';
import { t } from './index.ts';

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

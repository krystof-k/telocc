import type { Db } from '../index.ts';
import { dialPolicyPrefixes } from '../schema/index.ts';

/**
 * Premium / shared-cost CZ prefix deny-list (ER-EMG-2). Emergency short codes
 * (112, 150, 155, 156, 158) are deliberately NOT here — they are hard-coded in
 * `core/dial-policy.ts` (decisions.md #11), a safety property, not configuration.
 */
export const DIAL_POLICY_PREFIXES: { prefix: string; label: string }[] = [
  { prefix: '+42090', label: 'Premium-rate (9xx)' },
  { prefix: '+42084', label: 'Shared-cost (84x)' },
  { prefix: '+42076', label: 'Extra-cost service (76x)' },
];

export async function seedDialPolicyPrefixes(db: Db): Promise<void> {
  for (const row of DIAL_POLICY_PREFIXES) {
    await db
      .insert(dialPolicyPrefixes)
      .values(row)
      .onConflictDoNothing({ target: dialPolicyPrefixes.prefix });
  }
}

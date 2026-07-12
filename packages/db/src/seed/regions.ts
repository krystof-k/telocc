import type { Db } from '../index.ts';
import { regionAreaCodes } from '../schema/index.ts';

/**
 * CZ geographic area codes (Decree 117/2007 Sb., abbreviated set). Prague is the
 * seeded/demo catalog default region (decisions.md #5). Idempotent: safe to re-run.
 */
export const REGION_AREA_CODES: { regionName: string; tcPrefix: string }[] = [
  { regionName: 'Prague', tcPrefix: '2' },
  { regionName: 'Central Bohemia', tcPrefix: '3' },
  { regionName: 'South Bohemia / South Moravia', tcPrefix: '5' },
  { regionName: 'West Bohemia', tcPrefix: '37' },
  { regionName: 'North Bohemia', tcPrefix: '4' },
  { regionName: 'East Bohemia', tcPrefix: '49' },
  { regionName: 'North Moravia', tcPrefix: '55' },
];

export async function seedRegionAreaCodes(db: Db): Promise<void> {
  for (const row of REGION_AREA_CODES) {
    await db
      .insert(regionAreaCodes)
      .values(row)
      .onConflictDoNothing({ target: regionAreaCodes.tcPrefix });
  }
}

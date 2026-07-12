import { config } from 'dotenv';
import { createNodeDb } from '../node.ts';
import { seedDialPolicyPrefixes } from './dial-policy.ts';
import { seedRegionAreaCodes } from './regions.ts';

config({ path: new URL('../../../../.env', import.meta.url).pathname });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('seed/run.ts: DATABASE_URL must be set');
}

const db = createNodeDb(databaseUrl);
await seedRegionAreaCodes(db);
await seedDialPolicyPrefixes(db);
console.log('Seeded region_area_codes and dial_policy_prefixes.');

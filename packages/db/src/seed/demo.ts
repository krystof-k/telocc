/**
 * The one-command demo seed (docs/design.md §12, docs/milestones.md M10). Creates a
 * fully-onboarded org so every simulator flow works on first run with no manual setup:
 * org **Demo s.r.o.**, owner `demo@telocc.example`, a VERIFIED personal number (PIN
 * pre-satisfied — no code to hand-enter), an approved KYC record, an ACTIVE Prague
 * business number, Mon–Fri 09:00–17:00 office hours, and a dozen historical call-log
 * rows spanning every documented terminal status (design.md §5.3) so the call log and
 * dashboard aren't empty on first look.
 *
 * Idempotent (safe to re-run, per the brief): the Better Auth `user` row for the demo
 * email is found-or-created (stable id across reseeds — an existing browser session for
 * that email survives a reseed), then any previous org owned by that user is deleted
 * (FK cascade removes every org-scoped row: membership, KYC, business number, calls,
 * office hours, sessions) and recreated fresh.
 *
 * Run directly: `pnpm --filter @telocc/db run seed:demo` (also what `scripts/demo.mjs`
 * shells out to). Not intended to be imported — mirrors `seed/run.ts`'s convention of
 * being a standalone script, not a reusable module.
 */
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import type { Db } from '../index.ts';
import { createNodeDb } from '../node.ts';
import {
  businessNumbers,
  calls,
  endUsers,
  memberships,
  officeHourRules,
  orgs,
  regulatoryBundles,
  user,
} from '../schema/index.ts';
import { seedDialPolicyPrefixes } from './dial-policy.ts';
import { seedRegionAreaCodes } from './regions.ts';

export const DEMO_OWNER_EMAIL = 'demo@telocc.example';
export const DEMO_ORG_NAME = 'Demo s.r.o.';
export const DEMO_PERSONAL_NUMBER = '+420777123456';
export const DEMO_BUSINESS_NUMBER = '+420212345678';
export const DEMO_OUTBOUND_TARGET = '+420601222333';

/** Business-capacity declaration copy version (design.md §3.2 ER-B2B-1) — kept in sync
 * with `DECLARATION_VERSION` in `apps/api/src/routes/orgs.ts` by convention; not
 * imported from there to avoid `packages/db` depending on `apps/api` (design.md §1
 * dependency direction). */
const DECLARATION_VERSION = 'v1';

function minutesAgo(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}

interface HistoricalCallSeed {
  direction: 'inbound' | 'outbound';
  status:
    | 'answered'
    | 'missed'
    | 'declined'
    | 'failed'
    | 'blocked'
    | 'emergency_refused'
    | 'destination_blocked';
  reason: string | null;
  fromE164: string | null;
  toE164: string | null;
  startedAgoMinutes: number;
  durationSeconds: number;
  providerErrorCode?: string | null;
  outbound?: boolean;
  ref: string;
}

/** Spans every terminal status in design.md §5.3 so the call log/dashboard aren't
 * empty on first look and every badge colour/status label is visible immediately. */
function buildHistoricalCalls(): HistoricalCallSeed[] {
  const CUSTOMER_A = '+420600111222';
  const CUSTOMER_B = '+420600333444';
  return [
    {
      direction: 'inbound',
      status: 'answered',
      reason: null,
      fromE164: CUSTOMER_A,
      toE164: DEMO_BUSINESS_NUMBER,
      startedAgoMinutes: 3000,
      durationSeconds: 95,
      ref: 'demo_seed_0001',
    },
    {
      direction: 'inbound',
      status: 'declined',
      reason: 'out_of_hours',
      fromE164: CUSTOMER_B,
      toE164: DEMO_BUSINESS_NUMBER,
      startedAgoMinutes: 2900,
      durationSeconds: 0,
      ref: 'demo_seed_0002',
    },
    {
      direction: 'inbound',
      status: 'answered',
      reason: null,
      fromE164: CUSTOMER_A,
      toE164: DEMO_BUSINESS_NUMBER,
      startedAgoMinutes: 1500,
      durationSeconds: 210,
      ref: 'demo_seed_0003',
    },
    {
      direction: 'inbound',
      status: 'missed',
      reason: null,
      fromE164: CUSTOMER_B,
      toE164: DEMO_BUSINESS_NUMBER,
      startedAgoMinutes: 1400,
      durationSeconds: 0,
      ref: 'demo_seed_0004',
    },
    {
      direction: 'inbound',
      status: 'failed',
      reason: null,
      fromE164: CUSTOMER_A,
      toE164: DEMO_BUSINESS_NUMBER,
      startedAgoMinutes: 1300,
      durationSeconds: 0,
      providerErrorCode: '480',
      ref: 'demo_seed_0005',
    },
    {
      direction: 'outbound',
      status: 'answered',
      reason: null,
      fromE164: DEMO_PERSONAL_NUMBER,
      toE164: DEMO_OUTBOUND_TARGET,
      startedAgoMinutes: 900,
      durationSeconds: 130,
      outbound: true,
      ref: 'demo_seed_0006',
    },
    {
      direction: 'outbound',
      status: 'missed',
      reason: null,
      fromE164: DEMO_PERSONAL_NUMBER,
      toE164: DEMO_OUTBOUND_TARGET,
      startedAgoMinutes: 800,
      durationSeconds: 0,
      outbound: true,
      ref: 'demo_seed_0007',
    },
    {
      direction: 'outbound',
      status: 'blocked',
      reason: 'rate_limited',
      fromE164: DEMO_PERSONAL_NUMBER,
      toE164: null,
      startedAgoMinutes: 700,
      durationSeconds: 0,
      outbound: true,
      ref: 'demo_seed_0008',
    },
    {
      // `toE164` is null here — matching `core/routing/dialin.ts`'s `baseLog`, which
      // never stores the raw dialled digits in this E.164-checked column (design.md
      // §5.3's "raw digits" cell describes the *record's conceptual meaning*, not this
      // literal DB column — the CHECK constraint on `calls.to_e164` would reject
      // anything that isn't a well-formed E.164 number anyway).
      direction: 'outbound',
      status: 'emergency_refused',
      reason: null,
      fromE164: DEMO_PERSONAL_NUMBER,
      toE164: null,
      startedAgoMinutes: 600,
      durationSeconds: 0,
      outbound: true,
      ref: 'demo_seed_0009',
    },
    {
      direction: 'outbound',
      status: 'destination_blocked',
      reason: 'premium',
      fromE164: DEMO_PERSONAL_NUMBER,
      toE164: null,
      startedAgoMinutes: 500,
      durationSeconds: 0,
      outbound: true,
      ref: 'demo_seed_0010',
    },
    {
      direction: 'outbound',
      status: 'destination_blocked',
      reason: 'international',
      fromE164: DEMO_PERSONAL_NUMBER,
      toE164: null,
      startedAgoMinutes: 400,
      durationSeconds: 0,
      outbound: true,
      ref: 'demo_seed_0011',
    },
    {
      direction: 'outbound',
      status: 'failed',
      reason: 'invalid_target',
      fromE164: DEMO_PERSONAL_NUMBER,
      toE164: null,
      startedAgoMinutes: 300,
      durationSeconds: 0,
      outbound: true,
      ref: 'demo_seed_0012',
    },
  ];
}

export interface SeedDemoResult {
  ownerEmail: string;
  orgName: string;
  personalNumber: string;
  businessNumber: string;
}

export async function seedDemoData(
  db: Db,
  now: () => Date = () => new Date(),
): Promise<SeedDemoResult> {
  await seedRegionAreaCodes(db);
  await seedDialPolicyPrefixes(db);

  const nowDate = now();

  // 1. Find-or-create the Better Auth user — stable id across reseeds (header comment).
  const existingUserRows = await db.select().from(user).where(eq(user.email, DEMO_OWNER_EMAIL));
  let userId = existingUserRows[0]?.id;
  if (!userId) {
    const [inserted] = await db
      .insert(user)
      .values({
        id: randomUUID(),
        name: 'Demo Owner',
        email: DEMO_OWNER_EMAIL,
        emailVerified: true,
      })
      .returning();
    if (!inserted) throw new Error('seed/demo.ts: failed to create the demo Better Auth user');
    userId = inserted.id;
  }

  // 2. Wipe any previous demo org for this user — idempotent re-run. FK cascade removes
  // every org-scoped row (membership, KYC, bundle, business number, office hours, call
  // sessions, calls) in one statement.
  const existingMembershipRows = await db
    .select()
    .from(memberships)
    .where(eq(memberships.userId, userId));
  const existingMembership = existingMembershipRows[0];
  if (existingMembership) {
    await db.delete(orgs).where(eq(orgs.id, existingMembership.orgId));
  }

  // 3. Org — fully onboarded, business-capacity declaration recorded.
  const [org] = await db
    .insert(orgs)
    .values({
      name: DEMO_ORG_NAME,
      timezone: 'Europe/Prague',
      officeHoursMode: 'schedule',
      businessCapacityDeclaredAt: nowDate,
      declarationVersion: DECLARATION_VERSION,
    })
    .returning();
  if (!org) throw new Error('seed/demo.ts: failed to create the demo org');

  // 4. Membership — verified personal number PRE-SATISFIED (brief: "PIN pre-satisfied
  // for the demo user"), emergency-limitation acknowledgment stamped (ER-EMG-3).
  await db.insert(memberships).values({
    orgId: org.id,
    userId,
    role: 'owner',
    personalNumberE164: DEMO_PERSONAL_NUMBER,
    personalNumberVerifiedAt: nowDate,
    emergencyAckAt: nowDate,
  });

  // 5. KYC — end-user record + an auto-approved bundle (mirrors the mock provider's
  // auto-approve behaviour, design.md §4.4).
  const [endUser] = await db
    .insert(endUsers)
    .values({
      orgId: org.id,
      legalName: DEMO_ORG_NAME,
      ico: '12345678',
      street: 'Václavské náměstí 1',
      city: 'Praha',
      postalCode: '11000',
      country: 'CZ',
    })
    .returning();
  if (!endUser) throw new Error('seed/demo.ts: failed to create the demo KYC end-user record');

  const [bundle] = await db
    .insert(regulatoryBundles)
    .values({
      orgId: org.id,
      providerBundleRef: 'bundle_demo_0001',
      status: 'approved',
      submittedAt: nowDate,
      decidedAt: nowDate,
    })
    .returning();
  if (!bundle) throw new Error('seed/demo.ts: failed to create the demo regulatory bundle');

  // 6. Business number — ACTIVE, Prague (area code '2').
  const [businessNumber] = await db
    .insert(businessNumbers)
    .values({
      orgId: org.id,
      e164: DEMO_BUSINESS_NUMBER,
      numberClass: 'geographic',
      status: 'active',
      areaCode: '2',
      providerNumberRef: 'number_demo_0001',
      bundleId: bundle.id,
      activatedAt: nowDate,
    })
    .returning();
  if (!businessNumber) throw new Error('seed/demo.ts: failed to create the demo business number');

  // 7. Office hours — weekday (Mon–Fri) 09:00–17:00 Europe/Prague (design.md §12).
  await db.insert(officeHourRules).values(
    [0, 1, 2, 3, 4].map((weekday) => ({
      orgId: org.id,
      weekday,
      opensAt: '09:00',
      closesAt: '17:00',
    })),
  );

  // 8. Historical call-log rows so the log/dashboard aren't empty on first run.
  const historical = buildHistoricalCalls();
  await db.insert(calls).values(
    historical.map((row) => {
      const startedAt = minutesAgo(nowDate, row.startedAgoMinutes);
      const answeredAt = row.status === 'answered' ? startedAt : null;
      const endedAt = new Date(startedAt.getTime() + row.durationSeconds * 1000);
      return {
        orgId: org.id,
        businessNumberId: businessNumber.id,
        direction: row.direction,
        status: row.status,
        reason: row.reason,
        fromE164: row.fromE164,
        toE164: row.toE164,
        initiatingUserId: row.outbound ? userId : null,
        startedAt,
        answeredAt,
        endedAt,
        durationSeconds: row.durationSeconds,
        providerCallRef: row.ref,
        providerErrorCode: row.providerErrorCode ?? null,
      };
    }),
  );

  return {
    ownerEmail: DEMO_OWNER_EMAIL,
    orgName: DEMO_ORG_NAME,
    personalNumber: DEMO_PERSONAL_NUMBER,
    businessNumber: DEMO_BUSINESS_NUMBER,
  };
}

async function main() {
  config({ path: new URL('../../../../.env', import.meta.url).pathname });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('seed/demo.ts: DATABASE_URL must be set (see .env.example)');
  }
  const db = createNodeDb(databaseUrl);
  const result = await seedDemoData(db);
  console.log(
    `Seeded demo org "${result.orgName}" — owner ${result.ownerEmail}, ` +
      `business number ${result.businessNumber}, personal number ${result.personalNumber}.`,
  );
  const client = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
  await client?.end?.();
}

await main();

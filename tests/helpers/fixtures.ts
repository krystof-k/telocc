import { randomUUID } from 'node:crypto';
import type { Db } from '@telocc/db';
import {
  businessNumbers,
  callSessions,
  endUsers,
  kycDocuments,
  memberships,
  officeHourRules,
  orgs,
} from '@telocc/db';
import type { App } from '../../apps/api/src/app.ts';
import { findUserIdByEmail, loginViaMagicLink } from './auth.ts';
import type { CaptureMailbox } from './mailbox.ts';

/**
 * Direct-DB fixture builders for preconditions that are NOT themselves the boundary a
 * given contract file is exercising (e.g. "an org with an active business number" as
 * setup for an inbound-routing test). The boundaries the brief calls out as needing to
 * be real — magic-link tokens, SMS PINs, webhooks, DTMF, settings input — are always
 * driven through the real HTTP app instead; see `auth.ts`/`telco.ts`.
 */

export const DECLARATION_VERSION = 'contract-test-v1';

export type BusinessNumberStatus =
  | 'requested'
  | 'docs_pending'
  | 'bundle_submitted'
  | 'approved'
  | 'rejected'
  | 'active'
  | 'porting_out'
  | 'released';

export type NumberClass = 'geographic' | 'nomadic_910' | 'mobile';
export type OfficeHoursMode = 'schedule' | 'always_open' | 'always_closed';

export interface CreateOrgOptions {
  name?: string;
  timezone?: string;
  officeHoursMode?: OfficeHoursMode;
  businessCapacityDeclaredAt?: Date;
  declarationVersion?: string;
  dialinHourlyCap?: number;
  outboundDailyMinutesCap?: number;
}

export async function createOrgFixture(db: Db, opts: CreateOrgOptions = {}) {
  const [row] = await db
    .insert(orgs)
    .values({
      name: opts.name ?? `Test Org ${randomUUID().slice(0, 8)} s.r.o.`,
      timezone: opts.timezone ?? 'Europe/Prague',
      officeHoursMode: opts.officeHoursMode ?? 'schedule',
      businessCapacityDeclaredAt: opts.businessCapacityDeclaredAt ?? new Date(),
      declarationVersion: opts.declarationVersion ?? DECLARATION_VERSION,
      dialinHourlyCap: opts.dialinHourlyCap ?? 6,
      outboundDailyMinutesCap: opts.outboundDailyMinutesCap ?? 180,
    })
    .returning();
  if (!row) throw new Error('createOrgFixture: insert returned no row');
  return row;
}

export interface CreateMembershipOptions {
  orgId: string;
  userId: string;
  role?: 'owner';
  personalNumberE164?: string | null;
  personalNumberVerifiedAt?: Date | null;
  emergencyAckAt?: Date | null;
}

export async function createMembershipFixture(db: Db, opts: CreateMembershipOptions) {
  const [row] = await db
    .insert(memberships)
    .values({
      orgId: opts.orgId,
      userId: opts.userId,
      role: opts.role ?? 'owner',
      personalNumberE164: opts.personalNumberE164 ?? null,
      personalNumberVerifiedAt: opts.personalNumberVerifiedAt ?? null,
      emergencyAckAt: opts.emergencyAckAt ?? null,
    })
    .returning();
  if (!row) throw new Error('createMembershipFixture: insert returned no row');
  return row;
}

export interface CreateBusinessNumberOptions {
  orgId: string;
  e164: string;
  status?: BusinessNumberStatus;
  numberClass?: NumberClass;
  areaCode?: string;
  activatedAt?: Date | null;
  releasedAt?: Date | null;
}

export async function createBusinessNumberFixture(db: Db, opts: CreateBusinessNumberOptions) {
  const [row] = await db
    .insert(businessNumbers)
    .values({
      orgId: opts.orgId,
      e164: opts.e164,
      status: opts.status ?? 'active',
      numberClass: opts.numberClass ?? 'geographic',
      areaCode: opts.areaCode ?? '2',
      activatedAt: opts.activatedAt ?? new Date(),
      releasedAt: opts.releasedAt ?? null,
    })
    .returning();
  if (!row) throw new Error('createBusinessNumberFixture: insert returned no row');
  return row;
}

export interface OfficeHourRuleInput {
  weekday: number; // 0 (Mon) - 6 (Sun)
  opensAt: string; // 'HH:MM'
  closesAt: string; // 'HH:MM'
}

export async function createOfficeHourRules(db: Db, orgId: string, rules: OfficeHourRuleInput[]) {
  if (rules.length === 0) return [];
  return db
    .insert(officeHourRules)
    .values(
      rules.map((r) => ({ orgId, weekday: r.weekday, opensAt: r.opensAt, closesAt: r.closesAt })),
    )
    .returning();
}

/** Mon-Fri 09:00-17:00 Europe/Prague — the demo default (design.md §12). */
export const STANDARD_WEEKDAY_9_TO_17: OfficeHourRuleInput[] = [0, 1, 2, 3, 4].map((weekday) => ({
  weekday,
  opensAt: '09:00',
  closesAt: '17:00',
}));

export interface CreateEndUserOptions {
  orgId: string;
  legalName?: string;
  ico?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  country?: string;
}

export async function createEndUserFixture(db: Db, opts: CreateEndUserOptions) {
  const [row] = await db
    .insert(endUsers)
    .values({
      orgId: opts.orgId,
      legalName: opts.legalName ?? 'Test Org s.r.o.',
      ico: opts.ico ?? '12345678',
      street: opts.street ?? 'Vaclavske namesti 1',
      city: opts.city ?? 'Praha',
      postalCode: opts.postalCode ?? '11000',
      country: opts.country ?? 'CZ',
    })
    .returning();
  if (!row) throw new Error('createEndUserFixture: insert returned no row');
  return row;
}

export interface CreateKycDocumentOptions {
  orgId: string;
  endUserId: string;
  type?: string;
  filename?: string;
  contentType?: string;
  bytes?: Buffer;
}

/** A minimal well-formed `kyc_documents` row — used by cross-org by-id scoping cases. */
export async function createKycDocumentFixture(db: Db, opts: CreateKycDocumentOptions) {
  const [row] = await db
    .insert(kycDocuments)
    .values({
      orgId: opts.orgId,
      endUserId: opts.endUserId,
      type: opts.type ?? 'business_registration',
      filename: opts.filename ?? 'registration.pdf',
      contentType: opts.contentType ?? 'application/pdf',
      bytes: opts.bytes ?? Buffer.from('%PDF-1.4 fixture content'),
    })
    .returning();
  if (!row) throw new Error('createKycDocumentFixture: insert returned no row');
  return row;
}

export interface CreateCallSessionOptions {
  orgId: string;
  businessNumberId: string;
  providerCallRef?: string;
  kind?: 'inbound' | 'dialin';
  state?: 'forwarding' | 'collecting' | 'bridging' | 'bridged';
  fromE164?: string | null;
}

/**
 * A minimal in-flight `call_sessions` row — used to prove erasure sweeps actually
 * remove live session state, not just the append-only `calls` log.
 */
export async function createCallSessionFixture(db: Db, opts: CreateCallSessionOptions) {
  const [row] = await db
    .insert(callSessions)
    .values({
      orgId: opts.orgId,
      businessNumberId: opts.businessNumberId,
      providerCallRef: opts.providerCallRef ?? `call_session_fixture_${randomUUID()}`,
      kind: opts.kind ?? 'inbound',
      state: opts.state ?? 'forwarding',
      fromE164: opts.fromE164 ?? null,
    })
    .returning();
  if (!row) throw new Error('createCallSessionFixture: insert returned no row');
  return row;
}

export interface ReadyOrgOptions {
  email?: string;
  orgName?: string;
  timezone?: string;
  personalNumberE164?: string;
  businessNumberE164?: string;
  officeHoursMode?: OfficeHoursMode;
  officeHourRules?: OfficeHourRuleInput[];
  dialinHourlyCap?: number;
  outboundDailyMinutesCap?: number;
}

export interface ReadyOrgFixture {
  cookieHeader: string;
  userId: string;
  orgId: string;
  businessNumberId: string;
  businessNumberE164: string;
  personalNumberE164: string;
}

/**
 * The common case: a logged-in owner (real magic-link boundary) whose org already has
 * a verified personal number and an active business number — everything most
 * inbound/outbound/call-log/settings contract cases need as a precondition, without
 * re-running the onboarding wizard's HTTP surface in every file (that flow is
 * org-bootstrap.contract.test.ts's job).
 */
export async function createReadyOrg(
  app: App,
  db: Db,
  mailbox: CaptureMailbox,
  opts: ReadyOrgOptions = {},
): Promise<ReadyOrgFixture> {
  const email = opts.email ?? `owner+${randomUUID()}@example.test`;
  const { cookieHeader } = await loginViaMagicLink(app, mailbox, email);
  const userId = await findUserIdByEmail(db, email);
  const org = await createOrgFixture(db, {
    name: opts.orgName,
    timezone: opts.timezone,
    officeHoursMode: opts.officeHoursMode,
    dialinHourlyCap: opts.dialinHourlyCap,
    outboundDailyMinutesCap: opts.outboundDailyMinutesCap,
  });
  // Unique per call, like businessNumberE164 above: the verified personal number is the
  // dial-in identity (exact CLI match), so two ready orgs sharing one default number
  // would make org B's calls look like org A's own dial-in.
  const personalNumberE164 =
    opts.personalNumberE164 ?? `+42077${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  await createMembershipFixture(db, {
    orgId: org.id,
    userId,
    personalNumberE164,
    personalNumberVerifiedAt: new Date(),
    emergencyAckAt: new Date(),
  });
  // Unique per call: business_numbers.e164 is globally unique, so a fixed default
  // collides whenever a test builds two ready orgs.
  const businessNumberE164 =
    opts.businessNumberE164 ?? `+4202${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const businessNumber = await createBusinessNumberFixture(db, {
    orgId: org.id,
    e164: businessNumberE164,
  });
  await createOfficeHourRules(db, org.id, opts.officeHourRules ?? STANDARD_WEEKDAY_9_TO_17);
  return {
    cookieHeader,
    userId,
    orgId: org.id,
    businessNumberId: businessNumber.id,
    businessNumberE164,
    personalNumberE164,
  };
}

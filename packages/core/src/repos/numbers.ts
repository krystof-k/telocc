/**
 * Business-number repo (ER-KYC-1..3, design.md §3.2 `business_numbers`). Every
 * org-scoped query takes `orgId` first (design.md §3 "Org-scoping pattern").
 */
import type { Db } from '@telocc/db';
import { businessNumbers, regionAreaCodes, regulatoryBundles } from '@telocc/db';
import type { TelephonyProvider } from '@telocc/telephony';
import { and, eq, ne } from 'drizzle-orm';
import { writeAuditEvent } from './audit.ts';

export type BusinessNumberStatus =
  | 'requested'
  | 'docs_pending'
  | 'bundle_submitted'
  | 'approved'
  | 'rejected'
  | 'active'
  | 'porting_out'
  | 'released';

export async function getBusinessNumberByOrgId(db: Db, orgId: string) {
  const rows = await db
    .select()
    .from(businessNumbers)
    .where(and(eq(businessNumbers.orgId, orgId), ne(businessNumbers.status, 'released')));
  return rows[0] ?? null;
}

export async function getBusinessNumberById(db: Db, orgId: string, id: string) {
  const rows = await db
    .select()
    .from(businessNumbers)
    .where(and(eq(businessNumbers.id, id), eq(businessNumbers.orgId, orgId)));
  return rows[0] ?? null;
}

/** Looked up by the called number's E.164 during webhook processing (design.md §3
 * "Webhook path derives org from the called business number"). Not org-scoped by
 * construction — this is exactly how a webhook discovers the org in the first place. */
export async function findBusinessNumberByE164(db: Db, e164: string) {
  const rows = await db.select().from(businessNumbers).where(eq(businessNumbers.e164, e164));
  return rows[0] ?? null;
}

/**
 * Resolves a provider-issued number ref back to its `business_numbers` row for
 * `provisioning.update` webhook handling. Primary match is the stored
 * `provider_number_ref`; a `number_<id>` fallback covers rows that never went through
 * `provisionNumber` (e.g. fixture-seeded numbers in tests) — provider implementations
 * (mock and, by convention, this fallback) are free to shape their ref strings any way,
 * as long as a ref of that exact form resolves by embedded id when no stored ref
 * matches (see webhooks.ts / provisioning.contract.test.ts).
 */
export async function findBusinessNumberByProviderNumberRef(db: Db, numberRef: string) {
  const byRef = await db
    .select()
    .from(businessNumbers)
    .where(eq(businessNumbers.providerNumberRef, numberRef));
  if (byRef[0]) return byRef[0];

  const match = /^number_(.+)$/.exec(numberRef);
  if (!match?.[1]) return null;
  const byId = await db.select().from(businessNumbers).where(eq(businessNumbers.id, match[1]));
  return byId[0] ?? null;
}

/** Same fallback convention for regulatory bundles (`bundle_<id>`). */
export async function findBusinessNumberByBundleRef(db: Db, bundleRef: string) {
  const byRef = await db
    .select({ businessNumber: businessNumbers })
    .from(businessNumbers)
    .innerJoin(regulatoryBundles, eq(businessNumbers.bundleId, regulatoryBundles.id))
    .where(eq(regulatoryBundles.providerBundleRef, bundleRef));
  if (byRef[0]) return byRef[0].businessNumber;

  const match = /^bundle_(.+)$/.exec(bundleRef);
  if (!match?.[1]) return null;
  const byId = await db
    .select({ businessNumber: businessNumbers })
    .from(businessNumbers)
    .innerJoin(regulatoryBundles, eq(businessNumbers.bundleId, regulatoryBundles.id))
    .where(eq(regulatoryBundles.id, match[1]));
  return byId[0]?.businessNumber ?? null;
}

export interface CreateBusinessNumberInput {
  orgId: string;
  e164: string;
  numberClass: 'geographic' | 'nomadic_910' | 'mobile';
  areaCode: string;
  status: BusinessNumberStatus;
  providerNumberRef?: string | null;
  bundleId?: string | null;
  activatedAt?: Date | null;
}

export async function createBusinessNumber(db: Db, input: CreateBusinessNumberInput) {
  const [row] = await db
    .insert(businessNumbers)
    .values({
      orgId: input.orgId,
      e164: input.e164,
      numberClass: input.numberClass,
      areaCode: input.areaCode,
      status: input.status,
      providerNumberRef: input.providerNumberRef ?? null,
      bundleId: input.bundleId ?? null,
      activatedAt: input.activatedAt ?? null,
    })
    .returning();
  if (!row) throw new Error('createBusinessNumber: insert returned no row');
  return row;
}

export interface UpdateBusinessNumberStatusInput {
  status: BusinessNumberStatus;
  providerRejectionReason?: string | null;
  activatedAt?: Date | null;
  releasedAt?: Date | null;
}

export async function updateBusinessNumberStatus(
  db: Db,
  id: string,
  input: UpdateBusinessNumberStatusInput,
) {
  const [row] = await db
    .update(businessNumbers)
    .set({
      status: input.status,
      ...(input.providerRejectionReason !== undefined
        ? { providerRejectionReason: input.providerRejectionReason }
        : {}),
      ...(input.activatedAt !== undefined ? { activatedAt: input.activatedAt } : {}),
      ...(input.releasedAt !== undefined ? { releasedAt: input.releasedAt } : {}),
    })
    .where(eq(businessNumbers.id, id))
    .returning();
  return row ?? null;
}

export interface CreateRegulatoryBundleInput {
  orgId: string;
  providerBundleRef?: string | null;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  submittedAt?: Date | null;
  decidedAt?: Date | null;
}

export async function createRegulatoryBundle(db: Db, input: CreateRegulatoryBundleInput) {
  const [row] = await db
    .insert(regulatoryBundles)
    .values({
      orgId: input.orgId,
      providerBundleRef: input.providerBundleRef ?? null,
      status: input.status,
      submittedAt: input.submittedAt ?? null,
      decidedAt: input.decidedAt ?? null,
    })
    .returning();
  if (!row) throw new Error('createRegulatoryBundle: insert returned no row');
  return row;
}

/** Every non-released business number for an org (used by erasure/release flows). */
export async function listReleasableBusinessNumbers(db: Db, orgId: string) {
  return db
    .select()
    .from(businessNumbers)
    .where(and(eq(businessNumbers.orgId, orgId), ne(businessNumbers.status, 'released')));
}

/** `region ∈ region_area_codes` (design.md §7 `GET /api/numbers/catalog` input). */
export async function getRegionAreaCodeByName(db: Db, regionName: string) {
  const rows = await db
    .select()
    .from(regionAreaCodes)
    .where(eq(regionAreaCodes.regionName, regionName));
  return rows[0] ?? null;
}

export async function listRegionAreaCodes(db: Db) {
  return db.select().from(regionAreaCodes);
}

/**
 * Releases every non-released business number for an org through the seam
 * (`provider.releaseNumber`, best-effort — failures are swallowed, matching
 * design.md §10.3's "best-effort provider propagation, do not block local deletion")
 * and records exactly one **PII-free, org-less** `number_lifecycle` audit event per
 * release: `org_id: null` so it survives the org's own cascading delete (like
 * `deletion_tombstones`), and `meta` carries no phone number or org name — only a
 * last-4 digest, matching the redaction convention already used elsewhere (ER-AUD-2
 * "no full phone numbers — last-4 only where needed").
 *
 * Intended for `POST /api/account/delete` (design.md §10.3, M8's `routes/dsr.ts`) to
 * call *before* the org's row is deleted — this function itself does not delete
 * anything in the local schema; it only talks to the provider and writes the audit
 * trail entry that must outlive the cascade.
 */
export async function releaseOrgBusinessNumbers(
  db: Db,
  provider: TelephonyProvider,
  orgId: string,
): Promise<void> {
  const numbers = await listReleasableBusinessNumbers(db, orgId);
  for (const number of numbers) {
    if (number.providerNumberRef) {
      try {
        await provider.releaseNumber(number.providerNumberRef);
      } catch {
        // best-effort — local deletion must not be blocked by a provider-side failure.
      }
    }
    await writeAuditEvent(db, {
      orgId: null,
      type: 'number_lifecycle',
      retentionClass: 'lifecycle',
      meta: { event: 'released_on_account_deletion', numberLastFour: number.e164.slice(-4) },
    });
  }
}

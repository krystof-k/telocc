/**
 * Org-scoped query helpers — every fn takes `orgId` first (design.md §3, org-scoping
 * pattern). Implemented in M2.
 */
import type { Db } from '@telocc/db';
import { orgs } from '@telocc/db';
import { eq } from 'drizzle-orm';

export interface CreateOrgInput {
  name: string;
  timezone?: string;
  businessCapacityDeclaredAt: Date;
  declarationVersion: string;
  /** § 63a step — only set under COMPLIANCE_POSTURE=nbics_provider (ER-POST-1). */
  contractSummaryShownAt?: Date | null;
  waiverAcceptedAt?: Date | null;
}

/** Creates a new org row. Not itself org-scoped — this is how an org comes to exist. */
export async function createOrg(db: Db, input: CreateOrgInput) {
  const [row] = await db
    .insert(orgs)
    .values({
      name: input.name,
      timezone: input.timezone,
      businessCapacityDeclaredAt: input.businessCapacityDeclaredAt,
      declarationVersion: input.declarationVersion,
      contractSummaryShownAt: input.contractSummaryShownAt ?? null,
      waiverAcceptedAt: input.waiverAcceptedAt ?? null,
    })
    .returning();
  if (!row) throw new Error('createOrg: insert returned no row');
  return row;
}

export async function getOrgById(db: Db, orgId: string) {
  const rows = await db.select().from(orgs).where(eq(orgs.id, orgId));
  return rows[0] ?? null;
}

export interface UpdateOrgInput {
  name?: string;
}

export async function updateOrg(db: Db, orgId: string, input: UpdateOrgInput) {
  if (Object.keys(input).length === 0) return getOrgById(db, orgId);
  const [row] = await db
    .update(orgs)
    .set({ ...(input.name !== undefined ? { name: input.name } : {}) })
    .where(eq(orgs.id, orgId))
    .returning();
  return row ?? null;
}

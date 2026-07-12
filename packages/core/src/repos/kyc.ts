/**
 * KYC repo (end users, bundles, documents; ER-KYC-2, design.md §3.2). Every org-scoped
 * query takes `orgId` first (design.md §3 "Org-scoping pattern").
 */
import type { Db } from '@telocc/db';
import { endUsers, kycDocuments } from '@telocc/db';
import { and, eq, isNull } from 'drizzle-orm';

export interface EndUserInput {
  legalName: string;
  ico: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
}

export async function getEndUserByOrgId(db: Db, orgId: string) {
  const rows = await db.select().from(endUsers).where(eq(endUsers.orgId, orgId));
  return rows[0] ?? null;
}

/** Create-or-update: `end_users.org_id` is unique, so `PUT /api/kyc` is idempotent. */
export async function upsertEndUser(db: Db, orgId: string, input: EndUserInput) {
  const [row] = await db
    .insert(endUsers)
    .values({
      orgId,
      legalName: input.legalName,
      ico: input.ico,
      street: input.street,
      city: input.city,
      postalCode: input.postalCode,
      country: input.country,
    })
    .onConflictDoUpdate({
      target: endUsers.orgId,
      set: {
        legalName: input.legalName,
        ico: input.ico,
        street: input.street,
        city: input.city,
        postalCode: input.postalCode,
        country: input.country,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error('upsertEndUser: insert/update returned no row');
  return row;
}

export interface KycDocumentInput {
  orgId: string;
  endUserId: string;
  type: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}

export async function insertKycDocument(db: Db, input: KycDocumentInput) {
  const [row] = await db
    .insert(kycDocuments)
    .values({
      orgId: input.orgId,
      endUserId: input.endUserId,
      type: input.type,
      filename: input.filename,
      contentType: input.contentType,
      bytes: input.bytes,
    })
    .returning();
  if (!row) throw new Error('insertKycDocument: insert returned no row');
  return row;
}

/** Metadata-only listing (design.md §10.2 export shape: "documents: metadata only"). */
export async function listKycDocumentMeta(db: Db, orgId: string) {
  return db
    .select({
      id: kycDocuments.id,
      type: kycDocuments.type,
      filename: kycDocuments.filename,
      contentType: kycDocuments.contentType,
      uploadedAt: kycDocuments.uploadedAt,
    })
    .from(kycDocuments)
    .where(and(eq(kycDocuments.orgId, orgId), isNull(kycDocuments.deletedAt)));
}

export async function getKycDocumentById(db: Db, orgId: string, id: string) {
  const rows = await db
    .select()
    .from(kycDocuments)
    .where(
      and(eq(kycDocuments.id, id), eq(kycDocuments.orgId, orgId), isNull(kycDocuments.deletedAt)),
    );
  return rows[0] ?? null;
}

/** All documents (incl. bytes) for a given end-user — used to build a submitBundle
 * seam call's `documents` array. */
export async function listKycDocumentsForEndUser(db: Db, orgId: string, endUserId: string) {
  return db
    .select()
    .from(kycDocuments)
    .where(
      and(
        eq(kycDocuments.orgId, orgId),
        eq(kycDocuments.endUserId, endUserId),
        isNull(kycDocuments.deletedAt),
      ),
    );
}

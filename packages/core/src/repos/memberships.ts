/**
 * Membership repo (roles seam, design.md §3.2/§6). `getMembershipByUserId` is the one
 * exception to the "orgId first" convention — it's how org middleware *discovers*
 * `orgId` from a session's user in the first place (design.md "Org-scoping pattern").
 */
import type { Db } from '@telocc/db';
import { memberships } from '@telocc/db';
import { eq } from 'drizzle-orm';

export interface CreateMembershipInput {
  orgId: string;
  userId: string;
  role?: 'owner';
}

export async function createMembership(db: Db, input: CreateMembershipInput) {
  const [row] = await db
    .insert(memberships)
    .values({
      orgId: input.orgId,
      userId: input.userId,
      role: input.role ?? 'owner',
    })
    .returning();
  if (!row) throw new Error('createMembership: insert returned no row');
  return row;
}

export async function getMembershipByUserId(db: Db, userId: string) {
  const rows = await db.select().from(memberships).where(eq(memberships.userId, userId));
  return rows[0] ?? null;
}

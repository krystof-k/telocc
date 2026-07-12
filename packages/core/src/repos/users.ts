/**
 * Better Auth `user` row repo. Kept separate from `memberships.ts` — the user row
 * (email, name) belongs to auth, not to org-scoped domain state — but it's a single
 * small lookup so it doesn't warrant its own directory.
 */
import type { Db } from '@telocc/db';
import { user } from '@telocc/db';
import { eq } from 'drizzle-orm';

export async function getUserById(db: Db, userId: string) {
  const rows = await db.select().from(user).where(eq(user.id, userId));
  return rows[0] ?? null;
}

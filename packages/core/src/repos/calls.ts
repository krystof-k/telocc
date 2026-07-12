/**
 * Call-log read repo (design.md §7 `GET /api/calls?cursor&direction&from&to`,
 * `GET /api/calls/:id` — decisions.md #37). Every query is org-scoped (design.md §3
 * "Org-scoping pattern"); there is deliberately no update/delete function here — the
 * log is append-only, written exclusively by `core/call-log.ts`.
 */
import type { Db } from '@telocc/db';
import { calls } from '@telocc/db';
import { and, desc, eq, gte, lt, lte, or, type SQLWrapper } from 'drizzle-orm';

export type CallRow = typeof calls.$inferSelect;

export interface ListCallsFilter {
  direction?: 'inbound' | 'outbound';
  from?: Date;
  to?: Date;
  /** Opaque cursor previously returned as `nextCursor` — resumes right after it,
   * newest-first (design.md §7). */
  cursor?: string;
  limit?: number;
}

export interface ListCallsResult {
  items: CallRow[];
  nextCursor: string | null;
}

const DEFAULT_PAGE_SIZE = 5;

interface CursorPosition {
  startedAt: Date;
  id: string;
}

function encodeCursor(row: CursorPosition): string {
  const json = JSON.stringify({ startedAt: row.startedAt.toISOString(), id: row.id });
  return Buffer.from(json, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): CursorPosition | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      startedAt?: string;
      id?: string;
    };
    if (typeof parsed.startedAt !== 'string' || typeof parsed.id !== 'string') return null;
    const startedAt = new Date(parsed.startedAt);
    if (Number.isNaN(startedAt.getTime())) return null;
    return { startedAt, id: parsed.id };
  } catch {
    return null;
  }
}

/** Newest-first (`started_at DESC`, `id DESC` tiebreak), keyset-paginated so repeated
 * walks are stable and never produce cross-page duplicates even under concurrent
 * inserts (unlike offset pagination). */
export async function listCallsForOrg(
  db: Db,
  orgId: string,
  filter: ListCallsFilter = {},
): Promise<ListCallsResult> {
  const limit = filter.limit ?? DEFAULT_PAGE_SIZE;
  const conditions: (SQLWrapper | undefined)[] = [eq(calls.orgId, orgId)];
  if (filter.direction) conditions.push(eq(calls.direction, filter.direction));
  if (filter.from) conditions.push(gte(calls.startedAt, filter.from));
  if (filter.to) conditions.push(lte(calls.startedAt, filter.to));

  if (filter.cursor) {
    const pos = decodeCursor(filter.cursor);
    if (pos) {
      conditions.push(
        or(
          lt(calls.startedAt, pos.startedAt),
          and(eq(calls.startedAt, pos.startedAt), lt(calls.id, pos.id)),
        ),
      );
    }
  }

  const rows = await db
    .select()
    .from(calls)
    .where(and(...conditions))
    .orderBy(desc(calls.startedAt), desc(calls.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  const nextCursor =
    hasMore && last ? encodeCursor({ startedAt: last.startedAt, id: last.id }) : null;

  return { items, nextCursor };
}

/** Org-scoped by-id lookup (decisions.md #37) — cross-org ids resolve to `null` so the
 * route can 404 rather than leak existence (design.md §3 "Cross-org probing returns
 * 404, not 403"). */
export async function getCallById(db: Db, orgId: string, id: string): Promise<CallRow | null> {
  const rows = await db
    .select()
    .from(calls)
    .where(and(eq(calls.id, id), eq(calls.orgId, orgId)));
  return rows[0] ?? null;
}

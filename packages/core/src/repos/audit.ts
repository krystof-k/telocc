/** Audit-event writer (ER-AUD-2, design.md §3.2). */
import type { Db } from '@telocc/db';
import { auditEvents } from '@telocc/db';

export type AuditEventType =
  | 'login'
  | 'magic_link_issued'
  | 'magic_link_used'
  | 'pin_issued'
  | 'pin_attempt_failed'
  | 'pin_verified'
  | 'settings_changed'
  | 'number_lifecycle'
  | 'export_requested'
  | 'webhook_rejected'
  | 'webhook_ignored'
  | 'anomaly_flagged'
  | 'dsr_erasure';

export interface WriteAuditEventInput {
  orgId?: string | null;
  actorUserId?: string | null;
  type: AuditEventType;
  /** @default 'security' */
  retentionClass?: 'security' | 'lifecycle';
  /** Minimal — no secrets, no full phone numbers (last-4 only where needed). */
  meta?: Record<string, unknown>;
}

export async function writeAuditEvent(db: Db, input: WriteAuditEventInput) {
  const [row] = await db
    .insert(auditEvents)
    .values({
      orgId: input.orgId ?? null,
      actorUserId: input.actorUserId ?? null,
      type: input.type,
      retentionClass: input.retentionClass ?? 'security',
      meta: input.meta ?? {},
    })
    .returning();
  if (!row) throw new Error('writeAuditEvent: insert returned no row');
  return row;
}

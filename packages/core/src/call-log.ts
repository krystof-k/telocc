/**
 * The append-only call log writer — the ONLY module inserting into `calls`
 * (design.md §3.2, decisions.md #19). Terminal writes are produced by the routing
 * state machines (`routing/inbound.ts`, and M6's `routing/dialin.ts`) at decision time
 * (declines/blocks/refusals), and by `deriveFinalization` below at `call.completed`
 * time for any session that issued a `forward`/`bridge` (design.md §5.0 — the sole
 * finalizer for dialled legs, shared by both machines).
 */
import type { Db } from '@telocc/db';
import { calls } from '@telocc/db';

export type CallDirection = 'inbound' | 'outbound';

export type CallStatus =
  | 'answered'
  | 'missed'
  | 'declined'
  | 'failed'
  | 'blocked'
  | 'emergency_refused'
  | 'destination_blocked';

export interface TerminalCallInput {
  orgId: string;
  businessNumberId: string;
  direction: CallDirection;
  status: CallStatus;
  reason?: string | null;
  fromE164: string | null;
  toE164: string | null;
  initiatingUserId?: string | null;
  startedAt: Date;
  answeredAt?: Date | null;
  endedAt: Date;
  durationSeconds?: number;
  providerCallRef: string;
  providerErrorCode?: string | null;
}

/**
 * Inserts the one `calls` row for a logical call at its terminal state. Write-once by
 * construction: `calls.provider_call_ref`'s unique index (partial — `WHERE
 * provider_call_ref IS NOT NULL`) rejects a second insert for an already-finalized
 * `providerCallRef` (§4.3 order tolerance) with a constraint-violation error; the
 * webhook route's outer catch-all (design.md §4.3 "never a 5xx") swallows it and acks
 * 200, so a redelivery is a no-op from the caller's perspective without ever reading
 * before acting (decisions.md #19). A plain `INSERT` (not `ON CONFLICT DO NOTHING`) is
 * deliberate here: Postgres requires an `ON CONFLICT` target's predicate to match a
 * partial unique index's `WHERE` clause exactly, and duplicating that partial
 * predicate here would be more fragile than just letting the constraint do its job.
 * There is deliberately no update path here or anywhere else in application code.
 */
export async function writeTerminalCall(db: Db, input: TerminalCallInput): Promise<void> {
  await db.insert(calls).values({
    orgId: input.orgId,
    businessNumberId: input.businessNumberId,
    direction: input.direction,
    status: input.status,
    reason: input.reason ?? null,
    fromE164: input.fromE164,
    toE164: input.toE164,
    initiatingUserId: input.initiatingUserId ?? null,
    startedAt: input.startedAt,
    answeredAt: input.answeredAt ?? null,
    endedAt: input.endedAt,
    durationSeconds: input.durationSeconds ?? 0,
    providerCallRef: input.providerCallRef,
    providerErrorCode: input.providerErrorCode ?? null,
  });
}

/** The subset of `call_sessions` a leg event (`call.leg`) updates (design.md §5.0:
 * "non-final events only record"). Neither branch ever writes a `calls` row. */
export interface LegRecordUpdate {
  answeredAt?: Date;
  state?: 'bridged';
  lastLegStatus?: string;
  lastLegErrorCode?: string | null;
}

/** Pure derivation of the `call_sessions` bookkeeping update for a `call.leg` event —
 * `answered` fires at pickup and advances the session to `bridged`; any other leg
 * status just records the best-known outcome for the eventual finalizer. Shared by
 * both the inbound (§5.1) and dial-in (§5.2, M6) machines: leg recording is identical
 * for a forwarded or a bridged leg. */
export function deriveLegRecordUpdate(event: {
  legStatus: 'answered' | 'busy' | 'no_answer' | 'failed';
  errorCode?: string;
  at: Date;
}): LegRecordUpdate {
  if (event.legStatus === 'answered') {
    return { answeredAt: event.at, state: 'bridged' };
  }
  return { lastLegStatus: event.legStatus, lastLegErrorCode: event.errorCode ?? null };
}

/** Best-known `call_sessions` state at the point a dialled-leg session is being
 * finalized by `call.completed` (design.md §5.0). */
export interface SessionFinalizationInput {
  kind: 'inbound' | 'dialin';
  state: 'forwarding' | 'collecting' | 'bridging' | 'bridged';
  answeredAt: Date | null;
  lastLegStatus: string | null;
  lastLegErrorCode: string | null;
}

export interface FinalizationOutcome {
  status: CallStatus;
  reason: string | null;
  providerErrorCode: string | null;
  answeredAt: Date | null;
  durationSeconds: number;
}

/**
 * Pure derivation of the terminal `status`/`reason`/duration from best-known session
 * data at `call.completed` (design.md §5.0 — "`call.completed` is the sole finalizer"):
 *
 * - `answered_at` set → `answered`, duration from the event (covers the caller hanging
 *   up first after answer — Twilio's Dial action callback never fires there).
 * - else `last_leg_status` `busy|no_answer` → `missed`.
 * - else `last_leg_status` `failed` → `failed` + the provider error code.
 * - else (no dialled-leg outcome at all — the caller hung up before any outcome):
 *   inbound FORWARDING or dial-in BRIDGING → `missed/caller_hangup`; dial-in
 *   COLLECTING → `failed/caller_hangup`.
 *
 * No I/O — callers persist the resulting row via `writeTerminalCall`.
 */
export function deriveFinalization(
  session: SessionFinalizationInput,
  completedEvent: { durationSeconds: number; errorCode?: string },
): FinalizationOutcome {
  if (session.answeredAt) {
    return {
      status: 'answered',
      reason: null,
      providerErrorCode: null,
      answeredAt: session.answeredAt,
      durationSeconds: completedEvent.durationSeconds,
    };
  }
  if (session.lastLegStatus === 'busy' || session.lastLegStatus === 'no_answer') {
    return {
      status: 'missed',
      reason: null,
      providerErrorCode: null,
      answeredAt: null,
      durationSeconds: 0,
    };
  }
  if (session.lastLegStatus === 'failed') {
    return {
      status: 'failed',
      reason: null,
      providerErrorCode: session.lastLegErrorCode ?? completedEvent.errorCode ?? null,
      answeredAt: null,
      durationSeconds: 0,
    };
  }
  // No dialled-leg outcome at all — the caller hung up before any outcome (§5.0).
  const status = session.kind === 'dialin' && session.state === 'collecting' ? 'failed' : 'missed';
  return {
    status,
    reason: 'caller_hangup',
    providerErrorCode: null,
    answeredAt: null,
    durationSeconds: 0,
  };
}

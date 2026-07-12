/**
 * Provider webhook surface — signature-authenticated, never session-authenticated
 * (design.md §4). This file is exempt from the "routes import repos, not @telocc/db"
 * convention (seam-isolation.contract.test.ts) since the webhook path resolves org
 * identity from the called business number itself, not from a session (design.md §3
 * "Org-scoping pattern" point 3).
 *
 * Flow (design.md §4.3): verifyWebhook → parseWebhook → zod-validate the neutral event
 * (belt over the seam boundary) → load context → dispatch to `packages/core`'s pure
 * routing/call-log functions → persist whatever they decided → renderInstruction. This
 * file is a thin adapter: it does the I/O (loading business numbers/org/membership/
 * office-hour rules/call_sessions, and persisting session/`calls` writes); the actual
 * decisions (§5.1 inbound routing, §5.0 finalization) live in
 * `core/routing/inbound.ts` and `core/call-log.ts` (decisions.md #44 — this replaces
 * M4's inline flow with delegation to those now-implemented modules).
 *
 * SCOPE NOTE (M6): a `call.incoming` whose signalling `from` exactly matches the org's
 * verified personal number enters the dial-in machine (`core/routing/dialin.ts` +
 * `core/dial-policy.ts`, design.md §5.2) instead of the inbound machine — the pre-checks
 * (hourly attempt cap, daily-minutes remainder, structural concurrent-bridge INSERT,
 * decisions.md #29) are I/O, so they live here; the actual decisions are pure functions
 * this file calls into and persists.
 */
import { createHash } from 'node:crypto';
import {
  deriveFinalization,
  deriveLegRecordUpdate,
  writeTerminalCall,
} from '@telocc/core/call-log';
import type { DialPolicyDenyPrefix } from '@telocc/core/dial-policy';
import { writeAuditEvent } from '@telocc/core/repos/audit';
import {
  findBusinessNumberByBundleRef,
  findBusinessNumberByE164,
  findBusinessNumberByProviderNumberRef,
  updateBusinessNumberStatus,
} from '@telocc/core/repos/numbers';
import {
  decideDialinDigits,
  decideDialinEntry,
  dialinBlockedCallLog,
} from '@telocc/core/routing/dialin';
import { decideInboundIncoming } from '@telocc/core/routing/inbound';
import {
  businessNumbers,
  callSessions,
  calls,
  dialPolicyPrefixes,
  memberships,
  officeHourRules,
  orgs,
  rateLimitCounters,
} from '@telocc/db';
import {
  type CallInstruction,
  MalformedWebhookError,
  type RawWebhookRequest,
  type RenderContext,
  type TelephonyEvent,
} from '@telocc/telephony';
import { and, eq, gte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Deps } from '../deps.ts';
import type { AppEnv } from '../lib/context.ts';
import { safeLog } from '../lib/log.ts';

/** Belt-over-the-seam validation of the already-provider-parsed neutral event
 * (design.md §4.3). Deliberately loose on string shapes (E.164 branding is the
 * provider's job) — this exists to catch a shape drift between a provider adapter and
 * the neutral type, not to re-implement provider parsing. */
const telephonyEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('call.incoming'),
    callRef: z.string().min(1),
    to: z.string().min(1),
    from: z.string().min(1).nullable(),
    at: z.date(),
  }),
  z.object({
    type: z.literal('call.dtmf'),
    callRef: z.string().min(1),
    digits: z.string(),
    at: z.date(),
  }),
  z.object({
    type: z.literal('call.leg'),
    callRef: z.string().min(1),
    legStatus: z.enum(['answered', 'busy', 'no_answer', 'failed']),
    errorCode: z.string().optional(),
    at: z.date(),
  }),
  z.object({
    type: z.literal('call.completed'),
    callRef: z.string().min(1),
    durationSeconds: z.number(),
    errorCode: z.string().optional(),
    at: z.date(),
  }),
  z.object({
    type: z.literal('sms.status'),
    messageRef: z.string().min(1),
    status: z.enum(['sent', 'delivered', 'failed']),
    at: z.date(),
  }),
  z.object({
    type: z.literal('provisioning.update'),
    bundleRef: z.string().optional(),
    numberRef: z.string().optional(),
    status: z.enum(['submitted', 'approved', 'rejected', 'active']),
    reason: z.string().optional(),
    at: z.date(),
  }),
]);

function assertNever(x: never): never {
  throw new Error(`unreachable event type: ${JSON.stringify(x)}`);
}

// ---------------------------------------------------------------------------
// Signature-failure counting → synchronous anomaly flag (decisions.md #39/#48).
// ---------------------------------------------------------------------------

const SIGNATURE_FAILURE_SCOPE = 'webhook_invalid_signature';
const SIGNATURE_FAILURE_WINDOW_SECONDS = 600;
/** Not pinned by design.md (only the unrelated ANOMALY_* nightly thresholds are
 * named) — an M4 implementation decision, per tests/helpers/README.md's ambiguity
 * note and rate-limits.contract.test.ts's own header comment. */
const SIGNATURE_FAILURE_ALERT_THRESHOLD = 10;

async function recordInvalidSignature(deps: Deps, reason: string): Promise<void> {
  await writeAuditEvent(deps.db, { type: 'webhook_rejected', meta: { reason } });

  const nowSec = Math.floor(deps.now().getTime() / 1000);
  const windowStartSec =
    Math.floor(nowSec / SIGNATURE_FAILURE_WINDOW_SECONDS) * SIGNATURE_FAILURE_WINDOW_SECONDS;
  const key = createHash('sha256')
    .update(`${SIGNATURE_FAILURE_SCOPE} global ${windowStartSec}`)
    .digest('hex');
  const windowStartsAt = new Date(windowStartSec * 1000);
  const expiresAt = new Date((windowStartSec + SIGNATURE_FAILURE_WINDOW_SECONDS) * 1000);

  const rows = await deps.db
    .insert(rateLimitCounters)
    .values({ key, scope: SIGNATURE_FAILURE_SCOPE, count: 1, windowStartsAt, expiresAt })
    .onConflictDoUpdate({
      target: rateLimitCounters.key,
      set: { count: sql`${rateLimitCounters.count} + 1` },
    })
    .returning();
  const count = rows[0]?.count ?? 1;

  if (count === SIGNATURE_FAILURE_ALERT_THRESHOLD + 1) {
    await writeAuditEvent(deps.db, {
      type: 'anomaly_flagged',
      meta: { reason: 'invalid_webhook_signature_threshold', count },
    });
  }
}

function renderInstructionResponse(
  deps: Deps,
  instruction: CallInstruction,
  callRef: string,
): Response {
  const ctx: RenderContext = { webhookBaseUrl: deps.env.APP_BASE_URL, callRef };
  const rendered = deps.provider.renderInstruction(instruction, ctx);
  return new Response(rendered.body, {
    status: rendered.status,
    headers: { 'content-type': rendered.contentType },
  });
}

// ---------------------------------------------------------------------------
// Dial-in (appless outbound) I/O helpers (design.md §5.2) — pre-checks the pure
// `core/routing/dialin.ts` decisions need but deliberately have no access to.
// ---------------------------------------------------------------------------

const DIALIN_ATTEMPT_SCOPE = 'dialin_attempt';
const DIALIN_ATTEMPT_WINDOW_SECONDS = 3600; // fixed hourly window (design.md §5.2 step 1)

/** Fixed-window per-org counter, same shape as `recordInvalidSignature`'s global one —
 * returns the count *including* this attempt. */
async function incrementDialinHourlyAttempts(deps: Deps, orgId: string): Promise<number> {
  const nowSec = Math.floor(deps.now().getTime() / 1000);
  const windowStartSec =
    Math.floor(nowSec / DIALIN_ATTEMPT_WINDOW_SECONDS) * DIALIN_ATTEMPT_WINDOW_SECONDS;
  const key = createHash('sha256')
    .update(`${DIALIN_ATTEMPT_SCOPE} ${orgId} ${windowStartSec}`)
    .digest('hex');
  const windowStartsAt = new Date(windowStartSec * 1000);
  const expiresAt = new Date((windowStartSec + DIALIN_ATTEMPT_WINDOW_SECONDS) * 1000);

  const rows = await deps.db
    .insert(rateLimitCounters)
    .values({ key, scope: DIALIN_ATTEMPT_SCOPE, count: 1, windowStartsAt, expiresAt })
    .onConflictDoUpdate({
      target: rateLimitCounters.key,
      set: { count: sql`${rateLimitCounters.count} + 1` },
    })
    .returning();
  return rows[0]?.count ?? 1;
}

/** design.md §5.2 step 2 — remaining daily outbound minutes = the org's cap minus
 * minutes already consumed by *answered* outbound calls "today" (calendar day in UTC —
 * not pinned by design.md; an M6 implementation decision, docs/decisions.md). */
async function remainingDailyOutboundSeconds(
  deps: Deps,
  orgId: string,
  capMinutes: number,
): Promise<number> {
  const now = deps.now();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const rows = await deps.db
    .select({ durationSeconds: calls.durationSeconds })
    .from(calls)
    .where(
      and(
        eq(calls.orgId, orgId),
        eq(calls.direction, 'outbound'),
        eq(calls.status, 'answered'),
        gte(calls.startedAt, dayStart),
      ),
    );
  const consumedSeconds = rows.reduce((sum, r) => sum + r.durationSeconds, 0);
  return capMinutes * 60 - consumedSeconds;
}

async function listDialPolicyDenyPrefixes(deps: Deps): Promise<DialPolicyDenyPrefix[]> {
  const rows = await deps.db.select({ prefix: dialPolicyPrefixes.prefix }).from(dialPolicyPrefixes);
  return rows;
}

/** Postgres unique-violation ("23505") on the structural concurrent-bridge index
 * (`call_sessions_one_active_dialin_per_org`, decisions.md #29) — the INSERT conflict
 * itself *is* the reject-busy path, no read-then-act race (ER-RATE-2). drizzle-orm
 * wraps the raw `pg` driver error in a `DrizzleQueryError`, so the Postgres error code
 * lives on `.cause`, not on the thrown error itself. */
function pgErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string') return code;
  const cause = (err as { cause?: unknown }).cause;
  return pgErrorCode(cause);
}

function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === '23505';
}

// ---------------------------------------------------------------------------
// Per-event-type handlers — I/O + dispatch to packages/core's pure decisions.
// ---------------------------------------------------------------------------

async function handleCallIncoming(
  deps: Deps,
  event: Extract<TelephonyEvent, { type: 'call.incoming' }>,
): Promise<Response> {
  const businessNumber = await findBusinessNumberByE164(deps.db, event.to);
  if (!businessNumber) {
    await writeAuditEvent(deps.db, {
      type: 'webhook_ignored',
      meta: { reason: 'unknown_business_number' },
    });
    return Response.json({ ignored: true }, { status: 200 });
  }

  const orgId = businessNumber.orgId;
  const orgRows = await deps.db.select().from(orgs).where(eq(orgs.id, orgId));
  const org = orgRows[0] ?? null;
  const membershipRows = await deps.db
    .select()
    .from(memberships)
    .where(eq(memberships.orgId, orgId));
  const membership = membershipRows[0] ?? null;
  const rules = await deps.db
    .select()
    .from(officeHourRules)
    .where(eq(officeHourRules.orgId, orgId));

  const hasVerifiedPersonalNumber =
    membership?.personalNumberVerifiedAt != null && membership.personalNumberE164 != null;

  // design.md §5.2 entry condition: `from` (provider signalling, never user input)
  // EXACTLY matches the org's verified personal number → appless dial-in, not gated by
  // office hours. Any non-match (near-miss, withheld, another org's verified caller) is
  // the unverified-caller failure path into the inbound machine below (§5.1).
  if (org && hasVerifiedPersonalNumber && event.from === membership?.personalNumberE164) {
    return handleDialinIncoming(deps, event, {
      orgId,
      businessNumber: { id: businessNumber.id, e164: businessNumber.e164 },
      personalNumberE164: membership.personalNumberE164 as string,
      initiatingUserId: membership.userId,
      dialinHourlyCap: org.dialinHourlyCap,
      outboundDailyMinutesCap: org.outboundDailyMinutesCap,
    });
  }

  const decision = decideInboundIncoming({
    now: deps.now(),
    callRef: event.callRef,
    from: event.from,
    at: event.at,
    orgId,
    businessNumber: { id: businessNumber.id, e164: businessNumber.e164 },
    hasVerifiedPersonalNumber,
    personalNumberE164: membership?.personalNumberE164 ?? null,
    officeHoursMode: org?.officeHoursMode ?? 'always_closed',
    officeHourRules: rules,
    timezone: org?.timezone ?? 'Europe/Prague',
  });

  if (decision.outcome === 'declined') {
    await writeTerminalCall(deps.db, decision.callLogWrite);
    return renderInstructionResponse(deps, { kind: 'reject', cause: 'busy' }, event.callRef);
  }

  // Idempotent: a redelivered call.incoming for the same callRef is a no-op.
  await deps.db
    .insert(callSessions)
    .values(decision.sessionInsert)
    .onConflictDoNothing({ target: callSessions.providerCallRef });

  return renderInstructionResponse(deps, decision.instruction, event.callRef);
}

/**
 * design.md §5.2 pre-checks, in order — each one a decision-time terminal
 * (`calls` row written immediately, no session ever created):
 * 1. hourly attempt cap, 2. remaining daily outbound minutes, 3. the structural
 * concurrent-bridge INSERT (decisions.md #29 — the conflict itself is the reject).
 */
async function handleDialinIncoming(
  deps: Deps,
  event: Extract<TelephonyEvent, { type: 'call.incoming' }>,
  ctx: {
    orgId: string;
    businessNumber: { id: string; e164: string };
    personalNumberE164: string;
    initiatingUserId: string | null;
    dialinHourlyCap: number;
    outboundDailyMinutesCap: number;
  },
): Promise<Response> {
  const blockedCtx = {
    orgId: ctx.orgId,
    businessNumberId: ctx.businessNumber.id,
    from: ctx.personalNumberE164,
    at: event.at,
    callRef: event.callRef,
    initiatingUserId: ctx.initiatingUserId,
  };

  const attempts = await incrementDialinHourlyAttempts(deps, ctx.orgId);
  if (attempts > ctx.dialinHourlyCap) {
    await writeTerminalCall(deps.db, dialinBlockedCallLog(blockedCtx, 'rate_limited'));
    return renderInstructionResponse(deps, { kind: 'reject', cause: 'busy' }, event.callRef);
  }

  const remainingSeconds = await remainingDailyOutboundSeconds(
    deps,
    ctx.orgId,
    ctx.outboundDailyMinutesCap,
  );
  if (remainingSeconds <= 0) {
    await writeTerminalCall(deps.db, dialinBlockedCallLog(blockedCtx, 'daily_cap_reached'));
    return renderInstructionResponse(deps, { kind: 'reject', cause: 'busy' }, event.callRef);
  }

  const { instruction, sessionInsert } = decideDialinEntry({
    orgId: ctx.orgId,
    businessNumberId: ctx.businessNumber.id,
    callRef: event.callRef,
    from: ctx.personalNumberE164,
  });

  try {
    // Idempotent on exact redelivery (same convention as the inbound branch above):
    // a redelivered call.incoming for the same callRef is a no-op, not a fresh
    // concurrency conflict. A genuine second concurrent dial-in (different callRef,
    // same org already collecting/bridging/bridged) still throws on the OTHER
    // (partial, orgId-scoped) unique index, caught below.
    await deps.db
      .insert(callSessions)
      .values(sessionInsert)
      .onConflictDoNothing({ target: callSessions.providerCallRef });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    await writeTerminalCall(deps.db, dialinBlockedCallLog(blockedCtx, 'concurrent_bridge'));
    return renderInstructionResponse(deps, { kind: 'reject', cause: 'busy' }, event.callRef);
  }

  return renderInstructionResponse(deps, instruction, event.callRef);
}

async function handleCallLeg(
  deps: Deps,
  event: Extract<TelephonyEvent, { type: 'call.leg' }>,
): Promise<Response> {
  const rows = await deps.db
    .select()
    .from(callSessions)
    .where(eq(callSessions.providerCallRef, event.callRef));
  const session = rows[0] ?? null;
  if (!session) {
    await writeAuditEvent(deps.db, {
      type: 'webhook_ignored',
      meta: { reason: 'leg_event_unknown_call_ref' },
    });
    return Response.json({ ignored: true }, { status: 200 });
  }

  const update = deriveLegRecordUpdate({
    legStatus: event.legStatus,
    errorCode: event.errorCode,
    at: event.at,
  });
  await deps.db
    .update(callSessions)
    .set({
      ...(update.answeredAt ? { answeredAt: update.answeredAt } : {}),
      ...(update.state ? { state: update.state } : {}),
      ...(update.lastLegStatus ? { lastLegStatus: update.lastLegStatus } : {}),
      ...(update.lastLegStatus ? { lastLegErrorCode: update.lastLegErrorCode ?? null } : {}),
      updatedAt: deps.now(),
    })
    .where(eq(callSessions.id, session.id));
  return Response.json({ ok: true }, { status: 200 });
}

/**
 * design.md §5.2 `COLLECTING` → hangup/refuseTone/`BRIDGING`. A dtmf event on any
 * other session shape (no session, inbound session, or a dial-in session already past
 * `collecting`) is acked-and-ignored (§4.3) — this is also how "no retry" (decisions.md
 * #13) falls out for free: a second dtmf on an already-finalized (deleted) session
 * finds no session at all.
 */
async function handleCallDtmf(
  deps: Deps,
  event: Extract<TelephonyEvent, { type: 'call.dtmf' }>,
): Promise<Response> {
  const rows = await deps.db
    .select()
    .from(callSessions)
    .where(eq(callSessions.providerCallRef, event.callRef));
  const session = rows[0] ?? null;
  if (session?.kind !== 'dialin' || session.state !== 'collecting') {
    await writeAuditEvent(deps.db, {
      type: 'webhook_ignored',
      meta: { reason: 'dtmf_without_collecting_dialin_session' },
    });
    return Response.json({ ignored: true }, { status: 200 });
  }

  const businessNumberRows = await deps.db
    .select()
    .from(businessNumbers)
    .where(eq(businessNumbers.id, session.businessNumberId));
  const businessNumber = businessNumberRows[0] ?? null;
  const membershipRows = await deps.db
    .select()
    .from(memberships)
    .where(eq(memberships.orgId, session.orgId));
  const membership = membershipRows[0] ?? null;
  const orgRows = await deps.db.select().from(orgs).where(eq(orgs.id, session.orgId));
  const org = orgRows[0] ?? null;

  if (!businessNumber || !membership?.personalNumberE164 || !org) {
    // Defensive: unreachable given the session was created moments earlier from these
    // same rows.
    await writeAuditEvent(deps.db, {
      type: 'webhook_ignored',
      meta: { reason: 'dtmf_missing_context' },
    });
    return Response.json({ ignored: true }, { status: 200 });
  }

  const denyPrefixes = await listDialPolicyDenyPrefixes(deps);
  const remainingSeconds = await remainingDailyOutboundSeconds(
    deps,
    session.orgId,
    org.outboundDailyMinutesCap,
  );

  const decision = decideDialinDigits({
    digits: event.digits,
    at: event.at,
    callRef: event.callRef,
    orgId: session.orgId,
    businessNumberId: businessNumber.id,
    businessNumberE164: businessNumber.e164,
    personalNumberE164: membership.personalNumberE164,
    fromE164: session.fromE164 ?? membership.personalNumberE164,
    denyPrefixes,
    remainingDailySeconds: remainingSeconds,
    initiatingUserId: membership.userId,
  });

  if (decision.outcome === 'bridge') {
    await deps.db
      .update(callSessions)
      .set({ state: 'bridging', targetE164: decision.targetE164, updatedAt: deps.now() })
      .where(eq(callSessions.id, session.id));
    return renderInstructionResponse(deps, decision.instruction, event.callRef);
  }

  // timeout / refused — decision-time terminal (design.md §5.0): write + delete now,
  // no retry (decisions.md #13).
  await writeTerminalCall(deps.db, decision.callLogWrite);
  await deps.db.delete(callSessions).where(eq(callSessions.id, session.id));
  return renderInstructionResponse(deps, decision.instruction, event.callRef);
}

async function handleCallCompleted(
  deps: Deps,
  event: Extract<TelephonyEvent, { type: 'call.completed' }>,
): Promise<Response> {
  const rows = await deps.db
    .select()
    .from(callSessions)
    .where(eq(callSessions.providerCallRef, event.callRef));
  const session = rows[0] ?? null;
  if (!session) {
    // Late/unknown callRef (design.md §4.3): session already finalized-and-deleted,
    // swept by the 4h purge, or never existed. Ack 200, change nothing, count it.
    await writeAuditEvent(deps.db, {
      type: 'webhook_ignored',
      meta: { reason: 'completed_event_unknown_or_finalized_call_ref' },
    });
    return Response.json({ ignored: true }, { status: 200 });
  }

  const businessNumberRows = await deps.db
    .select()
    .from(businessNumbers)
    .where(eq(businessNumbers.id, session.businessNumberId));
  const businessNumber = businessNumberRows[0] ?? null;

  const outcome = deriveFinalization(
    {
      kind: session.kind,
      state: session.state,
      answeredAt: session.answeredAt,
      lastLegStatus: session.lastLegStatus,
      lastLegErrorCode: session.lastLegErrorCode,
    },
    { durationSeconds: event.durationSeconds, errorCode: event.errorCode },
  );

  // Outbound (dial-in) finalization's initiating user is the org's owner membership
  // (design.md §5.2/§5.3 — dial-in is single-owner MVP; ER-AUD-1 "initiating_user").
  let initiatingUserId: string | null = null;
  if (session.kind === 'dialin') {
    const membershipRows = await deps.db
      .select()
      .from(memberships)
      .where(eq(memberships.orgId, session.orgId));
    initiatingUserId = membershipRows[0]?.userId ?? null;
  }

  await writeTerminalCall(deps.db, {
    orgId: session.orgId,
    businessNumberId: session.businessNumberId,
    direction: session.kind === 'dialin' ? 'outbound' : 'inbound',
    status: outcome.status,
    reason: outcome.reason,
    fromE164: session.fromE164,
    toE164: session.kind === 'dialin' ? session.targetE164 : (businessNumber?.e164 ?? null),
    initiatingUserId,
    startedAt: session.createdAt,
    answeredAt: outcome.answeredAt,
    endedAt: event.at,
    durationSeconds: outcome.durationSeconds,
    providerCallRef: event.callRef,
    providerErrorCode: outcome.providerErrorCode,
  });

  await deps.db.delete(callSessions).where(eq(callSessions.id, session.id));
  return Response.json({ ok: true }, { status: 200 });
}

async function handleSmsStatus(): Promise<Response> {
  // No app-side state keyed on message refs yet (PIN delivery, M3, does not need the
  // delivery-status callback to function). Ack only.
  return Response.json({ ok: true }, { status: 200 });
}

function mapProvisioningStatus(
  status: 'submitted' | 'approved' | 'rejected' | 'active',
): 'docs_pending' | 'bundle_submitted' | 'approved' | 'rejected' | 'active' {
  switch (status) {
    case 'submitted':
      return 'bundle_submitted';
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    case 'active':
      return 'active';
    default:
      return assertNever(status);
  }
}

async function handleProvisioningUpdate(
  deps: Deps,
  event: Extract<TelephonyEvent, { type: 'provisioning.update' }>,
): Promise<Response> {
  let businessNumber = event.numberRef
    ? await findBusinessNumberByProviderNumberRef(deps.db, event.numberRef)
    : null;
  if (!businessNumber && event.bundleRef) {
    businessNumber = await findBusinessNumberByBundleRef(deps.db, event.bundleRef);
  }
  if (!businessNumber) {
    await writeAuditEvent(deps.db, {
      type: 'webhook_ignored',
      meta: { reason: 'unresolvable_provisioning_ref' },
    });
    return Response.json({ ignored: true }, { status: 200 });
  }

  const mappedStatus = mapProvisioningStatus(event.status);
  await updateBusinessNumberStatus(deps.db, businessNumber.id, {
    status: mappedStatus,
    providerRejectionReason: event.status === 'rejected' ? (event.reason ?? null) : null,
    ...(event.status === 'active' ? { activatedAt: deps.now() } : {}),
  });

  // ER-AUD-2 lifecycle event — org-scoped (the org still exists at this point; the
  // org_id:null PII-free variant is written on erasure's own release call, not here).
  await writeAuditEvent(deps.db, {
    orgId: businessNumber.orgId,
    type: 'number_lifecycle',
    retentionClass: 'lifecycle',
    meta: { status: mappedStatus, source: 'provisioning_webhook' },
  });
  return Response.json({ ok: true }, { status: 200 });
}

/** Provider webhook surface — signature-authenticated, never session-authenticated
 * (design.md §4). */
export function webhooksRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  r.post('/telephony/:provider', async (c) => {
    const providerParam = c.req.param('provider');
    if (providerParam !== deps.provider.name) {
      return c.json({ error: 'not_found' }, 404);
    }

    const rawBody = await c.req.text();
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const rawReq: RawWebhookRequest = {
      method: c.req.method,
      url: c.req.url,
      headers,
      rawBody,
    };

    const verification = await deps.provider.verifyWebhook(rawReq);
    if (!verification.ok) {
      await recordInvalidSignature(deps, verification.reason);
      return c.json({ error: 'invalid_signature' }, 401);
    }

    let event: TelephonyEvent;
    try {
      event = deps.provider.parseWebhook(rawReq);
    } catch (err) {
      if (err instanceof MalformedWebhookError) {
        return c.json({ error: 'malformed_webhook', reason: err.message }, 400);
      }
      throw err;
    }

    const validation = telephonyEventSchema.safeParse(event);
    if (!validation.success) {
      return c.json({ error: 'malformed_webhook', reason: 'neutral event failed validation' }, 400);
    }
    const validated = validation.data as TelephonyEvent;

    try {
      switch (validated.type) {
        case 'call.incoming':
          return await handleCallIncoming(deps, validated);
        case 'call.leg':
          return await handleCallLeg(deps, validated);
        case 'call.dtmf':
          return await handleCallDtmf(deps, validated);
        case 'call.completed':
          return await handleCallCompleted(deps, validated);
        case 'sms.status':
          return await handleSmsStatus();
        case 'provisioning.update':
          return await handleProvisioningUpdate(deps, validated);
        default:
          return assertNever(validated);
      }
    } catch (err) {
      // design.md §4.3: never a 5xx — providers redeliver for hours on error
      // responses, which only compounds the underlying problem. Log and ack.
      safeLog('error', 'webhook processing failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json({ error: 'internal_error_acked' }, 200);
    }
  });

  return r;
}

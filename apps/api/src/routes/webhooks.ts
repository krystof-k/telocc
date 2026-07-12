/**
 * Provider webhook surface — signature-authenticated, never session-authenticated
 * (design.md §4). This file is exempt from the "routes import repos, not @telocc/db"
 * convention (seam-isolation.contract.test.ts) since the webhook path resolves org
 * identity from the called business number itself, not from a session (design.md §3
 * "Org-scoping pattern" point 3).
 *
 * Flow (design.md §4.3): verifyWebhook → parseWebhook → zod-validate the neutral event
 * (belt over the seam boundary) → minimal inbound routing (§5.1/§5.0) → renderInstruction.
 *
 * SCOPE NOTE: `core/routing/inbound.ts` (M5) and `core/routing/dialin.ts` (M6) are still
 * stubs — those milestones own the full state machines. This file implements just
 * enough of the inbound (customer → business number) flow, inline, to satisfy this
 * milestone's contract gates (webhook-auth, provisioning, the rate-limits webhook
 * case): office-hours + verified-number gating, session bookkeeping, and
 * `call.completed` finalization per §5.0. It never creates a `dialin`-kind session
 * (that entry condition — signalling CLI exactly matching the org's verified personal
 * number — is M6's dial-policy/dialin machine), so `call.dtmf` is always a no-op here.
 * M5/M6 will very likely refactor this file to delegate to their state machines.
 */
import { createHash } from 'node:crypto';
import { writeAuditEvent } from '@telocc/core/repos/audit';
import {
  findBusinessNumberByBundleRef,
  findBusinessNumberByE164,
  findBusinessNumberByProviderNumberRef,
  updateBusinessNumberStatus,
} from '@telocc/core/repos/numbers';
import {
  businessNumbers,
  callSessions,
  calls,
  memberships,
  officeHourRules,
  orgs,
  rateLimitCounters,
} from '@telocc/db';
import {
  type CallInstruction,
  MalformedWebhookError,
  parseE164,
  presentedCli,
  type RawWebhookRequest,
  type RenderContext,
  type TelephonyEvent,
} from '@telocc/telephony';
import { eq, sql } from 'drizzle-orm';
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
// Office hours (design.md §8) — minimal inline evaluation. M5 owns the real,
// reusable `core/office-hours.ts::isOpen`; this mirrors its documented algorithm
// (Intl-based, zero deps) just enough for the inbound decision above.
// ---------------------------------------------------------------------------

interface OfficeHourRuleRow {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

function minutesOf(hhmmss: string): number {
  const [h, m] = hhmmss.split(':');
  return Number(h ?? 0) * 60 + Number(m ?? 0);
}

function isOrgOpenNow(
  mode: 'schedule' | 'always_open' | 'always_closed',
  rules: OfficeHourRuleRow[],
  now: Date,
  timezone: string,
): boolean {
  if (mode === 'always_open') return true;
  if (mode === 'always_closed') return false;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const weekdayShort = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const weekday = WEEKDAY_INDEX[weekdayShort];
  if (weekday === undefined) return false;

  const rule = rules.find((r) => r.weekday === weekday);
  if (!rule) return false;
  const minutesNow = hour * 60 + minute;
  return minutesNow >= minutesOf(rule.opensAt) && minutesNow < minutesOf(rule.closesAt);
}

// ---------------------------------------------------------------------------
// Signature-failure counting → synchronous anomaly flag (decisions.md #39).
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

// ---------------------------------------------------------------------------
// calls-table writer. `core/call-log.ts` (design.md §3.2, decisions.md #19) is the
// documented long-term "only module inserting into calls"; it is still an M5/M6 stub,
// so this file writes directly (permitted here — see the file-header note) until that
// lands and this can delegate instead.
// ---------------------------------------------------------------------------

type CallStatus =
  | 'answered'
  | 'missed'
  | 'declined'
  | 'failed'
  | 'blocked'
  | 'emergency_refused'
  | 'destination_blocked';

interface TerminalCallInput {
  orgId: string;
  businessNumberId: string;
  direction: 'inbound' | 'outbound';
  status: CallStatus;
  reason: string | null;
  fromE164: string | null;
  toE164: string | null;
  startedAt: Date;
  answeredAt?: Date | null;
  endedAt: Date;
  durationSeconds?: number;
  providerCallRef: string;
  providerErrorCode?: string | null;
}

async function writeTerminalCall(deps: Deps, input: TerminalCallInput): Promise<void> {
  await deps.db.insert(calls).values({
    orgId: input.orgId,
    businessNumberId: input.businessNumberId,
    direction: input.direction,
    status: input.status,
    reason: input.reason,
    fromE164: input.fromE164,
    toE164: input.toE164,
    startedAt: input.startedAt,
    answeredAt: input.answeredAt ?? null,
    endedAt: input.endedAt,
    durationSeconds: input.durationSeconds ?? 0,
    providerCallRef: input.providerCallRef,
    providerErrorCode: input.providerErrorCode ?? null,
  });
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
// Per-event-type handlers.
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

  const now = deps.now();
  const hasVerifiedNumber =
    membership?.personalNumberVerifiedAt != null && membership.personalNumberE164 != null;

  if (!hasVerifiedNumber) {
    await writeTerminalCall(deps, {
      orgId,
      businessNumberId: businessNumber.id,
      direction: 'inbound',
      status: 'declined',
      reason: 'no_verified_number',
      fromE164: event.from,
      toE164: event.to,
      startedAt: event.at,
      endedAt: event.at,
      providerCallRef: event.callRef,
    });
    return renderInstructionResponse(deps, { kind: 'reject', cause: 'busy' }, event.callRef);
  }

  const open = org ? isOrgOpenNow(org.officeHoursMode, rules, now, org.timezone) : false;
  if (!open) {
    await writeTerminalCall(deps, {
      orgId,
      businessNumberId: businessNumber.id,
      direction: 'inbound',
      status: 'declined',
      reason: 'out_of_hours',
      fromE164: event.from,
      toE164: event.to,
      startedAt: event.at,
      endedAt: event.at,
      providerCallRef: event.callRef,
    });
    return renderInstructionResponse(deps, { kind: 'reject', cause: 'busy' }, event.callRef);
  }

  const personalE164 = parseE164(membership?.personalNumberE164 ?? '');
  if (!personalE164) {
    // Defensive: the DB CHECK constraint should make this unreachable in practice.
    await writeTerminalCall(deps, {
      orgId,
      businessNumberId: businessNumber.id,
      direction: 'inbound',
      status: 'declined',
      reason: 'no_verified_number',
      fromE164: event.from,
      toE164: event.to,
      startedAt: event.at,
      endedAt: event.at,
      providerCallRef: event.callRef,
    });
    return renderInstructionResponse(deps, { kind: 'reject', cause: 'busy' }, event.callRef);
  }

  // Idempotent: a redelivered call.incoming for the same callRef is a no-op.
  await deps.db
    .insert(callSessions)
    .values({
      orgId,
      businessNumberId: businessNumber.id,
      providerCallRef: event.callRef,
      kind: 'inbound',
      state: 'forwarding',
      fromE164: event.from,
    })
    .onConflictDoNothing({ target: callSessions.providerCallRef });

  const instruction: CallInstruction = {
    kind: 'forward',
    to: personalE164,
    callerId: presentedCli({ id: businessNumber.id, e164: businessNumber.e164, status: 'active' }),
    timeoutSeconds: 120,
  };
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

  if (event.legStatus === 'answered') {
    await deps.db
      .update(callSessions)
      .set({ answeredAt: event.at, state: 'bridged', updatedAt: deps.now() })
      .where(eq(callSessions.id, session.id));
  } else {
    await deps.db
      .update(callSessions)
      .set({
        lastLegStatus: event.legStatus,
        lastLegErrorCode: event.errorCode ?? null,
        updatedAt: deps.now(),
      })
      .where(eq(callSessions.id, session.id));
  }
  return Response.json({ ok: true }, { status: 200 });
}

async function handleCallDtmf(
  deps: Deps,
  event: Extract<TelephonyEvent, { type: 'call.dtmf' }>,
): Promise<Response> {
  const rows = await deps.db
    .select()
    .from(callSessions)
    .where(eq(callSessions.providerCallRef, event.callRef));
  const session = rows[0] ?? null;
  // The appless-outbound (dial-in → DTMF → bridge) machine is M6 scope
  // (core/routing/dialin.ts); this milestone's call.incoming handler never creates a
  // `dialin`-kind session, so there is nothing to collect against yet.
  if (session?.kind !== 'dialin') {
    await writeAuditEvent(deps.db, {
      type: 'webhook_ignored',
      meta: { reason: 'dtmf_without_dialin_session' },
    });
    return Response.json({ ignored: true }, { status: 200 });
  }
  return Response.json({ ok: true }, { status: 200 });
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

  let status: CallStatus;
  let reason: string | null;
  let providerErrorCode: string | null = null;

  if (session.answeredAt) {
    status = 'answered';
    reason = null;
  } else if (session.lastLegStatus === 'busy' || session.lastLegStatus === 'no_answer') {
    status = 'missed';
    reason = null;
  } else if (session.lastLegStatus === 'failed') {
    status = 'failed';
    reason = null;
    providerErrorCode = session.lastLegErrorCode ?? event.errorCode ?? null;
  } else {
    // No dialled-leg outcome at all — the caller hung up while ringing (§5.0).
    status = session.kind === 'dialin' && session.state === 'collecting' ? 'failed' : 'missed';
    reason = 'caller_hangup';
  }

  await writeTerminalCall(deps, {
    orgId: session.orgId,
    businessNumberId: session.businessNumberId,
    direction: session.kind === 'dialin' ? 'outbound' : 'inbound',
    status,
    reason,
    fromE164: session.fromE164,
    toE164: session.kind === 'dialin' ? session.targetE164 : (businessNumber?.e164 ?? null),
    startedAt: session.createdAt,
    answeredAt: session.answeredAt ?? null,
    endedAt: event.at,
    durationSeconds: session.answeredAt ? event.durationSeconds : 0,
    providerCallRef: event.callRef,
    providerErrorCode,
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

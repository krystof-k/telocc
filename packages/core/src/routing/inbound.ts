/**
 * Inbound routing state machine (design.md §5.1) — the `call.incoming` decision for a
 * customer calling the business number. Pure function of `(org-context, event, now)`;
 * no I/O (design.md §5: "pure functions of (session-state, event, org-context, now) →
 * { instruction?, sessionTransition?, callLogWrite? }"). The webhook route
 * (`apps/api/src/routes/webhooks.ts`) loads the business number/membership/office-hour
 * rules, calls this, then persists whatever the decision says to persist.
 *
 * Entry condition (design.md §5.1): every `call.incoming` where the org has no
 * dial-in machine to divert to yet reaches here — the actual dial-in entry check
 * (signalling `from` exactly matching the org's verified personal number) is M6's
 * `core/routing/dialin.ts`/`core/dial-policy.ts`; until that lands, every inbound call
 * is a customer call.
 */
import { type CallInstruction, type E164, parseE164, presentedCli } from '@telocc/telephony';
import type { TerminalCallInput } from '../call-log.ts';
import { isOpen, type OfficeHourRule, type OfficeHoursMode } from '../office-hours.ts';

/** Deliberately longer than any personal-carrier outcome (design.md §5.1): the
 * customer's own carrier decides the result (voicemail → answered; ring-out/reject →
 * missed) — the timeout is only a backstop against a leg that never resolves. */
export const FORWARD_TIMEOUT_SECONDS = 120;

export interface InboundIncomingContext {
  now: Date;
  callRef: string;
  from: string | null;
  at: Date;
  orgId: string;
  businessNumber: { id: string; e164: string };
  hasVerifiedPersonalNumber: boolean;
  personalNumberE164: string | null;
  officeHoursMode: OfficeHoursMode;
  officeHourRules: readonly OfficeHourRule[];
  timezone: string;
}

export interface InboundSessionInsert {
  orgId: string;
  businessNumberId: string;
  providerCallRef: string;
  kind: 'inbound';
  state: 'forwarding';
  fromE164: string | null;
}

export type InboundIncomingDecision =
  | { outcome: 'declined'; callLogWrite: TerminalCallInput }
  | {
      outcome: 'forwarded';
      instruction: Extract<CallInstruction, { kind: 'forward' }>;
      sessionInsert: InboundSessionInsert;
    };

function declineWrite(
  ctx: InboundIncomingContext,
  reason: 'no_verified_number' | 'out_of_hours',
): TerminalCallInput {
  return {
    orgId: ctx.orgId,
    businessNumberId: ctx.businessNumber.id,
    direction: 'inbound',
    status: 'declined',
    reason,
    fromE164: ctx.from,
    toE164: ctx.businessNumber.e164,
    startedAt: ctx.at,
    endedAt: ctx.at,
    providerCallRef: ctx.callRef,
  };
}

/**
 * `RECEIVED` decision (design.md §5.1):
 * 1. no verified personal number on the org → reject busy, `declined/no_verified_number`.
 * 2. office hours closed → reject busy, `declined/out_of_hours`.
 * 3. open → `FORWARDING`, `forward(to=personal#, callerId=business#, timeout=120s)`.
 */
export function decideInboundIncoming(ctx: InboundIncomingContext): InboundIncomingDecision {
  if (!ctx.hasVerifiedPersonalNumber || !ctx.personalNumberE164) {
    return { outcome: 'declined', callLogWrite: declineWrite(ctx, 'no_verified_number') };
  }

  const personalE164: E164 | null = parseE164(ctx.personalNumberE164);
  if (!personalE164) {
    // Defensive: the DB CHECK constraint should make this unreachable in practice.
    return { outcome: 'declined', callLogWrite: declineWrite(ctx, 'no_verified_number') };
  }

  const open = isOpen(ctx.officeHoursMode, ctx.officeHourRules, ctx.now, ctx.timezone);
  if (!open) {
    return { outcome: 'declined', callLogWrite: declineWrite(ctx, 'out_of_hours') };
  }

  const instruction: Extract<CallInstruction, { kind: 'forward' }> = {
    kind: 'forward',
    to: personalE164,
    callerId: presentedCli({
      id: ctx.businessNumber.id,
      e164: ctx.businessNumber.e164,
      status: 'active',
    }),
    timeoutSeconds: FORWARD_TIMEOUT_SECONDS,
  };

  return {
    outcome: 'forwarded',
    instruction,
    sessionInsert: {
      orgId: ctx.orgId,
      businessNumberId: ctx.businessNumber.id,
      providerCallRef: ctx.callRef,
      kind: 'inbound',
      state: 'forwarding',
      fromE164: ctx.from,
    },
  };
}

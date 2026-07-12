/**
 * Appless outbound (dial-in → DTMF → bridge) state machine (design.md §5.2, ER-CLI-1,
 * ER-RATE-2). Pure functions of `(session-state, event, org-context, now)`, same shape
 * as `routing/inbound.ts` (design.md §5). The webhook route
 * (`apps/api/src/routes/webhooks.ts`) does the I/O — resolving the verified-personal-
 * number entry match, the hourly-attempt counter, the daily-minutes consumption sum,
 * and the structural concurrent-bridge INSERT (decisions.md #29) — then calls into
 * these decisions and persists whatever they say to persist.
 */
import {
  type CallInstruction,
  type E164,
  type PresentedCli,
  presentedCli,
} from '@telocc/telephony';
import type { TerminalCallInput } from '../call-log.ts';
import { classifyDialedDigits, type DialPolicyDenyPrefix } from '../dial-policy.ts';

/** design.md §5.2 COLLECTING instruction. */
export const DTMF_MAX_DIGITS = 16;
export const DTMF_COLLECT_TIMEOUT_SECONDS = 10;
/** design.md §5.2 BRIDGING instruction ring timeout (distinct from the 120s forward
 * timeout of §5.1 — this is an appless outbound leg, not the inbound-forward leg). */
export const DIALIN_BRIDGE_RING_TIMEOUT_SECONDS = 30;

export interface DialinSessionInsert {
  orgId: string;
  businessNumberId: string;
  providerCallRef: string;
  kind: 'dialin';
  state: 'collecting';
  fromE164: string;
}

/**
 * `RECEIVED` → `COLLECTING` (design.md §5.2): only reachable once the caller has
 * already been I/O-matched to the org's verified personal number and passed every
 * pre-check (hourly cap, daily-minutes remainder, structural concurrency INSERT) — all
 * three live in the webhook route since they need counters/queries this pure function
 * deliberately has no access to.
 */
export function decideDialinEntry(ctx: {
  orgId: string;
  businessNumberId: string;
  callRef: string;
  from: string;
}): {
  instruction: Extract<CallInstruction, { kind: 'collectDigits' }>;
  sessionInsert: DialinSessionInsert;
} {
  return {
    instruction: {
      kind: 'collectDigits',
      prompt: 'beep',
      maxDigits: DTMF_MAX_DIGITS,
      finishKey: '#',
      timeoutSeconds: DTMF_COLLECT_TIMEOUT_SECONDS,
    },
    sessionInsert: {
      orgId: ctx.orgId,
      businessNumberId: ctx.businessNumberId,
      providerCallRef: ctx.callRef,
      kind: 'dialin',
      state: 'collecting',
      fromE164: ctx.from,
    },
  };
}

/** A pre-check failure (rate limit / daily cap / structural concurrency) is a
 * decision-time terminal (design.md §5.0) — logged immediately, no session ever
 * created for it. */
export function dialinBlockedCallLog(
  ctx: {
    orgId: string;
    businessNumberId: string;
    from: string;
    at: Date;
    callRef: string;
    initiatingUserId: string | null;
  },
  reason: 'rate_limited' | 'daily_cap_reached' | 'concurrent_bridge',
): TerminalCallInput {
  return {
    orgId: ctx.orgId,
    businessNumberId: ctx.businessNumberId,
    direction: 'outbound',
    status: 'blocked',
    reason,
    fromE164: ctx.from,
    toE164: null,
    initiatingUserId: ctx.initiatingUserId,
    startedAt: ctx.at,
    endedAt: ctx.at,
    providerCallRef: ctx.callRef,
  };
}

export type DialinDigitsDecision =
  | {
      outcome: 'timeout';
      instruction: Extract<CallInstruction, { kind: 'hangup' }>;
      callLogWrite: TerminalCallInput;
    }
  | {
      outcome: 'refused';
      instruction: Extract<CallInstruction, { kind: 'refuseTone' }>;
      callLogWrite: TerminalCallInput;
    }
  | {
      outcome: 'bridge';
      instruction: Extract<CallInstruction, { kind: 'bridge' }>;
      targetE164: E164;
    };

/**
 * `COLLECTING` → hangup / refuseTone / `BRIDGING` (design.md §5.2): the DTMF-validate
 * decision. `digits === ''` is the Gather inactivity timeout (§4.1's neutral-event
 * contract); anything else runs the dial-policy classification (§5.2 steps a-g) — no
 * retry either way (decisions.md #13), the caller deletes the session on every branch
 * except `bridge`.
 */
export function decideDialinDigits(ctx: {
  digits: string;
  at: Date;
  callRef: string;
  orgId: string;
  businessNumberId: string;
  businessNumberE164: string;
  personalNumberE164: string;
  fromE164: string;
  denyPrefixes: readonly DialPolicyDenyPrefix[];
  remainingDailySeconds: number;
  initiatingUserId: string | null;
}): DialinDigitsDecision {
  const baseLog = (
    status: 'failed' | 'emergency_refused' | 'destination_blocked',
    reason: string | null,
  ): TerminalCallInput => ({
    orgId: ctx.orgId,
    businessNumberId: ctx.businessNumberId,
    direction: 'outbound',
    status,
    reason,
    fromE164: ctx.fromE164,
    toE164: null,
    initiatingUserId: ctx.initiatingUserId,
    startedAt: ctx.at,
    endedAt: ctx.at,
    providerCallRef: ctx.callRef,
  });

  if (ctx.digits === '') {
    return {
      outcome: 'timeout',
      instruction: { kind: 'hangup' },
      callLogWrite: baseLog('failed', 'inactivity_timeout'),
    };
  }

  const classification = classifyDialedDigits({
    digitsRaw: ctx.digits,
    businessNumberE164: ctx.businessNumberE164,
    personalNumberE164: ctx.personalNumberE164,
    denyPrefixes: ctx.denyPrefixes,
  });

  switch (classification.kind) {
    case 'emergency':
      return {
        outcome: 'refused',
        instruction: { kind: 'refuseTone' },
        callLogWrite: baseLog('emergency_refused', null),
      };
    case 'short_code':
      return {
        outcome: 'refused',
        instruction: { kind: 'refuseTone' },
        callLogWrite: baseLog('destination_blocked', 'short_code'),
      };
    case 'international':
      return {
        outcome: 'refused',
        instruction: { kind: 'refuseTone' },
        callLogWrite: baseLog('destination_blocked', 'international'),
      };
    case 'premium':
      return {
        outcome: 'refused',
        instruction: { kind: 'refuseTone' },
        callLogWrite: baseLog('destination_blocked', 'premium'),
      };
    case 'invalid_target':
      return {
        outcome: 'refused',
        instruction: { kind: 'refuseTone' },
        callLogWrite: baseLog('failed', 'invalid_target'),
      };
    case 'valid': {
      const callerId: PresentedCli = presentedCli({
        id: ctx.businessNumberId,
        e164: ctx.businessNumberE164,
        status: 'active',
      });
      const instruction: Extract<CallInstruction, { kind: 'bridge' }> = {
        kind: 'bridge',
        target: classification.target,
        callerId,
        timeoutSeconds: DIALIN_BRIDGE_RING_TIMEOUT_SECONDS,
        maxDurationSeconds: Math.max(ctx.remainingDailySeconds, 0),
      };
      return { outcome: 'bridge', instruction, targetE164: classification.target };
    }
    default: {
      const _exhaustive: never = classification;
      throw new Error(`unreachable dial policy classification: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

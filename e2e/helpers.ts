/**
 * Shared helpers for the e2e suite (docs/testing.md "E2E scope"). Runs against the demo
 * stack (`playwright.config.ts`'s `webServer` shells out to `scripts/demo.mjs`), so
 * every test drives the same seeded org — **Demo s.r.o.** (`packages/db/src/seed/demo.ts`)
 * — through the real magic-link/session/office-hours/simulator surfaces, never a
 * shortcut. This suite follows the "seeded-org path" (docs/milestones.md M10 "onboarding
 * path OR seeded-org path"): the demo seed is already fully onboarded, so login lands
 * straight on the dashboard.
 */
import type { APIRequestContext } from '@playwright/test';

export const DEMO_EMAIL = 'demo@telocc.example';
export const DEMO_BUSINESS_NUMBER = '+420212345678';
export const DEMO_PERSONAL_NUMBER = '+420777123456';

interface MailboxMessage {
  to: string;
  subject: string;
  text: string;
  sentAt: string;
}

/** Requests a fresh magic link for `email` through the real rate-limited route. */
export async function requestMagicLink(
  request: APIRequestContext,
  email: string = DEMO_EMAIL,
): Promise<void> {
  const res = await request.post('/api/auth/sign-in/magic-link', { data: { email } });
  if (!res.ok()) {
    throw new Error(`requestMagicLink: POST /api/auth/sign-in/magic-link -> ${res.status()}`);
  }
}

/** Retrieves the most recent magic-link URL sent to `email` via the dev mailbox
 * (`GET /dev/mailbox`, env-gated — `apps/api/src/routes/dev/index.ts`). */
export async function getLatestMagicLink(
  request: APIRequestContext,
  email: string = DEMO_EMAIL,
): Promise<string> {
  const res = await request.get('/dev/mailbox');
  if (!res.ok()) {
    throw new Error(`getLatestMagicLink: GET /dev/mailbox -> ${res.status()}`);
  }
  const body = (await res.json()) as { messages: MailboxMessage[] };
  const mine = (body.messages ?? []).filter((m) => m.to === email);
  const last = mine.at(-1);
  if (!last) throw new Error(`getLatestMagicLink: no mailbox message found for ${email}`);
  const match = /https?:\/\/\S+/.exec(last.text);
  if (!match) throw new Error('getLatestMagicLink: no URL found in the magic-link email body');
  return match[0];
}

export interface CallDto {
  id: string;
  direction: 'inbound' | 'outbound';
  status: string;
  reason: string | null;
  fromE164: string | null;
  toE164: string | null;
  startedAt: string;
  durationSeconds: number;
  providerCallRef: string | null;
}

/** Reads the call log through the authenticated API (deterministic — avoids racing the
 * UI's own poll interval). Requires an authenticated request context (the suite-wide
 * `storageState` from `e2e/global-setup.ts`, unless a test explicitly opted out of it). */
export async function listCalls(request: APIRequestContext): Promise<CallDto[]> {
  const res = await request.get('/api/calls');
  if (!res.ok()) throw new Error(`listCalls: GET /api/calls -> ${res.status()}`);
  const body = (await res.json()) as { items: CallDto[] };
  return body.items;
}

/** Polls `/api/calls` until a row matching `predicate` appears (the call log is
 * write-once and asynchronous relative to the simulator's fire-and-forget buttons). */
export async function waitForCall(
  request: APIRequestContext,
  predicate: (call: CallDto) => boolean,
  { timeoutMs = 10_000, intervalMs = 250 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<CallDto> {
  const start = Date.now();
  for (;;) {
    const calls = await listCalls(request);
    const match = calls.find(predicate);
    if (match) return match;
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitForCall: timed out waiting for a matching call-log row');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export interface OfficeHoursDto {
  mode: 'schedule' | 'always_open' | 'always_closed';
  timezone: string;
  rules: { weekday: number; opensAt: string; closesAt: string }[];
}

export async function getOfficeHours(request: APIRequestContext): Promise<OfficeHoursDto> {
  const res = await request.get('/api/office-hours');
  if (!res.ok()) throw new Error(`getOfficeHours: GET /api/office-hours -> ${res.status()}`);
  return res.json();
}

/** Forces office hours to `mode` for the duration of a test — callers should always
 * restore the original settings afterwards (each test that mutates shared demo-org
 * state is responsible for putting it back, since the demo stack is a single long-lived
 * process, not reset between test files). */
export async function setOfficeHoursMode(
  request: APIRequestContext,
  mode: OfficeHoursDto['mode'],
  base: OfficeHoursDto,
): Promise<void> {
  const res = await request.put('/api/office-hours', { data: { ...base, mode } });
  if (!res.ok()) throw new Error(`setOfficeHoursMode: PUT /api/office-hours -> ${res.status()}`);
}

interface SimResult {
  status: number;
  instruction: { kind: string } | null;
}

function simRef(prefix: string): string {
  return `e2e_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Fires a simulated inbound call via the real signed-webhook path (`/dev/sim/*`,
 * env-gated), returning the callRef used so callers can drive the rest of the call. */
export async function simIncomingCall(
  request: APIRequestContext,
  params: { to: string; from: string | null },
): Promise<{ callRef: string; result: SimResult }> {
  const callRef = simRef('call');
  const res = await request.post('/dev/sim/incoming-call', { data: { callRef, ...params } });
  if (!res.ok()) throw new Error(`simIncomingCall -> ${res.status()}`);
  return { callRef, result: await res.json() };
}

export async function simDtmf(
  request: APIRequestContext,
  params: { callRef: string; digits: string },
): Promise<SimResult> {
  const res = await request.post('/dev/sim/dtmf', { data: params });
  if (!res.ok()) throw new Error(`simDtmf -> ${res.status()}`);
  return res.json();
}

export async function simLegAnswered(
  request: APIRequestContext,
  callRef: string,
): Promise<SimResult> {
  const res = await request.post('/dev/sim/leg-answered', { data: { callRef } });
  if (!res.ok()) throw new Error(`simLegAnswered -> ${res.status()}`);
  return res.json();
}

export async function simLegEnded(
  request: APIRequestContext,
  callRef: string,
  legStatus: 'busy' | 'no_answer' | 'failed',
): Promise<SimResult> {
  const res = await request.post('/dev/sim/leg-ended', { data: { callRef, legStatus } });
  if (!res.ok()) throw new Error(`simLegEnded -> ${res.status()}`);
  return res.json();
}

export async function simHangup(
  request: APIRequestContext,
  callRef: string,
  durationSeconds: number,
): Promise<SimResult> {
  const res = await request.post('/dev/sim/hangup', { data: { callRef, durationSeconds } });
  if (!res.ok()) throw new Error(`simHangup -> ${res.status()}`);
  return res.json();
}

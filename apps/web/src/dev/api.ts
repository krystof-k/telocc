/**
 * Fetch helpers for the dev simulator page (docs/design.md §12, §11 "Dev simulator
 * page"; docs/milestones.md M10). Deliberately self-contained — a small local copy of
 * `apps/web/src/lib/api.ts`'s `request()` shape rather than an import from it, since
 * `lib/**` is owned by the concurrently-running M7.1 milestone (coordinate-free: this
 * file must keep working across whatever shape `lib/api.ts` ends up in).
 *
 * Talks to three surfaces:
 *  - `/dev/sim/*` and `/dev/mailbox` (env-gated, unauthenticated — `apps/api/src/routes/dev/index.ts`)
 *  - `/api/office-hours` and `/api/calls` (session-cookie authenticated — used by the
 *    "out-of-hours" flow and the live call-log panel; both degrade gracefully to a
 *    "sign in first" state when no session cookie is present)
 */

export class DevApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'DevApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `http_${res.status}`;
    throw new DevApiError(res.status, message);
  }
  return body as T;
}

function getJson<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

function postJson<T>(path: string, json: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(json) });
}

// ---- /dev/sim/demo-info ----

export interface DemoInfo {
  id: string;
  name: string;
  officeHoursMode: 'schedule' | 'always_open' | 'always_closed';
  personalNumberE164: string | null;
  personalNumberVerified: boolean;
  businessNumberE164: string | null;
  businessNumberStatus: string | null;
}

export async function getDemoInfo(): Promise<DemoInfo | null> {
  const res = await getJson<{ org: DemoInfo | null }>('/dev/sim/demo-info');
  return res.org;
}

// ---- /dev/sim/* (MockTelco driver — design.md §4.5/§12) ----

export type CallInstructionKind =
  | 'reject'
  | 'forward'
  | 'collectDigits'
  | 'bridge'
  | 'refuseTone'
  | 'hangup';

export interface SimInstruction {
  kind: CallInstructionKind;
  [key: string]: unknown;
}

export interface SimResult {
  status: number;
  bodyText: string;
  instruction: SimInstruction | null;
}

export function generateCallRef(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function simIncomingCall(params: {
  callRef: string;
  to: string;
  from: string | null;
}): Promise<SimResult> {
  return postJson('/dev/sim/incoming-call', params);
}

export function simDtmf(params: { callRef: string; digits: string }): Promise<SimResult> {
  return postJson('/dev/sim/dtmf', params);
}

export function simLegAnswered(params: { callRef: string }): Promise<SimResult> {
  return postJson('/dev/sim/leg-answered', params);
}

export function simLegEnded(params: {
  callRef: string;
  legStatus: 'busy' | 'no_answer' | 'failed';
}): Promise<SimResult> {
  return postJson('/dev/sim/leg-ended', params);
}

export function simHangup(params: {
  callRef: string;
  durationSeconds: number;
}): Promise<SimResult> {
  return postJson('/dev/sim/hangup', params);
}

export interface SimEventLogEntry {
  at: string;
  action: string;
  status: number;
  instructionKind: string | null;
}

export async function getSimState(): Promise<SimEventLogEntry[]> {
  const res = await getJson<{ events: SimEventLogEntry[] }>('/dev/sim/state');
  return res.events;
}

// ---- /dev/mailbox (magic links) + /dev/sim/sms-outbox (PIN texts) ----

export interface MailboxMessage {
  to: string;
  subject: string;
  text: string;
  sentAt: string;
}

export async function getMailbox(): Promise<MailboxMessage[]> {
  const res = await getJson<{ messages: MailboxMessage[] }>('/dev/mailbox');
  return res.messages;
}

export interface SmsOutboxMessage {
  to: string;
  body: string;
  messageRef: string;
  at: string;
}

export async function getSmsOutbox(): Promise<SmsOutboxMessage[]> {
  const res = await getJson<{ messages: SmsOutboxMessage[] }>('/dev/sim/sms-outbox');
  return res.messages;
}

/** The first `http(s)://` URL found in free-form text — magic-link emails are a short
 * intro line followed by the link (`apps/api/src/lib/auth.ts`'s `sendMagicLink`). */
export function extractFirstUrl(text: string): string | null {
  const match = /https?:\/\/\S+/.exec(text);
  return match ? match[0] : null;
}

// ---- /api/office-hours (session-authenticated; used by the "out-of-hours" flow) ----

export interface OfficeHoursRuleDto {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

export interface OfficeHoursDto {
  mode: 'schedule' | 'always_open' | 'always_closed';
  timezone: string;
  rules: OfficeHoursRuleDto[];
}

export function getOfficeHours(): Promise<OfficeHoursDto> {
  return getJson('/api/office-hours');
}

export function putOfficeHours(input: OfficeHoursDto): Promise<OfficeHoursDto> {
  return request('/api/office-hours', { method: 'PUT', body: JSON.stringify(input) });
}

// ---- /api/calls (session-authenticated; the live call-log panel) ----

export interface CallDto {
  id: string;
  direction: 'inbound' | 'outbound';
  status: string;
  reason: string | null;
  fromE164: string | null;
  toE164: string | null;
  startedAt: string;
  durationSeconds: number;
}

export async function listRecentCalls(): Promise<CallDto[]> {
  const res = await getJson<{ items: CallDto[] }>('/api/calls');
  return res.items;
}

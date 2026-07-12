/**
 * Typed API client (design.md §11, decisions.md #17).
 *
 * NOTE ON DECISION #17 (recorded deviation, apps/web scope only): decision #17 calls
 * for TanStack Query over a `hono/client` (`hc<AppType>`) typed RPC client. That does
 * not currently work against `apps/api`'s exported `AppType`: every route module in
 * `apps/api/src/routes/**` (and `app.ts` itself) mounts routes with bare
 * `app.get(...)`/`app.post(...)`/`app.route(...)` statements whose return value is
 * discarded rather than chained (`app = app.get(...)` or `new Hono().get(...).post(...)`).
 * Hono's RPC typing relies on that chain to accumulate the route schema into the
 * app's *type* — without it, `ReturnType<typeof buildApp>` carries Hono's empty
 * `BlankSchema`, and `hc<AppType>()` resolves to `unknown` (verified directly against
 * the checked-in `apps/api/src/app.ts` and every individual route module with a throwaway
 * tsc probe: `Client<T,...>`'s conditional type falls through to its `never` branch for
 * an empty schema, and `UnionToIntersection<never>` is `unknown` — a well-known TS
 * quirk). Fixing it means adding `.route()`/`.get()` chaining across every file under
 * `apps/api/src/**`, which is out of this milestone's file ownership (M7 may not touch
 * `apps/api/**`) and is concurrently being edited by other milestones. Until that lands,
 * this file hand-writes the request/response shapes for each endpoint instead, matching
 * `docs/design.md` §7 and the route handlers as read at the time of writing. The two
 * DSR routes (`/api/export*`, `/api/account/delete`) were always going to be plain fetch
 * per the M7 brief's compile-coupling rule; every other endpoint below follows the same
 * pattern for the reason above, not because of the DSR-specific concern.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { 'content-type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const code =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `http_${res.status}`;
    throw new ApiError(res.status, code);
  }

  return body as T;
}

function getJson<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

function postJson<T>(path: string, json?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: json === undefined ? undefined : JSON.stringify(json),
  });
}

function putJson<T>(path: string, json: unknown): Promise<T> {
  return request<T>(path, { method: 'PUT', body: JSON.stringify(json) });
}

// ---- me / session ----

export interface MeResponse {
  user: { id: string; email: string | null };
  org: OrgDto | null;
  orgId: string | null;
  personalNumberE164: string | null;
  personalNumberVerifiedAt: string | null;
  emergencyAckAt: string | null;
}

export interface OrgDto {
  id: string;
  name: string;
  timezone: string;
  officeHoursMode: 'schedule' | 'always_open' | 'always_closed';
  businessCapacityDeclaredAt: string;
  declarationVersion: string;
  contractSummaryShownAt: string | null;
  waiverAcceptedAt: string | null;
  createdAt: string;
}

export function getMe(): Promise<MeResponse> {
  return getJson('/api/me');
}

// ---- auth ----

export function requestMagicLink(email: string): Promise<void> {
  return postJson('/api/auth/sign-in/magic-link', { email });
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin' });
}

// ---- orgs ----

export function createOrg(input: {
  name: string;
  businessCapacityDeclared: true;
  waiverAccepted?: boolean;
}): Promise<OrgDto> {
  return postJson('/api/orgs', input);
}

export function updateOrg(input: { name?: string }): Promise<OrgDto> {
  return request('/api/org', { method: 'PATCH', body: JSON.stringify(input) });
}

// ---- verifications ----

export interface IssueVerificationResponse {
  id: string;
  expiresAt: string;
}

export function issueVerification(phoneE164: string): Promise<IssueVerificationResponse> {
  return postJson('/api/verifications', { phoneE164 });
}

export function confirmVerification(id: string, pin: string): Promise<{ verified: true }> {
  return postJson(`/api/verifications/${encodeURIComponent(id)}/confirm`, { pin });
}

// ---- kyc ----

export interface KycRequirement {
  type: string;
  label: string;
}

export interface EndUserDto {
  id: string;
  orgId: string;
  legalName: string;
  ico: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  createdAt: string;
  updatedAt: string;
}

export interface KycInput {
  legalName: string;
  ico: string;
  street: string;
  city: string;
  postalCode: string;
  country: 'CZ';
}

export function getKycRequirements(): Promise<KycRequirement[]> {
  return getJson('/api/kyc/requirements');
}

export async function getKyc(): Promise<EndUserDto | null> {
  try {
    return await getJson<EndUserDto>('/api/kyc');
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export function putKyc(input: KycInput): Promise<EndUserDto> {
  return putJson('/api/kyc', input);
}

export interface KycDocumentDto {
  id: string;
  type: string;
  filename: string;
  contentType: string;
  uploadedAt: string;
}

export async function uploadKycDocument(file: File, type: string): Promise<KycDocumentDto> {
  const form = new FormData();
  form.set('file', file);
  form.set('type', type);
  return request('/api/kyc/documents', { method: 'POST', body: form });
}

// ---- numbers ----

export interface CatalogNumberDto {
  e164: string;
  numberClass: 'geographic' | 'nomadic_910' | 'mobile';
  areaCode: string;
}

export function getNumberCatalog(region: string): Promise<CatalogNumberDto[]> {
  return getJson(`/api/numbers/catalog?region=${encodeURIComponent(region)}`);
}

export interface ProvisionNumberResponse {
  id: string;
  e164: string;
  status: string;
}

export function provisionNumber(e164: string): Promise<ProvisionNumberResponse> {
  return postJson('/api/numbers/provision', { e164 });
}

export interface BusinessNumberDto {
  id: string;
  e164: string;
  numberClass: 'geographic' | 'nomadic_910' | 'mobile';
  status:
    | 'requested'
    | 'docs_pending'
    | 'bundle_submitted'
    | 'approved'
    | 'rejected'
    | 'active'
    | 'porting_out'
    | 'released';
  areaCode: string | null;
  activatedAt: string | null;
  releasedAt: string | null;
  providerRejectionReason: string | null;
  deliverabilityWarning: boolean;
}

export async function getBusinessNumber(): Promise<BusinessNumberDto | null> {
  try {
    return await getJson<BusinessNumberDto>('/api/business-number');
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// ---- office hours ----

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
  return putJson('/api/office-hours', input);
}

// ---- calls ----

export interface CallDto {
  id: string;
  direction: 'inbound' | 'outbound';
  status:
    | 'answered'
    | 'missed'
    | 'declined'
    | 'failed'
    | 'blocked'
    | 'emergency_refused'
    | 'destination_blocked';
  reason: string | null;
  fromE164: string | null;
  toE164: string | null;
  initiatingUserId: string | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  providerCallRef: string | null;
  providerErrorCode: string | null;
}

export interface CallListResponse {
  items: CallDto[];
  nextCursor: string | null;
}

export function listCalls(params: {
  cursor?: string;
  direction?: 'inbound' | 'outbound';
  from?: string;
  to?: string;
}): Promise<CallListResponse> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.direction) query.set('direction', params.direction);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  const qs = query.toString();
  return getJson(`/api/calls${qs ? `?${qs}` : ''}`);
}

// ---- DSR (contract-pinned paths, plain fetch per the M7 brief) ----

/** `GET /api/export` — JSON bundle download (contract-pinned path). */
export const EXPORT_JSON_PATH = '/api/export';
/** `GET /api/export/calls.csv` — CSV download (contract-pinned path). */
export const EXPORT_CSV_PATH = '/api/export/calls.csv';

export function deleteAccount(confirmName: string): Promise<void> {
  return postJson('/api/account/delete', { confirmName });
}

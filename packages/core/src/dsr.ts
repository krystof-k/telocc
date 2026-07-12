/**
 * Export builder + erasure routine (ER-DSR-1..2, design.md §10.2-10.3). Two concerns,
 * both org-scoped by construction (every read/write below takes `orgId` first, so a
 * cross-org leak would require a bug in one of the repos, not in this module):
 * `buildAccountExport`/`callsToCsv` back `GET /api/export` + `GET /api/export/calls.csv`;
 * `eraseAccount` backs `POST /api/account/delete`.
 */

import type { Db } from '@telocc/db';
import { deletionTombstones, orgs, user } from '@telocc/db';
import type { TelephonyProvider } from '@telocc/telephony';
import { eq } from 'drizzle-orm';
import { getOfficeHoursForOrg, type OfficeHoursSettings } from './office-hours.ts';
import { writeAuditEvent } from './repos/audit.ts';
import type { CallRow } from './repos/calls.ts';
import { listCallsForOrg } from './repos/calls.ts';
import { getEndUserByOrgId, listKycDocumentMeta } from './repos/kyc.ts';
import { getMembershipByUserId } from './repos/memberships.ts';
import {
  getBusinessNumberByOrgId,
  listReleasableBusinessNumbers,
  releaseOrgBusinessNumbers,
} from './repos/numbers.ts';
import { getOrgById } from './repos/orgs.ts';

/** A very large page: the export must contain the *whole* call log (design.md §10.2),
 * not `listCallsForOrg`'s default paginated page. */
const EXPORT_CALLS_LIMIT = 100_000;

/** design.md §10.2 — `GET /api/export`'s documented JSON shape. */
export interface AccountExport {
  account: { email: string | null };
  org: {
    id: string;
    name: string;
    timezone: string;
    officeHoursMode: string;
    country: string;
    createdAt: Date;
  } | null;
  membership: { personalNumber: string | null; verifiedAt: Date | null };
  officeHours: OfficeHoursSettings | null;
  businessNumber: {
    id: string;
    e164: string;
    numberClass: string;
    status: string;
    areaCode: string | null;
    activatedAt: Date | null;
    releasedAt: Date | null;
    createdAt: Date;
  } | null;
  // KYC documents are metadata only (design.md §10.2: "documents: metadata only") —
  // `listKycDocumentMeta` never selects the `bytes` column.
  kyc: { endUser: Awaited<ReturnType<typeof getEndUserByOrgId>>; documents: unknown[] };
  calls: CallRow[];
}

/** Builds the full `GET /api/export` bundle for `orgId` (ER-DSR-1). `userId` is the
 * caller's own Better Auth user id — used only to resolve their email and their
 * membership row, never another org's. */
export async function buildAccountExport(
  db: Db,
  orgId: string,
  userId: string,
): Promise<AccountExport> {
  const [org, membership, officeHours, businessNumber, endUser, documents, callsResult, userRows] =
    await Promise.all([
      getOrgById(db, orgId),
      getMembershipByUserId(db, userId),
      getOfficeHoursForOrg(db, orgId),
      getBusinessNumberByOrgId(db, orgId),
      getEndUserByOrgId(db, orgId),
      listKycDocumentMeta(db, orgId),
      listCallsForOrg(db, orgId, { limit: EXPORT_CALLS_LIMIT }),
      db.select({ email: user.email }).from(user).where(eq(user.id, userId)),
    ]);

  return {
    account: { email: userRows[0]?.email ?? null },
    org: org
      ? {
          id: org.id,
          name: org.name,
          timezone: org.timezone,
          officeHoursMode: org.officeHoursMode,
          country: org.country,
          createdAt: org.createdAt,
        }
      : null,
    membership: {
      personalNumber: membership?.personalNumberE164 ?? null,
      verifiedAt: membership?.personalNumberVerifiedAt ?? null,
    },
    officeHours,
    businessNumber: businessNumber
      ? {
          id: businessNumber.id,
          e164: businessNumber.e164,
          numberClass: businessNumber.numberClass,
          status: businessNumber.status,
          areaCode: businessNumber.areaCode,
          activatedAt: businessNumber.activatedAt,
          releasedAt: businessNumber.releasedAt,
          createdAt: businessNumber.createdAt,
        }
      : null,
    kyc: { endUser: endUser ?? null, documents },
    calls: callsResult.items,
  };
}

const CSV_HEADER = 'started_at,direction,status,reason,from,to,duration_seconds';

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** `GET /api/export/calls.csv` body — one row per call, the documented columns
 * (design.md §10.2). */
export function callsToCsv(rows: readonly CallRow[]): string {
  const lines = rows.map((row) =>
    [
      row.startedAt.toISOString(),
      row.direction,
      row.status,
      row.reason ?? '',
      row.fromE164 ?? '',
      row.toE164 ?? '',
      String(row.durationSeconds),
    ]
      .map(csvField)
      .join(','),
  );
  return `${[CSV_HEADER, ...lines].join('\n')}\n`;
}

export interface EraseAccountResult {
  stats: Record<string, number>;
}

/**
 * `POST /api/account/delete` (ER-DSR-2, design.md §10.3). Order matters:
 *
 * 1. Best-effort provider propagation — reads org-scoped rows that must still exist,
 *    so it runs before anything is deleted locally; failures never block local erasure.
 * 2. `DELETE FROM orgs` — FK cascade removes memberships, phone_verifications,
 *    business_numbers (and call_sessions/calls beneath them), regulatory_bundles,
 *    end_users, kyc_documents, office_hour_rules, org-scoped audit_events, and the
 *    dormant billing tables in one statement (works on the transaction-less
 *    neon-http driver — no multi-statement transaction needed).
 * 3. The Better Auth `user` row — its `session`/`account` rows cascade from this
 *    delete via their own FKs (packages/db/src/schema/auth.ts), so a single delete
 *    here is enough to invalidate every session for that user.
 * 4. A **PII-free, org-less** `dsr_erasure` audit event — `org_id: null` (like the
 *    `number_lifecycle` release event above) so it survives the org's own cascade,
 *    with no email/org name/phone number in `meta` (ER-AUD-2).
 * 5. A `deletion_tombstones` row — counts only, never the org name or a phone number.
 */
export async function eraseAccount(
  db: Db,
  provider: TelephonyProvider,
  orgId: string,
  userId: string,
  now: () => Date = () => new Date(),
): Promise<EraseAccountResult> {
  // Step 1a: propagate-delete every non-anonymised call record (ER-DSR-2 "seam
  // capability deleteCallRecord"). Best-effort — the mock is a no-op success; a real
  // Twilio 404 on an already-purged record must not block anything below.
  const allCalls = await listCallsForOrg(db, orgId, { limit: EXPORT_CALLS_LIMIT });
  let callRecordsDeleted = 0;
  for (const call of allCalls.items) {
    if (call.providerCallRef && !call.anonymisedAt) {
      try {
        await provider.deleteCallRecord(call.providerCallRef);
        callRecordsDeleted += 1;
      } catch {
        // best-effort — see function doc.
      }
    }
  }

  // Step 1b: release every non-released business number. Called directly (not only
  // through `releaseOrgBusinessNumbers` below) so a number without a stored
  // `providerNumberRef` — e.g. one seeded directly rather than provisioned through the
  // API — still gets a best-effort release attempt, using the same `number_<id>`
  // fallback convention `repos/numbers.ts` documents for resolving such rows.
  const releasableNumbers = await listReleasableBusinessNumbers(db, orgId);
  for (const number of releasableNumbers) {
    const ref = number.providerNumberRef ?? `number_${number.id}`;
    try {
      await provider.releaseNumber(ref);
    } catch {
      // best-effort — see function doc.
    }
  }
  // Writes the required PII-free, `org_id: null` `number_lifecycle` audit event per
  // released number (packages/core/src/repos/numbers.ts) — must run before the org row
  // is deleted below, since that event is meant to survive the cascade.
  await releaseOrgBusinessNumbers(db, provider, orgId);

  // Step 2.
  await db.delete(orgs).where(eq(orgs.id, orgId));

  // Step 3.
  await db.delete(user).where(eq(user.id, userId));

  // Step 4 — PII-free, org_id:null (ER-AUD-2), so it survives the org cascade above.
  await writeAuditEvent(db, {
    orgId: null,
    type: 'dsr_erasure',
    retentionClass: 'lifecycle',
    meta: { event: 'account_deleted' },
  });

  // Step 5 — counts only.
  const stats: Record<string, number> = {
    callsCount: allCalls.items.length,
    callRecordsDeleted,
    businessNumbersReleased: releasableNumbers.length,
  };
  await db.insert(deletionTombstones).values({ deletedAt: now(), stats });

  return { stats };
}

import { randomUUID } from 'node:crypto';
import { auditEvents, businessNumbers, orgs } from '@telocc/db';
import type { ProviderCapabilities } from '@telocc/telephony';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { findUserIdByEmail, loginViaMagicLink } from '../helpers/auth.ts';
import { setupContractTest } from '../helpers/context.ts';
import {
  createBusinessNumberFixture,
  createOrgFixture,
  createReadyOrg,
} from '../helpers/fixtures.ts';
import { getJson, jsonBody, postJson, putJson } from '../helpers/http.ts';

/**
 * provisioning.contract.test.ts — number lifecycle (ER-KYC-1..3, design.md §3.2, §4.4, §7).
 *
 * Ambiguity note (tests/helpers/README.md): design.md's cascade topology deletes
 * `audit_events` with the org on account deletion, yet also says number-lifecycle
 * transitions are audit-logged. This file assumes the release event is written with
 * `org_id: null` (like `deletion_tombstones`) so it survives the cascade — flagged for
 * architect confirmation if M8 implements it differently.
 */
describe('number provisioning', () => {
  const ctx = setupContractTest();

  async function ownerWithoutKyc() {
    const email = `provisioning-${randomUUID()}@example.test`;
    const { cookieHeader } = await loginViaMagicLink(ctx.app, ctx.mailbox, email);
    const userId = await findUserIdByEmail(ctx.db, email);
    const org = await createOrgFixture(ctx.db);
    return { cookieHeader, userId, orgId: org.id };
  }

  it('the catalog is unavailable until the KYC end-user record is complete', async () => {
    const { cookieHeader } = await ownerWithoutKyc();
    const res = await getJson(ctx.app, '/api/numbers/catalog?region=Prague', { cookieHeader });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('the catalog returns only numbers whose area code matches the requested region (Prague default)', async () => {
    const { cookieHeader } = await ownerWithoutKyc();
    await putJson(
      ctx.app,
      '/api/kyc',
      {
        legalName: 'Acme s.r.o.',
        ico: '12345678',
        street: 'Vaclavske namesti 1',
        city: 'Praha',
        postalCode: '11000',
        country: 'CZ',
      },
      { cookieHeader },
    );

    const res = await getJson(ctx.app, '/api/numbers/catalog?region=Prague', { cookieHeader });
    expect(res.status).toBe(200);
    const body = await jsonBody<{ e164: string }[]>(res);
    expect(body?.length).toBeGreaterThan(0);
    for (const entry of body ?? []) {
      expect(entry.e164.startsWith('+4202')).toBe(true);
    }
  });

  it('KYC rejects a PO-box street address and a non-CZ country', async () => {
    const { cookieHeader } = await ownerWithoutKyc();
    const poBoxRes = await putJson(
      ctx.app,
      '/api/kyc',
      {
        legalName: 'Acme s.r.o.',
        ico: '12345678',
        street: 'PO Box 42',
        city: 'Praha',
        postalCode: '11000',
        country: 'CZ',
      },
      { cookieHeader },
    );
    expect(poBoxRes.status).toBe(400);

    const nonCzRes = await putJson(
      ctx.app,
      '/api/kyc',
      {
        legalName: 'Acme s.r.o.',
        ico: '12345678',
        street: 'Hauptstrasse 1',
        city: 'Berlin',
        postalCode: '10115',
        country: 'DE',
      },
      { cookieHeader },
    );
    expect(nonCzRes.status).toBe(400);
  });

  it('provisioning transitions requested → … → active only via seam events/polls, never via a direct API write', async () => {
    const { cookieHeader } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
    const res = await putJson(
      ctx.app,
      '/api/business-number',
      { status: 'active' },
      { cookieHeader },
    );
    expect([404, 405]).toContain(res.status);
  });

  it('a rejected bundle surfaces status rejected with the provider reason', async () => {
    const { businessNumberE164 } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
    const [numberRow] = await ctx.db
      .select()
      .from(businessNumbers)
      .where(eq(businessNumbers.e164, businessNumberE164));
    if (!numberRow) throw new Error('fixture missing');

    await ctx.telco.provisioningUpdate({
      numberRef: numberRow.providerNumberRef ?? `number_${numberRow.id}`,
      status: 'rejected',
      reason: 'invalid_document',
    });

    const [after] = await ctx.db
      .select()
      .from(businessNumbers)
      .where(eq(businessNumbers.id, numberRow.id));
    expect(after?.status).toBe('rejected');
    expect(after?.providerRejectionReason).toBe('invalid_document');
  });

  it('the mock auto-approves so a fresh org reaches active synchronously in the demo path', async () => {
    const { cookieHeader } = await ownerWithoutKyc();
    await putJson(
      ctx.app,
      '/api/kyc',
      {
        legalName: 'Acme s.r.o.',
        ico: '12345678',
        street: 'Vaclavske namesti 1',
        city: 'Praha',
        postalCode: '11000',
        country: 'CZ',
      },
      { cookieHeader },
    );
    const catalogRes = await getJson(ctx.app, '/api/numbers/catalog?region=Prague', {
      cookieHeader,
    });
    const catalog = await jsonBody<{ e164: string }[]>(catalogRes);
    const chosen = catalog?.[0]?.e164;
    expect(chosen).toBeTruthy();

    const provisionRes = await postJson(
      ctx.app,
      '/api/numbers/provision',
      { e164: chosen },
      { cookieHeader },
    );
    expect(provisionRes.status).toBeLessThan(300);

    const businessNumberRes = await getJson(ctx.app, '/api/business-number', { cookieHeader });
    const businessNumberBody = await jsonBody<{ status?: string }>(businessNumberRes);
    expect(businessNumberBody?.status).toBe('active');
  });

  it("with capability czCliDomesticTermination='unverified', the business-number response carries the deliverability warning flag", async () => {
    const { cookieHeader } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
    (ctx.provider as { capabilities: ProviderCapabilities }).capabilities = {
      ...ctx.provider.capabilities,
      czCliDomesticTermination: 'unverified',
    };

    const res = await getJson(ctx.app, '/api/business-number', { cookieHeader });
    const body = await jsonBody<{ deliverabilityWarning?: boolean }>(res);
    expect(body?.deliverabilityWarning).toBe(true);
  });

  it('number release on account deletion records a lifecycle audit event', async () => {
    const { cookieHeader, orgId } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
    const [orgRow] = await ctx.db.select().from(orgs).where(eq(orgs.id, orgId));

    await postJson(ctx.app, '/api/account/delete', { confirmName: orgRow?.name }, { cookieHeader });

    const events = await ctx.db.select().from(auditEvents);
    const lifecycleEvent = events.find((e) => e.type === 'number_lifecycle');
    expect(lifecycleEvent).toBeDefined();
  });

  it('a second active business number for the same org is impossible', async () => {
    const { orgId } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox);
    await expect(
      createBusinessNumberFixture(ctx.db, { orgId, e164: '+420299999998', status: 'active' }),
    ).rejects.toThrow();
  });
});

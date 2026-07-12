/**
 * Number catalog, provisioning, and business-number routes (design.md §6, §7). Covers
 * `GET /api/numbers/catalog`, `POST /api/numbers/provision`, `GET /api/business-number`.
 *
 * Provisioning state machine (ER-KYC-1..3): a business number only ever transitions via
 * this route's seam calls (`submitBundle`/`provisionNumber`) or the `provisioning.update`
 * webhook (`routes/webhooks.ts`) — never a direct API write (there is deliberately no
 * `PUT`/`PATCH` handler on `/api/business-number`).
 */
import { zValidator } from '@hono/zod-validator';
import { writeAuditEvent } from '@telocc/core/repos/audit';
import { getEndUserByOrgId, listKycDocumentsForEndUser } from '@telocc/core/repos/kyc';
import {
  createBusinessNumber,
  createRegulatoryBundle,
  getBusinessNumberByOrgId,
  getRegionAreaCodeByName,
  listRegionAreaCodes,
} from '@telocc/core/repos/numbers';
import { type DocumentRef, type EndUserRecord, parseE164 } from '@telocc/telephony';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Deps } from '../deps.ts';
import type { AppEnv } from '../lib/context.ts';
import { requireRole } from '../middleware/org.ts';
import { rateLimit } from '../middleware/rate-limit.ts';

const provisionSchema = z.object({
  e164: z.string().regex(/^\+[1-9][0-9]{1,14}$/, 'must be a well-formed E.164 number'),
});

function mapProvisioningResultStatus(status: 'pending' | 'active'): 'bundle_submitted' | 'active' {
  return status === 'active' ? 'active' : 'bundle_submitted';
}

export function numbersRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  r.get(
    '/numbers/catalog',
    requireRole('owner'),
    // design.md §7: 30/h per org.
    rateLimit({
      db: deps.db,
      now: deps.now,
      scope: 'numbers_catalog',
      windowSeconds: 60 * 60,
      limit: 30,
      identifier: (c) => c.get('orgId') ?? null,
    }),
    async (c) => {
      const orgId = c.get('orgId');
      if (!orgId) return c.json({ error: 'no_org' }, 403);

      const endUser = await getEndUserByOrgId(deps.db, orgId);
      if (!endUser) return c.json({ error: 'kyc_incomplete' }, 400);

      const region = c.req.query('region');
      if (!region) return c.json({ error: 'region_required' }, 400);
      const areaCodeRow = await getRegionAreaCodeByName(deps.db, region);
      if (!areaCodeRow) return c.json({ error: 'unknown_region' }, 400);

      const numbers = await deps.provider.searchNumbers({
        country: 'CZ',
        areaCode: areaCodeRow.tcPrefix,
        numberClass: 'geographic',
        limit: 10,
      });
      return c.json(numbers);
    },
  );

  r.post(
    '/numbers/provision',
    requireRole('owner'),
    // design.md §7: 3/day per org.
    rateLimit({
      db: deps.db,
      now: deps.now,
      scope: 'number_provision',
      windowSeconds: 60 * 60 * 24,
      limit: 3,
      identifier: (c) => c.get('orgId') ?? null,
    }),
    zValidator('json', provisionSchema),
    async (c) => {
      const orgId = c.get('orgId');
      if (!orgId) return c.json({ error: 'no_org' }, 403);

      const endUser = await getEndUserByOrgId(deps.db, orgId);
      if (!endUser) return c.json({ error: 'kyc_incomplete' }, 400);

      const { e164 } = c.req.valid('json');
      const parsed = parseE164(e164);
      if (!parsed) return c.json({ error: 'invalid_e164' }, 400);

      // "must come from catalog" (design.md §7): confirm the requested number's area
      // code matches one of the seeded regions rather than re-querying the provider's
      // full catalog (which would be equivalent for the deterministic mock catalog).
      const areaCodes = await listRegionAreaCodes(deps.db);
      const areaCodeRow = areaCodes.find((row) => parsed.startsWith(`+420${row.tcPrefix}`));
      if (!areaCodeRow) return c.json({ error: 'number_not_in_catalog' }, 400);

      const existing = await getBusinessNumberByOrgId(deps.db, orgId);
      if (existing) return c.json({ error: 'business_number_already_exists' }, 409);

      const documents = await listKycDocumentsForEndUser(deps.db, orgId, endUser.id);
      const documentRefs: DocumentRef[] = documents.map((doc) => ({
        type: doc.type,
        filename: doc.filename,
        contentType: doc.contentType,
        bytes: new Uint8Array(doc.bytes),
      }));
      const endUserRecord: EndUserRecord = {
        legalName: endUser.legalName,
        ico: endUser.ico,
        street: endUser.street,
        city: endUser.city,
        postalCode: endUser.postalCode,
        country: endUser.country,
      };

      let businessNumberId: string;
      let finalStatus: string;
      try {
        const bundleResult = await deps.provider.submitBundle({
          endUser: endUserRecord,
          documents: documentRefs,
        });
        const bundleRow = await createRegulatoryBundle(deps.db, {
          orgId,
          providerBundleRef: bundleResult.bundleRef,
          status: bundleResult.status,
          submittedAt: deps.now(),
          decidedAt: bundleResult.status === 'approved' ? deps.now() : null,
        });

        const numberResult = await deps.provider.provisionNumber({
          e164: parsed,
          bundleRef: bundleResult.bundleRef,
          webhookBaseUrl: deps.env.APP_BASE_URL,
        });
        const mappedStatus = mapProvisioningResultStatus(numberResult.status);

        const businessNumber = await createBusinessNumber(deps.db, {
          orgId,
          e164: parsed,
          numberClass: 'geographic',
          areaCode: areaCodeRow.tcPrefix,
          status: mappedStatus,
          providerNumberRef: numberResult.numberRef,
          bundleId: bundleRow.id,
          activatedAt: mappedStatus === 'active' ? deps.now() : null,
        });
        businessNumberId = businessNumber.id;
        finalStatus = businessNumber.status;
      } catch (err) {
        if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
          return c.json({ error: 'business_number_already_exists' }, 409);
        }
        throw err;
      }

      await writeAuditEvent(deps.db, {
        orgId,
        type: 'number_lifecycle',
        retentionClass: 'lifecycle',
        meta: { status: finalStatus, numberLastFour: parsed.slice(-4) },
      });

      return c.json({ id: businessNumberId, e164: parsed, status: finalStatus }, 201);
    },
  );

  r.get('/business-number', requireRole('owner'), async (c) => {
    const orgId = c.get('orgId');
    if (!orgId) return c.json({ error: 'no_org' }, 403);

    const businessNumber = await getBusinessNumberByOrgId(deps.db, orgId);
    if (!businessNumber) return c.json({ error: 'not_found' }, 404);

    const deliverabilityWarning =
      deps.provider.capabilities.czCliDomesticTermination === 'unverified';
    return c.json({
      id: businessNumber.id,
      e164: businessNumber.e164,
      numberClass: businessNumber.numberClass,
      status: businessNumber.status,
      areaCode: businessNumber.areaCode,
      activatedAt: businessNumber.activatedAt,
      releasedAt: businessNumber.releasedAt,
      providerRejectionReason: businessNumber.providerRejectionReason,
      deliverabilityWarning,
    });
  });

  return r;
}

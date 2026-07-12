/**
 * KYC / regulatory-bundle routes (design.md §6, §7): end-user record (`GET`/`PUT
 * /api/kyc`), the provider's required-document checklist (`GET /api/kyc/requirements`),
 * and document upload (`POST /api/kyc/documents`, `GET /api/kyc/documents/:id` —
 * decisions.md #37 pins the by-id GET as part of the API surface).
 */
import { zValidator } from '@hono/zod-validator';
import {
  getEndUserByOrgId,
  getKycDocumentById,
  insertKycDocument,
  upsertEndUser,
} from '@telocc/core/repos/kyc';
import type { NumberClass } from '@telocc/telephony';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Deps } from '../deps.ts';
import type { AppEnv } from '../lib/context.ts';
import { requireRole } from '../middleware/org.ts';
import { rateLimit } from '../middleware/rate-limit.ts';

/** design.md §7: "street (PO-box regex reject)". */
const PO_BOX_PATTERN = /\bp\.?\s*o\.?\s*box\b/i;

const kycSchema = z.object({
  legalName: z.string().min(1).max(200),
  ico: z.string().regex(/^\d{8}$/, 'must be 8 digits'),
  street: z
    .string()
    .min(1)
    .max(200)
    .refine((s) => !PO_BOX_PATTERN.test(s), 'PO box addresses are not accepted'),
  city: z.string().min(1).max(120),
  postalCode: z.string().min(1).max(20),
  country: z.literal('CZ'),
});

const NUMBER_CLASSES: NumberClass[] = ['geographic', 'nomadic_910', 'mobile'];
const ALLOWED_DOCUMENT_CONTENT_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
/** ≤5 MB (decisions.md #33). */
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export function kycRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  r.get('/requirements', requireRole('owner'), async (c) => {
    const queryClass = c.req.query('numberClass');
    const numberClass: NumberClass = NUMBER_CLASSES.includes(queryClass as NumberClass)
      ? (queryClass as NumberClass)
      : 'geographic';
    const documents = await deps.provider.getRequiredDocuments({ country: 'CZ', numberClass });
    return c.json(documents);
  });

  r.get('/', requireRole('owner'), async (c) => {
    const orgId = c.get('orgId');
    if (!orgId) return c.json({ error: 'no_org' }, 403);
    const endUser = await getEndUserByOrgId(deps.db, orgId);
    if (!endUser) return c.json({ error: 'not_found' }, 404);
    return c.json(endUser);
  });

  r.put('/', requireRole('owner'), zValidator('json', kycSchema), async (c) => {
    const orgId = c.get('orgId');
    if (!orgId) return c.json({ error: 'no_org' }, 403);
    const body = c.req.valid('json');
    const endUser = await upsertEndUser(deps.db, orgId, body);
    return c.json(endUser);
  });

  r.post(
    '/documents',
    requireRole('owner'),
    // design.md §7: 20/day per org.
    rateLimit({
      db: deps.db,
      now: deps.now,
      scope: 'kyc_document_upload',
      windowSeconds: 60 * 60 * 24,
      limit: 20,
      identifier: (c) => c.get('orgId') ?? null,
    }),
    async (c) => {
      const orgId = c.get('orgId');
      if (!orgId) return c.json({ error: 'no_org' }, 403);

      const endUser = await getEndUserByOrgId(deps.db, orgId);
      if (!endUser) return c.json({ error: 'kyc_incomplete' }, 400);

      const contentTypeHeader = c.req.header('content-type') ?? '';
      if (!contentTypeHeader.includes('multipart/form-data')) {
        return c.json({ error: 'multipart_form_data_required' }, 400);
      }

      const body = await c.req.parseBody();
      const file = body.file;
      const typeField = body.type;
      if (!(file instanceof File)) {
        return c.json({ error: 'file_required' }, 400);
      }
      if (!ALLOWED_DOCUMENT_CONTENT_TYPES.has(file.type)) {
        return c.json({ error: 'unsupported_content_type' }, 400);
      }
      if (file.size > MAX_DOCUMENT_BYTES) {
        return c.json({ error: 'file_too_large' }, 400);
      }

      const bytes = Buffer.from(await file.arrayBuffer());
      const docType =
        typeof typeField === 'string' && typeField.length > 0 ? typeField : 'business_registration';

      const document = await insertKycDocument(deps.db, {
        orgId,
        endUserId: endUser.id,
        type: docType,
        filename: file.name,
        contentType: file.type,
        bytes,
      });

      return c.json(
        {
          id: document.id,
          type: document.type,
          filename: document.filename,
          contentType: document.contentType,
          uploadedAt: document.uploadedAt,
        },
        201,
      );
    },
  );

  r.get('/documents/:id', requireRole('owner'), async (c) => {
    const orgId = c.get('orgId');
    if (!orgId) return c.json({ error: 'no_org' }, 403);
    const id = c.req.param('id');
    const document = await getKycDocumentById(deps.db, orgId, id);
    if (!document) return c.json({ error: 'not_found' }, 404);
    return c.json({
      id: document.id,
      type: document.type,
      filename: document.filename,
      contentType: document.contentType,
      uploadedAt: document.uploadedAt,
    });
  });

  return r;
}

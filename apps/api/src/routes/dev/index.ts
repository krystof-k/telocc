/**
 * Dev-only simulator + mailbox routes, env-gated (design.md §12, decisions.md #21).
 * 404 unless `ENABLE_DEV_ROUTES=1` — pinned by security-headers.contract.test.ts.
 *
 * `/dev/sim/*` drives `MockTelco` (packages/telephony/src/mock/telco.ts) against a
 * **standalone instance** of the real `webhooksRoutes(deps)` sub-app — Hono sub-apps
 * are independently fetchable via `.request()`, so this exercises the exact same
 * signature-verification/parse/route code the mounted `/webhooks` router uses
 * (decisions.md #21: "always enters the system through the real signed webhook
 * endpoint"), without needing a circular reference to the fully-assembled top-level
 * app (which does not exist yet at the point `deps`/`devRoutes` are constructed).
 */
import { parseE164 } from '@telocc/telephony';
import { createMockTelco } from '@telocc/telephony/mock';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Deps } from '../../deps.ts';
import type { AppEnv } from '../../lib/context.ts';
import { webhooksRoutes } from '../webhooks.ts';

interface SimEventLogEntry {
  at: string;
  action: string;
  status: number;
  instructionKind: string | null;
}

const incomingCallSchema = z.object({
  to: z.string().min(1),
  from: z.string().min(1).nullable().optional(),
  callRef: z.string().optional(),
});
const callRefSchema = z.object({ callRef: z.string().min(1) });
const legEndedSchema = z.object({
  callRef: z.string().min(1),
  legStatus: z.enum(['busy', 'no_answer', 'failed']),
  errorCode: z.string().optional(),
});
const completedSchema = z.object({
  callRef: z.string().min(1),
  durationSeconds: z.number().default(0),
  errorCode: z.string().optional(),
});
const dtmfSchema = z.object({ callRef: z.string().min(1), digits: z.string() });
const provisioningUpdateSchema = z.object({
  bundleRef: z.string().optional(),
  numberRef: z.string().optional(),
  status: z.enum(['submitted', 'approved', 'rejected', 'active']),
  reason: z.string().optional(),
});

export function devRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  // Double gate (design.md §11 "Dev simulator page"): the web build's own
  // `VITE_ENABLE_SIM` flag is the other half; server routes 404 unconditionally here.
  if (!deps.env.ENABLE_DEV_ROUTES) {
    return r;
  }

  const eventLog: SimEventLogEntry[] = [];
  const webhookApp = webhooksRoutes(deps);
  const telco = createMockTelco({
    app: { request: async (input, init) => webhookApp.request(input, init) },
    webhookSecret: deps.env.MOCK_WEBHOOK_SECRET,
    now: deps.now,
  });

  function record(action: string, result: { status: number; instruction: unknown }) {
    const instructionKind =
      result.instruction && typeof result.instruction === 'object' && 'kind' in result.instruction
        ? String((result.instruction as { kind: unknown }).kind)
        : null;
    eventLog.push({ at: deps.now().toISOString(), action, status: result.status, instructionKind });
    if (eventLog.length > 200) eventLog.shift();
  }

  r.get('/mailbox', (c) => {
    const email = deps.email as unknown as { sent?: unknown[] };
    return c.json({ messages: email.sent ?? [] });
  });

  r.get('/sim/state', (c) => c.json({ events: eventLog }));

  r.post('/sim/incoming-call', async (c) => {
    const body = incomingCallSchema.parse(await c.req.json());
    const to = parseE164(body.to);
    if (!to) return c.json({ error: 'invalid_e164', field: 'to' }, 400);
    const from = body.from ? parseE164(body.from) : null;
    if (body.from && !from) return c.json({ error: 'invalid_e164', field: 'from' }, 400);

    const result = await telco.incomingCall({ callRef: body.callRef, to, from });
    record('incoming-call', result);
    return c.json(result);
  });

  r.post('/sim/dtmf', async (c) => {
    const body = dtmfSchema.parse(await c.req.json());
    const result = await telco.dtmf(body);
    record('dtmf', result);
    return c.json(result);
  });

  r.post('/sim/leg-answered', async (c) => {
    const body = callRefSchema.parse(await c.req.json());
    const result = await telco.legAnswered(body);
    record('leg-answered', result);
    return c.json(result);
  });

  r.post('/sim/leg-ended', async (c) => {
    const body = legEndedSchema.parse(await c.req.json());
    const result = await telco.legEnded(body);
    record('leg-ended', result);
    return c.json(result);
  });

  r.post('/sim/hangup', async (c) => {
    const body = completedSchema.parse(await c.req.json());
    const result = await telco.completed(body);
    record('hangup', result);
    return c.json(result);
  });

  r.post('/sim/provisioning-update', async (c) => {
    const body = provisioningUpdateSchema.parse(await c.req.json());
    const result = await telco.provisioningUpdate(body);
    record('provisioning-update', result);
    return c.json(result);
  });

  return r;
}

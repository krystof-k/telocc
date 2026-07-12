import { randomUUID } from 'node:crypto';
import { parseE164 } from '@telocc/telephony';
import { describe, expect, it } from 'vitest';
import { setupContractTest } from '../helpers/context.ts';
import { createReadyOrg } from '../helpers/fixtures.ts';
import { deleteJson, getJson, jsonBody, putJson } from '../helpers/http.ts';

/**
 * call-log.contract.test.ts — the record itself (ER-AUD-1, design.md §5.3, §7).
 * Assumes `GET /api/calls` responds `{ items: CallRow[], nextCursor: string | null }`
 * (design.md names the route `?cursor&direction&from&to` but doesn't pin the response
 * envelope shape — this is the documented assumption, tests/helpers/README.md).
 */

interface CallRow {
  id: string;
  direction: 'inbound' | 'outbound';
  status: string;
  reason: string | null;
  startedAt: string;
  durationSeconds: number;
  initiatingUserId: string | null;
}

interface CallListResponse {
  items: CallRow[];
  nextCursor: string | null;
}

async function fetchAllPages(app: Parameters<typeof getJson>[0], cookieHeader: string, query = '') {
  const collected: CallRow[] = [];
  let cursor: string | null = null;
  let guard = 0;
  do {
    guard += 1;
    if (guard > 50) throw new Error('fetchAllPages: too many pages — possible infinite loop');
    const qs = new URLSearchParams(query);
    if (cursor) qs.set('cursor', cursor);
    const res = await getJson(app, `/api/calls?${qs.toString()}`, { cookieHeader });
    if (res.status !== 200) return { collected, lastStatus: res.status };
    const body = (await jsonBody<CallListResponse>(res)) ?? { items: [], nextCursor: null };
    collected.push(...body.items);
    cursor = body.nextCursor;
  } while (cursor);
  return { collected, lastStatus: 200 };
}

describe('call log', () => {
  const ctx = setupContractTest();

  async function readyOrg() {
    return createReadyOrg(ctx.app, ctx.db, ctx.mailbox, { officeHoursMode: 'always_open' });
  }

  it('the log lists inbound and outbound calls newest-first with timestamp, direction, duration, status', async () => {
    const { cookieHeader, businessNumberE164, personalNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    const from = parseE164(personalNumberE164);
    if (!to || !from) throw new Error('bad fixture');

    // Inbound answered call.
    const inboundRef = `call_inbound_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef: inboundRef, to, from: parseE164('+420602000001') });
    await ctx.telco.legAnswered({ callRef: inboundRef });
    await ctx.telco.completed({ callRef: inboundRef, durationSeconds: 30 });

    ctx.clock.advanceSeconds(5);
    // Outbound answered call (later in time).
    const outboundRef = `call_outbound_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef: outboundRef, to, from });
    await ctx.telco.dtmf({ callRef: outboundRef, digits: '604200001' });
    await ctx.telco.legAnswered({ callRef: outboundRef });
    await ctx.telco.completed({ callRef: outboundRef, durationSeconds: 45 });

    const res = await getJson(ctx.app, '/api/calls', { cookieHeader });
    expect(res.status).toBe(200);
    const body = await jsonBody<CallListResponse>(res);
    expect(body?.items.length).toBe(2);
    // Newest-first: the outbound call (later) must come before the inbound one.
    expect(body?.items[0]?.direction).toBe('outbound');
    expect(body?.items[1]?.direction).toBe('inbound');
    for (const item of body?.items ?? []) {
      expect(item.startedAt).toBeTruthy();
      expect(typeof item.durationSeconds).toBe('number');
      expect(item.status).toBeTruthy();
    }
  });

  it('outbound rows record the initiating user; inbound rows do not', async () => {
    const { cookieHeader, userId, businessNumberE164, personalNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    const from = parseE164(personalNumberE164);
    if (!to || !from) throw new Error('bad fixture');

    const inboundRef = `call_inbound_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef: inboundRef, to, from: parseE164('+420602000002') });
    await ctx.telco.completed({ callRef: inboundRef, durationSeconds: 0 });

    const outboundRef = `call_outbound_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef: outboundRef, to, from });
    await ctx.telco.dtmf({ callRef: outboundRef, digits: '604200002' });
    await ctx.telco.legAnswered({ callRef: outboundRef });
    await ctx.telco.completed({ callRef: outboundRef, durationSeconds: 10 });

    const res = await getJson(ctx.app, '/api/calls', { cookieHeader });
    const body = await jsonBody<CallListResponse>(res);
    const inbound = body?.items.find((c) => c.direction === 'inbound');
    const outbound = body?.items.find((c) => c.direction === 'outbound');
    expect(inbound?.initiatingUserId).toBeNull();
    expect(outbound?.initiatingUserId).toBe(userId);
  });

  it('there is no API route that updates or deletes an individual call row', async () => {
    const { cookieHeader } = await readyOrg();
    const putRes = await putJson(
      ctx.app,
      '/api/calls/00000000-0000-0000-0000-000000000000',
      {},
      { cookieHeader },
    );
    expect([404, 405]).toContain(putRes.status);
    const deleteRes = await deleteJson(
      ctx.app,
      '/api/calls/00000000-0000-0000-0000-000000000000',
      undefined,
      { cookieHeader },
    );
    expect([404, 405]).toContain(deleteRes.status);
  });

  it('pagination returns stable cursors and no cross-page duplicates', async () => {
    const { cookieHeader, businessNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('bad fixture');

    const count = 12;
    for (let i = 0; i < count; i += 1) {
      const callRef = `call_page_${i}_${randomUUID()}`;
      await ctx.telco.incomingCall({
        callRef,
        to,
        from: parseE164(`+42060210${String(i).padStart(4, '0')}`),
      });
      await ctx.telco.completed({ callRef, durationSeconds: 0 });
      ctx.clock.advanceSeconds(1);
    }

    const { collected: firstWalk } = await fetchAllPages(ctx.app, cookieHeader);
    const { collected: secondWalk } = await fetchAllPages(ctx.app, cookieHeader);

    expect(firstWalk.length).toBe(count);
    const ids = firstWalk.map((r) => r.id);
    expect(new Set(ids).size).toBe(count); // no cross-page duplicates
    expect(secondWalk.map((r) => r.id)).toEqual(ids); // stable across repeated walks
  });

  it('filters by direction and date range are org-scoped', async () => {
    const orgA = await readyOrg();
    const orgB = await readyOrg();
    const toA = parseE164(orgA.businessNumberE164);
    const toB = parseE164(orgB.businessNumberE164);
    if (!toA || !toB) throw new Error('bad fixture');

    const inboundA = `call_a_inbound_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef: inboundA, to: toA, from: parseE164('+420602099001') });
    await ctx.telco.completed({ callRef: inboundA, durationSeconds: 0 });

    const outboundA = `call_a_outbound_${randomUUID()}`;
    await ctx.telco.incomingCall({
      callRef: outboundA,
      to: toA,
      from: parseE164(orgA.personalNumberE164),
    });
    await ctx.telco.dtmf({ callRef: outboundA, digits: '604200003' });
    await ctx.telco.legAnswered({ callRef: outboundA });
    await ctx.telco.completed({ callRef: outboundA, durationSeconds: 5 });

    const inboundB = `call_b_inbound_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef: inboundB, to: toB, from: parseE164('+420602099002') });
    await ctx.telco.completed({ callRef: inboundB, durationSeconds: 0 });

    const res = await getJson(ctx.app, '/api/calls?direction=inbound', {
      cookieHeader: orgA.cookieHeader,
    });
    const body = await jsonBody<CallListResponse>(res);
    expect(body?.items.every((c) => c.direction === 'inbound')).toBe(true);
    expect(body?.items.length).toBe(1);
  });

  it('a full inbound+outbound demo sequence produces log rows matching the terminal-state table in design §5.3, field for field', async () => {
    const { cookieHeader, businessNumberE164, personalNumberE164 } = await readyOrg();
    const to = parseE164(businessNumberE164);
    const from = parseE164(personalNumberE164);
    if (!to || !from) throw new Error('bad fixture');

    // 1. Inbound, forwarded, answered.
    const answeredRef = `call_seq_answered_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef: answeredRef, to, from: parseE164('+420602300001') });
    await ctx.telco.legAnswered({ callRef: answeredRef });
    await ctx.telco.completed({ callRef: answeredRef, durationSeconds: 40 });

    // 2. Inbound, not picked up.
    const missedRef = `call_seq_missed_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef: missedRef, to, from: parseE164('+420602300002') });
    await ctx.telco.legEnded({ callRef: missedRef, legStatus: 'no_answer' });
    await ctx.telco.completed({ callRef: missedRef, durationSeconds: 0 });

    // 3. Outbound bridged, answered.
    const bridgedRef = `call_seq_bridged_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef: bridgedRef, to, from });
    await ctx.telco.dtmf({ callRef: bridgedRef, digits: '604300003' });
    await ctx.telco.legAnswered({ callRef: bridgedRef });
    await ctx.telco.completed({ callRef: bridgedRef, durationSeconds: 60 });

    // 4. Outbound, emergency refused.
    const emergencyRef = `call_seq_emergency_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef: emergencyRef, to, from });
    await ctx.telco.dtmf({ callRef: emergencyRef, digits: '112' });

    const res = await getJson(ctx.app, '/api/calls', { cookieHeader });
    const body = await jsonBody<CallListResponse>(res);
    const items = body?.items ?? [];
    const answered = items.find((c) => c.direction === 'inbound' && c.status === 'answered');
    expect(answered?.durationSeconds).toBe(40);

    const missed = items.find((c) => c.direction === 'inbound' && c.status === 'missed');
    expect(missed?.durationSeconds).toBe(0);

    const bridged = items.find((c) => c.direction === 'outbound' && c.status === 'answered');
    expect(bridged?.durationSeconds).toBe(60);
    expect(bridged?.initiatingUserId).toBeTruthy();

    const emergencyRefused = items.find((c) => c.status === 'emergency_refused');
    expect(emergencyRefused?.direction).toBe('outbound');
    expect(emergencyRefused?.durationSeconds).toBe(0);

    expect(items.length).toBe(4);
  });
});

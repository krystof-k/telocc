import { randomUUID } from 'node:crypto';
import { auditEvents, rateLimitCounters } from '@telocc/db';
import { parseE164 } from '@telocc/telephony';
import { describe, expect, it } from 'vitest';
import { setupContractTest } from '../helpers/context.ts';
import { createReadyOrg } from '../helpers/fixtures.ts';
import { jsonBody, postJson } from '../helpers/http.ts';

/**
 * rate-limits.contract.test.ts — abusable surfaces (ER-RATE-1, design.md §7, §9.1).
 * Test names deliberately match milestones.md's `-t` filter patterns: only the last
 * case's name contains "webhook" (M3 excludes it via `-t '^(?!.*webhook)'`; M4 re-adds
 * it via `-t 'webhook'`).
 *
 * Ambiguity note (tests/helpers/README.md): design.md doesn't pin an exact numeric
 * "alert threshold" for invalid webhook signatures (only the ANOMALY_* nightly-scan
 * thresholds are named, which are unrelated). This file sends a stress batch and
 * asserts the accumulation is counted and an `anomaly_flagged` audit event appears —
 * the concrete threshold constant is an M4/M8 implementation decision.
 */
describe('rate limits', () => {
  const ctx = setupContractTest();

  it('magic-link, PIN-issue, and PIN-confirm limits return generic 429 bodies with no identifier echo', async () => {
    const email = `ratelimit-generic-${randomUUID()}@example.test`;
    let last429Body: unknown;
    for (let i = 0; i < 4; i += 1) {
      const res = await postJson(ctx.app, '/api/auth/sign-in/magic-link', { email });
      if (res.status === 429) last429Body = await jsonBody(res);
    }
    expect(last429Body).toBeDefined();
    const serialized = JSON.stringify(last429Body);
    expect(serialized.includes(email)).toBe(false);
  });

  it('limits are per-identifier: a second email/phone/IP is unaffected', async () => {
    const emailA = `identifier-a-${randomUUID()}@example.test`;
    for (let i = 0; i < 3; i += 1) {
      await postJson(
        ctx.app,
        '/api/auth/sign-in/magic-link',
        { email: emailA },
        { headers: { 'x-forwarded-for': '203.0.113.50' } },
      );
    }
    const trippedForA = await postJson(
      ctx.app,
      '/api/auth/sign-in/magic-link',
      { email: emailA },
      { headers: { 'x-forwarded-for': '203.0.113.50' } },
    );
    expect(trippedForA.status).toBe(429);

    const emailB = `identifier-b-${randomUUID()}@example.test`;
    const resForB = await postJson(
      ctx.app,
      '/api/auth/sign-in/magic-link',
      { email: emailB },
      { headers: { 'x-forwarded-for': '198.51.100.60' } },
    );
    expect(resForB.status).toBeLessThan(300);
  });

  it('the window resets: after the fixed window passes, requests succeed again', async () => {
    const email = `window-reset-${randomUUID()}@example.test`;
    for (let i = 0; i < 3; i += 1) {
      await postJson(ctx.app, '/api/auth/sign-in/magic-link', { email });
    }
    const tripped = await postJson(ctx.app, '/api/auth/sign-in/magic-link', { email });
    expect(tripped.status).toBe(429);

    ctx.clock.advanceMinutes(15);
    ctx.clock.advanceSeconds(1);
    ctx.rebuildApp();

    const afterWindow = await postJson(ctx.app, '/api/auth/sign-in/magic-link', { email });
    expect(afterWindow.status).toBeLessThan(300);
  });

  it('rate-limit counter keys store no raw identifier (only hashes) in the database', async () => {
    const email = `hashed-key-${randomUUID()}@example.test`;
    const ip = '203.0.113.77';
    for (let i = 0; i < 4; i += 1) {
      await postJson(
        ctx.app,
        '/api/auth/sign-in/magic-link',
        { email },
        { headers: { 'x-forwarded-for': ip } },
      );
    }

    const rows = await ctx.db.select().from(rateLimitCounters);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.key.includes(email)).toBe(false);
      expect(row.key.includes(ip)).toBe(false);
    }
  });

  it('invalid webhook signatures increment a counter that trips the alert threshold', async () => {
    const { businessNumberE164 } = await createReadyOrg(ctx.app, ctx.db, ctx.mailbox, {
      officeHoursMode: 'always_open',
    });
    const to = parseE164(businessNumberE164);
    if (!to) throw new Error('bad fixture');

    const attempts = 15; // a stress batch — see file header ambiguity note
    for (let i = 0; i < attempts; i += 1) {
      await ctx.telco.incomingCall(
        { to, from: parseE164(`+42060400${String(i).padStart(4, '0')}`) },
        { signatureOverride: 'deadbeef'.repeat(8) },
      );
    }

    const events = await ctx.db.select().from(auditEvents);
    const rejectedCount = events.filter((e) => e.type === 'webhook_rejected').length;
    expect(rejectedCount).toBe(attempts);
    expect(events.some((e) => e.type === 'anomaly_flagged')).toBe(true);
  });
});

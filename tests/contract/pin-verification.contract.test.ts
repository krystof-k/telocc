import { randomUUID } from 'node:crypto';
import { auditEvents, memberships, phoneVerifications } from '@telocc/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { findUserIdByEmail, loginViaMagicLink } from '../helpers/auth.ts';
import { setupContractTest } from '../helpers/context.ts';
import { createMembershipFixture, createOrgFixture } from '../helpers/fixtures.ts';
import { postJson } from '../helpers/http.ts';

/**
 * pin-verification.contract.test.ts — SMS-PIN flow (ER-SEC-3, ER-RET-3, ER-EMG-3,
 * design.md §9.3).
 */

function extractSixDigitCode(text: string): string {
  const match = text.match(/\b(\d{6})\b/);
  if (!match?.[1]) throw new Error(`extractSixDigitCode: no 6-digit code found in "${text}"`);
  return match[1];
}

describe('SMS-PIN verification', () => {
  const ctx = setupContractTest();

  async function setupOwnerWithOrg(email = `pin-${randomUUID()}@example.test`) {
    const { cookieHeader } = await loginViaMagicLink(ctx.app, ctx.mailbox, email);
    const userId = await findUserIdByEmail(ctx.db, email);
    const org = await createOrgFixture(ctx.db);
    await createMembershipFixture(ctx.db, { orgId: org.id, userId });
    return { cookieHeader, orgId: org.id, userId };
  }

  it('requesting verification sends a 6-digit PIN via the telephony seam to the given number', async () => {
    const { cookieHeader } = await setupOwnerWithOrg();
    const phoneE164 = '+420777000001';
    const res = await postJson(ctx.app, '/api/verifications', { phoneE164 }, { cookieHeader });
    expect(res.status).toBeLessThan(300);

    expect(ctx.spies.sentSms.length).toBe(1);
    expect(ctx.spies.sentSms[0]?.to).toBe(phoneE164);
    expect(() => extractSixDigitCode(ctx.spies.sentSms[0]?.body ?? '')).not.toThrow();
  });

  it('the PIN is stored only as an HMAC hash — the digits never appear in the database', async () => {
    const { cookieHeader } = await setupOwnerWithOrg();
    await postJson(ctx.app, '/api/verifications', { phoneE164: '+420777000002' }, { cookieHeader });
    const pin = extractSixDigitCode(ctx.spies.sentSms[0]?.body ?? '');

    const rows = await ctx.db.select().from(phoneVerifications);
    expect(rows.length).toBe(1);
    expect(rows[0]?.pinHash).not.toBe(pin);
    expect(rows[0]?.pinHash.includes(pin)).toBe(false);
  });

  it('the correct PIN within TTL verifies the number and records verified_at', async () => {
    const { cookieHeader, userId } = await setupOwnerWithOrg();
    const phoneE164 = '+420777000003';
    const issueRes = await postJson(ctx.app, '/api/verifications', { phoneE164 }, { cookieHeader });
    const issueBody = (await issueRes.json().catch(() => ({}))) as { id?: string };
    const pin = extractSixDigitCode(ctx.spies.sentSms[0]?.body ?? '');

    const confirmRes = await postJson(
      ctx.app,
      `/api/verifications/${issueBody.id}/confirm`,
      { pin },
      { cookieHeader },
    );
    expect(confirmRes.status).toBeLessThan(300);

    const [membership] = await ctx.db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, userId));
    expect(membership?.personalNumberE164).toBe(phoneE164);
    expect(membership?.personalNumberVerifiedAt).toBeTruthy();
  });

  it('verification deletes the challenge row (not merely flags it)', async () => {
    const { cookieHeader } = await setupOwnerWithOrg();
    const issueRes = await postJson(
      ctx.app,
      '/api/verifications',
      { phoneE164: '+420777000004' },
      { cookieHeader },
    );
    const issueBody = (await issueRes.json().catch(() => ({}))) as { id?: string };
    const pin = extractSixDigitCode(ctx.spies.sentSms[0]?.body ?? '');

    await postJson(
      ctx.app,
      `/api/verifications/${issueBody.id}/confirm`,
      { pin },
      { cookieHeader },
    );

    const rows = await ctx.db.select().from(phoneVerifications);
    expect(rows.length).toBe(0);
  });

  it('the 5th wrong attempt invalidates the challenge; the correct PIN no longer works after that', async () => {
    const { cookieHeader } = await setupOwnerWithOrg();
    const issueRes = await postJson(
      ctx.app,
      '/api/verifications',
      { phoneE164: '+420777000005' },
      { cookieHeader },
    );
    const issueBody = (await issueRes.json().catch(() => ({}))) as { id?: string };
    const correctPin = extractSixDigitCode(ctx.spies.sentSms[0]?.body ?? '');
    const wrongPin = correctPin === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i += 1) {
      const res = await postJson(
        ctx.app,
        `/api/verifications/${issueBody.id}/confirm`,
        { pin: wrongPin },
        { cookieHeader },
      );
      expect(res.status, `attempt ${i + 1}`).toBeGreaterThanOrEqual(400);
    }

    const finalAttempt = await postJson(
      ctx.app,
      `/api/verifications/${issueBody.id}/confirm`,
      { pin: correctPin },
      { cookieHeader },
    );
    expect(finalAttempt.status).toBeGreaterThanOrEqual(400);
  });

  it('a PIN older than 10 minutes is rejected', async () => {
    const { cookieHeader } = await setupOwnerWithOrg();
    const issueRes = await postJson(
      ctx.app,
      '/api/verifications',
      { phoneE164: '+420777000006' },
      { cookieHeader },
    );
    const issueBody = (await issueRes.json().catch(() => ({}))) as { id?: string };
    const pin = extractSixDigitCode(ctx.spies.sentSms[0]?.body ?? '');

    ctx.clock.advanceMinutes(10);
    ctx.clock.advanceSeconds(1);
    ctx.rebuildApp();

    const res = await postJson(
      ctx.app,
      `/api/verifications/${issueBody.id}/confirm`,
      { pin },
      { cookieHeader },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('a resend inside the 60-second cooldown returns 429', async () => {
    const { cookieHeader } = await setupOwnerWithOrg();
    const phoneE164 = '+420777000007';
    const first = await postJson(ctx.app, '/api/verifications', { phoneE164 }, { cookieHeader });
    expect(first.status).toBeLessThan(300);

    const second = await postJson(ctx.app, '/api/verifications', { phoneE164 }, { cookieHeader });
    expect(second.status).toBe(429);
  });

  it('the 6th SMS to one phone number in a day returns 429', async () => {
    const { cookieHeader } = await setupOwnerWithOrg();
    const phoneE164 = '+420777000008';
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await postJson(ctx.app, '/api/verifications', { phoneE164 }, { cookieHeader });
      statuses.push(res.status);
      ctx.clock.advanceMinutes(11); // clears the 60s cooldown and the 3/10min window
      ctx.rebuildApp();
    }
    expect(statuses.slice(0, 5).every((s) => s < 300)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it('the 11th SMS for one org in a day returns 429', async () => {
    const { cookieHeader } = await setupOwnerWithOrg();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await postJson(
        ctx.app,
        '/api/verifications',
        { phoneE164: `+42077800${String(i).padStart(4, '0')}` },
        { cookieHeader, headers: { 'x-forwarded-for': `198.51.100.${i}` } },
      );
      statuses.push(res.status);
      ctx.clock.advanceMinutes(11);
      ctx.rebuildApp();
    }
    expect(statuses.slice(0, 10).every((s) => s < 300)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('changing the personal number requires a fresh verification — the old number stays active until the new one is confirmed', async () => {
    const { cookieHeader, userId } = await setupOwnerWithOrg();
    const oldNumber = '+420777000010';
    const issueOld = await postJson(
      ctx.app,
      '/api/verifications',
      { phoneE164: oldNumber },
      { cookieHeader },
    );
    const oldBody = (await issueOld.json().catch(() => ({}))) as { id?: string };
    const oldPin = extractSixDigitCode(ctx.spies.sentSms[0]?.body ?? '');
    await postJson(
      ctx.app,
      `/api/verifications/${oldBody.id}/confirm`,
      { pin: oldPin },
      { cookieHeader },
    );

    const newNumber = '+420777000011';
    ctx.clock.advanceMinutes(11);
    ctx.rebuildApp();
    const issueNew = await postJson(
      ctx.app,
      '/api/verifications',
      { phoneE164: newNumber },
      { cookieHeader },
    );
    const newBody = (await issueNew.json().catch(() => ({}))) as { id?: string };

    const [duringChange] = await ctx.db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, userId));
    expect(duringChange?.personalNumberE164).toBe(oldNumber);

    const newPin = extractSixDigitCode(ctx.spies.sentSms.at(-1)?.body ?? '');
    await postJson(
      ctx.app,
      `/api/verifications/${newBody.id}/confirm`,
      { pin: newPin },
      { cookieHeader },
    );

    const [afterChange] = await ctx.db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, userId));
    expect(afterChange?.personalNumberE164).toBe(newNumber);
  });

  it('verifying records the emergency-limitation acknowledgment timestamp', async () => {
    const { cookieHeader, userId } = await setupOwnerWithOrg();
    const issueRes = await postJson(
      ctx.app,
      '/api/verifications',
      { phoneE164: '+420777000012' },
      { cookieHeader },
    );
    const issueBody = (await issueRes.json().catch(() => ({}))) as { id?: string };
    const pin = extractSixDigitCode(ctx.spies.sentSms[0]?.body ?? '');
    await postJson(
      ctx.app,
      `/api/verifications/${issueBody.id}/confirm`,
      { pin },
      { cookieHeader },
    );

    const [membership] = await ctx.db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, userId));
    expect(membership?.emergencyAckAt).toBeTruthy();
  });

  it('PIN issuance and failed attempts appear in audit_events without any PIN value', async () => {
    const { cookieHeader } = await setupOwnerWithOrg();
    const issueRes = await postJson(
      ctx.app,
      '/api/verifications',
      { phoneE164: '+420777000013' },
      { cookieHeader },
    );
    const issueBody = (await issueRes.json().catch(() => ({}))) as { id?: string };
    const correctPin = extractSixDigitCode(ctx.spies.sentSms[0]?.body ?? '');
    const wrongPin = correctPin === '000000' ? '111111' : '000000';
    await postJson(
      ctx.app,
      `/api/verifications/${issueBody.id}/confirm`,
      { pin: wrongPin },
      { cookieHeader },
    );

    const events = await ctx.db.select().from(auditEvents);
    const types = events.map((e) => e.type);
    expect(types).toContain('pin_issued');
    expect(types).toContain('pin_attempt_failed');
    for (const event of events) {
      const serialized = JSON.stringify(event.meta);
      expect(serialized.includes(correctPin)).toBe(false);
      expect(serialized.includes(wrongPin)).toBe(false);
    }
  });
});

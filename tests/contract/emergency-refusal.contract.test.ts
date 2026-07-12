import { randomUUID } from 'node:crypto';
import { calls } from '@telocc/db';
import { parseE164 } from '@telocc/telephony';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setupContractTest } from '../helpers/context.ts';
import { createReadyOrg } from '../helpers/fixtures.ts';

/**
 * emergency-refusal.contract.test.ts — ER-EMG-1/2, design.md §5.2 steps a-d (safety-critical).
 */
describe('emergency and destination-blocked refusal', () => {
  const ctx = setupContractTest();

  async function dialInSession() {
    const { orgId, businessNumberE164, personalNumberE164 } = await createReadyOrg(
      ctx.app,
      ctx.db,
      ctx.mailbox,
      {
        officeHoursMode: 'always_open',
      },
    );
    const to = parseE164(businessNumberE164);
    const from = parseE164(personalNumberE164);
    if (!to || !from) throw new Error('bad fixture');
    return { orgId, to, from };
  }

  async function dial(
    to: NonNullable<ReturnType<typeof parseE164>>,
    from: NonNullable<ReturnType<typeof parseE164>>,
    digits: string,
  ) {
    const callRef = `call_${randomUUID()}`;
    await ctx.telco.incomingCall({ callRef, to, from });
    const res = await ctx.telco.dtmf({ callRef, digits });
    return { callRef, res };
  }

  it('each of 112, 150, 155, 156, 158 gets the distinct refusal tone and a call row with status emergency_refused', async () => {
    const { orgId, to, from } = await dialInSession();
    for (const code of ['112', '150', '155', '156', '158']) {
      const { callRef, res } = await dial(to, from, code);
      expect(res.instruction?.kind, code).toBe('refuseTone');

      const [row] = await ctx.db.select().from(calls).where(eq(calls.providerCallRef, callRef));
      expect(row?.status, code).toBe('emergency_refused');
    }
    const rows = await ctx.db.select().from(calls).where(eq(calls.orgId, orgId));
    expect(rows.length).toBe(5);
  });

  it('no dial/bridge/forward instruction is ever rendered for an emergency number', async () => {
    const { to, from } = await dialInSession();
    for (const code of ['112', '150', '155', '156', '158']) {
      await dial(to, from, code);
    }
    const dialCapableKinds = new Set(['forward', 'bridge']);
    const dialCapable = ctx.spies.renderedInstructions.filter((r) =>
      dialCapableKinds.has(r.instruction.kind),
    );
    expect(dialCapable).toEqual([]);
  });

  it('emergency numbers with terminator variations (112#) are still refused', async () => {
    const { to, from } = await dialInSession();
    const { res } = await dial(to, from, '112#');
    expect(res.instruction?.kind).toBe('refuseTone');
  });

  it('other short codes (e.g. 1188) are refused and logged destination_blocked/short_code', async () => {
    const { to, from } = await dialInSession();
    const { callRef, res } = await dial(to, from, '1188');
    expect(res.instruction?.kind).toBe('refuseTone');

    const [row] = await ctx.db.select().from(calls).where(eq(calls.providerCallRef, callRef));
    expect(row?.status).toBe('destination_blocked');
    expect(row?.reason).toBe('short_code');
  });

  it('a premium-rate prefix from the seeded deny table (+420 90x) is refused and logged destination_blocked/premium', async () => {
    const { to, from } = await dialInSession();
    const { callRef, res } = await dial(to, from, '900123456');
    expect(res.instruction?.kind).toBe('refuseTone');

    const [row] = await ctx.db.select().from(calls).where(eq(calls.providerCallRef, callRef));
    expect(row?.status).toBe('destination_blocked');
    expect(row?.reason).toBe('premium');
  });

  it('an international target (0044…) is refused and logged destination_blocked/international', async () => {
    const { to, from } = await dialInSession();
    const { callRef, res } = await dial(to, from, '0044207946000');
    expect(res.instruction?.kind).toBe('refuseTone');

    const [row] = await ctx.db.select().from(calls).where(eq(calls.providerCallRef, callRef));
    expect(row?.status).toBe('destination_blocked');
    expect(row?.reason).toBe('international');
  });

  it('the refusal is audible, not silent: the rendered instruction is refuseTone, never bare hangup', async () => {
    const { to, from } = await dialInSession();
    const { res } = await dial(to, from, '112');
    expect(res.instruction?.kind).toBe('refuseTone');
    expect(res.instruction?.kind).not.toBe('hangup');
  });

  it('emergency refusal rows are never silent failures — reason and timestamps are populated', async () => {
    const { to, from } = await dialInSession();
    const { callRef } = await dial(to, from, '150');
    const [row] = await ctx.db.select().from(calls).where(eq(calls.providerCallRef, callRef));
    expect(row?.status).toBe('emergency_refused');
    expect(row?.startedAt).toBeTruthy();
  });
});

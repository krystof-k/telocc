import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { calls, orgs } from '@telocc/db';
import { describe, expect, it } from 'vitest';
import { loginViaMagicLink } from '../helpers/auth.ts';
import { setupContractTest } from '../helpers/context.ts';
import { createBusinessNumberFixture, createOrgFixture } from '../helpers/fixtures.ts';
import { postJson } from '../helpers/http.ts';

const execFileAsync = promisify(execFile);

/**
 * posture-flip.contract.test.ts — ER-POST-1 (design.md §2, §6, §14).
 *
 * Ambiguity note (tests/helpers/README.md): design.md doesn't pin `scripts/esd-report.ts`'s
 * stdout format. This file assumes it prints one JSON object to stdout shaped
 * `{ inbound: { calls, minutes }, outbound: { calls, minutes } }` for the requested
 * half-year — the concrete contract for M8 to implement against.
 */
describe('compliance posture flip', () => {
  const ctx = setupContractTest();

  it('under posture app_layer, onboarding has no contract-summary step', async () => {
    ctx.rebuildApp({ COMPLIANCE_POSTURE: 'app_layer' });
    const email = 'app-layer-owner@example.test';
    const { cookieHeader } = await loginViaMagicLink(ctx.app, ctx.mailbox, email);

    const res = await postJson(
      ctx.app,
      '/api/orgs',
      { name: 'App Layer Org', businessCapacityDeclared: true },
      { cookieHeader },
    );
    expect(res.status).toBeLessThan(300);

    const [org] = await ctx.db.select().from(orgs);
    expect(org?.contractSummaryShownAt).toBeNull();
    expect(org?.waiverAcceptedAt).toBeNull();
  });

  it('under posture nbics_provider, org creation requires the § 63a summary + waiver and records both timestamps', async () => {
    ctx.rebuildApp({ COMPLIANCE_POSTURE: 'nbics_provider' });
    const email = 'nbics-owner@example.test';
    const { cookieHeader } = await loginViaMagicLink(ctx.app, ctx.mailbox, email);

    const withoutWaiver = await postJson(
      ctx.app,
      '/api/orgs',
      { name: 'NBICS Org', businessCapacityDeclared: true },
      { cookieHeader },
    );
    expect(withoutWaiver.status).toBe(400);

    const withWaiver = await postJson(
      ctx.app,
      '/api/orgs',
      { name: 'NBICS Org', businessCapacityDeclared: true, waiverAccepted: true },
      { cookieHeader },
    );
    expect(withWaiver.status).toBeLessThan(300);

    const [org] = await ctx.db.select().from(orgs);
    expect(org?.contractSummaryShownAt).toBeTruthy();
    expect(org?.waiverAcceptedAt).toBeTruthy();
  });

  it(
    'the ESD report script produces per-direction calls and minutes with 30 June / 31 December ' +
      'cutoffs, including from anonymised rows (ER-AUD-3)',
    async () => {
      const org = await createOrgFixture(ctx.db);
      const businessNumber = await createBusinessNumberFixture(ctx.db, {
        orgId: org.id,
        e164: '+420212300000',
      });

      // One H1 call (kept), one H1 call already anonymised (numbers stripped, aggregate
      // survives), and one H2 call — the report must still count the anonymised row.
      await ctx.db.insert(calls).values([
        {
          orgId: org.id,
          businessNumberId: businessNumber.id,
          direction: 'inbound',
          status: 'answered',
          startedAt: new Date('2026-03-01T10:00:00Z'),
          durationSeconds: 120,
          fromE164: '+420604900001',
          toE164: businessNumber.e164,
        },
        {
          orgId: org.id,
          businessNumberId: businessNumber.id,
          direction: 'outbound',
          status: 'answered',
          startedAt: new Date('2026-05-01T10:00:00Z'),
          durationSeconds: 60,
          anonymisedAt: new Date('2027-06-01T00:00:00Z'),
        },
        {
          orgId: org.id,
          businessNumberId: businessNumber.id,
          direction: 'inbound',
          status: 'answered',
          startedAt: new Date('2026-09-01T10:00:00Z'),
          durationSeconds: 30,
          fromE164: '+420604900002',
          toE164: businessNumber.e164,
        },
      ]);

      const { stdout } = await execFileAsync(
        'node_modules/.bin/tsx',
        ['scripts/esd-report.ts', '--year', '2026', '--half', '1'],
        { env: { ...process.env, DATABASE_URL: ctx.databaseUrl }, cwd: process.cwd() },
      );

      const report = JSON.parse(stdout) as {
        inbound: { calls: number; minutes: number };
        outbound: { calls: number; minutes: number };
      };
      expect(report.inbound.calls).toBe(1);
      expect(report.inbound.minutes).toBeCloseTo(2, 5);
      expect(report.outbound.calls).toBe(1);
      expect(report.outbound.minutes).toBeCloseTo(1, 5);
    },
  );
});

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invoiceLines, invoices, orgTurnoverYears } from '@telocc/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setupContractTest } from '../helpers/context.ts';
import { createOrgFixture } from '../helpers/fixtures.ts';

/**
 * seam-isolation.contract.test.ts — the architectural invariant (design.md §4.6, §9.8;
 * ER-BILL-1). The first four cases are static source scans and must pass from M1
 * onward (docs/milestones.md: "seam-isolation static scans pass already — nothing to
 * violate yet"); the billing case is a real DB test (billing tables are exercised only
 * here, decisions.md #24).
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

function listTsFiles(dir: string): string[] {
  const absDir = join(REPO_ROOT, dir);
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.wrangler')
      continue;
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(entryPath));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(entryPath);
    }
  }
  return out;
}

function read(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

describe('seam isolation (static scans)', () => {
  it('no file in packages/core or apps/api (except deps.ts) imports twilio or @telocc/telephony/twilio', () => {
    const files = [...listTsFiles('packages/core/src'), ...listTsFiles('apps/api/src')].filter(
      (f) =>
        relative(REPO_ROOT, join(REPO_ROOT, f)) !== 'apps/api/src/deps.ts' &&
        !f.endsWith('.test.ts'),
    );
    const offenders: string[] = [];
    for (const file of files) {
      const source = read(file);
      if (
        /from\s+['"](@telocc\/telephony\/twilio|twilio)['"]/.test(source) ||
        /require\(['"]twilio['"]\)/.test(source)
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no provider-specific identifier (TwiML, CallSid) appears outside packages/telephony', () => {
    const files = [
      ...listTsFiles('packages/core/src'),
      ...listTsFiles('apps/api/src'),
      ...listTsFiles('packages/db/src'),
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const source = read(file);
      if (/\bTwiML\b/.test(source) || /\bCallSid\b/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('route files import repos, not the db package directly', () => {
    const files = listTsFiles('apps/api/src/routes').filter(
      (f) => !f.endsWith('webhooks.ts') && !f.includes('/dev/') && !f.endsWith('.test.ts'),
    );
    const offenders: string[] = [];
    for (const file of files) {
      const source = read(file);
      if (/from\s+['"]@telocc\/db['"]/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the redacting logger is the only logger imported in webhook and auth handlers', () => {
    const candidates = listTsFiles('apps/api/src').filter(
      (f) =>
        (f.includes('/routes/webhooks') ||
          f.includes('/routes/auth') ||
          f.includes('/middleware/')) &&
        !f.endsWith('.test.ts'),
    );
    const offenders: string[] = [];
    for (const file of candidates) {
      const source = read(file);
      // `console.*` is banned outright in these files, regardless of whether the
      // redacting logger is ALSO imported: a stray `console.log` bypasses ER-SEC-4
      // redaction entirely even sitting next to a correct `lib/log.ts` import, so the
      // previous "only flag console usage when the own logger is absent" exemption
      // was a hole — any console call here is a violation, full stop.
      const usesConsole = /console\.(log|error|warn|info|debug|trace)\s*\(/.test(source);
      // Third-party logging libraries are equally banned — only `lib/log.ts` may
      // log in these files (ER-SEC-4: the redactor is the sole emission path).
      const importsThirdPartyLogger =
        /from\s+['"](pino|winston|debug|loglevel)(\/[^'"]*)?['"]/.test(source) ||
        /require\(\s*['"](pino|winston|debug|loglevel)['"]\s*\)/.test(source);
      if (usesConsole || importsThirdPartyLogger) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  describe('billing-dormant tables (ER-BILL-1)', () => {
    const ctx = setupContractTest();

    it(
      'billing-dormant tables accept a well-formed invoice with sequential numbering and ' +
        'reverse-charge legend, and the turnover counter compares against both CZK thresholds',
      async () => {
        const org = await createOrgFixture(ctx.db);

        // Sequential invoice numbering + reverse-charge legend.
        const [invoice1] = await ctx.db
          .insert(invoices)
          .values({
            orgId: org.id,
            seq: 1,
            currency: 'CZK',
            reverseCharge: false,
            totalNet: '1000.00',
            totalVat: '210.00',
          })
          .returning();
        const [invoice2] = await ctx.db
          .insert(invoices)
          .values({
            orgId: org.id,
            seq: 2,
            currency: 'EUR',
            reverseCharge: true,
            reverseChargeLegend: 'Reverse charge — VAT to be accounted for by the recipient',
            totalNet: '500.00',
            totalVat: '0.00',
          })
          .returning();
        if (!invoice1 || !invoice2) throw new Error('fixture insert failed');
        expect(invoice2.seq).toBe(invoice1.seq + 1);
        expect(invoice2.reverseChargeLegend).toContain('Reverse charge');

        await ctx.db.insert(invoiceLines).values({
          invoiceId: invoice1.id,
          description: 'Business number monthly fee',
          qty: 1,
          unitNet: '1000.00',
          vatRate: '21.00',
          amountNet: '1000.00',
          amountVat: '210.00',
        });
        const lines = await ctx.db
          .select()
          .from(invoiceLines)
          .where(eq(invoiceLines.invoiceId, invoice1.id));
        expect(lines.length).toBe(1);

        // Turnover counter against both CZK VAT-registration thresholds (2,000,000 / 2,536,500).
        await ctx.db.insert(orgTurnoverYears).values([
          { orgId: org.id, year: 2025, netCzk: '1999999.99' },
          { orgId: org.id, year: 2026, netCzk: '2536500.01' },
        ]);
        const turnoverRows = await ctx.db
          .select()
          .from(orgTurnoverYears)
          .where(eq(orgTurnoverYears.orgId, org.id));
        const y2025 = turnoverRows.find((r) => r.year === 2025);
        const y2026 = turnoverRows.find((r) => r.year === 2026);
        expect(Number(y2025?.netCzk)).toBeLessThan(2_000_000);
        expect(Number(y2026?.netCzk)).toBeGreaterThan(2_536_500);

        // (org, year) is unique — a duplicate insert must fail.
        await expect(
          ctx.db.insert(orgTurnoverYears).values({ orgId: org.id, year: 2025, netCzk: '1.00' }),
        ).rejects.toThrow();
      },
    );
  });
});

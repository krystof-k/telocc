/**
 * ER-AUD-3 half-year volumes report (SQL over `calls`; design.md §7). Usage:
 *
 *   pnpm report:esd -- --year 2026 --half 1
 *
 * M0 stub only — argument parsing + the real per-direction calls/minutes query
 * (30 June / 31 December cutoffs, including from anonymised rows) land in M8.
 */
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    year: { type: 'string' },
    half: { type: 'string' },
  },
});

if (!values.year || !values.half) {
  console.error('Usage: pnpm report:esd -- --year <YYYY> --half <1|2>');
  process.exit(1);
}

console.log(
  `esd-report stub: would report calls/minutes for ${values.year} H${values.half} (implemented in M8).`,
);

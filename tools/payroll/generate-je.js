// Reproduces Garrison's existing payroll breakout method, reverse-engineered from the
// posted April 2026 entries in QBO (both periods reconcile to the penny — see verify()).
//
// Method:
//   DEBIT  Wages - Bartenders   taproom roster, gross less tips/commission/auto
//   DEBIT  Wages - General      everyone else except the contractor, same basis
//   DEBIT  Commission           COMM code
//   DEBIT  Mileage Stipend      AUTO code
//   DEBIT  <contractor acct>    Design LLC, Johnnyo — paid via payroll, not wages
//   DEBIT  <tips acct>          TIPCC — customer money passing through payroll
//   CREDIT Employer Taxes       employee withholding (the later tax payment covers ER+EE)
//   CREDIT 401K                 401K deferral code only
//   CREDIT Employee Benefits    every other deduction code
//   CREDIT 4) Payroll Expenses  net direct deposit — clears the lump sitting in the parent

const { parseRegister } = require('./parse-register');
const r2 = (n) => Math.round(n * 100) / 100;

const MEMO = new Set(['401ER', 'VACM']);          // listed in earnings, excluded from gross
const BARTENDERS = new Set([
  'Allred, Brandolyn C.', 'Gray, Brandon', 'Hansen, Taylor', 'Lewis, Richard K.',
  'Hooten, Angela', 'Mayo, Deara', 'Ramhart, Veronica', 'Pitman, Samantha',
]);
const CONTRACTORS = new Set(['Design LLC, Johnnyo']);

const ACCT = {
  bartenders: '4) Payroll Expenses:Wages - Bartenders',
  general: '4) Payroll Expenses:Wages - General',
  commission: '4) Payroll Expenses:Commission',
  mileage: '4) Payroll Expenses:Mileage Stipend',
  // Confirmed by Garrison 2026-07-31. Both sit OUTSIDE `4) Payroll Expenses`,
  // which is why neither was visible in the transaction report the method was
  // derived from. Both are balance-sheet accounts, and that is the point:
  //   Accounts Payable    — Johnnyo bills STB, the bill posts DR expense / CR A/P,
  //                         and the payroll draft pays it. This line CLEARS the bill,
  //                         so it must not be re-expensed as wages.
  //   Employee Tips Payable — customer money held as a liability until paid out
  //                         through payroll. This line CLEARS the liability.
  contractor: 'Accounts Payable',
  tips: 'Employee Tips Payable',
  erTaxes: '4) Payroll Expenses:Employer Taxes',
  k401: '4) Payroll Expenses:401K',
  benefits: '4) Payroll Expenses:Employee Benefits',
  parent: '4) Payroll Expenses',
};

function buildJE(txtPath) {
  const { meta, employees, totals } = parseRegister(txtPath);
  const g = { bartenders: 0, general: 0, contractor: 0, commission: 0, mileage: 0, tips: 0 };

  for (const e of employees) {
    const gross = r2(Object.entries(e.earnings).filter(([k]) => !MEMO.has(k))
      .reduce((a, [, v]) => a + v, 0));
    const tips = r2(e.earnings.TIPCC || 0);
    const comm = r2(e.earnings.COMM || 0);
    const auto = r2(e.earnings.AUTO || 0);
    const wages = r2(gross - tips - comm - auto);

    g.tips = r2(g.tips + tips);
    g.commission = r2(g.commission + comm);
    g.mileage = r2(g.mileage + auto);
    if (CONTRACTORS.has(e.name)) g.contractor = r2(g.contractor + wages);
    else if (BARTENDERS.has(e.name)) g.bartenders = r2(g.bartenders + wages);
    else g.general = r2(g.general + wages);
  }

  const k401 = r2(totals.deductions['401K'] || 0);
  const benefits = r2(totals.dedTotal - k401);

  const lines = [
    { acct: ACCT.bartenders, debit: g.bartenders },
    { acct: ACCT.general, debit: g.general },
    { acct: ACCT.commission, debit: g.commission },
    { acct: ACCT.mileage, debit: g.mileage },
    // QBO REQUIRES a Name on any Accounts Payable journal line — it refuses to
    // save without one. Carried here so the entry does not fail at keying time.
    { acct: ACCT.contractor, debit: g.contractor, name: 'Johnnyo Design' },
    { acct: ACCT.tips, debit: g.tips },
    { acct: ACCT.erTaxes, credit: totals.taxTotal },
    { acct: ACCT.k401, credit: k401 },
    { acct: ACCT.benefits, credit: benefits },
    { acct: ACCT.parent, credit: totals.net },
  ].filter((l) => r2((l.debit ?? 0) + (l.credit ?? 0)) !== 0);

  const dr = r2(lines.reduce((a, l) => a + (l.debit || 0), 0));
  const cr = r2(lines.reduce((a, l) => a + (l.credit || 0), 0));

  return { meta, totals, groups: g, k401, benefits, lines, dr, cr, balanced: Math.abs(dr - cr) < 0.005 };
}

// Regression: the two April periods are already posted in QBO. If the generator
// can't reproduce them exactly, it must not be trusted on May.
const EXPECTED = {
  '04/15/2026': { bartenders: 3145.47, general: 16102.31, commission: 1775.30, mileage: 0,
                  erTaxes: 2758.76, k401: 532.14, benefits: 2180.79, net: 32665.17 },
  '04/30/2026': { bartenders: 3780.80, general: 16057.27, commission: 1624.00, mileage: 1225.00,
                  erTaxes: 3592.23, k401: 390.26, benefits: 1784.46, net: 24190.79 },
};

function verify(je) {
  const exp = EXPECTED[je.meta.checkDate];
  if (!exp) return null;
  const got = {
    bartenders: je.groups.bartenders, general: je.groups.general,
    commission: je.groups.commission, mileage: je.groups.mileage,
    erTaxes: je.totals.taxTotal, k401: je.k401, benefits: je.benefits, net: je.totals.net,
  };
  return Object.entries(exp).map(([k, v]) => ({
    field: k, expected: v, got: got[k], ok: Math.abs(v - got[k]) < 0.005,
  }));
}

module.exports = { buildJE, verify, ACCT };

if (require.main === module) {
  const money = (n) => (n == null ? '' : n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  let anyFail = false;

  for (const f of process.argv.slice(2)) {
    const je = buildJE(f);
    const v = verify(je);

    console.log('\n' + '='.repeat(84));
    console.log(`JOURNAL ENTRY — payroll ${je.meta.checkDate}   (pay period ${je.meta.periodStart} to ${je.meta.periodEnd})`);
    console.log('='.repeat(84));
    console.log('Account'.padEnd(46) + 'Debit'.padStart(14) + 'Credit'.padStart(16) + '   Name');
    console.log('-'.repeat(84));
    for (const l of je.lines) {
      console.log(l.acct.padEnd(46) + money(l.debit).padStart(14) + money(l.credit).padStart(16) +
        (l.name ? '   ' + l.name : ''));
    }
    console.log('-'.repeat(84));
    console.log('TOTAL'.padEnd(46) + money(je.dr).padStart(14) + money(je.cr).padStart(16));
    console.log(je.balanced ? '  BALANCED' : '  *** OUT OF BALANCE ***');
    if (!je.balanced) anyFail = true;

    if (v) {
      console.log('\n  regression vs the entry already posted in QBO:');
      for (const r of v) {
        if (!r.ok) anyFail = true;
        console.log(`    ${r.ok ? 'OK  ' : 'FAIL'}  ${r.field.padEnd(12)} expected ${money(r.expected).padStart(11)}   got ${money(r.got).padStart(11)}`);
      }
    }
  }
  process.exit(anyFail ? 1 : 0);
}

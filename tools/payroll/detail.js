const { parseRegister } = require('./parse-register');
const r2 = (n) => Math.round(n * 100) / 100;

// Confirmed by per-employee probe: Paylocity lists these in the earnings column
// but excludes them from gross. 401ER = employer 401k match, VACM = vacation memo.
const MEMO = new Set(['401ER', 'VACM']);
// Credit-card tips run through payroll but are customer money, not wage expense.
const TIPS = new Set(['TIPCC']);

for (const f of process.argv.slice(2)) {
  const { meta, employees, totals } = parseRegister(f);
  console.log('\n' + '='.repeat(112));
  console.log(`CHECK ${meta.checkDate}   period ${meta.periodStart}-${meta.periodEnd}   net ${totals.net.toFixed(2)}`);
  console.log('-'.repeat(112));
  console.log(
    'Employee'.padEnd(24) + 'Title'.padEnd(22) + 'WCC'.padEnd(7) +
    'Gross'.padStart(10) + 'Tips'.padStart(10) + 'Wages'.padStart(10) +
    'Comm'.padStart(9) + 'Auto'.padStart(8) + '  codes'
  );
  let tG = 0, tT = 0, tW = 0, tC = 0, tA = 0;
  for (const e of employees) {
    const gross = r2(Object.entries(e.earnings)
      .filter(([k]) => !MEMO.has(k)).reduce((a, [, v]) => a + v, 0));
    const tips = r2(Object.entries(e.earnings)
      .filter(([k]) => TIPS.has(k)).reduce((a, [, v]) => a + v, 0));
    const comm = r2(e.earnings.COMM || 0);
    const auto = r2(e.earnings.AUTO || 0);
    const wages = r2(gross - tips - comm - auto);
    tG = r2(tG + gross); tT = r2(tT + tips); tW = r2(tW + wages); tC = r2(tC + comm); tA = r2(tA + auto);
    console.log(
      e.name.padEnd(24) + (e.title || '-').slice(0, 21).padEnd(22) + (e.wcc || '-').padEnd(7) +
      gross.toFixed(2).padStart(10) + tips.toFixed(2).padStart(10) + wages.toFixed(2).padStart(10) +
      comm.toFixed(2).padStart(9) + auto.toFixed(2).padStart(8) +
      '  ' + Object.keys(e.earnings).join(',')
    );
  }
  console.log('-'.repeat(112));
  console.log('TOTALS'.padEnd(53) + tG.toFixed(2).padStart(10) + tT.toFixed(2).padStart(10) +
    tW.toFixed(2).padStart(10) + tC.toFixed(2).padStart(9) + tA.toFixed(2).padStart(8));
  console.log(`  report gross ${totals.grossTotal.toFixed(2)}   taxes(EE) ${totals.taxTotal.toFixed(2)}   deductions ${totals.dedTotal.toFixed(2)}   401ER ${(totals.earnings['401ER'] || 0).toFixed(2)}`);
  console.log('  deduction codes: ' + Object.entries(totals.deductions).map(([k, v]) => `${k}=${v.toFixed(2)}`).join('  '));
  console.log('  tax codes:       ' + Object.entries(totals.taxes).map(([k, v]) => `${k}=${v.toFixed(2)}`).join('  '));
}

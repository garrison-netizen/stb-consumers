const { parseRegister } = require('./parse-register');
const path = require('path');

const r2 = (n) => Math.round(n * 100) / 100;
const sum = (o) => r2(Object.values(o).reduce((a, b) => a + b, 0));

// 401ER is an employer contribution memo line — Paylocity lists it in the earnings
// column but excludes it from gross. Treat it separately everywhere.
const MEMO_EARNINGS = ['401ER'];

for (const f of process.argv.slice(2)) {
  const { meta, employees, totals } = parseRegister(f);
  console.log('='.repeat(78));
  console.log(`${path.basename(f)}  |  check ${meta.checkDate}  |  period ${meta.periodStart} - ${meta.periodEnd}  |  process ${meta.process}`);
  console.log(`employees parsed: ${employees.length}   (report says ${totals?.counts?.Employees})`);

  if (!totals) { console.log('  !! no Report Totals block found'); continue; }

  // ---- Sum the per-employee detail and compare to the Report Totals block ----
  const agg = { earnings: {}, taxes: {}, deductions: {} };
  let net = 0;
  for (const e of employees) {
    for (const [k, v] of Object.entries(e.earnings)) agg.earnings[k] = r2((agg.earnings[k] || 0) + v);
    for (const [k, v] of Object.entries(e.taxes)) agg.taxes[k] = r2((agg.taxes[k] || 0) + v);
    for (const [k, v] of Object.entries(e.deductions)) agg.deductions[k] = r2((agg.deductions[k] || 0) + v);
    net = r2(net + (e.net || 0));
  }

  const issues = [];
  for (const grp of ['earnings', 'taxes', 'deductions']) {
    const keys = new Set([...Object.keys(agg[grp]), ...Object.keys(totals[grp])]);
    for (const k of keys) {
      const a = agg[grp][k] || 0, b = totals[grp][k] || 0;
      if (Math.abs(a - b) > 0.02) issues.push(`${grp}.${k}: detail ${a.toFixed(2)} vs totals ${b.toFixed(2)}  (Δ ${(a - b).toFixed(2)})`);
    }
  }

  // ---- Internal arithmetic of the Report Totals block ----
  const grossFromCodes = r2(sum(totals.earnings) - MEMO_EARNINGS.reduce((a, k) => a + (totals.earnings[k] || 0), 0));
  const taxFromCodes = sum(totals.taxes);
  const dedFromCodes = sum(totals.deductions);
  const netCalc = r2(totals.grossTotal - totals.taxTotal - totals.dedTotal);

  const chk = (label, a, b) => {
    const ok = Math.abs(a - b) <= 0.02;
    console.log(`  ${ok ? 'OK ' : 'FAIL'}  ${label.padEnd(42)} ${a.toFixed(2).padStart(12)}  vs ${b.toFixed(2).padStart(12)}`);
    return ok;
  };

  chk('earning codes (ex 401ER) = gross total', grossFromCodes, totals.grossTotal);
  chk('tax codes = tax total', taxFromCodes, totals.taxTotal);
  chk('deduction codes = deduction total', dedFromCodes, totals.dedTotal);
  chk('gross - tax - ded = net', netCalc, totals.net);
  chk('sum of employee net = report net', net, totals.net);
  chk('detail gross = report gross', r2(sum(agg.earnings) - MEMO_EARNINGS.reduce((a, k) => a + (agg.earnings[k] || 0), 0)), totals.grossTotal);

  if (issues.length) {
    console.log('  line-item mismatches:');
    issues.forEach((s) => console.log('    - ' + s));
  } else {
    console.log('  every line item ties detail -> totals.');
  }

  console.log(`  gross ${totals.grossTotal?.toFixed(2)}   tips(TIPCC) ${(totals.earnings.TIPCC || 0).toFixed(2)}   401ER ${(totals.earnings['401ER'] || 0).toFixed(2)}   net ${totals.net?.toFixed(2)}`);
}

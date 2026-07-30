#!/usr/bin/env node
// Parse Paylocity Payroll Register PDFs (pdftotext -table output) into structured JSON.
// Columns are left-aligned at the header token start, so we slice by header offsets.

const fs = require('fs');

const num = (s) => {
  if (s == null) return null;
  const t = String(s).replace(/,/g, '').trim();
  if (!t || !/^-?\$?\d*\.?\d+$/.test(t.replace(/^\$/, ''))) return null;
  return parseFloat(t.replace(/^\$/, ''));
};

// Find start index of each header token, in order, allowing repeats.
function headerOffsets(line, tokens) {
  const offs = [];
  let from = 0;
  for (const tk of tokens) {
    const i = line.indexOf(tk, from);
    if (i < 0) return null;
    offs.push(i);
    from = i + tk.length;
  }
  return offs;
}

function slice(line, start, end) {
  if (start >= line.length) return '';
  return line.substring(start, end === undefined ? line.length : end).trim();
}

const EMP_HDR = ['Code', 'Hours', 'Rate', 'Amount', 'Code', 'Status', 'Taxable', 'Amount', 'Code', 'Amount', 'Vchr'];
const TOT_HDR = ['Code', 'Hours', 'Amount', 'Code', 'Taxable', 'Amount', 'Code', 'Amount', 'Chk/Vchr'];

// Page furniture repeats mid-block at every page break. Left unfiltered it bleeds
// into the earnings/deduction columns ("Chec" from "Check Date:", "Pro" from "Process:").
const FURNITURE = /^\s*(Payroll Register|Spindle Tap|.*\(\d{6}\)\s*$)|Check Dates?:|Processe?s?:|Pay Periods?:|Page \d+ of \d+|Paylocity Corporation|\(888\)|Run on|User:\s/;

// Real Paylocity codes are short and uppercase/alphanumeric.
const isCode = (s) => /^[A-Z0-9][A-Z0-9&/-]{1,7}$/.test(s);

function parseRegister(txtPath) {
  const raw = fs.readFileSync(txtPath, 'utf8');
  const lines = raw.split(/\r?\n/);

  const head = raw.slice(0, 4000);
  const meta = {
    company: (head.match(/^(.*?LLC.*?)\s*\((\d+)\)/m) || [])[1]?.trim() || null,
    companyId: (head.match(/LLC.*?\((\d+)\)/) || [])[1] || null,
    checkDate: (head.match(/Check Dates?:\s*(\d{2}\/\d{2}\/\d{4})/) || [])[1] || null,
    checkDateEnd: (head.match(/Check Dates:\s*\d{2}\/\d{2}\/\d{4}\s*to\s*(\d{2}\/\d{2}\/\d{4})/) || [])[1] || null,
    process: (head.match(/Processe?s?:\s*(\d+)/) || [])[1] || null,
    processEnd: (head.match(/Processes:\s*\d+\s*-\s*(\d+)/) || [])[1] || null,
    periodStart: (head.match(/Pay Periods?:\s*(\d{2}\/\d{2}\/\d{4})/) || [])[1] || null,
    periodEnd: (head.match(/Pay Periods?:\s*\d{2}\/\d{2}\/\d{4}\s*to\s*(\d{2}\/\d{2}\/\d{4})/) || [])[1] || null,
    multiPeriod: /Check Dates:/.test(head),
    sourceFile: txtPath,
  };

  const employees = [];
  let totals = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // --- Report Totals block ---
    if (/^\s*Report Totals\s*$/.test(line)) {
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const offs = headerOffsets(lines[j], TOT_HDR);
        if (!offs) continue;
        totals = parseTotals(lines, j, offs);
        break;
      }
      continue;
    }

    // --- Employee block: header row carries the name in the left gutter ---
    const offs = headerOffsets(line, EMP_HDR);
    if (!offs) continue;
    const name = slice(line, 0, offs[0]);
    // Report-total header has no name and uses TOT_HDR; employee header always has a name.
    if (!name || !/[A-Za-z]/.test(name)) continue;

    const emp = {
      name,
      empId: null, title: null, wcc: null, freq: null, rate: null, salary: null,
      earnings: {}, hours: {}, taxes: {}, taxable: {}, deductions: {},
      grossTotal: null, hoursTotal: null, taxTotal: null, dedTotal: null,
      net: null, dirDep: null, chkDate: null, type: null,
    };

    for (let j = i + 1; j < lines.length; j++) {
      const L = lines[j];
      if (!L.trim()) continue;
      if (FURNITURE.test(L)) continue;
      // block ends when the next employee header or Report Totals starts
      if (headerOffsets(L, EMP_HDR) && slice(L, 0, offs[0])) break;
      if (/^\s*Report Totals\s*$/.test(L)) break;

      const label = slice(L, 0, offs[0]);
      const isTotalsRow = /^Totals$/.test(slice(L, offs[0], offs[1]));

      // left gutter: label/value pairs are inside [0, offs[0])
      const lm = label.match(/^(Emp Id|Rate|Salary|Freq|Title|EEO|WCC)\s+(.*)$/);
      if (lm) {
        const k = lm[1], v = lm[2].trim();
        if (k === 'Emp Id') emp.empId = v;
        else if (k === 'Title') emp.title = v;
        else if (k === 'WCC') emp.wcc = v;
        else if (k === 'Freq') emp.freq = v;
        else if (k === 'Rate') emp.rate = num(v);
        else if (k === 'Salary') emp.salary = num(v);
      } else if (/^Title$/.test(label)) {
        emp.title = emp.title || '';
      }

      // earnings columns
      const eCode = slice(L, offs[0], offs[1]);
      const eHours = num(slice(L, offs[1], offs[2]));
      const eAmt = num(slice(L, offs[3], offs[4]));
      if (isCode(eCode)) {
        if (eAmt != null) emp.earnings[eCode] = (emp.earnings[eCode] || 0) + eAmt;
        if (eHours != null) emp.hours[eCode] = (emp.hours[eCode] || 0) + eHours;
      } else if (isTotalsRow) {
        if (eHours != null) emp.hoursTotal = eHours;
        if (eAmt != null) emp.grossTotal = eAmt;
      }

      // tax columns
      const tCode = slice(L, offs[4], offs[5]);
      const tTaxable = num(slice(L, offs[6], offs[7]));
      const tAmt = num(slice(L, offs[7], offs[8]));
      if (isCode(tCode)) {
        if (tAmt != null) emp.taxes[tCode] = (emp.taxes[tCode] || 0) + tAmt;
        if (tTaxable != null && emp.taxable[tCode] == null) emp.taxable[tCode] = tTaxable;
      } else if (tCode === 'Totals' && tAmt != null) {
        emp.taxTotal = tAmt;
      }

      // deduction columns
      const dCode = slice(L, offs[8], offs[9]);
      const dAmt = num(slice(L, offs[9], offs[10]));
      if (isCode(dCode)) {
        if (dAmt != null) emp.deductions[dCode] = (emp.deductions[dCode] || 0) + dAmt;
      } else if (dCode === 'Totals' && dAmt != null) {
        emp.dedTotal = dAmt;
      }

      // check info (right gutter, after Vchr column start)
      const right = slice(L, offs[10]);
      const rm = right.match(/^(Type|Chk Date|Net|Dir Dep|Chk)\s+(.+)$/);
      if (rm) {
        const k = rm[1], v = rm[2].trim();
        if (k === 'Type') emp.type = v;
        else if (k === 'Chk Date') emp.chkDate = v;
        else if (k === 'Net') emp.net = num(v);
        else if (k === 'Dir Dep') emp.dirDep = num(v);
      }
    }

    if (emp.grossTotal != null || Object.keys(emp.earnings).length) employees.push(emp);
  }

  return { meta, employees, totals };
}

function parseTotals(lines, hdrIdx, offs) {
  const t = { earnings: {}, hours: {}, taxes: {}, taxable: {}, deductions: {}, counts: {},
              grossTotal: null, hoursTotal: null, taxTotal: null, dedTotal: null,
              net: null, dirDep: null, chk: null };
  for (let j = hdrIdx; j < Math.min(hdrIdx + 40, lines.length); j++) {
    const L = lines[j];
    if (!L.trim()) continue;
    if (/Paylocity Corporation/.test(L)) break;
    if (FURNITURE.test(L)) continue;

    const left = slice(L, 0, offs[0]);
    const lm = left.match(/^(Employees|Female|Male)\s+(\d+)$/);
    if (lm) t.counts[lm[1]] = parseInt(lm[2], 10);

    const eCode = slice(L, offs[0], offs[1]);
    const eHours = num(slice(L, offs[1], offs[2]));
    const eAmt = num(slice(L, offs[2], offs[3]));
    if (isCode(eCode)) {
      if (eAmt != null) t.earnings[eCode] = eAmt;
      if (eHours != null) t.hours[eCode] = eHours;
    } else if (eCode === 'Totals') {
      if (eHours != null) t.hoursTotal = eHours;
      if (eAmt != null) t.grossTotal = eAmt;
    }

    const tCode = slice(L, offs[3], offs[4]);
    const tTaxable = num(slice(L, offs[4], offs[5]));
    const tAmt = num(slice(L, offs[5], offs[6]));
    if (isCode(tCode)) {
      if (tAmt != null) t.taxes[tCode] = tAmt;
      if (tTaxable != null) t.taxable[tCode] = tTaxable;
    } else if (tCode === 'Totals' && tAmt != null) {
      t.taxTotal = tAmt;
    }

    const dCode = slice(L, offs[6], offs[7]);
    const dAmt = num(slice(L, offs[7], offs[8]));
    if (isCode(dCode)) {
      if (dAmt != null) t.deductions[dCode] = dAmt;
    } else if (dCode === 'Totals' && dAmt != null) {
      t.dedTotal = dAmt;
    }

    const right = slice(L, offs[8]);
    const rm = right.match(/^(Net|Dir Dep|Chk|Checks|Vouchers)\s+([\d,.\-]+)$/);
    if (rm) {
      const v = num(rm[2]);
      if (rm[1] === 'Net') t.net = v;
      else if (rm[1] === 'Dir Dep') t.dirDep = v;
      else if (rm[1] === 'Chk') t.chk = v;
      else t.counts[rm[1]] = v;
    }
  }
  return t;
}

module.exports = { parseRegister, num };

if (require.main === module) {
  const out = parseRegister(process.argv[2]);
  console.log(JSON.stringify(out, null, 2));
}


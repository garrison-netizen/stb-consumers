# Payroll breakout — Paylocity register → QBO journal entry

Turns a Paylocity **Payroll Register** PDF into the journal entry that reclassifies a
payroll draft out of the parent `4) Payroll Expenses` account into its sub-accounts.

Built 2026-07-28. The method here is not invented — it was reverse-engineered from the
April 2026 entries Garrison had already posted by hand, and reproduces both of them to
the penny (16/16 field checks). That regression is baked into `generate-je.js` and runs
automatically whenever an April register is passed.

## Use

```bash
pdftotext -table "Payroll Register (79).PDF" out.txt   # -table is required, see below
node check.js out.txt                                  # validate the parse
node generate-je.js out.txt                            # emit the entry
```

`check.js` must pass before an entry is trusted. It cross-foots the parsed detail against
the register's own Report Totals block and verifies gross − taxes − deductions = net.

## The method

| | Account | Basis |
|---|---|---|
| DR | `Wages - Bartenders` | taproom roster, gross less tips/commission/auto |
| DR | `Wages - General` | everyone else except the contractor, same basis |
| DR | `Commission` | `COMM` code |
| DR | `Mileage Stipend` | `AUTO` code |
| DR | *contractor account* | Design LLC, Johnnyo — paid via payroll, not wages |
| DR | *tips account* | `TIPCC` — customer money passing through payroll |
| CR | `Employer Taxes` | employee withholding |
| CR | `401K` | `401K` deduction code only |
| CR | `Employee Benefits` | every other deduction code |
| CR | `4) Payroll Expenses` | net direct deposit — clears the lump in the parent |

Employer taxes are never accrued from the register. The credit above removes the employee
withholding that is already sitting inside gross wages; the actual Paylocity tax draft
(same day) debits the same account. What remains is the true employer burden. Verified:
5/15 draft 5,241.34 − 3,129.30 = 2,112.04 against employee FICA of 1,927.85, leaving
184.19 of FUTA/SUTA. 5/29 gives 181.02 on the same basis.

**Two accounts are still placeholders** (`<<CONTRACTOR ACCOUNT - CONFIRM>>`,
`<<TIPS ACCOUNT - CONFIRM>>`). They live outside `4) Payroll Expenses` so they were not
visible in the transaction report used to derive this. Read them off a posted entry in
QBO and hard-code them in `generate-je.js`.

## Gotchas that cost time

- **`pdftotext -table`, not `-layout`.** This is Xpdf's pdftotext 4.00 (ships with Git for
  Windows), not poppler — `-bbox-layout` is unavailable. `-layout` interleaves the
  multi-column register and silently corrupts amounts. `-table` aligns columns exactly.
- **Two export variants exist and they look almost identical.** The condensed one
  (~37–40KB) is a *filtered subset*, not a reformat — for the 5/29 run it shows 7
  employees / 6,251.42 against the full register's 20 / 35,212.06. Always confirm the
  parsed employee count matches the register's own stated count; `check.js` does this.
- **`401ER` and `VACM` are memo codes.** Paylocity prints them in the earnings column but
  excludes them from gross. Confirmed per-employee, not assumed. `401ER` is the employer
  401(k) match — a real employer cost, but not wages.
- **`AUTO` *is* real taxable pay** and belongs in gross. It maps to `Mileage Stipend`.
- **Page furniture repeats mid-block** at every page break and bleeds into the amount
  columns ("Chec" from "Check Date:"). Filtered by `FURNITURE` in the parser.
- **FICA base check:** gross − contractor − pre-tax (MDCL/VISON/HSA) = SS taxable, exactly.
  A good canary that the parse and the Section 125 setup are both right.

## Roster

Bartenders: Allred, Gray, Hansen, Lewis, Hooten, Mayo, Ramhart, Pitman.
Contractor (excluded from wages): Design LLC, Johnnyo.
Everyone else → General. Beasley is salaried-with-tips and belongs in **General**, not
Bartenders — that split is what makes April reconcile.

New hires will land in General by default. Check the roster when the entry stops tying.

## Open

- Finer departmental split is possible — titles + workers-comp codes are parsed. For 5/29
  the General pool breaks into Production ~6,500 / Sales ~5,185 / Admin ~2,108, with Marin
  Slanina and Taylor Beasley unclassifiable (blank titles in Paylocity). Needs new QBO
  sub-accounts and Garrison's call on those two. Production labor is COGS-eligible.
- Everything is booked on **check date**, not when earned. Each period straddles a
  month/quarter boundary, so period-end wants a standard accrued-payroll adjustment.
  Garrison's CPA call.

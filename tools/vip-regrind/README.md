# VIP mart repair tooling

Scripts here are one-shot repairs kept because the defect classes they guard against are
easy to reintroduce. All are dry-run by default and gated; `--write` applies.

| Script | What it does | Ran |
|---|---|---|
| `regrind-mart-a.mjs` | Mart A 2021–2025 rebuild (January-column defect) | 2026-07-29 |
| `diagnose-mart-b.mjs` | Mart B history diagnostic (MAX-not-SUM) | 2026-07-29 |
| `repair-mart-b.mjs` | Step 1 — value repair on existing rows + Goody merge | 2026-07-29 |
| `rebuild-airport-flag.mjs` | Airport cluster flag, Architect-approved rule | 2026-07-29 |
| `carve-class-cutover.mjs` | Carve class onto Mart A + Mart C, replacing the footprint boolean | 2026-07-30 |
| `verify-carve-class.mjs` | Read-only acceptance harness for the above | 2026-07-30 |
| `expand-mart-b-spine.mjs` | Step 3 — create Mart B rows for genuinely absent accounts | not yet |

`identity.js` holds the account canonicalization and the pipeline's `findExisting`
resolution, shared so that "absent from Mart B" means the same thing in every script.
Do not fork it — a second copy drifting is how the Step 3 count silently changes.

## Carve class (2026-07-30)

`Carve class` (`field` / `transferred_territory` / `lapsed_out_of_state`) replaces
`Footprint artifact` as the carve definition. This was a **correction, not a relabel**:
FullClip and Modern Hops were flagged `footprint=NO` and were being counted inside core,
worth 11,467.5 CE on 2022 alone.

Acceptance test is one number: **core 2022 = 29,603.6**. If it reads 41,071.1 the cutover
did not take. The cutover also syncs Mart A/C's denormalized boolean to the class so a
consumer still reading the boolean mid-cutover gets the same carve rather than the
superseded basis; the boolean is dropped only once every consumer is cut over
(Architect's call).

Carve class is constant within each parent distributor — `carve-class-cutover.mjs`
asserts this from the Map and aborts if it ever stops being true, because Mart A and
Mart C key on parent, not on the raw token.

---

# VIP Mart A — historical regrind

Rebuilds Mart A years 2021–2025 from the frozen `vip_dist_matrix_YYYY` DBs in the Brain.
Ran once on 2026-07-29 to repair the corrupted history. Kept because the defect class it
guards against is easy to reintroduce.

```bash
node regrind-mart-a.mjs                 # dry run, writes nothing
node regrind-mart-a.mjs --year 2025     # one year
node regrind-mart-a.mjs --write         # apply
```

Reads `NOTION_TOKEN` from `stb-exec-console/.env` (the STB Executive Console integration —
it already has Mart A and the year DBs shared with it). Note the Notion REST API wants
**database** IDs, not the `collection://` data-source IDs the MCP tools use; both are in
the script header.

## The bug this fixes

The original historical load read the **January single-month column**
(`1 Month 1/1/YYYY thru 1/31/YYYY  Case Equivs`) instead of the full-year rollup
(`12 Months 1/1/YYYY thru 12/31/YYYY  Case Equivs`). Mart A carried about a tenth of true
CE for five years — 2025 read 1,620.0 against a true 17,287.2.

It survived six weeks of review because it never looked like a clean divisor: the error
ratio drifts year to year (10.7×, 11.4×) purely because January's share of each year moves
with seasonality. The prior-year columns were always *correct*, because
`12 Months 1/1/{Y-1}` is unambiguous in those exports — there is only one. The defect could
only bite the current-year pick, where twelve single-month candidates sit alongside the one
rollup and sort ahead of it.

**The mechanical fix is in `findYearColumns()`:** a candidate must parse as a 12-period
window starting 1/1 and ending 12/31 of the target year. If no such column exists the
script throws rather than falling back to a shorter window. Never widen this to a fuzzy
match on `"Case Equivs"`.

## Gates

Three per year; all must pass before anything is written, and one failure aborts the
entire run, not just that year.

1. **Aggregate preserves CE** — summed cells must equal the summed raw column. This is
   the check the original load would have failed.
2. **Raw ties to the authoritative oracle** (0.1% tolerance). Oracle values are the
   Architect's double-sourced tie-out, hard-coded in `ORACLE`.
3. **Derived organic ties too** — validates the `Footprint artifact` flags, not just the
   volumes.

Two further checks hold as of the 2026-07-29 run and are worth re-testing after any change:
zero rows archived (every existing cell title matches a computed one, so the grain is
right), and each year's `CE prior year` equals the previous year's gross exactly.

## Conventions (locked by Architect, 2026-07-24)

- **Gross is the only stored basis.** Organic is a read-time filter over
  `Footprint artifact` — never a second stored total. This script writes gross and sets
  the flag; it never writes organic.
- Grain and cell-title format match the live GAS pipeline exactly
  (`pipelines/vip-marts/src/Transform.gs`, `VM_computeMartA_`):
  `"Brand | Parent | Segment | Year"`.
- **2026 is never touched** — it is pipeline-written and already exact.
- Unmapped distributor tokens throw. Add them to the VIP Distributor Map (an Architect
  surface) and re-run; do not special-case them here.

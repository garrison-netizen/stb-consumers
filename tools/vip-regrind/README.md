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

## generate-merge-candidates.mjs — duplicate-account candidates (Architect ruling 2026-07-30)

**Generates. Never merges.** Writes nothing to Notion. It emits a candidate list; the
Architect adjudicates; a separate executor applies only the ruled set, the way
`merge-goody-goody.mjs` did.

Goody Goody had a genuine invariant (the store number), so auto-merge was safe there. This
class has none — street number transposes (`350` → `305 N GUADALUPE`), city flips
(`1761 S Hwy 46` reads SEGUIN and NEW BRAUNFELS), name re-spells. Merging two real stores is
the unrecoverable direction, and *a rule with two known holes gets trusted as though it has
none.*

### The four ruled criteria (deliberately loose)

chain-name family · **AND** ≥1 significant street-name token · **AND** city or an adjacent
city · **AND** distributor differs.

- **Family** comes from VIP's `Chain` field where the row is a chain account — it is stable
  across every spelling (all 15 Skip's identities read `SKIPS BEER WINE AND LIQUOR`).
  `INDEPENDENTS` is a catch-all bucket, not a chain, so those fall back to a two-token name
  prefix.
- **Significant street token** drops the LEADING numeric (the street number — it transposes)
  and all suffix/directional tokens, but KEEPS a non-leading numeric: `46` is the only thing
  tying `1761 S ST HWY 46` to `1761 S STATE HWY 46` once `ST`/`HWY` are gone.
- **Adjacency** uses a metro table that is incomplete by construction, so a pair failing
  *only* the city test is reported under NEAR MISSES rather than dropped.
- **Distributor differs** is applied per cluster. A single-distributor cluster is reported
  separately, not discarded — Cibolo proves one distributor can enter one store twice via
  two branches.

### ⛔ No handover assumption

An earlier framing claimed "Dynamo handed Central TX to Green Light in 2024." That is FALSE
and was retracted 2026-07-30 (Dynamo was flat across 2024: 7,200.6 → 7,020.9). The real shape
is **concurrent** — a second distributor booking occasional out-of-territory sales into a
store its true distributor still serves. So the generator must NOT look for "A ends, B
begins": same-year co-occurrence is normal here, and year adjacency is a confirming signal
that SORTS, never a filter that removes.

### Store-code guard (precision, added by Code)

The first run chained four different HEB stores (#110/#474/#553/#627) into one candidate
because they all sit on `HWY 6`, burying the one real pair (#760). Where a chain carries a
store code in the name, a **differing** code proves a different store. Used only to BLOCK an
edge, never to create one — it can only split a cluster, never cause a bad merge. Narrow by
design (3–4 digits only) so Skip's `#1` and VIP's `_2` row suffix never block.

### Output

`output/merge-candidates.md` (adjudication) and `output/merge-candidates.json` (executor).
Sections: **A** all four criteria met · **B** same-distributor clusters · **C** near misses
(city test only) · **D** same address / different store code — not candidates, but likely a
mis-addressed row.

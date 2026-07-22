# STB VIP Mart C Weekly Pipeline

Weekly VIP depletion refresh per **ADR-015: VIP Mart C weekly pipeline**
(adopted 2026-07-22, Brain page `3a51c57a-c02b-81f2-bac3-d4caafc1888a`).
Garrison drops the VIP **13-week trailing weekly Distributor x Brand
Matrix** CSV export in the **"Weekly Depletion" subfolder** of the
Weekly Distribution Pulse Drive folder; Mart C comes current
automatically. Pipeline-owned surface: the loader is the only writer.

**ZERO shared runtime with the ADR-013 monthly pipeline**
(`pipelines/vip-marts`): separate GAS project, separate Script
Properties, separate Drive subfolder. Do not merge them.

## Why a subfolder (load-bearing, not tidiness)

The weekly export and the monthly YTD matrix export share the same
filename pattern (`Distributor x Brand Matrix (N).csv`), and the
monthly pipeline watches the parent folder. A weekly file dropped
there would trip the monthly pipeline's pair-mismatch alarm every
week. DriveApp folder listings are non-recursive, so the subfolder
makes the two pipelines mutually invisible. The pipeline creates the
subfolder on first run if it doesn't exist.

## Mart shape (ADR-015)

Grain: **canonical brand × distributor(parent) × segment × week**,
LONG (Week is a date field), **ACCUMULATING** — seeds at 13 weeks,
+1 net-new week per weekly pull. Overlapping weeks across consecutive
pulls dedup on `Cell` (the natural-key title
`brand | parent | segment | yyyy-mm-dd`), last-write-wins — VIP's
late restatements self-correct. **History weeks (before the current
pull's window) are never read, written, or archived by a normal run.**

Package sizes and distributor branches roll up by summation; `Branch`
keeps the distinct branch names as text. `Segment` comes from the raw
`OnOff Premises` column (OFF/ON/NA → Off-/On-Premise/Unknown — the
corrected Mart A rule, not package-derived). Brands conform via the
**VIP Brand Map** (fail-loud on unmapped, unlike Mart A which passes
raw brands through — per the ADR-015 spec), distributors via the
**VIP Distributor Map** (fail-loud, same as the monthly pipeline).
No YoY columns at weekly grain (13-week pull can't support them).

## Safety model

1. **Snapshot before every write, every run** — all of Mart C is
   frozen to `Weekly Depletion/Mart C Snapshots/mart-c-snapshot-
   <runId>.csv` first. Weeks older than the trailing 13 roll off
   VIP's export, so accumulated history is unrebuildable from source
   — same stakes as Mart B. (Empty-mart snapshot is legal exactly
   once: the seed run.)
2. **Reconcile gates before any write** — aggregated total CE must
   equal the raw weekly total exactly, AND the raw weekly total must
   match VIP's own 13-week rollup column (the export's built-in
   checksum). Optional `VIPW_EXPECTED_CE` seed-run oracle on top.
3. **Shape gate** — exactly 13 contiguous one-week column groups with
   all five metrics plus a matching 13-week rollup, else abort (a YTD
   export dropped in the wrong folder fails here loudly).
4. **Window discipline** — only rows whose `Week` falls inside the
   pull's 13-week window are upserted; in-window strays (restated-
   away cells) are archived; history rows are untouchable.
5. **Fail loud** — unmapped distributor/brand tokens, shape breaks,
   checksum mismatch: abort + email, nothing written.
6. **DRY_RUN defaults ON** (Shared.gs contract); every run emails a
   summary with per-week CE totals.

## File layout

```
src/
  Config.gs     — IDs, folder names, thresholds (no year config —
                  Week dates cross year boundaries natively)
  Shared.gs     — canonical Notion write layer (copy-per-pipeline)
  Notion.gs     — query-all pagination, retrying writes (VIPW_)
  Data.gs       — Drive discovery, CSV parse, weekly-window parsing,
                  distributor + brand maps (fail-loud)
  Transform.gs  — wide→long aggregation to Mart C cells (pure,
                  tested in the Node harness)
  Pipeline.gs   — phased orchestration (SNAPSHOT → MART_C → REPORT),
                  6-min-ceiling continuations
```

## Script Properties

| Property | Value |
|---|---|
| `NOTION_API_KEY` | Same integration token as the other pipelines |
| `VIPW_EXPECTED_CE` | Optional seed-run acceptance gate; cleared automatically after the first successful live run |
| `VIPW_EMAIL_TO` | Optional; defaults to garrison@spindletap.com |
| `DRY_RUN` | Leave blank (ON); set `0` for live writes |

No year property and no January rollover: `Week` is a full date, so a
late-December pull carrying early-January week-ending dates loads
like any other week (ADR-015 year-boundary note).

## First run = 13-week seed

1. The weekly export lands in `Weekly Distribution Pulse/Weekly
   Depletion/`.
2. Paste `NOTION_API_KEY` in Project Settings → Script Properties;
   optionally set `VIPW_EXPECTED_CE` to the hand-computed raw total.
3. Run `vipwVerifySetup()` (DRY-RUN default) — logs computed totals
   per week with writes structurally impossible.
4. Set `DRY_RUN=0`, run `vipwRunNow()` — seed load (~13 weeks of
   cells). Verify the emailed per-week CE totals against the raw file.
5. A successful live run installs the daily 6am CT check itself and
   clears the oracle. Thereafter: drop a fresh weekly export in the
   subfolder, everything else is automatic.

## Weekly routine (Garrison)

Pull the VIP **Distributor x Brand Matrix** weekly report (13-week
trailing, with the OnOff Premises column) and drop the CSV in the
**Weekly Depletion** subfolder. That's it. The newest week in any
pull is usually partial; next week's overlapping pull restates it
automatically.

## Known gotchas

- **Weekly export only.** A YTD pull dropped here aborts on the shape
  gate (and vice versa: keep weekly files OUT of the parent folder or
  the monthly pipeline will send mismatch alarms).
- **New distributor token or brand in VIP** → run aborts naming the
  token; add it to the VIP Distributor Map / Brand Map (Architect
  surfaces), re-run.
- **6-minute ceiling**: phases checkpoint and self-continue via a
  1-min trigger; skip-unchanged writes make re-entry idempotent. Up
  to 8 execution attempts per run, then a loud failure email.

## Testing

`node test/test_transform.js` — Node harness with GAS shims running
against the real 2026-07-22 weekly export fixture (shape gates,
contiguity, unmapped-token/brand gates, reconcile + checksum against
VIP's own rollup, cell semantics, skip-unchanged round trip,
deterministic recompute). Run it after any transform change.

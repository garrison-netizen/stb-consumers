# STB VIP Marts Pipeline

Monthly VIP depletion refresh per **ADR-010: VIP Marts Load Pipeline**
(adopted 2026-07-16, Brain page `3a41c57a-c02b-8193-846b-e4bb905b711a`).
Garrison drops two VIP CSV exports in the "Weekly Distribution Pulse"
Drive folder; the marts come current automatically. No manual Notion
export, no hand-edits, ever (pipeline-owned surfaces).

| Mart | Strategy | Why |
|---|---|---|
| Mart A — Depletion Trend | **Recompute-and-replace** (upsert by `Cell`, archive strays) | The YTD dump fully specifies the current year; stateless + self-healing |
| Mart B — Account Trajectory | **Overlay-and-preserve** (update by account identity) | 2021–2025 history exists ONLY in Mart B; history columns are never written |

The Trend Board is live Notion linked-views over the marts
(Architect-side setup) — this pipeline never writes it.

## Safety model

1. **Snapshot before every write, every run** — Mart B is frozen to
   `Mart B Snapshots/mart-b-snapshot-<runId>.csv` in the Drive folder
   before any Notion write (not just at bootstrap: history is
   unrebuildable, so every run gets insurance).
2. **Reconcile gate** — Mart A's aggregated total CE must equal the raw
   dump total *before* anything is written; optionally also matched
   against `VIP_EXPECTED_CE` (the acceptance oracle). Never
   delete-then-discover.
3. **YTD gate** — export rollup windows are parsed from the headers; a
   trailing-window pull (e.g. "13 Weeks 3/1 thru 5/30") aborts loudly.
   Both exports must cover the *same* current-year window.
4. **Fail loud** — unmapped distributor tokens, year mismatches,
   duplicate identity keys: abort + email, nothing written.
5. **DRY_RUN defaults ON** (Shared.gs contract) and every run emails a
   summary with the bucket counts.

## File layout

```
src/
  Config.gs     — IDs, year-parameterized column names, thresholds
  Shared.gs     — canonical Notion write layer (copy-per-pipeline)
  Notion.gs     — query-all pagination, retrying writes, extraction
  Data.gs       — Drive discovery, CSV parse, rollup-window parsing,
                  distributor map (fail-loud token mapping)
  Transform.gs  — Mart A aggregation; Mart B overlay + trajectory
                  classification (pure, tested in Node harness)
  Pipeline.gs   — phased orchestration (SNAPSHOT → MART_A → MART_B →
                  REPORT), 6-min-ceiling continuations, rollover
```

## Script Properties

| Property | Value |
|---|---|
| `NOTION_API_KEY` | Same integration token as the other pipelines |
| `VIP_CURRENT_YEAR` | `2026` (bumped by `vipRollover()`) |
| `VIP_EXPECTED_CE` | Optional acceptance gate, e.g. `7243.1` for the first run; clear after |
| `VIP_EMAIL_TO` | Optional; defaults to garrison@spindletap.com |
| `DRY_RUN` | Leave blank (ON); set `0` for live writes |

## First run = ADR-010 acceptance test

Per the Architect's supplement (2026-07-21), this cycle's Mart B update
IS the acceptance test. Expected (hand-verified):

- Mart A total CE **7,243.1** (Jan–Jun 2026), exact to raw
- Mart B buckets across 1,333 accounts: **New 273, Growing 165,
  Steady 70, Declining 279, Lapsed 541** (2026 + earlier combined),
  **Never material 5**
- H1 2026 total 7,243.1 vs 2025 same-period 9,776.1 (−25.9%)

Sequence:

1. Fresh **YTD** exports (Distributor x Brand Matrix + Full Account
   Detail) land in the Drive folder. Trailing-window pulls are rejected.
2. Set Script Properties; leave `DRY_RUN` blank; set
   `VIP_EXPECTED_CE=7243.1`.
3. Run `vipDryRunReport()` — logs computed totals + buckets with writes
   structurally impossible. Compare against the oracle.
4. Run `vipRunNow()` (still DRY-RUN) — full phase walk, snapshot lands
   in Drive, `[DRY-RUN]` write lines in the log, summary email sent.
5. Set `DRY_RUN=0`, run `vipRunNow()` live. Verify buckets in the email
   match the oracle; spot-check a few accounts row-by-row (frozen
   reference file from Architect if requested).
6. Run `vipSetupTrigger()` — daily 6am CT check that fires only when a
   *new* export pair lands. Clear `VIP_EXPECTED_CE` (next month's total
   will differ).

## Year rollover (January)

Run `vipRollover()` deliberately (DRY-RUN first). It snapshots Mart B,
promotes `CE {Y} YTD` → locked `CE {Y}`, retitles the same-period
column, creates `CE {Y+1} YTD`, bumps `VIP_CURRENT_YEAR`, and emails
what it did. Until it runs, a new-year export aborts with a rollover
message — the pipeline cannot silently mix years. The schema-PATCH
payload is `>>VALIDATE<<` against the live API on its first DRY-RUN.
Mart A needs no rollover.

Avoid pulling the January refresh during the first week of the year:
a 1-week YTD rollup can't be distinguished from the weekly detail
columns and the run will abort asking for a later pull.

## Known gotchas

- **Exports must be YTD pulls.** The 2026-06-03 files in the folder are
  13-week trailing windows — the pipeline (correctly) rejects that shape.
- **Both exports from the same pull.** Window mismatch or >7 days apart
  between file timestamps → abort/wait.
- **New distributor token in VIP** → run aborts naming the token; add it
  to the VIP Distributor Map (Architect surface), re-run.
- **Mart B identity** is normalized `Account name | Address`. Genuinely
  new accounts get a minted `account_uid` (md5-based, `acct_XXXXXXXX`);
  existing uids are never changed.
- **6-minute ceiling**: phases checkpoint and self-continue via a 1-min
  trigger; skip-unchanged writes make re-entry idempotent. Up to 8
  execution attempts per run, then a loud failure email.

## Testing

`node test/test_transform.js` — Node harness with GAS shims running
against the real 2026-06-03 export fixtures (26 checks: gates fire,
aggregation reconciles to raw, history-column write-protection,
classification, idempotent re-run). Run it after any transform change.

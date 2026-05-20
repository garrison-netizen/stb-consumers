# STB Clover Pipeline

Pulls Clover POS data into three STB Brain databases:

| Notion DB | Grain | Natural key |
|---|---|---|
| Taproom Daily | One row per day | Date (YYYY-MM-DD) |
| Taproom Sales by SKU by Week | One row per SKU per week | `{SKU name} — {week start ISO}` |
| Taproom Labor Daily | One row per day | Date (YYYY-MM-DD) |

Pipeline does **not** write to Taproom Margin Monthly — that database joins
Clover revenue with Ekos COGS and is built separately once Ekos API access
is confirmed.

## File layout

```
src/
  Config.gs     — Notion data source IDs + exact property names
  Shared.gs     — copy of shared/notion.gs (copy-per-pipeline pattern)
  Clover.gs     — Clover API fetch layer (paginated)
  Transform.gs  — pure aggregation: orders/shifts → Notion payloads
  Pipeline.gs   — entry points: cloverSync(), cloverBackfill()
  appsscript.json
```

## Setup: new Apps Script project

Any Google account works — use STB Google Workspace or personal Gmail.
The API keys are in Script Properties, not tied to the account.

1. Go to **script.google.com** → New project
2. Delete the default `myFunction` stub
3. For each `.gs` file, create a matching file in the editor and paste the contents:
   - `Config.gs`
   - `Shared.gs`
   - `Clover.gs`
   - `Transform.gs`
   - `Pipeline.gs`
4. Rename `appsscript.json`: click Project Settings → check "Show appsscript.json"
   then paste the contents of `src/appsscript.json`

## Script Properties

Project Settings → Script Properties → Add:

| Property | Value |
|---|---|
| `CLOVER_API_TOKEN` | Production API key from Clover dashboard |
| `CLOVER_MERCHANT_ID` | Your merchant ID (from Clover dashboard URL: `/merchants/XXXXXX`) |
| `NOTION_API_KEY` | Same Notion integration token used by other pipelines |
| `DRY_RUN` | Leave blank (defaults ON); set to `0` when ready for live writes |

## Finding your Merchant ID

Log into your Clover dashboard at **clover.com/dashboard**. The merchant ID
is in the URL: `clover.com/home/merchants/**XXXXXXXXXXXXXXXXX**/...`
Copy that string — it goes in `CLOVER_MERCHANT_ID`.

## First run sequence

1. Set Script Properties (all four above; leave `DRY_RUN` blank).
2. Run `cloverSync()` — logs show orders/shifts fetched and
   `[DRY-RUN] create ...` lines for each row that *would* be written.
3. Confirm output looks right: dates, dollar amounts, categories, SKU names.
4. Set `DRY_RUN=0` and run `cloverBackfill()` to load full Clover-era history.
5. Set up a time-driven trigger: `cloverSync` daily at ~6am CT.

## Backfill scope

Clover era begins ~2025-05-01 (Marin hire + POS switch). `cloverBackfill()`
defaults to `2025-05-01 → today`. Override with Script Properties:
- `BACKFILL_START` — e.g. `2025-05-01`
- `BACKFILL_END`   — e.g. `2025-12-31` (useful for chunked runs)

If the backfill hits the Apps Script 6-minute ceiling, run it in monthly
chunks — idempotent re-runs are safe (existing rows are skipped).

## Known gotchas

- **Category mapping** — `CLV_mapCategory_()` in `Clover.gs` maps Clover
  category names to Notion select values. If a Clover category doesn't match,
  it falls through to "Other". Check the dry-run logs for unexpected "Other"
  values and add a branch in `CLV_mapCategory_()` if needed.
- **Labor cost** — Clover stores wage in cents/hour. If shifts show $0 labor
  cost, the wage field is empty in Clover (data gap, not a bug). The
  `Data quality` flag on each row will show "Clean" or "Partial" accordingly.
- **date.equals datetime mismatch** — Clover returns timestamps in ms.
  All dates are normalized to YYYY-MM-DD on both filter and create sides
  (same fix as Mailchimp — documented in `Transform.gs`).

## Not yet built

- **Taproom Margin Monthly** — deferred until Ekos API capability confirmed.
  Once confirmed, this pipeline adds a fourth write target joining Clover
  daily revenue (already in Notion) with Ekos COGS.
- **SKU Mapping table** — manually maintained by Garrison. Pipeline writes
  `Clover SKU name` on each SKU-week row to support the join when ready.

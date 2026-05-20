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
  Clover.gs     — Clover API fetch layer (paginated, sandbox-first)
  Transform.gs  — pure aggregation: orders/shifts → Notion payloads
  Pipeline.gs   — entry points: cloverSync(), cloverBackfill()
  appsscript.json
```

## Sandbox setup (do this first)

1. Go to **sandbox.dev.clover.com** and create a free developer account.
2. Create a test merchant. Give it a few test categories (Beer, THC, Coffee,
   Food, Merch) and a handful of test items in each.
3. Create some test orders via the sandbox POS simulator.
4. From your sandbox merchant dashboard, copy:
   - **Merchant ID** (shown in the URL: `/merchants/{mId}`)
   - **API token** (Developer Dashboard → API Access)

## Script Properties

Set these in the Apps Script project → Project Settings → Script Properties:

| Property | Value |
|---|---|
| `CLOVER_API_TOKEN` | Sandbox API token |
| `CLOVER_MERCHANT_ID` | Sandbox merchant ID |
| `NOTION_API_KEY` | Same Notion integration token used by other pipelines |
| `DRY_RUN` | Leave blank (defaults ON); set to `0` when ready for live writes |

## Deploying with clasp

```bash
cp .clasp.json.example .clasp.json
# Edit .clasp.json: paste your Apps Script project script ID
clasp push
```

Create the Apps Script project at script.google.com if you don't have one.

## First run sequence

1. Set Script Properties (sandbox credentials, `DRY_RUN` unset).
2. Run `cloverSync()` — logs should show orders/shifts fetched and
   `[DRY-RUN] create...` lines for each row that would be written.
3. Confirm the output looks right (dates, amounts, categories, SKU names).
4. Set `DRY_RUN=0` and run `cloverBackfill()` for full Clover-era history.
5. Set up a time-driven trigger: `cloverSync` daily at ~6am CT.

## Production switch

Change `CLOVER.API_BASE` in `Config.gs` from
`https://sandbox.dev.clover.com` to `https://api.clover.com`.
Update `CLOVER_API_TOKEN` and `CLOVER_MERCHANT_ID` to production values.

## Known gotchas

- **date.equals datetime mismatch** — Clover returns timestamps in ms.
  All dates are normalized to YYYY-MM-DD before filter and create
  (same fix as Mailchimp, per the durable learning in Transform.gs).
- **Category mapping** — `CLV_mapCategory_()` in Clover.gs maps Clover
  category names to Notion select values. If a new category is added in
  Clover, it falls through to "Other" — check `CLV_mapCategory_()` and
  add a branch.
- **Labor cost** — Clover wage is stored in cents/hour. The shift cost
  calc in Transform.gs uses `wage.wage`. Verify the sandbox wage field
  is populated; if it's 0, labor cost rows will write $0 (correct behavior
  — it means the data is missing, not a bug).
- **Apps Script 6-min ceiling** — the backfill may hit the ceiling on a
  large date range. Set `BACKFILL_START` and `BACKFILL_END` Script
  Properties to run in monthly chunks if needed (idempotent re-runs are safe).

## Not yet built

- **Taproom Margin Monthly** — deferred until Ekos API capability is confirmed.
  Once confirmed, this pipeline adds a fourth write target joining Clover
  daily revenue (already in Notion) with Ekos COGS.
- **SKU Mapping table** — manually maintained by Garrison; pipeline writes
  a `Clover SKU name` text field on each SKU-week row to support the join.

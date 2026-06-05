# Sales Pulse — Setup

## 1. Create the Apps Script project

1. Go to script.google.com → New project → name it "STB Sales Pulse"
2. Create 7 script files (`.gs`) and paste each file from `src/`:
   - `Shared.gs`
   - `Config.gs`
   - `Brain.gs`
   - `Data.gs`
   - `Claude.gs`
   - `Render.gs`
   - `Pipeline.gs`
3. Enable the **Drive API** service:
   - Services → + → Drive API → Add

## 2. Set Script Properties

Project Settings → Script Properties → Add the following:

| Property | Value |
|---|---|
| `NOTION_API_KEY` | your Notion integration token (same one used in all other pipelines) |
| `ANTHROPIC_API_KEY` | your Anthropic API key |
| `SALES_PULSE_EMAIL_TO` | garrison@spindletap.com (or wherever you want it) |
| `DRY_RUN` | `1` (change to `0` when ready to go live) |

## 3. Test in stages

Run these functions in order from the Apps Script editor:

```
testBrainContextOnly()   → verifies Notion connection + Section 4 pull
testDataLoadOnly()       → verifies Drive file read
testSalesPulseDryRun()   → full flow without calling Claude or sending email
salesPulse()             → live run (only after DRY_RUN=0)
```

## 5. Schedule it

Run `setupSalesPulseTrigger()` once. It sets a weekly Monday 7am CT trigger.

## 6. When the real API arrives

Replace `Data.gs` with an API caller that returns the same tab-separated table
format. The rest of the pipeline (Brain.gs, Claude.gs, Render.gs, Pipeline.gs)
is unaffected.

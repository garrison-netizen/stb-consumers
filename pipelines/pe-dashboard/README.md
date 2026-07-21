# PE Dashboard pipeline

Renders a daily **Private Events dashboard** as a Notion page. Read-only against
the three Private Events databases the Triple Seat pipeline maintains (Triple
Seat Leads, Bookings, Lead Sources); its only write target is one Notion page it
owns outright and rewrites top to bottom every morning.

## What the dashboard shows

1. **KPI strip** — YTD event revenue + event count, % vs same point last year,
   next-30-days booked revenue, open lead count.
2. **Needs attention** — past events with unpaid balances (with outstanding
   total), upcoming events missing deposits, pending leads older than 14 days.
3. **Upcoming events** — next 45 days: date, headcount, revenue, deposit/balance
   status, rep.
4. **Event revenue by month** — current year vs last year, bar sales split out.
5. **Lead funnel** — trailing 90 days: conversion rate, status mix, top sources.

Revenue convention matches the Q2 2026 close method: actual revenue when
recorded, else quoted; cancelled bookings excluded; bar sales shown separately.

## Safety model (mechanical)

- Target page id lives in the Script Property `PE_DASHBOARD_PAGE_ID` — nothing
  hardcoded, fails loudly if unset.
- The first block the pipeline writes is a ⚙️ marker callout. On refresh, a
  non-empty page whose first block is not that marker **aborts before deleting
  anything** — a wrong page id can never wipe someone else's page.
- `DRY_RUN` defaults ON (writes are opt-in with `DRY_RUN=0`), same as every
  other pipeline.

## One-time setup

1. Create an empty Notion page wherever the dashboard should live (e.g. under
   the STB Departmental Dashboard), share it with the same Notion integration
   the other pipelines use.
2. `clasp create` + `clasp push` from `src/` (restore `appsscript.json`
   timezone to `America/Chicago` if clasp resets it).
3. Script Properties: `NOTION_API_KEY`, `PE_DASHBOARD_PAGE_ID` (the new page's
   id), `DRY_RUN=1`.
4. Run `testPeDashboardDryRun()` — check the logged KPI summary looks sane.
5. Set `DRY_RUN=0`, run `peDashboardRefresh()` once, eyeball the page.
6. Run `peDashboardInstallDailyTrigger()` — daily ~7am CT, an hour after the
   Triple Seat 6am sync lands fresh data.

## Files

| File | Role |
|---|---|
| `Config.gs` | Source DS ids + property names (copied from tripleseat config), dashboard shape, target-page property |
| `Shared.gs` | Byte-identical copy of `shared/notion.gs` |
| `Data.gs` | Paginated full reads → normalized lead/booking objects |
| `Metrics.gs` | Pure computation — KPIs, monthly, upcoming, attention, funnel |
| `Render.gs` | Blocks builders + marker-guarded page rewrite (block API on 2022-06-28) |
| `Pipeline.gs` | Orchestrator, trigger install, config check, dry-run test |

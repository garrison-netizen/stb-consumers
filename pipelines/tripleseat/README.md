# Triple Seat pipeline (Private Events)

Daily pull + full backfill of Triple Seat **leads** and **bookings** into the
Brain's Private Events databases. Phase 2 of the Private Events workstream.

## What it writes

| Source (Triple Seat) | Brain database | Natural key | Write policy |
|---|---|---|---|
| Leads | **Triple Seat Leads** | `Lead ID (Triple Seat)` | upsert TS-owned fields |
| Bookings | **Bookings** | `Booking ID (Triple Seat)` | upsert TS-owned fields |
| (derived) | **Lead Sources** | `Source name` | find-or-create (name only) |

**Field ownership.** The pipeline writes only Triple-Seat-owned facts (ids,
status, dates, revenue, headcount) and PATCHes them to match Triple Seat on
every run (events mutate: leads convert, bookings gain actual revenue after the
event). It never writes the manual **Notes** fields, and never writes the
calculator-owned **Winning configuration** relation. Out of scope for this
pipeline: Event Configurations (pricing-calculator integration), Party Pay
payments/payouts, and the seeded reference tables (Pricing Schema, Add-On
Catalog, Configuration Add-Ons).

## Runtime

Google Apps Script, copy-per-pipeline shared layer (`Shared.gs` byte-identical
to `shared/notion.gs`). Auth to Triple Seat is OAuth 2.0 `client_credentials`
(token exchange per run, 2-hour token). Notion writes via the proven
`UrlFetchApp` layer (`Notion-Version 2025-09-03`).

## Files

- `Config.gs` — API endpoints, Notion data-source ids, exact property names, secret getters.
- `Shared.gs` — canonical Notion write layer (do not edit here; edit the master and propagate).
- `TripleSeat.gs` — OAuth token, pagination, and `tripleSeatProbe()` (read-only shape dump).
- `Transform.gs` — pure record→Notion-props mapping (field paths marked `>>VALIDATE<<`).
- `Pipeline.gs` — entry points + upsert orchestration + relation wiring.

## Script Properties

| Key | Value |
|---|---|
| `TS_CLIENT_ID` | Triple Seat OAuth 2.0 app Client ID (UID) — Settings → API & Webhooks |
| `TS_CLIENT_SECRET` | Triple Seat OAuth 2.0 app Client Secret |
| `NOTION_API_KEY` | same Notion integration token as the other pipelines |
| `DRY_RUN` | `1` (default ON). Set to `0` only after probe + dry-run validation. |

> The Notion integration behind `NOTION_API_KEY` must be shared on the Private
> Events databases (Leads, Bookings, Lead Sources) or writes 404. Confirm in
> Notion → each DB → ••• → Connections.

## Bring-up sequence

1. `clasp create --type standalone --title "STB Triple Seat Pipeline"` in `src/`, then `clasp push`.
2. Set Script Properties (above); leave `DRY_RUN=1`.
3. Run **`tripleSeatProbe()`** (read-only). Inspect the logged lead/booking shapes
   and confirm/correct every `>>VALIDATE<<` field path in `Transform.gs` + the
   endpoint/envelope keys in `TripleSeat.gs`.
4. Run **`tripleSeatSync()`** under `DRY_RUN=1`. Eyeball the `[DRY-RUN]` payloads.
5. Set `DRY_RUN=0`, run `tripleSeatSync()` once (this is the full historical
   backfill — every record upserted).
6. Add a daily time-driven trigger on `tripleSeatSync`.

# mailchimp — Campaign Log pipeline (Phase 2)

Self-contained Apps Script project. Pulls sent Mailchimp campaigns +
report metrics + body, writes the Notion "Mailchimp Campaign Log".

## Files

| File | Role |
|---|---|
| `Shared.gs` | byte-identical copy of `shared/notion.gs` (do not edit here — see `shared/README.md`) |
| `Config.gs` | live IDs + Campaign Log schema (Architect-confirmed 2026-05-19) |
| `Mailchimp.gs` | Marketing API v3.0 client (UrlFetchApp) |
| `Transform.gs` | pure Mailchimp → Notion property mapping |
| `Pipeline.gs` | orchestration, trigger, dry-run test |

## Behavior

- **New campaign** (not in Campaign Log) → create a full row, `Phase` =
  "Phase 2 — API pipeline".
- **Existing row** (incl. Phase-1 manual) → **backfill only**: fills empty
  metric / body / segment cells. Never touches `Phase`, `Focus area`,
  `Notes`, or identity fields. Re-runs are no-ops (idempotent).
- Pipeline never sets `Focus area`, `Notes`, `Source file` (editorial), and
  never writes `Date logged` (Notion `created_time`, not writable).

## Idempotency key

Natural key = **Send date + Subject line** (Architect directive — human-
recognizable, Send-date-indexed for diffs). It is not guaranteed unique
(A/B tests, same-day resends). That risk is handled, not ignored:
`STB_notionFindOne_` **fails loudly** on >1 match instead of overwriting.
Open question for the Architect: accept loud-fail, or add a non-human
"Mailchimp Campaign ID" property as the true key (canonical-schema call).

## Script Properties (set in the GAS project)

| Key | Value |
|---|---|
| `NOTION_API_KEY` | Notion integration token (same name as Weekly Pulse v6.3) |
| `MAILCHIMP_API_KEY` | Mailchimp key (suffix `-usXX` = datacenter) |
| `MAILCHIMP_SERVER_PREFIX` | optional; only if not derivable from the key |
| `DRY_RUN` | defaults ON; set to `0` to enable real writes |

## First-run validation (before `DRY_RUN=0`)

The write path is **not proven by Weekly Pulse v6.3** (which is read-only).
Run `testMailchimpDryRun()` and confirm against the live Notion API:

1. The create payload `parent: { type: "data_source_id", data_source_id }`
   is correct under `Notion-Version: 2025-09-03` (`>>VALIDATE<<` in `Shared.gs`).
2. `date.equals` with a time component matches as intended
   (`>>VALIDATE<<` in `Transform.gs`); if Notion compares date-only,
   same-day collisions surface as loud failures (acceptable, by design).

Only after both check out: set `DRY_RUN=0`, then `setupMailchimpTrigger()`.

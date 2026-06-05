# weekly-pulse — reference pattern (FILLED)

`src/Code.js` is the verbatim, proven, shipped Weekly Executive Pulse —
**v6.3** (not v6.2; the live code is v6.3, header documents changes from v6.1).
Preserved as-is; this is the proven artifact. Do not refactor it in place
before it is committed verbatim.

## What this is

A **read** consumer: it reads Brain pages + databases, calls the Claude API,
and emails an HTML report + Google Doc. It does **not** write to Notion. So the
reusable value for the write pipelines (Clover / Triple Seat / Mailchimp) is
NOT a write layer — it is:

- the **proven Notion access pattern** (`UrlFetchApp`, `Bearer` auth,
  `Notion-Version: 2025-09-03` for data-source queries / `2022-06-28` for
  block children);
- the **data-source query** shape (`POST /v1/data_sources/{data_source_id}/query`)
  — note: it needs the **data_source_id**, NOT the database page id (the
  script's own maintenance notes flag confusing the two as a footgun);
- `renderPropertyValue` — a complete Notion-property → text mapper covering
  every property type (directly reusable for transforms);
- the property-whitelist discipline and its documented failure mode
  (silently-skipped unknown property names = invisible content gaps);
- secrets via `PropertiesService` Script Properties; scheduling via a
  time-driven trigger.

## Runtime-model finding (important)

This proven script runs in **Google Apps Script**, not Node. The initial
scaffold's `lib/` used the Node `@notionhq/client` SDK — that is the wrong
runtime model for the production target and does not transfer cleanly (GAS has
no npm / ES-module imports at runtime). The shared Notion layer should mirror
THIS script's `UrlFetchApp` + pinned `Notion-Version` pattern, and the
"shared lib" must be bundled/inlined per pipeline, not consumed as an npm
dependency. This is being reconciled before the Mailchimp build — see the
pending task and `project_consumer-runtime-model` memory.

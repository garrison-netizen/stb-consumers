# stb-consumers

Version-controlled home for the STB Brain **consumer pipelines**. The artifact
layer beside the Claude.ai Project agents — not inside them.

## Boundary (do not violate)

- Live canonical Notion mutation belongs to the Architect / Advisor agents.
  This repo holds durable artifacts (pipeline code, the shared write layer,
  version history), not canonical state.
- The Brain mirror is **not built here** — it is gated behind the
  freshness-contract ADR (separate workstream).

## Runtime model

Pipelines deploy as **Google Apps Script** projects (time-driven triggers,
`UrlFetchApp`, secrets in `PropertiesService`). Not Node. Established from the
proven, shipped Weekly Pulse **v6.3**. There is no npm / ES-module imports at
runtime, so shared code is **copied per pipeline**, not bundled (Architect
decision, 2026-05-19).

## Structure

```
shared/                  canonical shared source (master) + propagation rules
  notion.gs              UrlFetchApp Notion write layer (Notion-Version 2025-09-03)
pipelines/
  weekly-pulse/src/      proven v6.3 reference (READ consumer; do not refactor in place)
  mailchimp/src/         Phase-2 Campaign Log pipeline (WRITE consumer)
```

## Shared code

`shared/notion.gs` is the master. Each pipeline carries a byte-identical
`Shared.gs` copy. When the master changes, follow the propagation checklist
in `shared/README.md`. Revisit the copy model only past ~500 shared lines.

## Secrets

Never committed. Set per GAS project in Script Properties
(`NOTION_API_KEY`, `MAILCHIMP_API_KEY`, …). `.clasp.json` / `.clasprc.json`
are gitignored.

## Safety

Every pipeline's `DRY_RUN` Script Property defaults ON — writes are opt-in
and only enabled after the per-pipeline first-run validation passes (the
write path is new; v6.3 proved only the read path).

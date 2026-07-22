// ============================================================
// VIP Mart C weekly pipeline — configuration.
// Design of record: ADR-015 "VIP Mart C weekly pipeline" (adopted
// 2026-07-22, page 3a51c57a-c02b-81f2-bac3-d4caafc1888a).
// Data source IDs verified against live Brain 2026-07-22.
//
// ZERO shared runtime with the ADR-013 monthly pipeline
// (pipelines/vip-marts): separate GAS project, separate Script
// Properties, separate Drive subfolder. Shared.gs is the canonical
// copy-per-pipeline write layer; everything else is VIPW_-prefixed.
// ============================================================

var VIPW = {
  // Parent Drive folder ("Weekly Distribution Pulse", shared with
  // sales-pulse and the monthly VIP pipeline).
  PARENT_FOLDER_ID: "18SyL5m1-qybOTqoAZJKc9VEix76UzFQz",

  // The weekly export lands in a dedicated SUBFOLDER. This is load-
  // bearing, not tidiness: the weekly matrix export has the same
  // filename pattern as the monthly YTD matrix export, and the
  // monthly pipeline watches the parent folder — a weekly file
  // dropped there would trip its pair-mismatch alarm every week.
  // DriveApp folder listings are non-recursive, so a subfolder makes
  // the two pipelines mutually invisible.
  WEEKLY_FOLDER_NAME: "Weekly Depletion",

  // Subfolder (of the weekly subfolder, created on demand) for
  // pre-write Mart C snapshots.
  SNAPSHOT_FOLDER_NAME: "Mart C Snapshots",

  // File recognition — newest file matching the pattern wins.
  MATRIX_FILE_RE: /distributor.*brand.*matrix/i,

  // Notion data sources.
  DIST_MAP_DS:  "7d4ed233-26c5-4922-974e-89756fee78ad",  // VIP Distributor Map (shared surface)
  BRAND_MAP_DS: "08952148-8a86-4efc-a076-1749e5a2ea21",  // VIP Brand Map (shared surface)
  MART_C_DS:    "b29c4709-a96d-4d11-a64d-082569a2799b",  // VIP Mart C - Weekly Depletion

  // The VIP weekly report is a 13-week trailing pull; a header with a
  // different number of one-week groups is not the report this
  // pipeline loads (e.g. a YTD export has ~N-weeks-of-year of them).
  WEEKS_EXPECTED: 13,

  // Numeric comparison epsilon for skip-unchanged.
  EPSILON: 0.005,

  // Reconcile tolerance (absolute CE) for both gates: computed-vs-raw
  // drifts by per-cell 4-decimal rounding; raw-vs-rollup by VIP's own
  // rounding across 220+ rows. Same 0.05 the monthly pipeline uses.
  RECONCILE_TOL: 0.05,

  EMAIL_TO_DEFAULT: "garrison@spindletap.com",

  // Script Property keys (VIPW_ names — cannot collide with the
  // monthly pipeline even if someone pastes them into the wrong
  // project).
  PROP: {
    LAST_RUN:    "VIPW_LAST_RUN",     // runId of last completed run
    STATE:       "VIPW_STATE",        // JSON resume state for in-flight run
    EXPECTED_CE: "VIPW_EXPECTED_CE",  // optional: seed-run acceptance oracle
    EMAIL_TO:    "VIPW_EMAIL_TO",     // optional override
    DRY_RUN:     "DRY_RUN"            // "0" = live writes (Shared.gs contract)
  }
};

// No VIP_CURRENT_YEAR equivalent and no January rollover: Week is a
// full date, so the spine crosses year boundaries natively (ADR-015
// year-boundary note — a late-December pull carries early-January
// week-ending dates and they load like any other week).

function VIPW_emailTo_() {
  return PropertiesService.getScriptProperties().getProperty(VIPW.PROP.EMAIL_TO) || VIPW.EMAIL_TO_DEFAULT;
}

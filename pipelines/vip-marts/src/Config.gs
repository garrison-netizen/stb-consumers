// ============================================================
// VIP Marts pipeline — configuration.
// Design of record: ADR-010 "VIP Marts Load Pipeline" (adopted
// 2026-07-16, page 3a41c57a-c02b-8193-846b-e4bb905b711a).
// Data source IDs verified against live Brain 2026-07-21.
// ============================================================

var VIP = {
  // Drive folder the two monthly VIP exports land in
  // ("Weekly Distribution Pulse" — shared with sales-pulse).
  FOLDER_ID: "18SyL5m1-qybOTqoAZJKc9VEix76UzFQz",

  // Subfolder (created on demand) for Mart B pre-write snapshots.
  SNAPSHOT_FOLDER_NAME: "Mart B Snapshots",

  // File recognition — newest file matching each pattern wins.
  MATRIX_FILE_RE: /distributor.*brand.*matrix/i,
  DETAIL_FILE_RE: /account\s*detail/i,

  // Notion data sources.
  DIST_MAP_DS: "7d4ed233-26c5-4922-974e-89756fee78ad",  // VIP Distributor Map
  MART_A_DS:   "e974a77b-17c4-4fb2-9871-d5ce32734367",  // VIP Mart A - Depletion Trend
  MART_B_DS:   "f308e753-805b-4ce9-9ae9-d08695f56db8",  // VIP Mart B - Account Trajectory

  // Mart B history starts here; history columns are CE {FIRST_HISTORY_YEAR}..CE {year-1}.
  FIRST_HISTORY_YEAR: 2021,

  // Trajectory classification thresholds (ADR-010 §1.2):
  // Growing > +10%, Steady within ±10%, Declining < -10%.
  GROWTH_PCT: 0.10,

  // Numeric comparison epsilon for skip-unchanged and the reconcile gate.
  EPSILON: 0.005,

  EMAIL_TO_DEFAULT: "garrison@spindletap.com",

  // Script Property keys.
  PROP: {
    CURRENT_YEAR: "VIP_CURRENT_YEAR",   // e.g. "2026"; bumped by vipRollover()
    LAST_RUN:     "VIP_LAST_RUN",       // runId of last completed run
    STATE:        "VIP_STATE",          // JSON resume state for in-flight run
    EXPECTED_CE:  "VIP_EXPECTED_CE",    // optional: gate Mart A total against this
    EMAIL_TO:     "VIP_EMAIL_TO",       // optional override
    DRY_RUN:      "DRY_RUN"             // "0" = live writes (Shared.gs contract)
  }
};

function VIP_currentYear_() {
  var y = PropertiesService.getScriptProperties().getProperty(VIP.PROP.CURRENT_YEAR);
  if (!y) throw new Error(VIP.PROP.CURRENT_YEAR + " not set in Script Properties (e.g. 2026).");
  return parseInt(y, 10);
}

function VIP_emailTo_() {
  return PropertiesService.getScriptProperties().getProperty(VIP.PROP.EMAIL_TO) || VIP.EMAIL_TO_DEFAULT;
}

// Mart B year-embedded column names, derived from the configured year
// so vipRollover() is a config flip + schema promotion, not a code edit.
function VIP_colYtd_(year)        { return "CE " + year + " YTD"; }
function VIP_colSamePeriod_(year) { return "CE " + (year - 1) + " same-period"; }
function VIP_colHistory_(year)    { return "CE " + year; }
function VIP_statusNew_(year)     { return "New " + year; }
function VIP_statusLapsed_(year)  { return "Lapsed " + year; }

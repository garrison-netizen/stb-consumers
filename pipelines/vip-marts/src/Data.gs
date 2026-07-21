// ============================================================
// VIP Marts — Drive file discovery + VIP export CSV parsing.
//
// VIP export headers embed literal date windows, e.g.
//   "26 Weeks 1/1/2026 thru 6/27/2026  Case Equivs"
// so nothing here binds to literal column names. The parser finds
// the two multi-week rollup groups (current year + prior-year
// same-period) by pattern and HARD-FAILS if the current-year
// window does not start January 1 — a trailing-window export
// (e.g. "13 Weeks 3/1 thru 5/30") is NOT a YTD pull and loading
// it would corrupt the marts (ADR-010 assumes cumulative YTD).
// ============================================================

// Find the newest file matching each export pattern in the folder.
// Returns {matrix: file, detail: file, runId: string}.
function VM_findExports_() {
  var folder = DriveApp.getFolderById(VIP.FOLDER_ID);
  var files = folder.getFiles();
  var best = { matrix: null, detail: null };
  while (files.hasNext()) {
    var f = files.next();
    var name = f.getName();
    if (!/\.csv$/i.test(name) && f.getMimeType() !== MimeType.CSV) continue;
    if (VIP.MATRIX_FILE_RE.test(name)) {
      if (!best.matrix || f.getLastUpdated() > best.matrix.getLastUpdated()) best.matrix = f;
    } else if (VIP.DETAIL_FILE_RE.test(name)) {
      if (!best.detail || f.getLastUpdated() > best.detail.getLastUpdated()) best.detail = f;
    }
  }
  if (!best.matrix) throw new Error("No dist-matrix export (pattern " + VIP.MATRIX_FILE_RE + ") found in Drive folder.");
  if (!best.detail) throw new Error("No account-detail export (pattern " + VIP.DETAIL_FILE_RE + ") found in Drive folder.");
  var runId = best.matrix.getLastUpdated().getTime() + "-" + best.detail.getLastUpdated().getTime();
  return { matrix: best.matrix, detail: best.detail, runId: runId };
}

function VM_readCsv_(file) {
  var text = file.getBlob().getDataAsString("UTF-8");
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
  return Utilities.parseCsv(text);
}

// Numeric cell → number or null. VIP uses "--" for n/a.
function VM_num_(s) {
  if (s === null || s === undefined) return null;
  s = String(s).replace(/,/g, "").trim();
  if (s === "" || s === "--") return null;
  var n = Number(s);
  return isNaN(n) ? null : n;
}

// Normalize a string for matching: uppercase, collapse whitespace.
// The ADR calls this out explicitly — VIP tokens vary in spacing
// ("Company  LP" vs "Company LP").
function VM_norm_(s) {
  return String(s || "").toUpperCase().replace(/\s+/g, " ").trim();
}

// Distributor-token canonicalization. The raw VIP exports write the
// state as a comma suffix ("Silver Eagle Dist - Houston, TX") while
// the VIP Distributor Map's tokens carry the cleaned parenthesized
// form ("Silver Eagle Dist - Houston (TX)"). Rewrite the comma form
// to the parenthesized form, then apply VM_norm_ — applied to BOTH
// sides of the lookup so either spelling matches the same key.
function VM_normToken_(s) {
  var t = String(s || "").trim().replace(/,\s*([A-Za-z]{2})\s*$/, " ($1)");
  return VM_norm_(t);
}

// ---- Rollup-window header parsing --------------------------------

// VIP writes weekly-report windows as "N Weeks ..." and YTD/monthly
// windows as "N Months ..." — both shapes observed in live exports
// (13-week trailing pull 2026-06-03 vs YTD pull 2026-07-21).
var VM_WINDOW_RE = /^(\d+)\s+(?:Weeks?|Months?)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+thru\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(.+)$/;

var VM_METRIC_MAP = {
  "Case Equivs":          "ce",
  "Units Sold":           "units",
  "Did Buys(All Accts)":  "didBuys",
  "Effective(All Accts)": "effective",
  "Brd Placements(All)":  "placements"
};

// Scan a header row for multi-week rollup groups.
// Returns { current: {year, startMonth, startDay, weeks, cols: {metric: idx}},
//           prior:   {...} }
// current = the group whose end-date year is the max across groups;
// prior = the group with the next-lower year. Throws if either is
// missing or if current-year window is not YTD (start != Jan 1).
function VM_parseWindows_(header, expectYear) {
  var groups = {}; // key "start|end" -> group
  for (var i = 0; i < header.length; i++) {
    var m = VM_WINDOW_RE.exec(String(header[i]).trim());
    if (!m) continue;
    var key = m[2] + "/" + m[3] + "/" + m[4] + "|" + m[5] + "/" + m[6] + "/" + m[7];
    if (!groups[key]) {
      groups[key] = {
        weeks: parseInt(m[1], 10),
        startMonth: parseInt(m[2], 10), startDay: parseInt(m[3], 10), startYear: parseInt(m[4], 10),
        endYear: parseInt(m[7], 10),
        label: key.replace("|", " thru "),
        cols: {}
      };
    }
    var metric = VM_METRIC_MAP[m[8].trim()];
    if (metric) groups[key].cols[metric] = i;
  }
  // Only multi-period groups are rollups; single-week/single-month
  // groups are the detail columns and are skipped by requiring > 1.
  var rollups = [];
  for (var k in groups) if (groups[k].weeks > 1) rollups.push(groups[k]);
  if (rollups.length < 2) {
    throw new Error("Expected 2 multi-week rollup groups in export header, found " + rollups.length + ".");
  }
  rollups.sort(function (a, b) { return b.endYear - a.endYear; });
  var current = rollups[0], prior = rollups[1];
  if (expectYear && current.endYear !== expectYear) {
    throw new Error("ROLLOVER/YEAR MISMATCH: export current-year window ends in " + current.endYear +
      " but pipeline is configured for " + expectYear +
      ". If a new year has started, run vipRollover() first (see README).");
  }
  if (current.startMonth !== 1 || current.startDay !== 1) {
    throw new Error("NOT A YTD EXPORT: current-year rollup window starts " +
      current.startMonth + "/" + current.startDay + "/" + current.startYear +
      " — VIP pull must be year-to-date (Jan 1 start). Re-pull the export with a YTD range. " +
      "Nothing was written.");
  }
  return { current: current, prior: prior };
}

// ---- Distributor map ---------------------------------------------

// Load VIP Distributor Map → { normToken: {parent, branch, footprint} }.
function VM_loadDistMap_() {
  var rows = VM_queryAll_(VIP.DIST_MAP_DS, null);
  var map = {};
  rows.forEach(function (p) {
    var r = VM_row_(p);
    var token = VM_normToken_(r["Raw VIP token"]);
    if (!token) return;
    map[token] = {
      parent: r["Parent distributor"] || null,
      branch: r["Branch"] || null,
      footprint: !!r["Footprint artifact"]
    };
  });
  if (Object.keys(map).length === 0) throw new Error("VIP Distributor Map is empty — cannot map tokens.");
  return map;
}

// Resolve a raw distributor token; fail loudly on unmapped (ADR-010 §4).
function VM_mapDistributor_(map, rawToken) {
  var hit = map[VM_normToken_(rawToken)];
  if (!hit || !hit.parent) {
    throw new Error('UNMAPPED DISTRIBUTOR TOKEN: "' + rawToken + '" is not in the VIP Distributor Map. ' +
      "Add the token to the map (Architect surface), then re-run. Nothing was written.");
  }
  return hit;
}

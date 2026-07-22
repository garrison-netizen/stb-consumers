// ============================================================
// VIP Mart C weekly — Drive discovery + weekly export parsing.
//
// The weekly export is a 13-week TRAILING pull at Distributor x
// Brand Matrix grain: rows are raw-distributor × brand × package ×
// premise, and the weeks run ACROSS as column groups
//   "1 Week 4/26/2026 thru 5/2/2026  Case Equivs", ...
// followed by a "13 Weeks <first> thru <last>" rollup group (used
// here as VIP's own checksum), a prior-year 13-week group and
// Diff/Pct columns (all ignored).
//
// Shape gate: exactly WEEKS_EXPECTED contiguous one-week groups,
// each carrying all five metrics, plus a current rollup spanning
// them. A YTD export (which also carries one-week detail columns —
// ~30 of them by July) fails the count gate; anything else VIP
// might emit fails loudly too. Nothing is written on a gate abort.
// ============================================================

// ---- Drive ---------------------------------------------------------

// The dedicated weekly subfolder (see Config for why it exists).
// Created on demand so the first deploy self-provisions it.
function VIPW_weeklyFolder_() {
  var parent = DriveApp.getFolderById(VIPW.PARENT_FOLDER_ID);
  var it = parent.getFoldersByName(VIPW.WEEKLY_FOLDER_NAME);
  return it.hasNext() ? it.next() : parent.createFolder(VIPW.WEEKLY_FOLDER_NAME);
}

// Newest matrix-pattern CSV in the weekly subfolder.
// Returns {file, runId}.
function VIPW_findExport_() {
  var folder = VIPW_weeklyFolder_();
  var files = folder.getFiles();
  var best = null;
  while (files.hasNext()) {
    var f = files.next();
    var name = f.getName();
    if (!/\.csv$/i.test(name) && f.getMimeType() !== MimeType.CSV) continue;
    if (!VIPW.MATRIX_FILE_RE.test(name)) continue;
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  if (!best) {
    throw new Error("No weekly dist-matrix export (pattern " + VIPW.MATRIX_FILE_RE +
      ') found in the "' + VIPW.WEEKLY_FOLDER_NAME + '" subfolder of the Weekly Distribution Pulse folder.');
  }
  return { file: best, runId: String(best.getLastUpdated().getTime()) };
}

function VIPW_readCsv_(file) {
  var text = file.getBlob().getDataAsString("UTF-8");
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
  return Utilities.parseCsv(text);
}

// ---- Cell/text helpers (same semantics as the monthly pipeline) ----

// Numeric cell → number or null. VIP uses "--" for n/a.
function VIPW_num_(s) {
  if (s === null || s === undefined) return null;
  s = String(s).replace(/,/g, "").trim();
  if (s === "" || s === "--") return null;
  var n = Number(s);
  return isNaN(n) ? null : n;
}

// Normalize a string for matching: uppercase, collapse whitespace.
function VIPW_norm_(s) {
  return String(s || "").toUpperCase().replace(/\s+/g, " ").trim();
}

// Distributor-token canonicalization: raw exports write "..., TX",
// the VIP Distributor Map's tokens carry "... (TX)". Rewrite the
// comma form to the parenthesized form, then VIPW_norm_ — applied to
// BOTH sides of the lookup so either spelling matches.
function VIPW_normToken_(s) {
  var t = String(s || "").trim().replace(/,\s*([A-Za-z]{2})\s*$/, " ($1)");
  return VIPW_norm_(t);
}

// ---- Weekly window header parsing ----------------------------------

var VIPW_WINDOW_RE = /^(\d+)\s+(?:Weeks?|Months?)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+thru\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(.+)$/;

var VIPW_METRIC_MAP = {
  "Case Equivs":          "ce",
  "Units Sold":           "units",
  "Did Buys(All Accts)":  "didBuys",
  "Effective(All Accts)": "effective",
  "Brd Placements(All)":  "placements"
};

var VIPW_METRICS = ["ce", "units", "didBuys", "effective", "placements"];

function VIPW_isoDate_(m, d, y) {
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  return y + "-" + p2(m) + "-" + p2(d);
}

// Days between two m/d/y dates (UTC, no DST edge).
function VIPW_dayDiff_(m1, d1, y1, m2, d2, y2) {
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// Parse the header into the weekly spine.
// Returns { weeks: [{iso, label, cols:{metric: idx}}]  (ascending by
//           week-ending date),
//           rollup: {cols},  windowLabel: "<first start> thru <last end>" }
function VIPW_parseWeeklyWindows_(header) {
  var groups = {}; // "start|end" -> group
  for (var i = 0; i < header.length; i++) {
    var m = VIPW_WINDOW_RE.exec(String(header[i]).trim());
    if (!m) continue;
    var key = m[2] + "/" + m[3] + "/" + m[4] + "|" + m[5] + "/" + m[6] + "/" + m[7];
    if (!groups[key]) {
      groups[key] = {
        periods: parseInt(m[1], 10),
        sM: parseInt(m[2], 10), sD: parseInt(m[3], 10), sY: parseInt(m[4], 10),
        eM: parseInt(m[5], 10), eD: parseInt(m[6], 10), eY: parseInt(m[7], 10),
        label: key.replace("|", " thru "),
        cols: {}
      };
    }
    var metric = VIPW_METRIC_MAP[m[8].trim()];
    if (metric) groups[key].cols[metric] = i;
  }

  var weeks = [], rollups = [];
  for (var k in groups) {
    var g = groups[k];
    if (g.periods === 1) weeks.push(g); else rollups.push(g);
  }

  if (weeks.length !== VIPW.WEEKS_EXPECTED) {
    throw new Error("NOT THE WEEKLY EXPORT: found " + weeks.length + " one-week column groups, expected " +
      VIPW.WEEKS_EXPECTED + ". This pipeline loads the VIP 13-week trailing weekly Distributor x Brand Matrix " +
      "pull only (a YTD export has a different shape). Nothing was written.");
  }
  weeks.sort(function (a, b) {
    return Date.UTC(a.eY, a.eM - 1, a.eD) - Date.UTC(b.eY, b.eM - 1, b.eD);
  });
  weeks.forEach(function (w, idx) {
    VIPW_METRICS.forEach(function (met) {
      if (w.cols[met] === undefined) {
        throw new Error("Weekly group " + w.label + " is missing metric " + met + " — export shape changed; aborting.");
      }
    });
    if (VIPW_dayDiff_(w.sM, w.sD, w.sY, w.eM, w.eD, w.eY) !== 6) {
      throw new Error("Week group " + w.label + " does not span 7 days — export shape changed; aborting.");
    }
    if (idx > 0) {
      var prev = weeks[idx - 1];
      if (VIPW_dayDiff_(prev.eM, prev.eD, prev.eY, w.sM, w.sD, w.sY) !== 1) {
        throw new Error("Weeks " + prev.label + " and " + w.label + " are not contiguous — export shape changed; aborting.");
      }
    }
    w.iso = VIPW_isoDate_(w.eM, w.eD, w.eY);           // canonical week-ending date
    w.label = w.label;                                  // verbatim VIP week token
  });

  // Current rollup = the multi-week group exactly spanning the weekly
  // spine (VIP's own 13-week sum — used as a checksum). The prior-year
  // group and Diff/Pct columns simply don't match and are ignored.
  var first = weeks[0], last = weeks[weeks.length - 1];
  var rollup = null;
  rollups.forEach(function (g) {
    if (g.sM === first.sM && g.sD === first.sD && g.sY === first.sY &&
        g.eM === last.eM && g.eD === last.eD && g.eY === last.eY) rollup = g;
  });
  if (!rollup || rollup.cols.ce === undefined) {
    throw new Error("No " + VIPW.WEEKS_EXPECTED + "-week rollup group spanning " + first.label.split(" thru ")[0] +
      " thru " + last.label.split(" thru ")[1] + " found — export shape changed; aborting.");
  }

  return {
    weeks: weeks,
    rollup: rollup,
    windowLabel: first.label.split(" thru ")[0] + " thru " + last.label.split(" thru ")[1]
  };
}

// ---- Conforming maps (shared Brain surfaces, read-only here) -------

// VIP Distributor Map → { normToken: {parent, branch, footprint} }.
function VIPW_loadDistMap_() {
  var rows = VIPW_queryAll_(VIPW.DIST_MAP_DS, null);
  var map = {};
  rows.forEach(function (p) {
    var r = VIPW_row_(p);
    var token = VIPW_normToken_(r["Raw VIP token"]);
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

function VIPW_mapDistributor_(map, rawToken) {
  var hit = map[VIPW_normToken_(rawToken)];
  if (!hit || !hit.parent) {
    throw new Error('UNMAPPED DISTRIBUTOR TOKEN: "' + rawToken + '" is not in the VIP Distributor Map. ' +
      "Add the token to the map (Architect surface), then re-run. Nothing was written.");
  }
  return hit;
}

// VIP Brand Map → { normRawTitle: canonicalBrand }. Retired brands
// stay mapped — a late restatement may still carry them.
function VIPW_loadBrandMap_() {
  var rows = VIPW_queryAll_(VIPW.BRAND_MAP_DS, null);
  var map = {};
  rows.forEach(function (p) {
    var r = VIPW_row_(p);
    var raw = VIPW_norm_(r["Brand title (raw)"]);
    if (!raw) return;
    map[raw] = r["Canonical brand"] || r["Brand title (raw)"];
  });
  if (Object.keys(map).length === 0) throw new Error("VIP Brand Map is empty — cannot conform brands.");
  return map;
}

function VIPW_mapBrand_(map, rawBrand) {
  var hit = map[VIPW_norm_(rawBrand)];
  if (!hit) {
    throw new Error('UNMAPPED BRAND: "' + rawBrand + '" is not in the VIP Brand Map. ' +
      "Add the brand to the map (Architect surface), then re-run. Nothing was written.");
  }
  return hit;
}

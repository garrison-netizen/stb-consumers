// ============================================================
// VIP Mart C weekly — pure transform (no I/O beyond the parsed CSV
// array and the two conforming maps passed in).
//
// Raw grain: raw-distributor × brand × package × premise, weeks as
// column groups. Target grain (ADR-015): canonical brand ×
// distributor(parent) × segment × week, LONG. Package sizes and
// distributor branches roll up by summation; branches are kept as a
// distinct-joined text attribute.
// ============================================================

function VIPW_round_(n) {
  if (n === null || n === undefined) return null;
  return Math.round(n * 10000) / 10000;
}

function VIPW_eq_(a, b) {
  var an = (a === null || a === undefined), bn = (b === null || b === undefined);
  if (an && bn) return true;
  if (an || bn) return false;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < VIPW.EPSILON;
  return String(a) === String(b);
}

// Compute Mart C cells from the weekly matrix CSV.
// Returns {
//   cells: {cellTitle: rowObj},   // only cells with at least one nonzero metric
//   totalCE, rawTotalCE,          // aggregated vs straight-off-the-file (must be equal)
//   rollupTotalCE,                // VIP's own 13-week rollup column sum (checksum)
//   weekTotals: {iso: ce},        // per-week raw CE totals (for the report + validation)
//   weeks, windowLabel, firstWeekIso, lastWeekIso
// }
function VIPW_computeMartC_(csv, distMap, brandMap) {
  var header = csv[0];
  var win = VIPW_parseWeeklyWindows_(header);

  var cells = {};
  var rawTotalCE = 0, rollupTotalCE = 0;
  var weekTotals = {};
  win.weeks.forEach(function (w) { weekTotals[w.iso] = 0; });

  for (var r = 1; r < csv.length; r++) {
    var row = csv[r];
    if (!row || row.length < 5 || !String(row[0]).trim()) continue;
    var dist = VIPW_mapDistributor_(distMap, row[0]);
    var brand = VIPW_mapBrand_(brandMap, row[1]);
    var premise = VIPW_norm_(row[3]);
    var segment = premise === "OFF" ? "Off-Premise" : premise === "ON" ? "On-Premise" : "Unknown";

    rollupTotalCE += VIPW_num_(row[win.rollup.cols.ce]) || 0;

    for (var wi = 0; wi < win.weeks.length; wi++) {
      var w = win.weeks[wi];
      var ce         = VIPW_num_(row[w.cols.ce]) || 0;
      var units      = VIPW_num_(row[w.cols.units]) || 0;
      var didBuys    = VIPW_num_(row[w.cols.didBuys]) || 0;
      var effective  = VIPW_num_(row[w.cols.effective]) || 0;
      var placements = VIPW_num_(row[w.cols.placements]) || 0;

      rawTotalCE += ce;
      weekTotals[w.iso] += ce;

      // All-zero weeks create no cell: at 13 weeks × every raw combo,
      // most (combo, week) pairs are empty and rows of pure zeros
      // would be noise. Zeros contribute nothing to any reconcile
      // total, and a restated-to-zero week disappears from the
      // recompute so the in-window stray archival cleans up its old
      // row (same net effect as writing zeros, without the clutter).
      if (!ce && !units && !didBuys && !effective && !placements) continue;

      var key = brand + " | " + dist.parent + " | " + segment + " | " + w.iso;
      var cell = cells[key];
      if (!cell) {
        cell = cells[key] = {
          cell: key, brand: brand, parent: dist.parent, segment: segment,
          weekIso: w.iso, weekLabel: w.label,
          branches: {}, footprint: false,
          ce: 0, units: 0, didBuys: 0, effective: 0, placements: 0
        };
      }
      if (dist.branch) cell.branches[dist.branch] = true;
      cell.footprint = cell.footprint || dist.footprint;
      cell.ce += ce; cell.units += units; cell.didBuys += didBuys;
      cell.effective += effective; cell.placements += placements;
    }
  }

  var totalCE = 0;
  for (var k in cells) {
    var c = cells[k];
    c.ce = VIPW_round_(c.ce); c.units = VIPW_round_(c.units);
    c.didBuys = VIPW_round_(c.didBuys); c.effective = VIPW_round_(c.effective);
    c.placements = VIPW_round_(c.placements);
    c.branch = Object.keys(c.branches).sort().join(", ");
    totalCE += c.ce;
  }
  for (var iso in weekTotals) weekTotals[iso] = VIPW_round_(weekTotals[iso]);

  return {
    cells: cells,
    totalCE: VIPW_round_(totalCE),
    rawTotalCE: VIPW_round_(rawTotalCE),
    rollupTotalCE: VIPW_round_(rollupTotalCE),
    weekTotals: weekTotals,
    weeks: win.weeks,
    windowLabel: win.windowLabel,
    firstWeekIso: win.weeks[0].iso,
    lastWeekIso: win.weeks[win.weeks.length - 1].iso
  };
}

// Notion payload for a Mart C cell (property names verified against
// the live data source 2026-07-22).
function VIPW_martCProps_(c) {
  return {
    "Cell":                 STB_pTitle_(c.cell),
    "Brand":                STB_pRichText_(c.brand),
    "Distributor (parent)": STB_pSelect_(c.parent),
    "Branch":               STB_pRichText_(c.branch),
    "Segment":              STB_pSelect_(c.segment),
    "Week":                 STB_pDateISO_(c.weekIso),
    "Week label":           STB_pRichText_(c.weekLabel),
    "CE":                   STB_pNumber_(c.ce),
    "Units":                STB_pNumber_(c.units),
    "Did Buys":             STB_pNumber_(c.didBuys),
    "Effective":            STB_pNumber_(c.effective),
    "Placements":           STB_pNumber_(c.placements),
    "Footprint artifact":   VIPW_pCheckbox_(c.footprint)
  };
}

// Compare a computed cell against an existing extracted row —
// skip-unchanged is what makes timeout re-entry idempotent.
function VIPW_martCEqual_(c, ex) {
  return VIPW_eq_(c.ce, ex["CE"]) && VIPW_eq_(c.units, ex["Units"]) &&
    VIPW_eq_(c.didBuys, ex["Did Buys"]) && VIPW_eq_(c.effective, ex["Effective"]) &&
    VIPW_eq_(c.placements, ex["Placements"]) &&
    VIPW_eq_(c.brand, ex["Brand"]) && VIPW_eq_(c.parent, ex["Distributor (parent)"]) &&
    VIPW_eq_(c.segment, ex["Segment"]) && VIPW_eq_(c.weekIso, ex["Week"]) &&
    VIPW_eq_(c.weekLabel, ex["Week label"]) && VIPW_eq_(c.branch, ex["Branch"]) &&
    (!!c.footprint === !!ex["Footprint artifact"]);
}

// ============================================================
// VIP Marts — pure transforms (no I/O except reading the parsed
// CSV arrays + distributor map passed in).
// ============================================================

function VM_round_(n) {
  if (n === null || n === undefined) return null;
  return Math.round(n * 10000) / 10000;
}

function VM_eq_(a, b) {
  var an = (a === null || a === undefined), bn = (b === null || b === undefined);
  if (an && bn) return true;
  if (an || bn) return false;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < VIP.EPSILON;
  return String(a) === String(b);
}

// ---- MART A: recompute-and-replace (ADR-010 §1.1) ----------------
//
// Input: dist-matrix CSV rows. Grain of dump: raw-distributor ×
// brand × package × premise. Aggregate to (brand, parent, segment):
// sum current-window CE/Units/DidBuys/Effective/Placements; prior-
// year CE from the same-period rollup. Cell title format matches
// live rows: "Brand | Parent | Segment | Year".
//
// Returns { cells: {cellTitle: rowObj}, totalCE, rawTotalCE, year }.
function VM_computeMartA_(csv, distMap, year) {
  var header = csv[0];
  var win = VM_parseWindows_(header, year);
  var cur = win.current.cols, pri = win.prior.cols;
  ["ce", "units", "didBuys", "effective", "placements"].forEach(function (k) {
    if (cur[k] === undefined) throw new Error("dist-matrix current-year rollup missing metric: " + k);
  });
  if (pri.ce === undefined) throw new Error("dist-matrix prior-year rollup missing Case Equivs.");

  var cells = {};
  var rawTotalCE = 0;

  for (var r = 1; r < csv.length; r++) {
    var row = csv[r];
    if (!row || row.length < 5 || !String(row[0]).trim()) continue;
    var dist = VM_mapDistributor_(distMap, row[0]);
    var brand = String(row[1]).trim();
    var premise = VM_norm_(row[3]);
    var segment = premise === "OFF" ? "Off-Premise" : premise === "ON" ? "On-Premise" : "Unknown";

    var key = brand + " | " + dist.parent + " | " + segment + " | " + year;
    var cell = cells[key];
    if (!cell) {
      cell = cells[key] = {
        cell: key, year: year, brand: brand, parent: dist.parent, segment: segment,
        footprint: dist.footprint,
        ce: 0, units: 0, didBuys: 0, effective: 0, placements: 0, priorCE: 0
      };
    }
    cell.footprint = cell.footprint || dist.footprint;
    var ce = VM_num_(row[cur.ce]) || 0;
    cell.ce         += ce;
    cell.units      += VM_num_(row[cur.units]) || 0;
    cell.didBuys    += VM_num_(row[cur.didBuys]) || 0;
    cell.effective  += VM_num_(row[cur.effective]) || 0;
    cell.placements += VM_num_(row[cur.placements]) || 0;
    cell.priorCE    += VM_num_(row[pri.ce]) || 0;
    rawTotalCE += ce;
  }

  var totalCE = 0;
  for (var k in cells) {
    var c = cells[k];
    c.ce = VM_round_(c.ce); c.units = VM_round_(c.units);
    c.didBuys = VM_round_(c.didBuys); c.effective = VM_round_(c.effective);
    c.placements = VM_round_(c.placements); c.priorCE = VM_round_(c.priorCE);
    c.delta = VM_round_(c.ce - c.priorCE);
    c.pct = (c.priorCE && c.priorCE !== 0) ? VM_round_((c.ce - c.priorCE) / c.priorCE * 100) : null;
    totalCE += c.ce;
  }
  return {
    cells: cells,
    totalCE: VM_round_(totalCE),
    rawTotalCE: VM_round_(rawTotalCE),
    year: year,
    windowLabel: win.current.label
  };
}

// Notion payload for a Mart A cell.
function VM_martAProps_(c) {
  return {
    "Cell":                 STB_pTitle_(c.cell),
    "Year":                 STB_pNumber_(c.year),
    "Brand":                STB_pRichText_(c.brand),
    "Distributor (parent)": STB_pSelect_(c.parent),
    "Segment":              STB_pSelect_(c.segment),
    "CE":                   STB_pNumber_(c.ce),
    "Units":                STB_pNumber_(c.units),
    "Did Buys":             STB_pNumber_(c.didBuys),
    "Effective":            STB_pNumber_(c.effective),
    "Placements":           STB_pNumber_(c.placements),
    "CE prior year":        STB_pNumber_(c.priorCE),
    "CE YoY delta":         STB_pNumber_(c.delta),
    "CE YoY pct":           STB_pNumber_(c.pct),
    "Footprint artifact":   VM_pCheckbox_(c.footprint)
  };
}

// Compare a computed Mart A cell against an existing extracted row.
function VM_martAEqual_(c, ex) {
  return VM_eq_(c.ce, ex["CE"]) && VM_eq_(c.units, ex["Units"]) &&
    VM_eq_(c.didBuys, ex["Did Buys"]) && VM_eq_(c.effective, ex["Effective"]) &&
    VM_eq_(c.placements, ex["Placements"]) && VM_eq_(c.priorCE, ex["CE prior year"]) &&
    VM_eq_(c.delta, ex["CE YoY delta"]) && VM_eq_(c.pct, ex["CE YoY pct"]) &&
    VM_eq_(c.brand, ex["Brand"]) && VM_eq_(c.parent, ex["Distributor (parent)"]) &&
    VM_eq_(c.segment, ex["Segment"]) && (!!c.footprint === !!ex["Footprint artifact"]);
}

// ---- MART B: overlay-and-preserve (ADR-010 §1.2) -----------------
//
// existing: extracted Mart B rows (VM_row_ output).
// detailCsv: account-detail CSV. distMap: distributor map.
//
// Returns { updates: [{pageId, props, uid}], creates: [{props, uid}],
//           stats: {...}, unmatchedInfo: [...] }
//
// History columns (CE 2021..CE {year-1}) are NEVER written —
// preserved by omission. Only the current-year column, same-period
// column, and derived fields are computed and written.
function VM_computeMartB_(existing, detailCsv, distMap, year) {
  var header = detailCsv[0];
  var win = VM_parseWindows_(header, year);
  var curCE = win.current.cols.ce, priCE = win.prior.cols.ce;
  if (curCE === undefined) throw new Error("account-detail current-year rollup missing Case Equivs.");
  if (priCE === undefined) throw new Error("account-detail prior-year rollup missing Case Equivs.");

  var YTD = VIP_colYtd_(year), SP = VIP_colSamePeriod_(year);
  var histCols = [];
  for (var y = VIP.FIRST_HISTORY_YEAR; y < year; y++) histCols.push({ year: y, col: VIP_colHistory_(y) });

  // Architect ruling 2026-07-21: "OPEN" allocation rows (RDD BULK,
  // SALES REP, etc.) are VIP bookkeeping, not retail accounts —
  // excluded from Mart B entirely. Existing ones are archived; dump
  // ones are skipped. Their CE still reaches Mart A via the matrix.
  function isPseudo(name) { return VM_norm_(name) === "OPEN" || VM_norm_(name).indexOf("OPEN |") === 0; }
  var pseudoArchives = [];
  existing = existing.filter(function (ex) {
    if (isPseudo(ex["Account name"])) { pseudoArchives.push(ex.__id); return false; }
    return true;
  });

  // Index existing rows by canonical identity and by uid. Secondary
  // index name|city catches rows whose address VIP re-spelled beyond
  // canonicalization — used only when unambiguous AND the addresses
  // still overlap (guards multi-location chains: two "BLACK WALNUT
  // CAFE, HOUSTON" at different streets must NOT merge).
  // Colliding canonical keys (e.g. VIP bookkeeping pseudo-accounts
  // like "OPEN | RDD BULK - E" repeated per region, where City is the
  // real differentiator) are re-keyed with City appended rather than
  // aborting; only a still-colliding key aborts the run.
  var byKey = {}, collided = {}, byUid = {}, dupKeys = [], byNameCity = {};
  existing.forEach(function (ex) {
    var key = VM_identityKey_(ex["Account name"], ex["Address"]);
    if (collided[key]) {
      var k2 = key + "|" + VM_norm_(ex["City"]);
      if (byKey[k2]) dupKeys.push(k2); else byKey[k2] = ex;
    } else if (byKey[key]) {
      var orig = byKey[key];
      delete byKey[key];
      collided[key] = true;
      var ko = key + "|" + VM_norm_(orig["City"]);
      var kn = key + "|" + VM_norm_(ex["City"]);
      byKey[ko] = orig;
      if (kn === ko) dupKeys.push(kn); else byKey[kn] = ex;
    } else {
      byKey[key] = ex;
    }
    if (ex["account_uid"]) byUid[ex["account_uid"]] = ex;
    var nc = VM_norm_(ex["Account name"]) + "|" + VM_norm_(ex["City"]);
    if (byNameCity[nc] === undefined) byNameCity[nc] = ex; else byNameCity[nc] = null; // null = ambiguous
  });

  function dumpKeyFor(name, address, city) {
    var key = VM_identityKey_(name, address);
    return collided[key] ? key + "|" + VM_norm_(city) : key;
  }

  function findExisting(name, address, city) {
    var hit = byKey[dumpKeyFor(name, address, city)];
    if (hit) return hit;
    var nc = byNameCity[VM_norm_(name) + "|" + VM_norm_(city)];
    if (nc && VM_addrOverlap_(address, nc["Address"]) >= 0.5) return nc;
    return null;
  }

  // Aggregate dump rows by identity (an account can appear once per
  // distributor; sum CE across appearances, keep the active parent).
  var dump = {};
  var pseudoSkipped = 0;
  for (var r = 1; r < detailCsv.length; r++) {
    var row = detailCsv[r];
    if (!row || row.length < 7 || !String(row[0]).trim()) continue;
    var name = String(row[0]).trim();
    if (isPseudo(name)) { pseudoSkipped++; continue; }
    var key = dumpKeyFor(name, row[1], row[2]);
    var ytd = VM_num_(row[curCE]) || 0;
    var sp  = VM_num_(row[priCE]) || 0;
    var dist = VM_mapDistributor_(distMap, row[6]);
    var d = dump[key];
    if (!d) {
      d = dump[key] = {
        name: name, address: String(row[1]).trim(), city: String(row[2]).trim(),
        chain: String(row[4]).trim(), classOfTrade: String(row[5]).trim(),
        parent: dist.parent, ytd: 0, samePeriod: 0, activeParent: null
      };
    }
    d.ytd += ytd; d.samePeriod += sp;
    if (ytd > 0 && !d.activeParent) d.activeParent = dist.parent;
    if (!d.activeParent) d.activeParent = null; // resolved after loop
  }
  for (var k in dump) {
    dump[k].ytd = VM_round_(dump[k].ytd);
    dump[k].samePeriod = VM_round_(dump[k].samePeriod);
    if (!dump[k].activeParent) dump[k].activeParent = dump[k].parent;
  }

  var updates = [], creates = [];
  var stats = { newAccts: 0, growing: 0, steady: 0, declining: 0, lapsedNow: 0, lapsedEarlier: 0, neverMaterial: 0, unchanged: 0, matched: 0, flippedToLapsed: 0 };

  // Classify + derive for one logical row state.
  function derive(hist, ytd, samePeriod, existingStatus) {
    // Vocabulary conforms to the Architect's classifier (the ADR-013
    // acceptance oracle): "New {year}" keys on the SPINE HISTORY only —
    // an account with no CE 2021..{year-1} history counts as New even
    // if the dump shows same-period activity last year. Same-period
    // still (a) drives the Growing/Steady/Declining pct math and
    // (b) distinguishes "Lapsed {year}" from "Never material" for
    // inactive rows with no spine history.
    var hasPrior = hist.some(function (h) { return (h.ce || 0) > 0; });
    var spPrior = samePeriod > 0;
    var active = ytd > 0;
    var status;
    if (active) {
      // Architect ruling 2026-07-21: New requires NO prior activity by
      // BOTH signals — same-period = 0 AND no canonical spine match.
      // Either signal present → continuing account, classify off delta.
      if (!hasPrior && !spPrior) status = VIP_statusNew_(year);
      else if (samePeriod > 0) {
        var g = (ytd - samePeriod) / samePeriod;
        status = g > VIP.GROWTH_PCT ? "Growing" : g < -VIP.GROWTH_PCT ? "Declining" : "Steady";
      } else {
        status = "Growing"; // active now vs zero same-period (win-backs)
      }
    } else {
      var lastFullCe = hist.length ? (hist[hist.length - 1].ce || 0) : 0; // CE {year-1}
      if (hasPrior || spPrior) status = (lastFullCe > 0 || spPrior) ? VIP_statusLapsed_(year) : "Lapsed earlier";
      else status = existingStatus || "Never material";
      if (existingStatus === "Never material") status = "Never material";
    }
    // Peak across full history years; count the partial current year
    // only if it already beats every full year.
    var peakCE = null, peakYear = null;
    hist.forEach(function (h) {
      if (h.ce !== null && h.ce !== undefined && (peakCE === null || h.ce > peakCE)) { peakCE = h.ce; peakYear = h.year; }
    });
    if (active && (peakCE === null || ytd > peakCE)) { peakCE = ytd; peakYear = year; }
    if (peakCE !== null && peakCE <= 0) { peakCE = null; peakYear = null; }
    var firstActive = null, lastActive = null;
    hist.forEach(function (h) {
      if ((h.ce || 0) > 0) { if (firstActive === null) firstActive = h.year; lastActive = h.year; }
    });
    // Same-period evidence extends first/last active ONLY for inactive
    // rows (a "New {year}" label must not carry First active {year-1}).
    if (spPrior && !active) {
      if (firstActive === null) firstActive = year - 1;
      if (lastActive === null || lastActive < year - 1) lastActive = year - 1;
    }
    if (active) { if (firstActive === null) firstActive = year; lastActive = year; }
    return {
      status: status,
      delta: VM_round_(ytd - samePeriod),
      peakCE: VM_round_(peakCE), peakYear: peakYear,
      firstActive: firstActive, lastActive: lastActive
    };
  }

  function bump(status) {
    if (status === VIP_statusNew_(year)) stats.newAccts++;
    else if (status === "Growing") stats.growing++;
    else if (status === "Steady") stats.steady++;
    else if (status === "Declining") stats.declining++;
    else if (status === VIP_statusLapsed_(year)) stats.lapsedNow++;
    else if (status === "Lapsed earlier") stats.lapsedEarlier++;
    else if (status === "Never material") stats.neverMaterial++;
  }

  var seenIds = {};
  for (var dk in dump) {
    var d = dump[dk];
    var ex = findExisting(d.name, d.address, d.city);
    if (ex) seenIds[ex.__id] = true;
    if (ex) {
      stats.matched++;
      var hist = histCols.map(function (h) { return { year: h.year, ce: ex[h.col] }; });
      var dv = derive(hist, d.ytd, d.samePeriod, ex["Trajectory Status"]);
      bump(dv.status);
      var props = {};
      if (!VM_eq_(ex[YTD], d.ytd))                props[YTD] = STB_pNumber_(d.ytd);
      if (!VM_eq_(ex[SP], d.samePeriod))          props[SP] = STB_pNumber_(d.samePeriod);
      if (!VM_eq_(ex["Current YoY delta"], dv.delta))   props["Current YoY delta"] = STB_pNumber_(dv.delta);
      if (!VM_eq_(ex["Trajectory Status"], dv.status))  props["Trajectory Status"] = STB_pSelect_(dv.status);
      if (!VM_eq_(ex["Peak CE"], dv.peakCE))            props["Peak CE"] = STB_pNumber_(dv.peakCE);
      if (!VM_eq_(ex["Peak year"], dv.peakYear))        props["Peak year"] = STB_pNumber_(dv.peakYear);
      if (!VM_eq_(ex["First active year"], dv.firstActive)) props["First active year"] = STB_pNumber_(dv.firstActive);
      if (!VM_eq_(ex["Last active year"], dv.lastActive))   props["Last active year"] = STB_pNumber_(dv.lastActive);
      if (d.ytd > 0 && d.activeParent && !VM_eq_(ex["Distributor (parent, last-active)"], d.activeParent)) {
        props["Distributor (parent, last-active)"] = STB_pSelect_(d.activeParent);
      }
      if (Object.keys(props).length === 0) stats.unchanged++;
      else updates.push({ pageId: ex.__id, props: props, uid: ex["account_uid"] });
    } else {
      // New account this year — mint a uid (persisted forever after).
      var uid = "acct_" + VM_md5hex_(dk).slice(0, 8);
      if (byUid[uid]) uid = "acct_" + VM_md5hex_(dk).slice(0, 12); // collision fallback
      if (d.ytd <= 0 && d.samePeriod <= 0) continue; // dump noise: no data either year
      var dvNew = derive(histCols.map(function (h) { return { year: h.year, ce: null }; }), d.ytd, d.samePeriod, null);
      bump(dvNew.status);
      var cprops = {
        "Account name": STB_pTitle_(d.name),
        "Address":      STB_pRichText_(d.address),
        "City":         STB_pRichText_(d.city),
        "Class of Trade": STB_pRichText_(d.classOfTrade),
        "Chain":        STB_pRichText_(d.chain),
        "Chain account": VM_pCheckbox_(d.chain && VM_norm_(d.chain) !== "INDEPENDENTS"),
        "Airport cluster": VM_pCheckbox_(VM_norm_(d.address).indexOf("7800 AIRPORT BLVD") === 0),
        "Distributor (parent, last-active)": STB_pSelect_(d.activeParent),
        "account_uid":  STB_pRichText_(uid)
      };
      cprops[YTD] = STB_pNumber_(d.ytd);
      cprops[SP] = STB_pNumber_(d.samePeriod);
      cprops["Current YoY delta"] = STB_pNumber_(dvNew.delta);
      cprops["Trajectory Status"] = STB_pSelect_(dvNew.status);
      cprops["Peak CE"] = STB_pNumber_(dvNew.peakCE);
      cprops["Peak year"] = STB_pNumber_(dvNew.peakYear);
      cprops["First active year"] = STB_pNumber_(dvNew.firstActive);
      cprops["Last active year"] = STB_pNumber_(dvNew.lastActive);
      creates.push({ props: cprops, uid: uid });
    }
  }

  // Vanished accounts: in Mart B, absent from dump → current YTD = 0,
  // reclassify (ADR-010 §1.2 step 5). History untouched.
  existing.forEach(function (ex) {
    if (seenIds[ex.__id]) return;
    var hist = histCols.map(function (h) { return { year: h.year, ce: ex[h.col] }; });
    var dv = derive(hist, 0, ex[SP] || 0, ex["Trajectory Status"]);
    bump(dv.status);
    var props = {};
    if (!VM_eq_(ex[YTD], 0))                          props[YTD] = STB_pNumber_(0);
    if (!VM_eq_(ex["Current YoY delta"], dv.delta))   props["Current YoY delta"] = STB_pNumber_(dv.delta);
    if (!VM_eq_(ex["Trajectory Status"], dv.status))  props["Trajectory Status"] = STB_pSelect_(dv.status);
    if (Object.keys(props).length === 0) { stats.unchanged++; return; }
    if ((ex[YTD] || 0) > 0) stats.flippedToLapsed++;
    updates.push({ pageId: ex.__id, props: props, uid: ex["account_uid"] });
  });

  stats.pseudoSkipped = pseudoSkipped;
  stats.pseudoArchived = pseudoArchives.length;
  return { updates: updates, creates: creates, archives: pseudoArchives, stats: stats, dupKeys: dupKeys, windowLabel: win.current.label };
}

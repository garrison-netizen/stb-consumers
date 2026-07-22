// Node harness for the GAS-targeted weekly transforms. Shims the GAS
// globals, loads Config/Shared/Notion/Data/Transform, then exercises
// the logic against the REAL 2026-07-22 VIP weekly export (13 weeks,
// 4/26/2026 thru 7/25/2026) plus the monthly pipeline's YTD fixture
// as a negative shape-gate case.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---- GAS shims ----------------------------------------------------
global.Logger = { log: (...a) => console.log("[log]", ...a) };
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => ({ NOTION_API_KEY: "x", DRY_RUN: "" }[k] || null),
    setProperty: () => {}, deleteProperty: () => {}
  })
};
function parseCsv(text) {
  const rows = []; let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = [];
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
global.Utilities = {
  parseCsv,
  computeDigest: (_alg, s) => Array.from(crypto.createHash("md5").update(s, "utf8").digest()).map(b => b > 127 ? b - 256 : b),
  DigestAlgorithm: { MD5: "MD5" }, Charset: { UTF_8: "UTF_8" },
  sleep: () => {}
};
global.UrlFetchApp = { fetch: () => { throw new Error("no network in harness"); } };
global.DriveApp = {}; global.MimeType = { CSV: "text/csv" }; global.MailApp = {};
global.ScriptApp = {}; global.Date.UTC = Date.UTC;

// ---- load pipeline sources ---------------------------------------
const SRC = path.join(__dirname, "..", "src");
for (const f of ["Config.gs", "Shared.gs", "Notion.gs", "Data.gs", "Transform.gs"]) {
  eval(fs.readFileSync(path.join(SRC, f), "utf8"));
}

const weeklyText = fs.readFileSync(path.join(__dirname, "fixtures_weekly_dist_matrix.csv"), "utf8").replace(/^﻿/, "");
const weekly = parseCsv(weeklyText);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name, extra || ""); }
}

// ---- Test 1: weekly window parsing on the real export -------------
const win = VIPW_parseWeeklyWindows_(weekly[0]);
check("13 one-week groups found", win.weeks.length === 13, String(win.weeks.length));
check("first week-ending iso", win.weeks[0].iso === "2026-05-02", win.weeks[0].iso);
check("last week-ending iso", win.weeks[12].iso === "2026-07-25", win.weeks[12].iso);
check("verbatim week label preserved", win.weeks[0].label === "4/26/2026 thru 5/2/2026", win.weeks[0].label);
check("window label", win.windowLabel === "4/26/2026 thru 7/25/2026", win.windowLabel);
check("rollup checksum group found with CE col", win.rollup && win.rollup.cols.ce !== undefined);

// ---- Test 2: YTD export fails the shape gate ----------------------
const ytdPath = path.join(__dirname, "..", "..", "vip-marts", "test", "fixtures_ytd_dist_matrix.csv");
try {
  const ytd = parseCsv(fs.readFileSync(ytdPath, "utf8").replace(/^﻿/, ""));
  try {
    VIPW_parseWeeklyWindows_(ytd[0]);
    check("YTD export rejected by shape gate", false, "no error thrown");
  } catch (e) {
    check("YTD export rejected by shape gate", /NOT THE WEEKLY EXPORT/.test(e.message), e.message);
  }
} catch (e) {
  console.log("SKIP: YTD fixture not readable (" + e.message + ")");
}

// ---- Test 3: non-contiguous weeks fail ----------------------------
try {
  const brokenHeader = weekly[0].map(h =>
    String(h).replace(/1 Week 5\/3\/2026 thru 5\/9\/2026/g, "1 Week 5/4/2026 thru 5/10/2026"));
  VIPW_parseWeeklyWindows_(brokenHeader);
  check("contiguity gate fires", false, "no error thrown");
} catch (e) {
  check("contiguity gate fires", /not contiguous|does not span/.test(e.message), e.message);
}

// ---- Fake maps from the real file's tokens ------------------------
const tokens = new Set(), brands = new Set();
weekly.slice(1).forEach(r => {
  if (r[0] && String(r[0]).trim()) tokens.add(String(r[0]).trim());
  if (r[1] && String(r[1]).trim()) brands.add(String(r[1]).trim());
});
console.log("distributor tokens:", tokens.size, "| raw brands:", brands.size);

const distMap = {};
for (const raw of tokens) {
  const cleaned = raw.replace(/,\s*([A-Za-z]{2})\s*$/, " ($1)"); // as the live map spells it
  distMap[VIPW_normToken_(cleaned)] = {
    parent: /Silver Eagle/i.test(raw) ? "Silver Eagle" : /Green Light/i.test(raw) ? "Green Light" : "Dynamo Specialty",
    branch: raw.split(" - ")[1] || null,
    footprint: /Green Light|Central/i.test(raw)
  };
}
const brandMap = {};
for (const raw of brands) brandMap[VIPW_norm_(raw)] = raw; // identity canonical

// ---- Test 4: unmapped gates fail loud -----------------------------
try {
  const gap = { ...distMap };
  delete gap[VIPW_normToken_([...tokens][0])];
  VIPW_computeMartC_(weekly, gap, brandMap);
  check("unmapped-distributor gate fires", false, "no error thrown");
} catch (e) {
  check("unmapped-distributor gate fires", /UNMAPPED DISTRIBUTOR TOKEN/.test(e.message), e.message);
}
try {
  const gap = { ...brandMap };
  delete gap[VIPW_norm_([...brands][0])];
  VIPW_computeMartC_(weekly, distMap, gap);
  check("unmapped-brand gate fires", false, "no error thrown");
} catch (e) {
  check("unmapped-brand gate fires", /UNMAPPED BRAND/.test(e.message), e.message);
}

// ---- Test 5: compute + reconcile on the real export ---------------
const c = VIPW_computeMartC_(weekly, distMap, brandMap);
const nCells = Object.keys(c.cells).length;
console.log("cells:", nCells, "| totalCE:", c.totalCE, "| rawTotalCE:", c.rawTotalCE, "| rollupTotalCE:", c.rollupTotalCE);
check("aggregated matches raw (per-cell rounding tolerance)", Math.abs(c.totalCE - c.rawTotalCE) <= VIPW.RECONCILE_TOL,
  c.totalCE + " vs " + c.rawTotalCE);
check("raw matches VIP's own 13-week rollup (checksum)", Math.abs(c.rawTotalCE - c.rollupTotalCE) <= VIPW.RECONCILE_TOL,
  c.rawTotalCE + " vs " + c.rollupTotalCE);
const weekSum = Object.values(c.weekTotals).reduce((a, b) => a + b, 0);
check("per-week totals sum to raw total", Math.abs(weekSum - c.rawTotalCE) <= 0.001,
  weekSum + " vs " + c.rawTotalCE);
check("plausible cell count (>= 20)", nCells >= 20, String(nCells));

// ---- Test 6: cell semantics ---------------------------------------
const sample = Object.values(c.cells)[0];
check("cell key format brand | parent | segment | iso-week",
  /^.+ \| .+ \| (On-Premise|Off-Premise|Unknown) \| \d{4}-\d{2}-\d{2}$/.test(sample.cell), sample.cell);
check("NA premise maps to Unknown segment",
  Object.values(c.cells).some(x => x.segment === "Unknown"));
check("no all-zero cells created",
  Object.values(c.cells).every(x => x.ce || x.units || x.didBuys || x.effective || x.placements));
check("every cell's Week is inside the window",
  Object.values(c.cells).every(x => x.weekIso >= c.firstWeekIso && x.weekIso <= c.lastWeekIso));
check("branch attribute populated from map", Object.values(c.cells).every(x => typeof x.branch === "string"));

// ---- Test 7: props payload + skip-unchanged round trip ------------
const props = VIPW_martCProps_(sample);
check("props: title carries the cell key", props["Cell"].title[0].text.content === sample.cell);
check("props: Week is a date payload", props["Week"].date.start === sample.weekIso);
const exRow = {
  "CE": sample.ce, "Units": sample.units, "Did Buys": sample.didBuys,
  "Effective": sample.effective, "Placements": sample.placements,
  "Brand": sample.brand, "Distributor (parent)": sample.parent,
  "Segment": sample.segment, "Week": sample.weekIso, "Week label": sample.weekLabel,
  "Branch": sample.branch, "Footprint artifact": sample.footprint
};
check("round-trip equality (skip-unchanged)", VIPW_martCEqual_(sample, exRow));
check("changed CE detected", !VIPW_martCEqual_(sample, { ...exRow, "CE": (sample.ce || 0) + 1 }));

// ---- Test 8: recompute is deterministic (idempotent re-run) -------
const c2 = VIPW_computeMartC_(weekly, distMap, brandMap);
check("recompute deterministic", JSON.stringify(Object.keys(c.cells).sort()) === JSON.stringify(Object.keys(c2.cells).sort())
  && c.totalCE === c2.totalCE);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);

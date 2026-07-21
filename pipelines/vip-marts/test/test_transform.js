// Node harness for the GAS-targeted transforms. Shims the GAS globals,
// loads Config/Shared/Notion/Data/Transform, then exercises the logic
// against the REAL 2026-06-03 VIP exports plus synthetic YTD variants.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---- GAS shims ----------------------------------------------------
global.Logger = { log: (...a) => console.log("[log]", ...a) };
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => ({ VIP_CURRENT_YEAR: "2026", NOTION_API_KEY: "x", DRY_RUN: "" }[k] || null),
    setProperty: () => {}, deleteProperty: () => {}
  })
};
// Minimal CSV parser equivalent to Utilities.parseCsv (handles quotes).
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
global.ScriptApp = {};

// ---- load pipeline sources ---------------------------------------
const SRC = path.join(__dirname, "..", "src");
for (const f of ["Config.gs", "Shared.gs", "Notion.gs", "Data.gs", "Transform.gs"]) {
  eval(fs.readFileSync(path.join(SRC, f), "utf8"));
}

const SP = __dirname;
const matrixText = fs.readFileSync(path.join(SP, "fixtures_dist_matrix.csv"), "utf8").replace(/^﻿/, "");
const detailText = fs.readFileSync(path.join(SP, "fixtures_account_detail.csv"), "utf8").replace(/^﻿/, "");
const matrix = parseCsv(matrixText);
const detail = parseCsv(detailText);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name, extra || ""); }
}

// ---- Test 1: YTD gate fires on the real (13-week trailing) export --
try {
  VM_parseWindows_(matrix[0], 2026);
  check("YTD gate fires on trailing-window export", false, "no error thrown");
} catch (e) {
  check("YTD gate fires on trailing-window export", /NOT A YTD EXPORT/.test(e.message), e.message);
}

// ---- Test 2: year-mismatch gate ----------------------------------
try {
  VM_parseWindows_(matrix[0], 2027);
  check("rollover/year gate fires", false, "no error thrown");
} catch (e) {
  check("rollover/year gate fires", /ROLLOVER\/YEAR MISMATCH/.test(e.message), e.message);
}

// ---- Make YTD variants: rewrite rollup window headers to Jan 1 ----
function toYtdHeader(h) {
  return h
    .replace(/13 Weeks 3\/1\/2026 thru 5\/30\/2026/g, "22 Weeks 1/1/2026 thru 5/30/2026")
    .replace(/13 Weeks 3\/2\/2025 thru 5\/31\/2025/g, "22 Weeks 1/1/2025 thru 5/31/2025");
}
const matrixY = [matrix[0].map(toYtdHeader), ...matrix.slice(1)];
const detailY = [detail[0].map(toYtdHeader), ...detail.slice(1)];

// Fake distributor map from tokens present in the files.
const tokens = new Set();
matrixY.slice(1).forEach(r => r[0] && tokens.add(VM_norm_(r[0])));
detailY.slice(1).forEach(r => r[6] && tokens.add(VM_norm_(r[6])));
const distMap = {};
for (const t of tokens) {
  distMap[t] = {
    parent: /GREEN LIGHT/.test(t) ? "Green Light" : /SILVER EAGLE/.test(t) ? "Silver Eagle" : "Dynamo Specialty",
    branch: null,
    footprint: /GREEN LIGHT|CENTRAL/.test(t)
  };
}
console.log("tokens in files:", tokens.size);

// ---- Test 3: unmapped-token gate ---------------------------------
try {
  const gap = { ...distMap };
  delete gap[[...tokens][0]];
  VM_computeMartA_(matrixY, gap, 2026);
  check("unmapped-token gate fires", false, "no error thrown");
} catch (e) {
  check("unmapped-token gate fires", /UNMAPPED DISTRIBUTOR TOKEN/.test(e.message), e.message);
}

// ---- Test 4: Mart A aggregation reconciles -----------------------
const a = VM_computeMartA_(matrixY, distMap, 2026);
// Independent raw total: sum the current-window CE column directly.
const win = VM_parseWindows_(matrixY[0], 2026);
let rawCE = 0, rawUnits = 0, rawPrior = 0;
for (let r = 1; r < matrixY.length; r++) {
  const row = matrixY[r];
  if (!row || !String(row[0]).trim()) continue;
  rawCE += Number(String(row[win.current.cols.ce]).replace(/,/g, "")) || 0;
  rawUnits += Number(String(row[win.current.cols.units]).replace(/,/g, "")) || 0;
  rawPrior += Number(String(row[win.prior.cols.ce]).replace(/,/g, "")) || 0;
}
const aggCE = Object.values(a.cells).reduce((s, c) => s + c.ce, 0);
const aggUnits = Object.values(a.cells).reduce((s, c) => s + c.units, 0);
const aggPrior = Object.values(a.cells).reduce((s, c) => s + c.priorCE, 0);
check("Mart A CE reconciles to raw", Math.abs(aggCE - rawCE) < 0.01, `agg ${aggCE} raw ${rawCE}`);
check("Mart A Units reconcile to raw", Math.abs(aggUnits - rawUnits) < 0.01, `agg ${aggUnits} raw ${rawUnits}`);
check("Mart A prior CE reconciles to raw", Math.abs(aggPrior - rawPrior) < 0.01, `agg ${aggPrior} raw ${rawPrior}`);
check("Mart A totalCE == rawTotalCE (gate input)", Math.abs(a.totalCE - a.rawTotalCE) < 0.01, `${a.totalCE} vs ${a.rawTotalCE}`);
console.log("Mart A cells:", Object.keys(a.cells).length, "total CE:", a.totalCE);
const sample = Object.values(a.cells)[0];
check("Cell title format", /^.+ \| .+ \| (Off-Premise|On-Premise|Unknown) \| 2026$/.test(sample.cell), sample.cell);
check("YoY delta math", Math.abs(sample.delta - (sample.ce - sample.priorCE)) < 0.001);

// ---- Test 5: Mart B overlay on synthetic existing rows ------------
// Build "existing" Mart B rows from the detail file itself: pretend
// last month's state (older ytd values), plus one vanished account,
// one history-only account, and one Never material account.
function mkExisting(name, address, opts = {}) {
  return {
    __id: "page_" + name, "Account name": name, "Address": address, "City": opts.city || "HOUSTON",
    "account_uid": opts.uid || ("acct_" + VM_md5hex_(VM_norm_(name) + "|" + VM_norm_(address)).slice(0, 8)),
    "CE 2021": opts.h21 ?? null, "CE 2022": opts.h22 ?? null, "CE 2023": opts.h23 ?? null,
    "CE 2024": opts.h24 ?? null, "CE 2025": opts.h25 ?? null,
    "CE 2026 YTD": opts.ytd ?? null, "CE 2025 same-period": opts.sp ?? null,
    "Current YoY delta": opts.delta ?? null, "Trajectory Status": opts.status || null,
    "Peak CE": opts.peak ?? null, "Peak year": opts.peakYear ?? null,
    "First active year": opts.first ?? null, "Last active year": opts.last ?? null,
    "Distributor (parent, last-active)": opts.dist || "Silver Eagle",
    "Class of Trade": "", "Chain": "", "Chain account": false, "Airport cluster": false
  };
}
const existing = [
  // matches first real detail row (SPINDLE TAP BREWERY) with history
  mkExisting("SPINDLE TAP BREWERY", "7800 AIRPORT BLVD HOUF18", { h25: 300, ytd: 100, sp: 100, status: "Steady", peak: 300, peakYear: 2025, first: 2021, last: 2026 }),
  // vanished: not in dump, active last year → should flip to Lapsed 2026
  mkExisting("GONE BAR", "123 NOWHERE ST", { h24: 50, h25: 40, ytd: 12, sp: 20, status: "Declining", peak: 50, peakYear: 2024, first: 2024, last: 2026 }),
  // lapsed-earlier: not in dump, no 2025 → stays Lapsed earlier, no write
  mkExisting("OLD TIMER", "9 PAST LN", { h22: 30, ytd: 0, sp: 0, status: "Lapsed earlier", peak: 30, peakYear: 2022, first: 2022, last: 2023, delta: 0 }),
  // never material: not in dump → preserved
  mkExisting("TINY SPOT", "1 SMALL RD", { h23: 0.5, ytd: 0, sp: 0, status: "Never material", peak: 0.5, peakYear: 2023, first: 2023, last: 2023, delta: 0 })
];
const b = VM_computeMartB_(existing, detailY, distMap, 2026);
console.log("Mart B stats:", JSON.stringify(b.stats));
console.log("updates:", b.updates.length, "creates:", b.creates.length);

check("matched the seeded account", b.stats.matched === 1, b.stats.matched);
const stbUpd = b.updates.find(u => u.pageId === "page_SPINDLE TAP BREWERY");
check("matched account got an update", !!stbUpd);
if (stbUpd) {
  const props = stbUpd.props;
  check("update writes only overlay/derived fields (never history)",
    Object.keys(props).every(k => !/^CE 20(21|22|23|24|25)$/.test(k)), Object.keys(props).join(","));
  // real dump row 1: 13wk CE 176.586664 → ytd; sp 0
  check("ytd overlaid from dump", Math.abs(props["CE 2026 YTD"].number - 176.5867) < 0.001, JSON.stringify(props["CE 2026 YTD"]));
  check("same-period overlaid", props["CE 2025 same-period"].number === 0);
  // ytd 176.59 vs same-period 0 with history → Growing
  check("win-back vs zero same-period → Growing", props["Trajectory Status"].select.name === "Growing");
  check("delta = ytd - sp", Math.abs(props["Current YoY delta"].number - 176.5867) < 0.001);
  check("peak stays 2025 full-year (300 > ytd)", props["Peak CE"] === undefined, JSON.stringify(props["Peak CE"]));
}
const gone = b.updates.find(u => u.pageId === "page_GONE BAR");
check("vanished account flipped to Lapsed 2026", gone && gone.props["Trajectory Status"].select.name === "Lapsed 2026");
check("vanished account ytd zeroed", gone && gone.props["CE 2026 YTD"].number === 0);
const oldt = b.updates.find(u => u.pageId === "page_OLD TIMER");
check("lapsed-earlier untouched (no write)", !oldt);
const tiny = b.updates.find(u => u.pageId === "page_TINY SPOT");
check("never-material untouched (no write)", !tiny);
check("flippedToLapsed count", b.stats.flippedToLapsed === 1, b.stats.flippedToLapsed);

// creates: all other dump accounts are new here
const newCreate = b.creates[0];
check("creates carry minted uid", /^acct_[0-9a-f]{8}$/.test(newCreate.uid), newCreate.uid);
check("creates never write history columns",
  b.creates.every(c => Object.keys(c.props).every(k => !/^CE 20(21|22|23|24|25)$/.test(k))));
check("creates' status consistent with (ytd, same-period)",
  b.creates.every(c => {
    const s = c.props["Trajectory Status"].select.name;
    const ytd = c.props["CE 2026 YTD"].number, sp = c.props["CE 2025 same-period"].number;
    let ok;
    if (sp <= 0 && ytd > 0) ok = s === "New 2026";
    else if (sp > 0 && ytd <= 0) ok = s === "Lapsed 2026";
    else if (sp > 0 && ytd > 0) ok = ["Growing", "Steady", "Declining"].includes(s);
    else ok = false;
    if (!ok) console.log("  violator:", JSON.stringify({ s, ytd, sp, name: c.props["Account name"].title[0].text.content }));
    return ok;
  }));
// accounts in dump with ytd>0 → create count + matched should ≈ dump size
console.log("sample create:", JSON.stringify(newCreate.props).slice(0, 400));

// ---- Test 6: idempotence — re-run overlay with updates applied ----
const applied = existing.map(r => ({ ...r }));
for (const u of b.updates) {
  const row = applied.find(x => x.__id === u.pageId);
  for (const [k, v] of Object.entries(u.props)) {
    row[k] = v.number !== undefined ? v.number : v.select ? v.select.name : v.checkbox !== undefined ? v.checkbox : (v.rich_text ? v.rich_text[0].text.content : null);
  }
}
// add the creates as existing rows
for (const c of b.creates) {
  const row = { __id: "new_" + c.uid };
  for (const [k, v] of Object.entries(c.props)) {
    row[k] = v.number !== undefined ? v.number : v.select ? v.select.name : v.checkbox !== undefined ? v.checkbox : (v.title ? v.title[0].text.content : v.rich_text ? v.rich_text[0].text.content : null);
  }
  applied.push(row);
}
const b2 = VM_computeMartB_(applied, detailY, distMap, 2026);
check("second run is a no-op (idempotent)", b2.updates.length === 0 && b2.creates.length === 0,
  `updates ${b2.updates.length} creates ${b2.creates.length}` +
  (b2.updates[0] ? " first: " + b2.updates[0].pageId + " " + JSON.stringify(b2.updates[0].props).slice(0, 200) : ""));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

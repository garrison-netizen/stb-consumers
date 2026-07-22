// ============================================================
// VIP Mart C weekly — orchestration.
//
// Entry points:
//   vipwVerifySetup()    — editor default: DRY-RUN report, or the
//                          real load when DRY_RUN=0
//   vipwRunNow()         — run the load (resumes if mid-run)
//   vipwDailyCheck()     — trigger target: runs only when a new
//                          export lands in the weekly subfolder
//   vipwSetupTrigger()   — install the daily 6am CT check
//   vipwDryRunReport()   — parse + compute + log, guaranteed no writes
//
// Safety model (ADR-015 + the monthly pipeline's hardening):
//   1. Mart C snapshot to Drive BEFORE any write, EVERY run — weeks
//      older than the trailing 13 roll off VIP's export, so history
//      is unrebuildable from source, same stakes as Mart B.
//   2. Reconcile gates BEFORE any write: aggregated total CE must
//      equal the raw weekly total exactly, and the raw weekly total
//      must match VIP's own 13-week rollup column (checksum).
//   3. ACCUMULATING upsert-by-Cell: only rows whose Week falls
//      inside the current pull's 13-week window are ever touched;
//      in-window strays are archived (VIP restatements), rows
//      before the window are never read, written, or archived.
//   4. DRY_RUN defaults ON (Shared.gs contract).
//   5. Fail loud: any abort emails Garrison with the reason.
// ============================================================

var VIPW_START_MS = Date.now();
var VIPW_TIME_BUDGET_MS = 4.5 * 60 * 1000; // headroom under GAS 6-min cap

function VIPW_timeLeft_() { return VIPW_TIME_BUDGET_MS - (Date.now() - VIPW_START_MS); }

function VIPW_props_() { return PropertiesService.getScriptProperties(); }

function VIPW_getState_() {
  var s = VIPW_props_().getProperty(VIPW.PROP.STATE);
  return s ? JSON.parse(s) : null;
}
function VIPW_setState_(st) { VIPW_props_().setProperty(VIPW.PROP.STATE, JSON.stringify(st)); }
function VIPW_clearState_() { VIPW_props_().deleteProperty(VIPW.PROP.STATE); }

// ---- entry points -------------------------------------------------

// FIRST function on purpose: the GAS editor's default Run target.
function vipwVerifySetup() {
  if (STB_dryRun_()) {
    Logger.log("DRY_RUN is ON — snapshot + no-writes report. Set DRY_RUN=0 for the real load.");
    var ex = VIPW_findExport_();
    VIPW_phaseSnapshot_({ runId: "dryrun-" + ex.runId, log: [] });
    vipwDryRunReport();
  } else {
    Logger.log("DRY_RUN is OFF — running the real load.");
    vipwRunNow();
  }
}

// One-time editor run: reminds about the one secret. There are no
// non-secret properties to seed (no year config — Week dates carry
// the year; the acceptance oracle is optional).
function vipwBootstrapProperties() {
  var p = VIPW_props_();
  Logger.log("DRY_RUN is " + (STB_dryRun_() ? "ON (default)" : "OFF") + ".");
  if (p.getProperty(VIPW.PROP.EXPECTED_CE)) {
    Logger.log(VIPW.PROP.EXPECTED_CE + "=" + p.getProperty(VIPW.PROP.EXPECTED_CE) + " (seed acceptance oracle).");
  }
  if (!p.getProperty("NOTION_API_KEY")) {
    Logger.log("STILL NEEDED: paste NOTION_API_KEY in Project Settings → Script Properties.");
  }
}

function vipwSetupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "vipwDailyCheck") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("vipwDailyCheck").timeBased().everyDays(1).atHour(6).create();
  Logger.log("Daily 6am check installed (vipwDailyCheck).");
}

function VIPW_ensureDailyTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === "vipwDailyCheck";
  });
  if (!exists) vipwSetupTrigger();
}

// Runs from the daily trigger: only proceeds when a new export landed.
function vipwDailyCheck() {
  var ex;
  try {
    ex = VIPW_findExport_();
  } catch (e) {
    Logger.log("Daily check: " + e.message); // no file yet — quiet no-op
    return;
  }
  if (ex.runId === VIPW_props_().getProperty(VIPW.PROP.LAST_RUN)) {
    Logger.log("No new export; nothing to do.");
    return;
  }
  vipwRunNow();
}

// Parse + compute + log with writes structurally impossible.
function vipwDryRunReport() {
  var ex = VIPW_findExport_();
  var c = VIPW_computeMartC_(VIPW_readCsv_(ex.file), VIPW_loadDistMap_(), VIPW_loadBrandMap_());
  Logger.log("MART C: window " + c.windowLabel + " | cells " + Object.keys(c.cells).length +
    " | computed total CE " + c.totalCE + " | raw total CE " + c.rawTotalCE +
    " | VIP 13-week rollup CE " + c.rollupTotalCE);
  c.weeks.forEach(function (w) {
    Logger.log("  week ending " + w.iso + ": CE " + c.weekTotals[w.iso]);
  });
}

function vipwRunNow() {
  var ex = VIPW_findExport_();

  var st = VIPW_getState_();
  if (!st || st.runId !== ex.runId) {
    st = { runId: ex.runId, phase: "SNAPSHOT", tries: 0, log: [] };
    VIPW_setState_(st);
  }
  st.tries++;
  if (st.tries > 8) {
    VIPW_clearState_();
    VIPW_fail_("Mart C weekly run " + st.runId + " exceeded 8 execution attempts — giving up. " +
      "Last phase: " + st.phase + ". Investigate the Apps Script execution log.");
    return;
  }
  VIPW_setState_(st);

  try {
    if (st.phase === "SNAPSHOT") {
      VIPW_phaseSnapshot_(st);
      st.phase = "MART_C"; VIPW_setState_(st);
      if (!VIPW_checkpoint_(st)) return;
    }
    if (st.phase === "MART_C") {
      if (!VIPW_phaseMartC_(st, ex)) { VIPW_continueLater_(); return; }
      st.phase = "REPORT"; VIPW_setState_(st);
    }
    if (st.phase === "REPORT") {
      VIPW_phaseReport_(st);
      VIPW_props_().setProperty(VIPW.PROP.LAST_RUN, st.runId);
      VIPW_clearState_();
      if (!STB_dryRun_()) {
        VIPW_ensureDailyTrigger_();
        // The expected-total oracle is a seed-run acceptance gate;
        // clear it so next week's (different) total isn't rejected.
        if (VIPW_props_().getProperty(VIPW.PROP.EXPECTED_CE)) {
          VIPW_props_().deleteProperty(VIPW.PROP.EXPECTED_CE);
          Logger.log("Acceptance oracle " + VIPW.PROP.EXPECTED_CE + " cleared after successful live run.");
        }
      }
    }
  } catch (e) {
    VIPW_clearState_();
    VIPW_fail_("Mart C weekly run ABORTED in phase " + st.phase + ": " + e.message);
    throw e;
  }
}

function VIPW_checkpoint_(st) {
  if (VIPW_timeLeft_() > 60 * 1000) return true;
  VIPW_continueLater_();
  return false;
}

function VIPW_continueLater_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "vipwContinue") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("vipwContinue").timeBased().after(60 * 1000).create();
  Logger.log("Time budget reached — continuation scheduled in ~1 min.");
}

function vipwContinue() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "vipwContinue") ScriptApp.deleteTrigger(t);
  });
  vipwRunNow();
}

// ---- phases -------------------------------------------------------

// Phase 1 — freeze all of Mart C to a Drive CSV before anything
// writes. Weeks roll off VIP's 13-week export, so accumulated
// history has no source-of-truth backup but this.
function VIPW_phaseSnapshot_(st) {
  var folder = VIPW_weeklyFolder_();
  var subs = folder.getFoldersByName(VIPW.SNAPSHOT_FOLDER_NAME);
  var snapFolder = subs.hasNext() ? subs.next() : folder.createFolder(VIPW.SNAPSHOT_FOLDER_NAME);

  var name = "mart-c-snapshot-" + st.runId + ".csv";
  if (snapFolder.getFilesByName(name).hasNext()) {
    Logger.log("Snapshot already exists for this run — skipping (idempotent re-entry).");
    return;
  }

  var rows = VIPW_queryAll_(VIPW.MART_C_DS, null).map(VIPW_row_);
  if (rows.length === 0) {
    // Legitimate exactly once: the seed run starts from the empty DB.
    if (VIPW_props_().getProperty(VIPW.PROP.LAST_RUN)) {
      throw new Error("Mart C read returned 0 rows but a prior run completed — refusing to proceed " +
        "(snapshot would be empty; the mart may have been damaged).");
    }
    st.log.push("Snapshot: Mart C is empty (seed run) — nothing to freeze.");
    Logger.log(st.log[st.log.length - 1]);
    return;
  }

  var cols = ["__id", "Cell", "Brand", "Distributor (parent)", "Branch", "Segment",
    "Week", "Week label", "CE", "Units", "Did Buys", "Effective", "Placements", "Footprint artifact"];
  var csv = [cols.map(VIPW_csvEsc_).join(",")];
  rows.forEach(function (r) {
    csv.push(cols.map(function (c) { return VIPW_csvEsc_(r[c]); }).join(","));
  });
  snapFolder.createFile(name, csv.join("\r\n"), MimeType.CSV);
  st.log.push("Snapshot: " + rows.length + " Mart C rows frozen to Drive (" + name + ")");
  Logger.log(st.log[st.log.length - 1]);
}

function VIPW_csvEsc_(v) {
  if (v === null || v === undefined) return "";
  var s = String(v);
  if (v === true) s = "TRUE"; if (v === false) s = "FALSE";
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Phase 2 — compute, gate, accumulate-upsert.
// Returns true when complete; false if the time budget ran out
// (skip-unchanged makes re-entry converge).
function VIPW_phaseMartC_(st, ex) {
  var c = VIPW_computeMartC_(VIPW_readCsv_(ex.file), VIPW_loadDistMap_(), VIPW_loadBrandMap_());

  // RECONCILE GATES — all BEFORE any write.
  if (Math.abs(c.totalCE - c.rawTotalCE) > VIPW.RECONCILE_TOL) {
    throw new Error("Mart C reconcile FAILED: aggregated total CE " + c.totalCE +
      " != raw weekly total CE " + c.rawTotalCE + ". Nothing was written.");
  }
  if (Math.abs(c.rawTotalCE - c.rollupTotalCE) > VIPW.RECONCILE_TOL) {
    throw new Error("Mart C checksum FAILED: raw weekly total CE " + c.rawTotalCE +
      " != VIP's own 13-week rollup total " + c.rollupTotalCE +
      " — the export disagrees with itself; re-pull it. Nothing was written.");
  }
  var expected = VIPW_props_().getProperty(VIPW.PROP.EXPECTED_CE);
  var accepted = VIPW_props_().getProperty(VIPW.PROP.LAST_RUN);
  if (expected && !accepted && Math.abs(c.totalCE - Number(expected)) > 0.1) {
    throw new Error("Mart C total CE " + c.totalCE + " does not match " + VIPW.PROP.EXPECTED_CE +
      " = " + expected + " (seed acceptance oracle). Nothing was written.");
  }
  if (Object.keys(c.cells).length < 20) {
    throw new Error("Mart C computed only " + Object.keys(c.cells).length + " cells — implausibly low; aborting.");
  }

  // ACCUMULATING upsert: touch ONLY rows inside the pull's window.
  // Rows with Week before firstWeekIso are history — never queried,
  // never written, never archived.
  var existing = VIPW_queryAll_(VIPW.MART_C_DS, {
    property: "Week", date: { on_or_after: c.firstWeekIso }
  }).map(VIPW_row_);
  var byCell = {};
  existing.forEach(function (r) { byCell[r["Cell"]] = r; });

  var created = 0, updated = 0, unchanged = 0, archived = 0;
  for (var k in c.cells) {
    if (VIPW_timeLeft_() < 45 * 1000) { Logger.log("Mart C paused (time budget)."); return false; }
    var cell = c.cells[k], exRow = byCell[k];
    if (exRow && VIPW_martCEqual_(cell, exRow)) { unchanged++; continue; }
    if (exRow) { VIPW_update_(exRow.__id, VIPW_martCProps_(cell)); updated++; }
    else { VIPW_create_(VIPW.MART_C_DS, VIPW_martCProps_(cell)); created++; }
  }
  // In-window strays = cells VIP restated away (last-write-wins).
  for (var i = 0; i < existing.length; i++) {
    if (VIPW_timeLeft_() < 45 * 1000) { Logger.log("Mart C paused (time budget)."); return false; }
    if (!c.cells[existing[i]["Cell"]]) { VIPW_archive_(existing[i].__id); archived++; }
  }

  st.log.push("Mart C (window " + c.windowLabel + "): total CE " + c.totalCE +
    " across " + Object.keys(c.cells).length + " cells — " +
    created + " created, " + updated + " updated, " + unchanged + " unchanged, " +
    archived + " in-window strays archived.");
  var weekLines = [];
  c.weeks.forEach(function (w) { weekLines.push("  week ending " + w.iso + ": CE " + c.weekTotals[w.iso]); });
  st.log.push("Per-week CE:\n" + weekLines.join("\n"));
  st.martCTotal = c.totalCE;
  Logger.log(st.log[st.log.length - 2]);
  return true;
}

// Phase 3 — report.
function VIPW_phaseReport_(st) {
  var dry = STB_dryRun_();
  var subject = (dry ? "[DRY-RUN] " : "") + "VIP Mart C weekly load complete — run " + st.runId;
  var body = (dry ? "DRY RUN — no Notion writes were performed. Review the log lines, then set DRY_RUN=0 and re-run.\n\n" : "") +
    st.log.join("\n") +
    "\n\nNote: the newest week is usually a partial week at pull time; next week's " +
    "overlapping pull restates it automatically (accumulating last-write-wins).\n" +
    "\n— VIP Mart C weekly pipeline (ADR-015)";
  MailApp.sendEmail(VIPW_emailTo_(), subject, body);
  Logger.log("Report emailed to " + VIPW_emailTo_());
}

function VIPW_fail_(msg) {
  Logger.log("FAIL: " + msg);
  MailApp.sendEmail(VIPW_emailTo_(), "VIP Mart C weekly load FAILED", msg + "\n\n— VIP Mart C weekly pipeline (ADR-015)");
}

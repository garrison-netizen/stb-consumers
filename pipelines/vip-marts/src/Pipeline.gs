// ============================================================
// VIP Marts — orchestration.
//
// Entry points:
//   vipRunNow()        — run the load (resumes if mid-run)
//   vipDailyCheck()    — trigger target: runs only when new exports land
//   vipSetupTrigger()  — install the daily 6am CT check
//   vipRollover()      — January schema promotion (run deliberately)
//   vipDryRunReport()  — parse + compute + log, guaranteed no writes
//
// Safety model (ADR-010 + build hardening):
//   1. Mart B snapshot to Drive BEFORE any write, EVERY run.
//   2. Reconcile gate: Mart A computed total must equal the raw dump
//      total (and VIP_EXPECTED_CE if set) BEFORE any write.
//   3. Upsert-by-key (Cell / account_uid), never blind delete-then-
//      write: preserves page IDs, makes re-entry after a timeout
//      idempotent (unchanged rows are skipped).
//   4. DRY_RUN defaults ON (Shared.gs contract).
//   5. Fail loud: any abort emails Garrison with the reason.
// ============================================================

var VM_START_MS = Date.now();
var VM_TIME_BUDGET_MS = 4.5 * 60 * 1000; // leave headroom under GAS 6-min cap

function VM_timeLeft_() { return VM_TIME_BUDGET_MS - (Date.now() - VM_START_MS); }

function VM_props_() { return PropertiesService.getScriptProperties(); }

function VM_getState_() {
  var s = VM_props_().getProperty(VIP.PROP.STATE);
  return s ? JSON.parse(s) : null;
}
function VM_setState_(st) { VM_props_().setProperty(VIP.PROP.STATE, JSON.stringify(st)); }
function VM_clearState_() { VM_props_().deleteProperty(VIP.PROP.STATE); }

// ---- entry points -------------------------------------------------

// FIRST function in this file on purpose: it's the editor's default
// Run target (the GAS editor function dropdown resists automation, so
// the default must be the right thing to click). Dispatches on the
// DRY_RUN Script Property:
//   DRY_RUN unset/anything but "0"  → vipDryRunReport(): parse +
//     compute + log only, writes structurally impossible.
//   DRY_RUN = "0"                   → vipRunNow(): the real load.
function vipVerifySetup() {
  if (STB_dryRun_()) {
    Logger.log("DRY_RUN is ON — snapshot + no-writes report. Set DRY_RUN=0 for the real load.");
    // Exercise the real snapshot path (a Drive CSV, not a Notion
    // write) so dry mode proves the safety mechanism too.
    var ex = VM_findExports_();
    VM_phaseSnapshot_({ runId: "dryrun-" + ex.runId, log: [] }, VIP_currentYear_());
    vipDryRunReport();
  } else {
    Logger.log("DRY_RUN is OFF — running the real load.");
    vipRunNow();
  }
}

// One-time editor run: seeds the non-secret Script Properties.
// NOTION_API_KEY must be pasted manually in Project Settings →
// Script Properties (never lives in code or git).
function vipBootstrapProperties() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty(VIP.PROP.CURRENT_YEAR)) p.setProperty(VIP.PROP.CURRENT_YEAR, "2026");
  if (!p.getProperty(VIP.PROP.EXPECTED_CE)) p.setProperty(VIP.PROP.EXPECTED_CE, "7243.1");
  Logger.log("Seeded: VIP_CURRENT_YEAR=" + p.getProperty(VIP.PROP.CURRENT_YEAR) +
    ", VIP_EXPECTED_CE=" + p.getProperty(VIP.PROP.EXPECTED_CE) +
    ". DRY_RUN is " + (STB_dryRun_() ? "ON (default)" : "OFF") + ".");
  if (!p.getProperty("NOTION_API_KEY")) {
    Logger.log("STILL NEEDED: paste NOTION_API_KEY in Project Settings → Script Properties.");
  }
}

function vipSetupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "vipDailyCheck") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("vipDailyCheck").timeBased().everyDays(1).atHour(6).create();
  Logger.log("Daily 6am check installed (vipDailyCheck).");
}

// Idempotent: installs the daily check only if absent.
function VM_ensureDailyTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === "vipDailyCheck";
  });
  if (!exists) vipSetupTrigger();
}

// Runs from the daily trigger: only proceeds when BOTH exports are
// newer than the last completed run.
function vipDailyCheck() {
  var ex;
  try {
    ex = VM_findExports_();
  } catch (e) {
    // No export pair in the folder yet — quiet no-op, not a failure.
    Logger.log("Daily check: " + e.message);
    return;
  }
  var last = VM_props_().getProperty(VIP.PROP.LAST_RUN);
  if (ex.runId === last) { Logger.log("No new exports; nothing to do."); return; }
  var ageDiffDays = Math.abs(ex.matrix.getLastUpdated() - ex.detail.getLastUpdated()) / 86400000;
  if (ageDiffDays > 7) {
    VM_fail_("Export pair mismatch: dist-matrix and account-detail files are " +
      Math.round(ageDiffDays) + " days apart — they must come from the same VIP pull. " +
      "Waiting; drop both fresh exports.");
    return;
  }
  vipRunNow();
}

// Parse + compute + log with writes structurally impossible.
function vipDryRunReport() {
  var year = VIP_currentYear_();
  var ex = VM_findExports_();
  var distMap = VM_loadDistMap_();
  var a = VM_computeMartA_(VM_readCsv_(ex.matrix), distMap, year);
  Logger.log("MART A: window " + a.windowLabel + " | cells " + Object.keys(a.cells).length +
    " | computed total CE " + a.totalCE + " | raw total CE " + a.rawTotalCE);
  var existing = VM_queryAll_(VIP.MART_B_DS, null).map(VM_row_);
  var b = VM_computeMartB_(existing, VM_readCsv_(ex.detail), distMap, year);
  Logger.log("MART B: window " + b.windowLabel + " | existing " + existing.length +
    " | updates " + b.updates.length + " | creates " + b.creates.length +
    " | stats " + JSON.stringify(b.stats));
}

function vipRunNow() {
  var year = VIP_currentYear_();
  var ex = VM_findExports_();

  var st = VM_getState_();
  if (!st || st.runId !== ex.runId) {
    st = { runId: ex.runId, phase: "SNAPSHOT", tries: 0, log: [] };
    VM_setState_(st);
  }
  st.tries++;
  if (st.tries > 8) {
    VM_clearState_();
    VM_fail_("VIP marts run " + st.runId + " exceeded 8 execution attempts — giving up. " +
      "Last phase: " + st.phase + ". Investigate the Apps Script execution log.");
    return;
  }
  VM_setState_(st);

  try {
    var distMap = VM_loadDistMap_();

    if (st.phase === "SNAPSHOT") {
      VM_phaseSnapshot_(st, year);
      st.phase = "MART_A"; VM_setState_(st);
      if (!VM_checkpoint_(st)) return;
    }
    if (st.phase === "MART_A") {
      if (!VM_phaseMartA_(st, distMap, year, ex)) { VM_continueLater_(); return; }
      st.phase = "MART_B"; VM_setState_(st);
      if (!VM_checkpoint_(st)) return;
    }
    if (st.phase === "MART_B") {
      var done = VM_phaseMartB_(st, distMap, year, ex);
      if (!done) { VM_continueLater_(); return; }
      st.phase = "REPORT"; VM_setState_(st);
    }
    if (st.phase === "REPORT") {
      VM_phaseReport_(st);
      VM_props_().setProperty(VIP.PROP.LAST_RUN, st.runId);
      VM_clearState_();
      // A successful live run ensures its own daily check exists —
      // no separate trigger-installation step to remember.
      if (!STB_dryRun_()) VM_ensureDailyTrigger_();
    }
  } catch (e) {
    VM_clearState_();
    VM_fail_("VIP marts run ABORTED in phase " + st.phase + ": " + e.message);
    throw e;
  }
}

// If time is short, schedule a continuation and stop cleanly.
function VM_checkpoint_(st) {
  if (VM_timeLeft_() > 60 * 1000) return true;
  VM_continueLater_();
  return false;
}

function VM_continueLater_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "vipContinue") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("vipContinue").timeBased().after(60 * 1000).create();
  Logger.log("Time budget reached — continuation scheduled in ~1 min.");
}

function vipContinue() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "vipContinue") ScriptApp.deleteTrigger(t);
  });
  vipRunNow();
}

// ---- phases -------------------------------------------------------

// Phase 1 — freeze Mart B to a Drive CSV before anything writes.
// Runs EVERY run (not just bootstrap): Mart B history is
// unrebuildable, so every overlay gets a pre-write snapshot.
function VM_phaseSnapshot_(st, year) {
  var folder = DriveApp.getFolderById(VIP.FOLDER_ID);
  var subs = folder.getFoldersByName(VIP.SNAPSHOT_FOLDER_NAME);
  var snapFolder = subs.hasNext() ? subs.next() : folder.createFolder(VIP.SNAPSHOT_FOLDER_NAME);

  var name = "mart-b-snapshot-" + st.runId + ".csv";
  if (snapFolder.getFilesByName(name).hasNext()) {
    Logger.log("Snapshot already exists for this run — skipping (idempotent re-entry).");
    return;
  }

  var rows = VM_queryAll_(VIP.MART_B_DS, null).map(VM_row_);
  if (rows.length === 0) throw new Error("Mart B read returned 0 rows — refusing to proceed (snapshot would be empty).");

  var cols = ["__id", "account_uid", "Account name", "Address", "City", "Class of Trade", "Chain",
    "Chain account", "Airport cluster", "Distributor (parent, last-active)"];
  for (var y = VIP.FIRST_HISTORY_YEAR; y < year; y++) cols.push(VIP_colHistory_(y));
  cols.push(VIP_colYtd_(year), VIP_colSamePeriod_(year), "Current YoY delta", "Trajectory Status",
    "Peak CE", "Peak year", "First active year", "Last active year");

  var csv = [cols.map(VM_csvEsc_).join(",")];
  rows.forEach(function (r) {
    csv.push(cols.map(function (c) { return VM_csvEsc_(r[c]); }).join(","));
  });
  snapFolder.createFile(name, csv.join("\r\n"), MimeType.CSV);
  st.log.push("Snapshot: " + rows.length + " Mart B rows frozen to Drive (" + name + ")");
  Logger.log(st.log[st.log.length - 1]);
}

function VM_csvEsc_(v) {
  if (v === null || v === undefined) return "";
  var s = String(v);
  if (v === true) s = "TRUE"; if (v === false) s = "FALSE";
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Phase 2 — Mart A recompute + reconcile gate + upsert.
function VM_phaseMartA_(st, distMap, year, ex) {
  var a = VM_computeMartA_(VM_readCsv_(ex.matrix), distMap, year);

  // PAIR GATE — both exports must cover the same current-year window
  // (same VIP pull), else the two marts would disagree on "as of".
  // Checked here, BEFORE any write to either mart.
  var detailWin = VM_parseWindows_(VM_readCsv_(ex.detail)[0], year);
  if (detailWin.current.label !== a.windowLabel) {
    throw new Error("Export window mismatch: dist-matrix covers " + a.windowLabel +
      " but account-detail covers " + detailWin.current.label +
      " — re-pull both exports together. Nothing was written.");
  }

  // RECONCILE GATE — abort BEFORE any write.
  if (Math.abs(a.totalCE - a.rawTotalCE) > 0.05) {
    throw new Error("Mart A reconcile FAILED: aggregated total CE " + a.totalCE +
      " != raw dump total CE " + a.rawTotalCE + ". Nothing was written.");
  }
  var expected = VM_props_().getProperty(VIP.PROP.EXPECTED_CE);
  if (expected && Math.abs(a.totalCE - Number(expected)) > 0.1) {
    throw new Error("Mart A total CE " + a.totalCE + " does not match " + VIP.PROP.EXPECTED_CE +
      " = " + expected + " (acceptance oracle). Nothing was written.");
  }
  if (Object.keys(a.cells).length < 10) {
    throw new Error("Mart A computed only " + Object.keys(a.cells).length + " cells — implausibly low; aborting.");
  }

  // Upsert current-year rows keyed by Cell title; archive strays.
  var existing = VM_queryAll_(VIP.MART_A_DS, {
    property: "Year", number: { equals: year }
  }).map(VM_row_);
  var byCell = {};
  existing.forEach(function (r) { byCell[r["Cell"]] = r; });

  // Skip-unchanged makes this loop idempotent, so a timeout pause +
  // re-entry converges instead of duplicating work.
  var created = 0, updated = 0, unchanged = 0, archived = 0;
  for (var k in a.cells) {
    if (VM_timeLeft_() < 45 * 1000) { Logger.log("Mart A paused (time budget)."); return false; }
    var c = a.cells[k], exRow = byCell[k];
    if (exRow && VM_martAEqual_(c, exRow)) { unchanged++; continue; }
    if (exRow) { VM_update_(exRow.__id, VM_martAProps_(c)); updated++; }
    else { VM_create_(VIP.MART_A_DS, VM_martAProps_(c)); created++; }
  }
  for (var i = 0; i < existing.length; i++) {
    if (VM_timeLeft_() < 45 * 1000) { Logger.log("Mart A paused (time budget)."); return false; }
    if (!a.cells[existing[i]["Cell"]]) { VM_archive_(existing[i].__id); archived++; }
  }

  st.log.push("Mart A: total CE " + a.totalCE + " (window " + a.windowLabel + ") — " +
    created + " created, " + updated + " updated, " + unchanged + " unchanged, " + archived + " archived.");
  st.martATotal = a.totalCE;
  st.martAWindow = a.windowLabel;
  Logger.log(st.log[st.log.length - 1]);
  return true;
}

// Phase 3 — Mart B overlay. Returns true when complete; false if the
// time budget ran out mid-write (unwritten rows recompute as still-
// changed on re-entry, so re-running converges).
function VM_phaseMartB_(st, distMap, year, ex) {
  var existing = VM_queryAll_(VIP.MART_B_DS, null).map(VM_row_);
  var b = VM_computeMartB_(existing, VM_readCsv_(ex.detail), distMap, year);

  if (b.dupKeys.length) {
    throw new Error("Mart B has duplicate identity keys (name|address): " +
      b.dupKeys.slice(0, 5).join(" ; ") + (b.dupKeys.length > 5 ? " …" : "") +
      " — resolve duplicates before overlay (overlay would be ambiguous). Nothing was written.");
  }

  var total = b.updates.length + b.creates.length;
  var written = 0;
  for (var i = 0; i < b.updates.length; i++) {
    if (VM_timeLeft_() < 45 * 1000) { Logger.log("Mart B paused after " + written + "/" + total + " writes."); return false; }
    VM_update_(b.updates[i].pageId, b.updates[i].props);
    written++;
  }
  for (var j = 0; j < b.creates.length; j++) {
    if (VM_timeLeft_() < 45 * 1000) { Logger.log("Mart B paused after " + written + "/" + total + " writes."); return false; }
    VM_create_(VIP.MART_B_DS, b.creates[j].props);
    written++;
  }

  var s = b.stats;
  st.log.push("Mart B (window " + b.windowLabel + "): " + s.matched + " matched, " +
    b.creates.length + " new accounts, " + b.updates.length + " rows updated, " +
    s.unchanged + " unchanged, " + s.flippedToLapsed + " flipped to Lapsed.");
  st.log.push("Mart B trajectory buckets: New " + s.newAccts + ", Growing " + s.growing +
    ", Steady " + s.steady + ", Declining " + s.declining +
    ", Lapsed " + (s.lapsedNow + s.lapsedEarlier) + " (this yr " + s.lapsedNow +
    " / earlier " + s.lapsedEarlier + "), Never material " + s.neverMaterial + ".");
  st.log.forEach(function (l) { Logger.log(l); });
  return true;
}

// Phase 4 — report.
function VM_phaseReport_(st) {
  var dry = STB_dryRun_();
  var subject = (dry ? "[DRY-RUN] " : "") + "VIP marts load complete — run " + st.runId;
  var body = (dry ? "DRY RUN — no Notion writes were performed. Review the log lines, then set DRY_RUN=0 and re-run.\n\n" : "") +
    st.log.join("\n") +
    "\n\nAcceptance oracle (2026 cycle, from Architect):\n" +
    "  Mart A total CE (Jan–Jun 2026) = 7,243.1\n" +
    "  Mart B buckets: New 273, Growing 165, Steady 70, Declining 279, Lapsed 541, Never material 5\n" +
    "\n— VIP Marts pipeline (ADR-010)";
  MailApp.sendEmail(VIP_emailTo_(), subject, body);
  Logger.log("Report emailed to " + VIP_emailTo_());
}

function VM_fail_(msg) {
  Logger.log("FAIL: " + msg);
  MailApp.sendEmail(VIP_emailTo_(), "VIP marts load FAILED", msg + "\n\n— VIP Marts pipeline (ADR-010)");
}

// ---- January rollover (ADR-010 §6) -------------------------------
//
// Run DELIBERATELY once per new year, honoring DRY_RUN:
//   1. Freezes a snapshot of Mart B.
//   2. Promotes "CE {Y} YTD" → locked history column "CE {Y}".
//   3. Creates fresh "CE {Y+1} YTD" and renames the same-period
//      column to "CE {Y} same-period".
//   4. Adds "New {Y+1}" / "Lapsed {Y+1}" Trajectory Status options.
//   5. Bumps VIP_CURRENT_YEAR. The next data run reclassifies rows.
// Mart A needs no rollover (Year is a row dimension).
function vipRollover() {
  var year = VIP_currentYear_();
  var next = year + 1;

  // Snapshot first — same rule as every write.
  var st = { runId: "rollover-" + year + "-to-" + next, log: [], tries: 0 };
  VM_phaseSnapshot_(st, year);

  // >>VALIDATE<< schema-PATCH payload shape against the live API on a
  // DRY-RUN before the first real January rollover (same discipline as
  // Shared.gs write-path validation).
  var schema = {};
  // Promote "CE {Y} YTD" → locked "CE {Y}"; retitle the same-period
  // column for the new comparison year (its stale values are
  // overwritten by the first data run of the new year).
  schema[VIP_colYtd_(year)] = { name: VIP_colHistory_(year) };
  schema[VIP_colSamePeriod_(year)] = { name: VIP_colSamePeriod_(next) };
  VM_patchDataSource_(VIP.MART_B_DS, { properties: schema });

  var add = {};
  add[VIP_colYtd_(next)] = { type: "number", number: {} };
  VM_patchDataSource_(VIP.MART_B_DS, { properties: add });

  // New year's select options are created implicitly on first write
  // (Notion adds unknown select option names automatically).

  if (!STB_dryRun_()) {
    VM_props_().setProperty(VIP.PROP.CURRENT_YEAR, String(next));
  }
  var msg = "Rollover " + year + " → " + next + " " + (STB_dryRun_() ? "(DRY-RUN, nothing changed)" : "complete") +
    ":\n- " + VIP_colYtd_(year) + " promoted to " + VIP_colHistory_(year) +
    "\n- same-period column retitled to " + VIP_colSamePeriod_(next) +
    "\n- " + VIP_colYtd_(next) + " created" +
    "\n- VIP_CURRENT_YEAR " + (STB_dryRun_() ? "would be" : "") + " set to " + next +
    "\n\nNext monthly run loads " + next + " data normally.";
  Logger.log(msg);
  MailApp.sendEmail(VIP_emailTo_(), "VIP Mart B year rollover " + (STB_dryRun_() ? "[DRY-RUN]" : "done"), msg);
}

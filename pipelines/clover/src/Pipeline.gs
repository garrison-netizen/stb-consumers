// ============================================================
// Clover → STB Notion pipeline. Entry points:
//
//   cloverSync()      — yesterday's data (normal daily trigger)
//   cloverBackfill()  — Clover era: 2025-05-01 to today
//
// DRY_RUN defaults ON — set Script Property DRY_RUN=0 when ready
// for live writes (same pattern as Weekly Pulse v6.3 / Mailchimp).
//
// Script Properties required:
//   CLOVER_API_TOKEN    — from Clover developer dashboard
//   CLOVER_MERCHANT_ID  — your merchant ID
//   NOTION_API_KEY      — same token used by other pipelines
//   DRY_RUN             — "0" to enable writes (default ON)
//   BACKFILL_START      — override for cloverBackfill() (optional)
//   BACKFILL_END        — override for cloverBackfill() (optional)
// ============================================================

function cloverSync() {
  // "Yesterday" in Houston local time, not UTC. The range starts at the
  // week's Monday (not just yesterday) so SKU-week rows are recomputed
  // with full week-to-date data — see the update-or-create in the SKU
  // section of CLV_runRange_.
  var yest = CLV_yesterdayLocal_();
  CLV_runRange_(CLV_weekStart_(yest), yest);
}

function cloverBackfill() {
  var props = PropertiesService.getScriptProperties();
  var start = props.getProperty("BACKFILL_START") || "2025-05-01";
  // Default end = Houston YESTERDAY. A run that includes today writes a
  // partial daily row that idempotency would then freeze forever.
  var end   = props.getProperty("BACKFILL_END")   || CLV_yesterdayLocal_();
  Logger.log("[CLV] Backfill " + start + " → " + end);
  CLV_runRange_(start, end);
}

// Self-chaining backfill: processes ONE month per execution, saves its
// cursor, and schedules its own next run 30s out via a one-shot trigger.
// Editor-started long runs proved fragile (canceled by code deploys and
// browser-session churn, 2026-07-22); trigger-run chunks are fully
// server-side and each finishes in minutes. Run cloverBackfillAuto()
// once to start; watch progress in the Executions panel.
// To abort a chain: delete the BACKFILL_CURSOR Script Property, then
// delete any pending cloverBackfillAuto trigger in the Triggers panel.
function cloverBackfillAuto() {
  // Clear this handler's spent/pending one-shot triggers so they never pile up.
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "cloverBackfillAuto") ScriptApp.deleteTrigger(t);
  });

  var props    = PropertiesService.getScriptProperties();
  var start    = props.getProperty("BACKFILL_CURSOR") ||
                 props.getProperty("BACKFILL_START") || "2025-05-01";
  var finalEnd = props.getProperty("BACKFILL_END") || CLV_yesterdayLocal_();
  if (start > finalEnd) {
    props.deleteProperty("BACKFILL_CURSOR");
    Logger.log("[CLV] Backfill chain COMPLETE (cursor " + start + " past end " + finalEnd + ")");
    return;
  }

  var chunkEnd = CLV_monthEndISO_(start);
  if (chunkEnd > finalEnd) chunkEnd = finalEnd;
  Logger.log("[CLV] Backfill chunk " + start + " → " + chunkEnd + " (chain end " + finalEnd + ")");
  CLV_runRange_(start, chunkEnd);

  var next = CLV_addDaysISO_(chunkEnd, 1);
  if (next <= finalEnd) {
    props.setProperty("BACKFILL_CURSOR", next);
    ScriptApp.newTrigger("cloverBackfillAuto").timeBased().after(30 * 1000).create();
    Logger.log("[CLV] Next chunk (" + next + " →) scheduled in ~30s");
  } else {
    props.deleteProperty("BACKFILL_CURSOR");
    Logger.log("[CLV] Backfill chain COMPLETE through " + chunkEnd);
  }
}

// Payments-based history rebuild for the window where Clover purged order
// records (pre 2026-03-01). Self-chaining like cloverBackfillAuto: one
// month per execution, cursor in PAYFILL_CURSOR, re-triggers itself.
// Writes Taproom Daily ONLY (SKU detail lived on the purged orders and is
// not recoverable via API). Hard-stops before 2026-03-01 — order-based
// rows own everything from there.
function cloverPaymentsBackfillAuto() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "cloverPaymentsBackfillAuto") ScriptApp.deleteTrigger(t);
  });

  // Extended from 2026-02-28 on 2026-07-22: Clover's dashboard Sales
  // Reports proved the ORDER purge bleeds into March-April 2026 (March had
  // 1,181 orders; the orders API served fragments). Order data is solid
  // from May 2026; payments rebuild owns everything through April.
  var HARD_END = "2026-04-30";
  var props    = PropertiesService.getScriptProperties();
  var start    = props.getProperty("PAYFILL_CURSOR") ||
                 props.getProperty("PAYFILL_START") || "2025-04-01";
  var finalEnd = props.getProperty("PAYFILL_END") || HARD_END;
  if (finalEnd > HARD_END) finalEnd = HARD_END;
  if (start > finalEnd) {
    props.deleteProperty("PAYFILL_CURSOR");
    Logger.log("[CLV] Payments backfill chain COMPLETE");
    return;
  }

  var chunkEnd = CLV_monthEndISO_(start);
  if (chunkEnd > finalEnd) chunkEnd = finalEnd;
  var dry = STB_dryRun_();
  Logger.log("[CLV] Payments backfill chunk " + start + " → " + chunkEnd + " dry=" + dry);

  var payments  = CLV_fetchPayments_(start, chunkEnd);
  var tenderMap = CLV_fetchTenderMap_();
  var aggs      = CLV_aggregateDailyFromPayments_(payments, tenderMap);
  var s = { created: 0, skipped: 0, err: 0 };
  Object.keys(aggs).forEach(function(dateISO) {
    if (dateISO < start || dateISO > chunkEnd) return;   // ±12h fetch spill
    if (aggs[dateISO].grossRev === 0) return;
    try {
      var id = STB_notionFindOne_(CLOVER.DAILY_DS, CLV_dailyFilter_(dateISO));
      if (id) { s.skipped++; return; }
      STB_notionCreate_(CLOVER.DAILY_DS, CLV_dailyProps_(dateISO, aggs[dateISO]));
      s.created++;
    } catch(e) {
      Logger.log("[CLV payfill ERR] " + dateISO + ": " + e.message);
      s.err++;
    }
  });
  Logger.log("[CLV] payments=" + payments.length + " | daily=" + s.created +
             " created/" + s.skipped + " skip | errors=" + s.err);

  var next = CLV_addDaysISO_(chunkEnd, 1);
  if (next <= finalEnd) {
    props.setProperty("PAYFILL_CURSOR", next);
    ScriptApp.newTrigger("cloverPaymentsBackfillAuto").timeBased().after(30 * 1000).create();
    Logger.log("[CLV] Next chunk (" + next + " →) scheduled in ~30s");
  } else {
    props.deleteProperty("PAYFILL_CURSOR");
    Logger.log("[CLV] Payments backfill chain COMPLETE through " + chunkEnd);
  }
}

// TEMPORARY diagnostic (2026-07-22): the dashboard shows June-2025 sales
// but /orders returns nothing before 2026-03-01. Asks Clover for its
// oldest orders directly, three different ways, and logs what comes back.
function cloverProbe2025() {
  var mId  = CLOVER_merchantId_();
  var base = CLOVER.API_BASE + "/v3/merchants/" + mId;

  // A: oldest orders on this merchant, no time filter at all
  var respA = UrlFetchApp.fetch(base + "/orders?limit=5&orderBy=createdTime%20ASC",
    { method: "GET", headers: CLV_headers_(), muteHttpExceptions: true });
  Logger.log("[PROBE A] oldest orders (orderBy ASC): HTTP " + respA.getResponseCode());
  try {
    (JSON.parse(respA.getContentText()).elements || []).forEach(function(o) {
      Logger.log("  id=" + o.id + " createdTime=" + o.createdTime +
                 " (" + (o.createdTime ? new Date(o.createdTime).toISOString() : "null") + ")" +
                 " total=" + o.total + " state=" + o.state);
    });
  } catch(e) { Logger.log("  parse: " + respA.getContentText().substring(0, 300)); }

  // B: a known-good June 2025 week, same filter style the pipeline uses
  var s = new Date("2025-06-02T00:00:00Z").getTime();
  var e = new Date("2025-06-09T00:00:00Z").getTime();
  var respB = UrlFetchApp.fetch(base + "/orders?limit=5&filter=createdTime%3E%3D" + s +
    "&filter=createdTime%3C%3D" + e,
    { method: "GET", headers: CLV_headers_(), muteHttpExceptions: true });
  Logger.log("[PROBE B] June 2025 week, pipeline-style filter: HTTP " + respB.getResponseCode());
  try {
    var elB = JSON.parse(respB.getContentText()).elements || [];
    Logger.log("  count=" + elB.length +
               (elB.length ? " first createdTime=" + new Date(elB[0].createdTime).toISOString() : ""));
  } catch(e2) { Logger.log("  parse: " + respB.getContentText().substring(0, 300)); }

  // C: payments endpoint for the same week (different record type, in case
  // order retention differs from payment retention)
  var respC = UrlFetchApp.fetch(base + "/payments?limit=5&filter=createdTime%3E%3D" + s +
    "&filter=createdTime%3C%3D" + e,
    { method: "GET", headers: CLV_headers_(), muteHttpExceptions: true });
  Logger.log("[PROBE C] June 2025 payments: HTTP " + respC.getResponseCode());
  try {
    var elC = JSON.parse(respC.getContentText()).elements || [];
    Logger.log("  count=" + elC.length +
               (elC.length ? " first createdTime=" + new Date(elC[0].createdTime).toISOString() : ""));
  } catch(e3) { Logger.log("  parse: " + respC.getContentText().substring(0, 300)); }
}

// Last day of the month containing the given YYYY-MM-DD.
function CLV_monthEndISO_(iso) {
  var d = new Date(iso.substring(0, 7) + "-01T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().substring(0, 10);
}

function CLV_addDaysISO_(iso, n) {
  var d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().substring(0, 10);
}

function CLV_yesterdayLocal_() {
  return Utilities.formatDate(new Date(Date.now() - 86400000), "America/Chicago", "yyyy-MM-dd");
}

function CLV_runRange_(startISO, endISO) {
  var dry  = STB_dryRun_();
  var yest = CLV_yesterdayLocal_();

  // Never process today: the day is still open and idempotency would
  // freeze a partial daily row permanently.
  if (endISO > yest) endISO = yest;
  if (startISO > endISO) { Logger.log("[CLV] nothing to do (range is all today/future)"); return; }

  // SKU-week rows must always be computed from FULL week windows (clamped
  // to yesterday), or a range boundary mid-week would write a partial week
  // that a later update-or-create couldn't distinguish from a complete one.
  var skuStart = CLV_weekStart_(startISO);
  var skuEnd   = CLV_weekEnd_(endISO);
  if (skuEnd > yest) skuEnd = yest;

  Logger.log("[CLV] range=" + startISO + ".." + endISO +
             " skuRange=" + skuStart + ".." + skuEnd + " dry=" + dry);

  // --- Fetch (one fetch covers the wider SKU window) ---
  var orders    = CLV_fetchOrders_(skuStart, skuEnd);
  var itemMap   = CLV_fetchItemMap_();
  var shifts    = CLV_fetchShifts_(startISO, endISO);
  var tenderMap = CLV_fetchTenderMap_();

  // The fetch window is widened ±12h for timezone coverage; trim each
  // record to the exact Houston-local date ranges here.
  var dailyOrders = [];
  var skuOrders   = [];
  orders.forEach(function(o) {
    if (!o.createdTime) return;
    var d = CLV_dateISO_(o.createdTime);
    if (d >= skuStart  && d <= skuEnd) skuOrders.push(o);
    if (d >= startISO  && d <= endISO) dailyOrders.push(o);
  });
  shifts = shifts.filter(function(sh) {
    if (!sh.inTime) return false;
    var d = CLV_dateISO_(sh.inTime);
    return d >= startISO && d <= endISO;
  });
  Logger.log("[CLV] orders=" + dailyOrders.length + " (sku window " + skuOrders.length + ")" +
             " shifts=" + shifts.length +
             " itemMap=" + Object.keys(itemMap).length +
             " tenders=" + Object.keys(tenderMap).length);

  // --- Aggregate ---
  var dailyAggs = CLV_aggregateDaily_(dailyOrders, tenderMap);
  var skuAggs   = CLV_aggregateSkuWeek_(skuOrders, itemMap);
  var laborAggs = CLV_aggregateLabor_(shifts);

  var s = { dc: 0, ds: 0, sc: 0, su: 0, lc: 0, ls: 0, err: 0 };

  // --- Taproom Daily ---
  Object.keys(dailyAggs).forEach(function(dateISO) {
    try {
      // Refund-only / test-ring days aggregate to $0 even after the
      // paid-order filter ($0-amount payments). No revenue, no row.
      if (dailyAggs[dateISO].grossRev === 0) return;
      var id = STB_notionFindOne_(CLOVER.DAILY_DS, CLV_dailyFilter_(dateISO));
      if (id) { s.ds++; return; } // idempotent: daily totals don't change after close
      STB_notionCreate_(CLOVER.DAILY_DS, CLV_dailyProps_(dateISO, dailyAggs[dateISO]));
      s.dc++;
    } catch(e) {
      Logger.log("[CLV daily ERR] " + dateISO + ": " + e.message);
      s.err++;
    }
  });

  // --- Taproom SKU by Week (update-or-create) ---
  // Existing rows are UPDATED, not skipped: the daily sync recomputes the
  // live week every morning, so a week row grows until its week closes.
  // Values are always full-window recomputes (skuStart..skuEnd), so the
  // update is idempotent for completed weeks.
  Object.keys(skuAggs).forEach(function(key) {
    try {
      var props = CLV_skuWeekProps_(key, skuAggs[key]);
      var id = STB_notionFindOne_(CLOVER.SKU_WEEK_DS, CLV_skuWeekFilter_(key));
      if (id) { STB_notionUpdate_(id, props); s.su++; }
      else    { STB_notionCreate_(CLOVER.SKU_WEEK_DS, props); s.sc++; }
    } catch(e) {
      Logger.log("[CLV sku ERR] " + key + ": " + e.message);
      s.err++;
    }
  });

  // --- Taproom Labor Daily ---
  Object.keys(laborAggs).forEach(function(dateISO) {
    try {
      var id = STB_notionFindOne_(CLOVER.LABOR_DS, CLV_laborFilter_(dateISO));
      if (id) { s.ls++; return; }
      STB_notionCreate_(CLOVER.LABOR_DS, CLV_laborProps_(dateISO, laborAggs[dateISO]));
      s.lc++;
    } catch(e) {
      Logger.log("[CLV labor ERR] " + dateISO + ": " + e.message);
      s.err++;
    }
  });

  Logger.log("[CLV] daily=" + s.dc + " created/" + s.ds + " skip" +
             " | sku=" + s.sc + " created/" + s.su + " updated" +
             " | labor=" + s.lc + "/" + s.ls +
             " | errors=" + s.err);
}

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
  // "Yesterday" in Houston local time, not UTC.
  var iso = Utilities.formatDate(new Date(Date.now() - 86400000), "America/Chicago", "yyyy-MM-dd");
  CLV_runRange_(iso, iso);
}

function cloverBackfill() {
  var props = PropertiesService.getScriptProperties();
  var start = props.getProperty("BACKFILL_START") || "2025-05-01";
  var end   = props.getProperty("BACKFILL_END")   || new Date().toISOString().substring(0, 10);
  Logger.log("[CLV] Backfill " + start + " → " + end);
  CLV_runRange_(start, end);
}

function CLV_runRange_(startISO, endISO) {
  var dry = STB_dryRun_();
  Logger.log("[CLV] range=" + startISO + ".." + endISO + " dry=" + dry);

  // --- Fetch ---
  var orders    = CLV_fetchOrders_(startISO, endISO);
  var itemMap   = CLV_fetchItemMap_();
  var shifts    = CLV_fetchShifts_(startISO, endISO);
  var tenderMap = CLV_fetchTenderMap_();

  // The fetch window is widened ±12h for timezone coverage; trim each
  // record to the exact Houston-local date range here.
  orders = orders.filter(function(o) {
    if (!o.createdTime) return false;
    var d = CLV_dateISO_(o.createdTime);
    return d >= startISO && d <= endISO;
  });
  shifts = shifts.filter(function(sh) {
    if (!sh.inTime) return false;
    var d = CLV_dateISO_(sh.inTime);
    return d >= startISO && d <= endISO;
  });
  Logger.log("[CLV] orders=" + orders.length + " shifts=" + shifts.length +
             " itemMap=" + Object.keys(itemMap).length +
             " tenders=" + Object.keys(tenderMap).length);

  // --- Aggregate ---
  var dailyAggs = CLV_aggregateDaily_(orders, tenderMap);
  var skuAggs   = CLV_aggregateSkuWeek_(orders, itemMap);
  var laborAggs = CLV_aggregateLabor_(shifts);

  var s = { dc: 0, ds: 0, sc: 0, ss: 0, lc: 0, ls: 0, err: 0 };

  // --- Taproom Daily ---
  Object.keys(dailyAggs).forEach(function(dateISO) {
    try {
      var id = STB_notionFindOne_(CLOVER.DAILY_DS, CLV_dailyFilter_(dateISO));
      if (id) { s.ds++; return; } // idempotent: daily totals don't change after close
      STB_notionCreate_(CLOVER.DAILY_DS, CLV_dailyProps_(dateISO, dailyAggs[dateISO]));
      s.dc++;
    } catch(e) {
      Logger.log("[CLV daily ERR] " + dateISO + ": " + e.message);
      s.err++;
    }
  });

  // --- Taproom SKU by Week ---
  Object.keys(skuAggs).forEach(function(key) {
    try {
      var id = STB_notionFindOne_(CLOVER.SKU_WEEK_DS, CLV_skuWeekFilter_(key));
      if (id) { s.ss++; return; }
      STB_notionCreate_(CLOVER.SKU_WEEK_DS, CLV_skuWeekProps_(key, skuAggs[key]));
      s.sc++;
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
             " | sku=" + s.sc + "/" + s.ss +
             " | labor=" + s.lc + "/" + s.ls +
             " | errors=" + s.err);
}

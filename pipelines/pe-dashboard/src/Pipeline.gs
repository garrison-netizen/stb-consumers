// ============================================================
// PE Dashboard pipeline — orchestrator + trigger. Entry points:
//
//   peDashboardRefresh()       — full run (the daily trigger target)
//   peDashboardCheckConfig()   — logs effective config, no I/O beyond props
//   testPeDashboardDryRun()    — forces DRY_RUN, computes + logs, no writes
//
// DRY_RUN defaults ON (Shared.gs discipline) — a dry run reads the
// source databases, computes every metric, logs a summary and the
// would-be block count, and never touches the target page.
//
// Script Properties required:
//   NOTION_API_KEY        — same integration token as the other pipelines
//   PE_DASHBOARD_PAGE_ID  — the Notion page this pipeline owns and rewrites
//   DRY_RUN               — "0" to enable writes (default ON)
// ============================================================

function peDashboardRefresh() {
  var dry = STB_dryRun_();
  Logger.log("[PED] run start dry=" + dry);
  STB_notionKey_();                       // fail fast on missing key
  if (!dry) PED_pageId_();                // fail fast on missing page id

  var sourceNames = PED_loadSourceNames_();
  var leads    = PED_loadLeads_(sourceNames);
  var bookings = PED_loadBookings_();
  Logger.log("[PED] loaded leads=" + leads.length + " bookings=" + bookings.length +
             " sources=" + Object.keys(sourceNames).length);

  var model = PED_metrics_(leads, bookings);
  var k = model.kpis;
  Logger.log("[PED] YTD " + PED_money_(k.ytdRevenue) + " (" + k.ytdEvents + " events)" +
             " | LY-to-date " + PED_money_(k.ytdLastYear) +
             " | next30 " + k.next30Count + " ev / " + PED_money_(k.next30Revenue) +
             " | open leads " + k.openLeads +
             " | attention: " + model.attention.unpaidBalances.length + " unpaid balances, " +
             model.attention.unpaidDeposits.length + " missing deposits, " +
             model.attention.staleLeads.length + " stale leads");

  if (dry) {
    var blocks = PED_render_(model);
    Logger.log("[PED] DRY-RUN — would write " + blocks.length + " blocks to page " +
      (PropertiesService.getScriptProperties().getProperty("PE_DASHBOARD_PAGE_ID") || "(unset)"));
    Logger.log("[PED] run end (dry)");
    return;
  }

  var written = PED_writeDashboard_(model);
  Logger.log("[PED] wrote " + written + " blocks. Run end.");
}

// Run once to install the daily 7am CT trigger (after the 6am Triple
// Seat sync). Idempotent — clears existing peDashboardRefresh triggers.
function peDashboardInstallDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "peDashboardRefresh") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("peDashboardRefresh")
    .timeBased().everyDays(1).atHour(PED.TRIGGER_HOUR_CT)
    .inTimezone("America/Chicago").create();
  Logger.log("Daily trigger installed: peDashboardRefresh ~" + PED.TRIGGER_HOUR_CT + "am America/Chicago.");
}

function peDashboardCheckConfig() {
  var props = PropertiesService.getScriptProperties().getProperties();
  Logger.log("DRY_RUN raw value = [" + props.DRY_RUN + "]");
  Logger.log("Writes enabled? (dry-run OFF) = " + (!STB_dryRun_()));
  Logger.log("Has NOTION_API_KEY = " + !!props.NOTION_API_KEY);
  Logger.log("Has PE_DASHBOARD_PAGE_ID = " + !!props.PE_DASHBOARD_PAGE_ID +
             (props.PE_DASHBOARD_PAGE_ID ? " (" + props.PE_DASHBOARD_PAGE_ID + ")" : ""));
  Logger.log("All property keys present: " + Object.keys(props).join(", "));
}

// Forces a dry run regardless of the stored DRY_RUN value.
function testPeDashboardDryRun() {
  var props = PropertiesService.getScriptProperties();
  var prev = props.getProperty("DRY_RUN");
  props.setProperty("DRY_RUN", "1");
  try { peDashboardRefresh(); }
  finally {
    if (prev === null) props.deleteProperty("DRY_RUN");
    else props.setProperty("DRY_RUN", prev);
  }
}

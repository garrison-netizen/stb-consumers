// ============================================================
// Pipeline.gs — orchestrator + trigger setup.
// Entry point: salesPulse()
// ============================================================

function hello() { Logger.log("Sales Pulse project is alive."); }

function salesPulse() {
  Logger.log("=== Sales Pulse start" + (STB_dryRun_() ? " (DRY-RUN)" : "") + " ===");

  // Fail fast if required keys are missing
  SP_anthropicKey_();
  STB_notionKey_();

  // 1. Pull Brain context
  Logger.log("Step 1: Pulling Brain context from Notion...");
  var brainContext = SP_brainContext_();
  Logger.log("Brain context: " + brainContext.length + " chars");

  // 2. Load sales data from Drive
  Logger.log("Step 2: Loading sales data from Drive...");
  var salesData;
  try {
    salesData = SP_loadSalesData_();
    Logger.log("Sales data: " + salesData.length + " chars");
  } catch (e) {
    Logger.log("ERROR loading sales data: " + e.message);
    throw e;
  }

  // 3. In dry-run, log the prompt inputs and stop before the API call
  if (STB_dryRun_()) {
    Logger.log("[DRY-RUN] Brain context preview (first 500):\n" + brainContext.substring(0, 500));
    Logger.log("[DRY-RUN] Sales data preview (first 500):\n" + salesData.substring(0, 500));
    Logger.log("[DRY-RUN] Skipping Claude call and email send.");
    Logger.log("=== Sales Pulse end (DRY-RUN) ===");
    return;
  }

  // 4. Call Claude
  Logger.log("Step 3: Calling Claude...");
  var rawResponse = SP_callClaude_(brainContext, salesData);
  Logger.log("Claude response: " + rawResponse.length + " chars");

  // 5. Parse response
  Logger.log("Step 4: Parsing response...");
  var pulse = SP_parseResponse_(rawResponse);
  Logger.log("Sections parsed: " + pulse.sections.length +
    " | KPIs: " + pulse.sections.reduce(function(n, s) { return n + s.kpis.length; }, 0) +
    " | Actions: " + pulse.actions.length);

  // 6. Render HTML
  Logger.log("Step 5: Rendering email...");
  var html = SP_renderEmail_(pulse);

  // 7. Send email
  var subject = "Sales Pulse — Week Ending " + (pulse.meta.week_ending || SP_weekEndingISO_());
  if (pulse.meta.headline) subject += ": " + pulse.meta.headline;
  var to = SP_emailTo_();

  MailApp.sendEmail({
    to: to,
    subject: subject,
    htmlBody: html,
    name: "STB Sales Pulse"
  });

  Logger.log("Email sent to: " + to);
  Logger.log("=== Sales Pulse end ===");
}

// ---- Trigger setup -------------------------------------------

// Run once to schedule a weekly pull (Monday 7am CT).
function setupSalesPulseTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "salesPulse") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("salesPulse")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(SP.TRIGGER_HOUR_CT)
    .inTimezone("America/Chicago")
    .create();
  Logger.log("Trigger set: salesPulse Monday ~7am CT");
}

// ---- Test helpers --------------------------------------------

// Runs a full dry-run (forces DRY_RUN=1, skips API call + email).
function testSalesPulseDryRun() {
  var props = PropertiesService.getScriptProperties();
  var prev = props.getProperty("DRY_RUN");
  props.setProperty("DRY_RUN", "1");
  try { salesPulse(); }
  finally {
    if (prev === null) props.deleteProperty("DRY_RUN");
    else props.setProperty("DRY_RUN", prev);
  }
}

// Runs only the Brain context pull and logs the result.
function testBrainContextOnly() {
  STB_notionKey_();
  var ctx = SP_brainContext_();
  Logger.log("Brain context (" + ctx.length + " chars):\n" + ctx);
}

// Runs only the data load and logs the result.
function testDataLoadOnly() {
  var data = SP_loadSalesData_();
  Logger.log("Sales data (" + data.length + " chars):\n" + data.substring(0, 2000));
}

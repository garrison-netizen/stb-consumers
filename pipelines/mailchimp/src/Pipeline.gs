// ============================================================
// Mailchimp -> Notion Campaign Log. Orchestration + entry points.
//
// Semantics:
//   - Campaign NOT in Notion  -> create a full row, Phase = "Phase 2 — API pipeline".
//   - Campaign already in Notion -> BACKFILL ONLY: fill empty metric /
//     body / segment cells. Never touch Phase, Focus area, Notes, or
//     identity fields. This preserves Phase-1 manual rows and human edits.
//
// DRY_RUN Script Property defaults to ON (writes opt-in). Set DRY_RUN=0
// to enable real writes — only after the >>VALIDATE<< write-shape lines
// have been confirmed against the live Notion API.
// ============================================================

function mailchimpSync() {
  Logger.log("=== Mailchimp -> Campaign Log start" + (STB_dryRun_() ? " (DRY-RUN)" : "") + " ===");
  MC_apiKey_(); STB_notionKey_(); // fail fast if Script Properties missing

  var campaigns = MC_listSentCampaigns_();
  var s = { total: campaigns.length, created: 0, backfilled: 0, noop: 0, errors: 0 };

  for (var i = 0; i < campaigns.length; i++) {
    var c = campaigns[i];
    try {
      var subject = (c.settings && c.settings.subject_line) || "";
      var filter = MC_naturalKeyFilter_(c.send_time, subject);
      var pageId = STB_notionFindOne_(MC.DATA_SOURCE_ID, filter);

      var report = MC_getReport_(c.id);

      if (pageId === null) {
        var body = MC_getContentPlain_(c.id);
        STB_notionCreate_(MC.DATA_SOURCE_ID, MC_createProps_(c, body, report));
        s.created++;
      } else {
        var body2 = MC_getContentPlain_(c.id);
        var patch = MC_fillEmpties_(pageId, MC_backfillCandidates_(c, body2, report));
        if (patch === null) { s.noop++; }
        else { STB_notionUpdate_(pageId, patch); s.backfilled++; }
      }
    } catch (e) {
      s.errors++;
      Logger.log("ERROR campaign " + (c && c.id) + ": " + e.message);
    }
  }

  Logger.log("=== Mailchimp done" + (STB_dryRun_() ? " (DRY-RUN)" : "") +
    " — total=" + s.total + " created=" + s.created + " backfilled=" + s.backfilled +
    " noop=" + s.noop + " errors=" + s.errors + " ===");
  return s;
}

// Returns a patch of only the candidate props whose current Notion cell
// is empty, or null if nothing to fill (idempotent: re-runs are no-ops).
function MC_fillEmpties_(pageId, candidateProps) {
  var current = STB_notionGetProps_(pageId);
  var patch = {};
  var any = false;
  for (var name in candidateProps) {
    if (STB_propEmpty_(current[name])) { patch[name] = candidateProps[name]; any = true; }
  }
  return any ? patch : null;
}

// Run once to schedule a daily pull (06:00 CT).
function setupMailchimpTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "mailchimpSync") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("mailchimpSync")
    .timeBased().everyDays(1).atHour(6).inTimezone("America/Chicago").create();
  Logger.log("Trigger set: mailchimpSync daily ~6am CT");
}

// Convenience: force a dry run regardless of the Script Property.
function testMailchimpDryRun() {
  var props = PropertiesService.getScriptProperties();
  var prev = props.getProperty("DRY_RUN");
  props.setProperty("DRY_RUN", "1");
  try { mailchimpSync(); }
  finally { if (prev === null) props.deleteProperty("DRY_RUN"); else props.setProperty("DRY_RUN", prev); }
}

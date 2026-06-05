// ============================================================
// Mailchimp pipeline — config. Live IDs + Campaign Log schema,
// confirmed by the Architect 2026-05-19 (read-only schema pull).
// ============================================================

var MC = {
  // Notion "Mailchimp Campaign Log"
  DATABASE_ID:     "a9a26f77cf7041339364f4c3b34ff7a5",
  DATA_SOURCE_ID:  "33f3739d-a76d-47dc-ad1c-9ed05bfdf10c",

  // Exact Notion property names (verify against live schema before
  // changing — unknown names are silently dropped, the v6.3 footgun).
  PROP: {
    CAMPAIGN_NAME: "Campaign name",   // title
    SEND_DATE:     "Send date",       // date
    SUBJECT_LINE:  "Subject line",    // rich_text
    FOCUS_AREA:    "Focus area",      // multi_select (editorial — pipeline leaves empty)
    TARGET_SEG:    "Target segment",  // rich_text
    CAMPAIGN_BODY: "Campaign body",   // rich_text
    SOURCE_FILE:   "Source file",     // files (pipeline does not set)
    OPEN_RATE:     "Open rate",       // number, percent — store fraction (0.42 = 42%)
    CLICK_RATE:    "Click rate",      // number, percent — store fraction
    RECIPIENTS:    "Recipients",      // number, integer
    NOTES:         "Notes",           // rich_text (human — pipeline does not set)
    PHASE:         "Phase"            // select
    // "Date logged" is created_time — auto, NOT writable. Never send it.
  },

  PHASE_API: "Phase 2 — API pipeline"  // set on rows the pipeline creates
};

// Mailchimp Marketing API v3.0 — key + datacenter prefix from Script
// Properties. Key format ends in "-usXX"; suffix is the datacenter.
function MC_apiKey_() {
  var k = PropertiesService.getScriptProperties().getProperty("MAILCHIMP_API_KEY");
  if (!k) throw new Error("MAILCHIMP_API_KEY not set in Script Properties.");
  return k;
}
function MC_dc_() {
  var k = MC_apiKey_();
  var explicit = PropertiesService.getScriptProperties().getProperty("MAILCHIMP_SERVER_PREFIX");
  var dc = explicit || (k.split("-")[1] || "");
  if (!dc) throw new Error("Mailchimp datacenter prefix not derivable from key; set MAILCHIMP_SERVER_PREFIX.");
  return dc;
}

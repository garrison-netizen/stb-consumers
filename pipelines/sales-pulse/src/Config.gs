// ============================================================
// Sales Pulse — configuration
// All IDs and Script Property names live here.
// ============================================================

var SP = {

  // ---- Notion Brain sources (read-only) ----------------------

  // Section 4 Distribution page — block children pulled for live context
  DISTRIBUTION_PAGE_ID: "3591c57ac02b807ead8df17d1e4535c4",

  // Living Archive data source — queried for recent Sales-tagged entries
  LIVING_ARCHIVE_DS: "99e86096-d28f-4b0b-b26d-aedbe32f8489",

  // How many days back to pull from Living Archive
  LIVING_ARCHIVE_LOOKBACK_DAYS: 30,

  // ---- Drive folder ------------------------------------------

  // Exact name of the Drive folder containing the distribution reports.
  // All spreadsheet files in this folder are read and included as context.
  DATA_FOLDER_NAME: "Weekly Distribution Pulse",

  // ---- Script Property keys ----------------------------------
  // Set these in Apps Script > Project Settings > Script Properties

  PROP: {
    ANTHROPIC_KEY:   "ANTHROPIC_API_KEY",
    NOTION_KEY:      "NOTION_API_KEY",       // same key used across all pipelines
    EMAIL_TO:        "SALES_PULSE_EMAIL_TO", // defaults to SP.DEFAULT_EMAIL if not set
    DRY_RUN:         "DRY_RUN"               // "0" = real run; anything else = dry run
  },

  DEFAULT_EMAIL: "garrison@spindletap.com",

  // ---- Claude model ------------------------------------------
  CLAUDE_MODEL: "claude-opus-4-8",           // use Opus — this is analysis, not a simple transform
  CLAUDE_MAX_TOKENS: 4096,

  // ---- Trigger -----------------------------------------------
  TRIGGER_HOUR_CT: 7   // 7am Central Time, Monday
};

// ---- Helpers --------------------------------------------------

function SP_anthropicKey_() {
  var k = PropertiesService.getScriptProperties().getProperty(SP.PROP.ANTHROPIC_KEY);
  if (!k) throw new Error(SP.PROP.ANTHROPIC_KEY + " not set in Script Properties.");
  return k;
}

function SP_emailTo_() {
  return PropertiesService.getScriptProperties().getProperty(SP.PROP.EMAIL_TO) || SP.DEFAULT_EMAIL;
}

function SP_dataFolderName_() {
  return SP.DATA_FOLDER_NAME;
}

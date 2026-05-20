// ============================================================
// STB SHARED — Notion write layer for Apps Script consumer pipelines
// CANONICAL MASTER. Copied verbatim into each pipeline's GAS project
// (see shared/README.md for the propagation checklist). No npm, no
// modules — Apps Script runtime. Style matches Weekly Pulse v6.3.
//
// Mirrors v6.3's PROVEN read pattern (UrlFetchApp, Bearer auth,
// Notion-Version 2025-09-03). The WRITE path (create/update) is NOT
// exercised by v6.3 (read-only). Lines marked >>VALIDATE<< use a
// payload shape that must be confirmed against the live API on the
// first DRY-RUN before any real write.
// ============================================================

var STB_NOTION_VERSION = "2025-09-03";

function STB_dryRun_() {
  // Default TRUE until explicitly disabled — writes are opt-in.
  return PropertiesService.getScriptProperties().getProperty("DRY_RUN") !== "0";
}

function STB_notionKey_() {
  // Matches Weekly Pulse v6.3 Script Property name for cross-pipeline
  // consistency (one Notion integration token name everywhere).
  var k = PropertiesService.getScriptProperties().getProperty("NOTION_API_KEY");
  if (!k) throw new Error("NOTION_API_KEY not set in Script Properties.");
  return k;
}

function STB_notionHeaders_() {
  return {
    "Authorization": "Bearer " + STB_notionKey_(),
    "Notion-Version": STB_NOTION_VERSION
  };
}

// Find a single row by natural-key filter.
// Returns the page id, or null if none. Throws if >1 — the proven v6.3
// "design grain violated" discipline: a non-unique natural key must
// fail loudly, never silently overwrite.
function STB_notionFindOne_(dataSourceId, filter) {
  var url = "https://api.notion.com/v1/data_sources/" + dataSourceId + "/query";
  var resp = UrlFetchApp.fetch(url, {
    method: "POST",
    contentType: "application/json",
    headers: STB_notionHeaders_(),
    payload: JSON.stringify({ filter: filter, page_size: 3 }),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error("Notion query " + code + " for " + dataSourceId + ": " + resp.getContentText());
  }
  var rows = JSON.parse(resp.getContentText()).results || [];
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw new Error("Natural key matched " + rows.length +
      " rows in " + dataSourceId + " — collision; aborting to avoid overwrite.");
  }
  return rows[0].id;
}

function STB_notionGetProps_(pageId) {
  var resp = UrlFetchApp.fetch("https://api.notion.com/v1/pages/" + pageId, {
    method: "GET",
    headers: STB_notionHeaders_(),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error("Notion get page " + resp.getResponseCode() + " for " + pageId);
  }
  return JSON.parse(resp.getContentText()).properties || {};
}

// >>VALIDATE<< parent shape for data-source page creation under
// Notion-Version 2025-09-03. Print-only on first DRY-RUN, confirm
// against live API, then enable real writes.
function STB_notionCreate_(dataSourceId, properties) {
  if (STB_dryRun_()) {
    Logger.log("[DRY-RUN] create in ds " + dataSourceId + ": " + JSON.stringify(properties));
    return "DRYRUN";
  }
  var resp = UrlFetchApp.fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    contentType: "application/json",
    headers: STB_notionHeaders_(),
    payload: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      properties: properties
    }),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code !== 200) throw new Error("Notion create " + code + ": " + resp.getContentText());
  return JSON.parse(resp.getContentText()).id;
}

function STB_notionUpdate_(pageId, properties) {
  if (STB_dryRun_()) {
    Logger.log("[DRY-RUN] update " + pageId + ": " + JSON.stringify(properties));
    return;
  }
  var resp = UrlFetchApp.fetch("https://api.notion.com/v1/pages/" + pageId, {
    method: "PATCH",
    contentType: "application/json",
    headers: STB_notionHeaders_(),
    payload: JSON.stringify({ properties: properties }),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code !== 200) throw new Error("Notion update " + code + ": " + resp.getContentText());
}

// True if a retrieved Notion property is empty (used by backfill so we
// never clobber a manual Phase-1 value or a prior backfill).
function STB_propEmpty_(prop) {
  if (!prop || !prop.type) return true;
  var t = prop.type, v = prop[t];
  if (v === null || v === undefined) return true;
  switch (t) {
    case "title":
    case "rich_text":   return (v || []).length === 0;
    case "number":      return v === null;
    case "date":        return !v || !v.start;
    case "select":      return v === null;
    case "multi_select":return (v || []).length === 0;
    case "files":       return (v || []).length === 0;
    default:            return false;
  }
}

// Property value builders.
function STB_pTitle_(s)     { return { title: [{ text: { content: String(s == null ? "" : s) } }] }; }
function STB_pRichText_(s)  { return { rich_text: [{ text: { content: String(s == null ? "" : s) } }] }; }
function STB_pNumber_(n)    { return { number: (n === null || n === undefined) ? null : Number(n) }; }
function STB_pDateISO_(iso) { return { date: { start: iso } }; }
function STB_pSelect_(name) { return { select: { name: name } }; }

// ============================================================
// VIP Marts — Notion access layer on top of Shared.gs.
// Adds what the canonical shared layer doesn't carry: paginated
// query-all, retrying writes, archive, checkbox builder, value
// extraction, and MD5 for account_uid minting.
// ============================================================

// Fetch with retry/backoff on 429 and 5xx. Returns the HTTPResponse.
function VM_fetchRetry_(url, options) {
  var attempt = 0, resp, code;
  while (true) {
    resp = UrlFetchApp.fetch(url, options);
    code = resp.getResponseCode();
    if (code !== 429 && code < 500) return resp;
    attempt++;
    if (attempt > 4) return resp;
    Utilities.sleep(Math.min(20000, 1000 * Math.pow(2, attempt)));
  }
}

// Query every row of a data source (paginated, 100/page).
// Returns raw page objects.
function VM_queryAll_(dataSourceId, filter) {
  var url = "https://api.notion.com/v1/data_sources/" + dataSourceId + "/query";
  var results = [], cursor = null;
  do {
    var payload = { page_size: 100 };
    if (filter) payload.filter = filter;
    if (cursor) payload.start_cursor = cursor;
    var resp = VM_fetchRetry_(url, {
      method: "POST",
      contentType: "application/json",
      headers: STB_notionHeaders_(),
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      throw new Error("Notion query " + resp.getResponseCode() + " for " + dataSourceId + ": " + resp.getContentText());
    }
    var body = JSON.parse(resp.getContentText());
    results = results.concat(body.results || []);
    cursor = body.has_more ? body.next_cursor : null;
  } while (cursor);
  return results;
}

// Extract a plain JS value from a Notion property object.
function VM_val_(prop) {
  if (!prop || !prop.type) return null;
  var t = prop.type, v = prop[t];
  switch (t) {
    case "title":
    case "rich_text":
      return (v || []).map(function (r) { return r.plain_text || ""; }).join("");
    case "number":   return (v === undefined) ? null : v;
    case "select":   return v ? v.name : null;
    case "checkbox": return !!v;
    case "date":     return v ? v.start : null;
    default:         return null;
  }
}

// Extract all properties of a page into {name: value}, plus __id.
function VM_row_(page) {
  var out = { __id: page.id };
  var props = page.properties || {};
  for (var k in props) out[k] = VM_val_(props[k]);
  return out;
}

// Writes — same DRY_RUN contract as Shared.gs, plus retry.
function VM_create_(dataSourceId, properties) {
  if (STB_dryRun_()) {
    Logger.log("[DRY-RUN] create in ds " + dataSourceId + ": " + JSON.stringify(properties).slice(0, 300));
    return "DRYRUN";
  }
  var resp = VM_fetchRetry_("https://api.notion.com/v1/pages", {
    method: "POST",
    contentType: "application/json",
    headers: STB_notionHeaders_(),
    payload: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      properties: properties
    }),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error("Notion create " + resp.getResponseCode() + ": " + resp.getContentText());
  }
  return JSON.parse(resp.getContentText()).id;
}

function VM_update_(pageId, properties) {
  if (STB_dryRun_()) {
    Logger.log("[DRY-RUN] update " + pageId + ": " + JSON.stringify(properties).slice(0, 300));
    return;
  }
  var resp = VM_fetchRetry_("https://api.notion.com/v1/pages/" + pageId, {
    method: "PATCH",
    contentType: "application/json",
    headers: STB_notionHeaders_(),
    payload: JSON.stringify({ properties: properties }),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error("Notion update " + resp.getResponseCode() + ": " + resp.getContentText());
  }
}

function VM_archive_(pageId) {
  if (STB_dryRun_()) {
    Logger.log("[DRY-RUN] archive " + pageId);
    return;
  }
  var resp = VM_fetchRetry_("https://api.notion.com/v1/pages/" + pageId, {
    method: "PATCH",
    contentType: "application/json",
    headers: STB_notionHeaders_(),
    payload: JSON.stringify({ archived: true }),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error("Notion archive " + resp.getResponseCode() + ": " + resp.getContentText());
  }
}

// Data-source schema PATCH — used only by vipRollover().
function VM_patchDataSource_(dataSourceId, body) {
  if (STB_dryRun_()) {
    Logger.log("[DRY-RUN] PATCH data_source " + dataSourceId + ": " + JSON.stringify(body));
    return;
  }
  var resp = VM_fetchRetry_("https://api.notion.com/v1/data_sources/" + dataSourceId, {
    method: "PATCH",
    contentType: "application/json",
    headers: STB_notionHeaders_(),
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error("Notion data_source PATCH " + resp.getResponseCode() + ": " + resp.getContentText());
  }
}

function VM_pCheckbox_(b) { return { checkbox: !!b }; }

function VM_md5hex_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");
}

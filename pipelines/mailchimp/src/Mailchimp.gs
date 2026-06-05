// ============================================================
// Mailchimp Marketing API v3.0 — thin UrlFetchApp client.
// Mirrors Weekly Pulse v6.3's I/O idiom (UrlFetchApp, muteHttpExceptions,
// explicit non-200 throw).
// ============================================================

function MC_base_() {
  return "https://" + MC_dc_() + ".api.mailchimp.com/3.0";
}

function MC_auth_() {
  return "Basic " + Utilities.base64Encode("anystring:" + MC_apiKey_());
}

function MC_get_(path) {
  var resp = UrlFetchApp.fetch(MC_base_() + path, {
    method: "GET",
    headers: { "Authorization": MC_auth_() },
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error("Mailchimp GET " + path + " -> " + code + ": " + resp.getContentText());
  }
  return JSON.parse(resp.getContentText());
}

// All sent campaigns (paginated).
function MC_listSentCampaigns_() {
  var out = [];
  var pageSize = 100;
  for (var offset = 0; ; offset += pageSize) {
    var page = MC_get_("/campaigns?status=sent&count=" + pageSize + "&offset=" + offset);
    var batch = page.campaigns || [];
    for (var i = 0; i < batch.length; i++) out.push(batch[i]);
    if (batch.length < pageSize) break;
  }
  return out;
}

function MC_getReport_(campaignId) {
  return MC_get_("/reports/" + campaignId);
}

// Plain-text body. Some campaign types have no content endpoint — treat
// a non-200 as "no body" rather than failing the whole run.
function MC_getContentPlain_(campaignId) {
  try {
    var c = MC_get_("/campaigns/" + campaignId + "/content");
    return c.plain_text || "";
  } catch (e) {
    Logger.log("Warn: no content for campaign " + campaignId + ": " + e.message);
    return "";
  }
}

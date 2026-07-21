// ============================================================
// Data.gs — full paginated reads of the three Private Events
// databases, normalized to plain JS objects. Read-only; mirrors the
// Triple Seat pipeline's TS_loadKeyMap_ pagination pattern.
// ============================================================

// Query every row of a data source. Returns raw Notion page objects.
function PED_loadAll_(dsId) {
  var rows = [], cursor = null, guard = 0;
  do {
    var payload = { page_size: 100 };
    if (cursor) payload.start_cursor = cursor;
    var resp = UrlFetchApp.fetch("https://api.notion.com/v1/data_sources/" + dsId + "/query", {
      method: "post",
      contentType: "application/json",
      headers: STB_notionHeaders_(),
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      throw new Error("Notion load " + resp.getResponseCode() + " for " + dsId +
        ": " + resp.getContentText().substring(0, 200));
    }
    var body = JSON.parse(resp.getContentText());
    rows = rows.concat(body.results || []);
    cursor = body.has_more ? body.next_cursor : null;
    guard++;
  } while (cursor && guard < 200);
  return rows;
}

// ---- Property readers (live API property objects → scalars) ----

function PED_text_(prop) {
  if (!prop) return "";
  var arr = prop.title || prop.rich_text || [];
  return arr.map(function(it) { return it.plain_text || (it.text && it.text.content) || ""; }).join("");
}
function PED_num_(prop)    { return (prop && prop.number != null) ? prop.number : null; }
function PED_dateISO_(prop){ return (prop && prop.date && prop.date.start) ? String(prop.date.start).substring(0, 10) : ""; }
function PED_select_(prop) { return (prop && prop.select) ? (prop.select.name || "") : ""; }
function PED_check_(prop)  { return !!(prop && prop.checkbox); }
function PED_relIds_(prop) { return (prop && prop.relation || []).map(function(r) { return r.id; }); }

// ---- Normalized loads ------------------------------------------

// Lead Sources: page id → source name.
function PED_loadSourceNames_() {
  var map = {};
  PED_loadAll_(PED.LEAD_SOURCES_DS).forEach(function(row) {
    map[row.id] = PED_text_((row.properties || {})[PED.LEAD_SOURCES.NAME]);
  });
  return map;
}

function PED_loadLeads_(sourceNames) {
  var P = PED.LEADS;
  return PED_loadAll_(PED.LEADS_DS).map(function(row) {
    var p = row.properties || {};
    var srcIds = PED_relIds_(p[P.SOURCE]);
    return {
      title:       PED_text_(p[P.TITLE]),
      eventType:   PED_select_(p[P.EVENT_TYPE]),
      headcount:   PED_num_(p[P.HEADCOUNT]),
      reqDate:     PED_dateISO_(p[P.REQ_DATE]),
      status:      PED_select_(p[P.STATUS]),
      createdAt:   PED_dateISO_(p[P.CREATED_AT]),
      convertedAt: PED_dateISO_(p[P.CONVERTED_AT]),
      source:      srcIds.length ? (sourceNames[srcIds[0]] || "Unknown") : "Unknown"
    };
  });
}

function PED_loadBookings_() {
  var P = PED.BOOKINGS;
  return PED_loadAll_(PED.BOOKINGS_DS).map(function(row) {
    var p = row.properties || {};
    return {
      title:       PED_text_(p[P.TITLE]),
      eventDate:   PED_dateISO_(p[P.EVENT_DATE]),
      status:      PED_select_(p[P.STATUS]),
      quotedRev:   PED_num_(p[P.QUOTED_REV]),
      actualRev:   PED_num_(p[P.ACTUAL_REV]),
      barActual:   PED_num_(p[P.BAR_ACTUAL]),
      depositAmt:  PED_num_(p[P.DEPOSIT_AMT]),
      depositPaid: PED_check_(p[P.DEPOSIT_PAID]),
      balancePaid: PED_check_(p[P.BALANCE_PAID]),
      finalHc:     PED_num_(p[P.FINAL_HC]),
      rep:         PED_select_(p[P.REP])
    };
  });
}

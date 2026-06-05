// ============================================================
// Triple Seat → STB Notion pipeline. Entry points:
//
//   tripleSeatProbe()     — read-only raw shape dump (TripleSeat.gs)
//   tripleSeatDryShapes() — map a few records to Notion props, NO Notion
//                           I/O (validates mapping without credentials)
//   tripleSeatSync()      — full reconcile of leads + bookings (daily trigger)
//   tripleSeatBackfill()  — alias of sync; all-history is the same full pass
//
// Event data MUTATES (lead Pending→Booked, booking gains actual revenue),
// so this is an UPSERT pipeline. To keep daily runs fast and avoid
// rewriting unchanged rows (~2,100 of them), it PREFETCHES each target
// database's natural-key→row map once, then creates / updates-if-changed /
// skips. Only Triple-Seat-owned fields are written; manual Notes and the
// calculator-owned Winning configuration are never touched.
//
// DRY_RUN defaults ON — set Script Property DRY_RUN=0 for live writes.
//
// Script Properties required:
//   TS_CLIENT_ID, TS_CLIENT_SECRET — Triple Seat OAuth 2.0 app credentials
//   NOTION_API_KEY                 — Notion integration token (shared on the
//                                    Private Events databases)
//   DRY_RUN                        — "0" to enable writes (default ON)
// ============================================================

function tripleSeatSync()    { TS_runAll_(); }
function tripleSeatBackfill() { TS_runAll_(); }

// Diagnostic — logs the effective config so we can see why writes are/aren't
// happening. Reveals the raw DRY_RUN value (brackets expose stray spaces),
// the resolved dry-run state, and which Script Property keys exist.
function tripleSeatCheckConfig() {
  var props = PropertiesService.getScriptProperties().getProperties();
  Logger.log("DRY_RUN raw value = [" + props.DRY_RUN + "]");
  Logger.log("Writes enabled? (dry-run OFF) = " + (!STB_dryRun_()));
  Logger.log("Has TS_CLIENT_ID = " + !!props.TS_CLIENT_ID);
  Logger.log("Has TS_CLIENT_SECRET = " + !!props.TS_CLIENT_SECRET);
  Logger.log("Has NOTION_API_KEY = " + !!props.NOTION_API_KEY);
  Logger.log("All property keys present: " + Object.keys(props).join(", "));
}

// Run once to install the daily 6am (Central) trigger on tripleSeatSync.
// Idempotent — clears any existing tripleSeatSync triggers first.
function tripleSeatInstallDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "tripleSeatSync") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("tripleSeatSync").timeBased().everyDays(1).atHour(6).create();
  Logger.log("Daily trigger installed: tripleSeatSync ~6am America/Chicago.");
}

function TS_runAll_() {
  var dry = STB_dryRun_();
  Logger.log("[TS] run start dry=" + dry);

  // --- Fetch + filter deleted/test rows ---
  var leads = TS_fetchLeads_().filter(function(r) { return !r.deleted_at; });
  var bookingsAll = TS_fetchBookings_().filter(function(r) { return !r.deleted_at; });
  var bookings = bookingsAll.filter(TS_isRealBooking_);
  var excluded = bookingsAll.length - bookings.length;  // prospect/tentative (lead stage)
  Logger.log("[TS] leads=" + leads.length + " bookings(real)=" + bookings.length +
             " excluded(prospect/tentative)=" + excluded);

  // --- Prefetch existing rows (natural key -> {id, props}) ---
  var leadMap   = TS_loadKeyMap_(TRIPLESEAT.LEADS_DS,        TRIPLESEAT.LEADS.TS_ID,       false);
  var bookMap   = TS_loadKeyMap_(TRIPLESEAT.BOOKINGS_DS,     TRIPLESEAT.BOOKINGS.TS_ID,    false);
  var sourceMap = TS_loadKeyMap_(TRIPLESEAT.LEAD_SOURCES_DS, TRIPLESEAT.LEAD_SOURCES.NAME, true);

  var s = { srcNew: 0, leadNew: 0, leadUpd: 0, leadSkip: 0,
            bookNew: 0, bookUpd: 0, bookSkip: 0, excluded: excluded, err: 0 };

  // --- Leads pass; build event_id -> Notion lead pageId for booking links ---
  var eventIdToLeadPage = {};
  leads.forEach(function(rec) {
    try {
      var srcName = TS_leadSourceName_(rec);
      var srcId   = srcName ? TS_resolveSource_(srcName, sourceMap, s) : null;
      var props   = TS_leadProps_(rec, srcId);
      var pageId  = TS_upsert_(TRIPLESEAT.LEADS_DS, leadMap, String(rec.id), props, s, "lead");
      if (rec.event_id != null) eventIdToLeadPage[String(rec.event_id)] = pageId;
    } catch (e) {
      Logger.log("[TS lead ERR] id=" + (rec && rec.id) + ": " + e.message);
      s.err++;
    }
  });

  // --- Bookings pass; resolve Related lead via shared event_id ---
  bookings.forEach(function(rec) {
    try {
      var leadPage = null;
      var eids = TS_bookingEventIds_(rec);
      for (var i = 0; i < eids.length; i++) {
        if (eventIdToLeadPage[eids[i]]) { leadPage = eventIdToLeadPage[eids[i]]; break; }
      }
      var props = TS_bookingProps_(rec, leadPage);
      TS_upsert_(TRIPLESEAT.BOOKINGS_DS, bookMap, String(rec.id), props, s, "book");
    } catch (e) {
      Logger.log("[TS booking ERR] id=" + (rec && rec.id) + ": " + e.message);
      s.err++;
    }
  });

  Logger.log("[TS] sources +" + s.srcNew +
             " | leads " + s.leadNew + " new/" + s.leadUpd + " upd/" + s.leadSkip + " same" +
             " | bookings " + s.bookNew + " new/" + s.bookUpd + " upd/" + s.bookSkip + " same" +
             " | excluded=" + s.excluded + " | errors=" + s.err);
}

// ------------------------------------------------------------
// Mapping validator — NO Notion I/O. Run after TS creds are set to eyeball
// that records map to correct Notion props before wiring Notion. Safe.
// ------------------------------------------------------------
function tripleSeatDryShapes() {
  var leads = TS_fetchLeads_().filter(function(r) { return !r.deleted_at; });
  Logger.log("[TS SHAPES] leads(non-deleted)=" + leads.length);
  leads.slice(0, 3).forEach(function(r) {
    Logger.log("LEAD " + r.id + " status=" + TS_leadStatus_(r) +
      " source=" + TS_leadSourceName_(r) + "\n" +
      JSON.stringify(TS_leadProps_(r, "SRC"), null, 2));
  });

  var bookingsAll = TS_fetchBookings_().filter(function(r) { return !r.deleted_at; });
  var bookings = bookingsAll.filter(TS_isRealBooking_);
  Logger.log("[TS SHAPES] bookings(real)=" + bookings.length +
    " excluded=" + (bookingsAll.length - bookings.length));
  bookings.slice(0, 3).forEach(function(r) {
    Logger.log("BOOKING " + r.id + " status=" + TS_bookingStatus_(r) + "\n" +
      JSON.stringify(TS_bookingProps_(r, "LEADPAGE"), null, 2));
  });
}

// ------------------------------------------------------------
// Notion helpers (pipeline-local; the shared layer stays byte-identical)
// ------------------------------------------------------------

// Load every row's natural-key -> {id, props}. One paginated pass.
function TS_loadKeyMap_(dsId, keyProp, lower) {
  var map = {}, cursor = null, guard = 0;
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
    (body.results || []).forEach(function(row) {
      var key = TS_scalar_((row.properties || {})[keyProp]);
      if (key) { if (lower) key = key.toLowerCase(); map[key] = { id: row.id, props: row.properties || {} }; }
    });
    cursor = body.has_more ? body.next_cursor : null;
    guard++;
  } while (cursor && guard < 200);
  return map;
}

// Create-or-update-if-changed against a prefetched map. Returns the page id.
function TS_upsert_(dsId, map, key, props, stats, kind) {
  var existing = map[key];
  if (existing) {
    if (TS_needsUpdate_(existing.props, props)) {
      TS_retry429_(function() { STB_notionUpdate_(existing.id, props); });
      stats[kind + "Upd"]++;
    } else {
      stats[kind + "Skip"]++;
    }
    return existing.id;
  }
  var id = TS_retry429_(function() { return STB_notionCreate_(dsId, props); });
  stats[kind + "New"]++;
  map[key] = { id: id, props: props };  // keep map consistent within the run
  return id;
}

// Find-or-create a Lead Sources row by name; return its page id (cached).
function TS_resolveSource_(name, sourceMap, stats) {
  var key = name.toLowerCase();
  if (sourceMap[key]) return sourceMap[key].id;
  var props = {};
  props[TRIPLESEAT.LEAD_SOURCES.NAME] = STB_pTitle_(name);
  var id = TS_retry429_(function() { return STB_notionCreate_(TRIPLESEAT.LEAD_SOURCES_DS, props); });
  sourceMap[key] = { id: id, props: props };
  stats.srcNew++;
  return id;
}

// Wrap a Notion write so transient rate-limit (429) / conflict (409)
// responses back off and retry instead of failing the row. STB_notion*
// throws an Error whose message contains the HTTP code; match on that.
// (Skips cleanly in DRY-RUN — STB_notion* returns without throwing.)
function TS_retry429_(fn) {
  var last;
  for (var attempt = 0; attempt < 5; attempt++) {
    try { return fn(); }
    catch (e) {
      last = e;
      var m = String(e.message || "").toLowerCase();
      if (m.indexOf(" 429") >= 0 || m.indexOf(" 409") >= 0 ||
          m.indexOf("rate_limited") >= 0 || m.indexOf("conflict") >= 0) {
        Utilities.sleep(800 * (attempt + 1));  // 0.8s, 1.6s, 2.4s, 3.2s
        continue;
      }
      throw e;  // non-retryable — surface it
    }
  }
  throw last;
}

// True if any prop in newProps differs from the existing row (change
// detection — avoids rewriting unchanged rows on every daily run).
function TS_needsUpdate_(existingProps, newProps) {
  for (var k in newProps) {
    if (TS_scalar_(newProps[k]) !== TS_scalar_(existingProps[k])) return true;
  }
  return false;
}

// Normalize a Notion property (either a builder payload or a live API
// property object) to a comparable scalar string.
function TS_scalar_(prop) {
  if (!prop) return "";
  if ("title"        in prop) return TS_joinRich_(prop.title);
  if ("rich_text"    in prop) return TS_joinRich_(prop.rich_text);
  if ("number"       in prop) return (prop.number == null) ? "" : String(prop.number);
  if ("date"         in prop) return (prop.date && prop.date.start) ? String(prop.date.start).substring(0, 10) : "";
  if ("select"       in prop) return prop.select ? (prop.select.name || "") : "";
  if ("email"        in prop) return prop.email || "";
  if ("phone_number" in prop) return prop.phone_number || "";
  if ("checkbox"     in prop) return prop.checkbox ? "1" : "0";
  if ("relation"     in prop) return (prop.relation || []).map(function(r) { return r.id; }).sort().join(",");
  return "";
}

function TS_joinRich_(arr) {
  return (arr || []).map(function(it) {
    return it.plain_text || (it.text && it.text.content) || "";
  }).join("");
}

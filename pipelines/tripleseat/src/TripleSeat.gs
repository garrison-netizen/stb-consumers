// ============================================================
// Triple Seat API fetch layer.
// Auth: OAuth 2.0 client_credentials. POST client_id/client_secret to
// the token endpoint, get a Bearer access_token (2-hour lifetime — one
// token easily covers a single daily run; cached per execution).
//
// Rate limit: 10 req/sec on /events endpoints. We pace conservatively.
//
// >>VALIDATE<< markers flag response-shape assumptions to confirm with
// TS_probe() against the live API before enabling writes. The Triple
// Seat support docs are bot-blocked, so the probe is the source of truth
// for envelope keys and field names.
// ============================================================

var TS_TOKEN_CACHE = null;  // per-execution token cache

// Pace between paged requests — well under the 10 req/s ceiling.
var TS_PAGE_PAUSE_MS = 150;

function TS_token_() {
  if (TS_TOKEN_CACHE) return TS_TOKEN_CACHE;
  // Triple Seat's OAuth2 token endpoint expects form-urlencoded params,
  // NOT JSON (confirmed against the live endpoint 2026-06-05 — a JSON body
  // returns 400 "parsing request parameters"). Passing `payload` as an
  // object makes UrlFetchApp send application/x-www-form-urlencoded.
  var resp = UrlFetchApp.fetch(TRIPLESEAT.TOKEN_URL, {
    method: "post",
    payload: {
      client_id:     TS_clientId_(),
      client_secret: TS_clientSecret_(),
      grant_type:    "client_credentials"
    },
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  var text = resp.getContentText();
  if (code !== 200) {
    throw new Error("Triple Seat token " + code + ": " + text.substring(0, 300));
  }
  var body;
  try { body = JSON.parse(text); }
  catch (e) { throw new Error("Triple Seat token: non-JSON response: " + text.substring(0, 200)); }
  if (!body.access_token) throw new Error("Triple Seat token response missing access_token.");
  TS_TOKEN_CACHE = body.access_token;
  return TS_TOKEN_CACHE;
}

function TS_headers_() {
  return {
    "Authorization": "Bearer " + TS_token_(),
    "Accept": "application/json"
  };
}

// Paginate through every record on an endpoint.
// `resultsKey` is the array key in the response envelope (e.g. "leads",
// "bookings"). >>VALIDATE<< the envelope shape via TS_probe().
// `extraQS` is an optional already-encoded query string (e.g. an
// updated_since filter) appended to each page request.
function TS_fetchAll_(endpoint, resultsKey, extraQS) {
  var all  = [];
  var page = 1;
  while (true) {
    var url = TRIPLESEAT.API_BASE + endpoint +
              "?page=" + page + "&sort_direction=desc&order=created_at" +
              (extraQS ? "&" + extraQS : "");
    var resp = UrlFetchApp.fetch(url, {
      method: "get",
      headers: TS_headers_(),
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code !== 200) {
      throw new Error("Triple Seat " + code + " on " + endpoint +
        " p" + page + ": " + resp.getContentText().substring(0, 300));
    }
    var body  = JSON.parse(resp.getContentText());
    // Envelope tolerance: accept {key:[...]}, a bare array, or {results:[...]}.
    var batch = body[resultsKey] || body.results || (Array.isArray(body) ? body : []);
    if (!batch.length) break;
    all = all.concat(batch);
    if (batch.length < 1) break;           // empty page → done
    page++;
    if (page > 500) {                       // hard safety stop
      Logger.log("[TS] pagination safety stop at page 500 on " + endpoint);
      break;
    }
    Utilities.sleep(TS_PAGE_PAUSE_MS);
  }
  return all;
}

function TS_fetchLeads_(extraQS) {
  // >>VALIDATE<< endpoint path + results key against probe.
  return TS_fetchAll_("/leads.json", "leads", extraQS);
}

function TS_fetchBookings_(extraQS) {
  // >>VALIDATE<< endpoint path + results key against probe.
  return TS_fetchAll_("/bookings.json", "bookings", extraQS);
}

// ------------------------------------------------------------
// PROBE — run this first (read-only) once credentials are set.
// Dumps the raw shape of one lead and one booking so the field paths
// in Transform.gs can be confirmed/corrected before any write. Safe to
// run regardless of DRY_RUN (it never writes).
// ------------------------------------------------------------
function tripleSeatProbe() {
  Logger.log("[TS PROBE] token OK: " + (TS_token_() ? "yes" : "no"));

  var leads = TS_fetchLeads_();
  Logger.log("[TS PROBE] leads fetched: " + leads.length);
  if (leads.length) {
    Logger.log("[TS PROBE] first LEAD raw:\n" + JSON.stringify(leads[0], null, 2));
    Logger.log("[TS PROBE] lead status values seen: " +
      JSON.stringify(TS_distinct_(leads, "status")));
  }

  var bookings = TS_fetchBookings_();
  Logger.log("[TS PROBE] bookings fetched: " + bookings.length);
  if (bookings.length) {
    Logger.log("[TS PROBE] first BOOKING raw:\n" + JSON.stringify(bookings[0], null, 2));
    Logger.log("[TS PROBE] booking status values seen: " +
      JSON.stringify(TS_distinct_(bookings, "status")));
  }
}

// Collect distinct values of a top-level field across records (probe aid).
function TS_distinct_(records, field) {
  var seen = {};
  (records || []).forEach(function(r) {
    var v = r && r[field];
    if (v !== undefined && v !== null) seen[String(v)] = true;
  });
  return Object.keys(seen);
}

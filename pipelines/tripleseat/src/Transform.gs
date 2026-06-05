// ============================================================
// Pure mapping: Triple Seat lead/booking records → Notion property
// payloads. No I/O here (unit-reviewable core).
//
// Field paths CONFIRMED against the live API via tripleSeatProbe()
// (2026-06-05): 1287 leads, 842 bookings sampled.
//
// FIELD OWNERSHIP (scope decision 2026-06-05): the pipeline writes only
// Triple-Seat-owned facts. It NEVER writes the manual "Notes" fields and
// NEVER writes the calculator-owned "Winning configuration". Deposit/
// balance and event times/headcount are NOT exposed on these endpoints
// (they live on the Events/Payments endpoints) — left for the Events
// enrichment + Party Pay pipeline; not written here.
//
// KEY REALITIES from the probe:
//  - Leads have NO status field. Lifecycle is derived:
//      turned_down_at -> Lost; converted_at/booking -> Booked;
//      past event_date while open -> Passed; else Pending.
//  - Customer fields are flat on the lead (first_name, email_address...).
//  - Bookings status vocab: PROSPECT/TENTATIVE/DEFINITE/CLOSED/LOST.
//    Only DEFINITE+ ("ever reached definite_date") are real bookings;
//    PROSPECT/TENTATIVE are the lead stage and are filtered out (Pipeline.gs).
//  - Records carry deleted_at (deleted/test rows) — filtered in Pipeline.gs.
//  - Dates arrive mixed: ISO ("2024-04-06" / "...T..-06:00") on bookings,
//    US ("2/12/2024 9:03 AM") on leads. TS_dateOnly_ handles both, tz-safe.
//  - Booking<->lead link is via event_id (lead.event_id in booking.event_ids).
// ============================================================

// ---- date / value helpers ----------------------------------

// Normalize any Triple Seat date string to date-only YYYY-MM-DD, without
// timezone shifting. Handles ISO ("2024-04-06", "2024-02-12T09:05:22-06:00")
// and US ("2/12/2024 9:03 AM"). Returns null on empty/unparseable.
function TS_dateOnly_(v) {
  if (!v) return null;
  var s = String(v).trim();
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);          // ISO date or datetime
  if (iso) return iso[1] + "-" + iso[2] + "-" + iso[3];
  var us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);      // M/D/YYYY ...
  if (us) {
    var mm = ("0" + us[1]).slice(-2), dd = ("0" + us[2]).slice(-2);
    return us[3] + "-" + mm + "-" + dd;
  }
  return null;
}

function TS_today_() { return new Date().toISOString().substring(0, 10); }

function TS_round2_(n) { return (n === null || n === undefined) ? null : Math.round(Number(n) * 100) / 100; }

function TS_pRelation_(pageId) {
  if (!pageId || pageId === "DRYRUN") return { relation: [] };
  return { relation: [{ id: pageId }] };
}

// Display name from a Triple Seat user object {first_name,last_name,...},
// or a plain string.
function TS_personName_(p) {
  if (!p) return "";
  if (typeof p === "string") return p;
  var n = ((p.first_name || "") + " " + (p.last_name || "")).trim();
  return n || p.name || p.email || "";
}

// Map a Triple Seat rep name to the Notion select option.
function TS_mapRep_(name) {
  var s = String(name || "").toLowerCase();
  if (s.indexOf("marin")  >= 0) return "Marin";
  if (s.indexOf("taylor") >= 0 || s.indexOf("beasley") >= 0) return "Taylor Beasley";
  if (s.indexOf("garrison") >= 0) return "Garrison";
  return "Other";
}

// ============================================================
// LEADS → "Triple Seat Leads" props
// Natural key: Lead ID (Triple Seat). Notes never set.
// ============================================================

// Derived lead lifecycle: Pending / Booked / Passed / Lost.
function TS_leadStatus_(rec) {
  if (rec.turned_down_at) return "Lost";
  if (rec.converted_at || rec.booking_id || rec.booking_lead === true) return "Booked";
  var ev = TS_dateOnly_(rec.event_date);
  if (ev && ev < TS_today_()) return "Passed";
  return "Pending";
}

function TS_leadTitle_(rec) {
  var who  = TS_personName_(rec) || rec.company || "";
  var desc = (rec.event_description || "").trim();
  if (who && desc) return who + " — " + desc;
  return who || desc || ("Lead " + (rec.id || ""));
}

// Source name for the Lead Sources find-or-create.
function TS_leadSourceName_(rec) {
  var src = rec.lead_source;             // {id,name} confirmed
  if (src && typeof src === "object") src = src.name;
  src = String(src || rec.referral_source_other || "").trim();
  return src || null;
}

function TS_leadProps_(rec, sourceRelId) {
  var L = TRIPLESEAT.LEADS;
  var status = TS_leadStatus_(rec);
  var p = {};

  p[L.TITLE] = STB_pTitle_(TS_leadTitle_(rec));
  p[L.TS_ID] = STB_pRichText_(String(rec.id == null ? "" : rec.id));

  var custName = TS_personName_(rec);
  if (custName)            p[L.CUST_NAME]  = STB_pRichText_(custName);
  if (rec.email_address)   p[L.CUST_EMAIL] = { email: String(rec.email_address) };
  if (rec.phone_number)    p[L.CUST_PHONE] = { phone_number: String(rec.phone_number) };

  if (rec.guest_count != null) p[L.HEADCOUNT] = STB_pNumber_(rec.guest_count);

  var reqDate = TS_dateOnly_(rec.event_date);
  if (reqDate)  p[L.REQ_DATE] = STB_pDateISO_(reqDate);

  p[L.STATUS] = STB_pSelect_(status);

  var createdAt = TS_dateOnly_(rec.created_at);
  if (createdAt) p[L.CREATED_AT] = STB_pDateISO_(createdAt);
  if (status === "Booked") {
    var convertedAt = TS_dateOnly_(rec.converted_at);
    if (convertedAt) p[L.CONVERTED_AT] = STB_pDateISO_(convertedAt);
  }
  var statusAt = TS_dateOnly_(rec.updated_at);
  if (statusAt) p[L.STATUS_AT] = STB_pDateISO_(statusAt);

  var rep = TS_personName_(rec.owner);
  if (rep) p[L.REP] = STB_pSelect_(TS_mapRep_(rep));

  if (status === "Lost" && rec.turned_down_reason) {
    p[L.LOST_REASON] = STB_pRichText_(rec.turned_down_reason);
  }

  if (sourceRelId) p[L.SOURCE] = TS_pRelation_(sourceRelId);

  return p;
}

function TS_leadFilter_(leadId) {
  return { property: TRIPLESEAT.LEADS.TS_ID, rich_text: { equals: String(leadId) } };
}

// ============================================================
// BOOKINGS → "Bookings" props
// Natural key: Booking ID (Triple Seat). Notes + Winning configuration
// never set. Deposit/balance/times/headcount not on this endpoint.
// ============================================================

// A Triple Seat "booking" is only a real Brain booking once it reached
// DEFINITE (or is CLOSED). PROSPECT/TENTATIVE that never went definite are
// the lead stage — excluded (they're represented in Triple Seat Leads).
function TS_isRealBooking_(rec) {
  if (rec.deleted_at) return false;
  if (rec.definite_date) return true;
  var st = String(rec.status || "").toUpperCase();
  return st === "DEFINITE" || st === "CLOSED";
}

// Brain booking lifecycle: Confirmed / Completed / Cancelled.
function TS_bookingStatus_(rec) {
  var st = String(rec.status || "").toUpperCase();
  if (st === "LOST")   return "Cancelled";
  if (st === "CLOSED") return "Completed";
  var ev = TS_dateOnly_(rec.start_date || rec.end_date);
  if (ev && ev < TS_today_()) return "Completed";
  return "Confirmed";
}

function TS_bookingProps_(rec, relatedLeadPageId) {
  var B = TRIPLESEAT.BOOKINGS;
  var status = TS_bookingStatus_(rec);
  var p = {};

  p[B.TITLE] = STB_pTitle_(rec.name || rec.post_as || ("Booking " + (rec.id || "")));
  p[B.TS_ID] = STB_pRichText_(String(rec.id == null ? "" : rec.id));

  var eventDate = TS_dateOnly_(rec.start_date);
  if (eventDate) p[B.EVENT_DATE] = STB_pDateISO_(eventDate);

  p[B.STATUS] = STB_pSelect_(status);

  // Financials are top-level totals on the booking.
  var quoted = rec.total_grand_total != null ? rec.total_grand_total : rec.total_event_grand_total;
  if (quoted != null) p[B.QUOTED_REV] = STB_pNumber_(TS_round2_(quoted));
  var actual = rec.total_actual_amount != null ? rec.total_actual_amount : rec.total_event_actual_amount;
  if (actual != null) p[B.ACTUAL_REV] = STB_pNumber_(TS_round2_(actual));

  var rep = TS_personName_(rec.owner);
  if (rep) p[B.REP] = STB_pSelect_(TS_mapRep_(rep));

  var confirmedAt = TS_dateOnly_(rec.definite_date);
  if (confirmedAt) p[B.CONFIRMED_AT] = STB_pDateISO_(confirmedAt);

  if (status === "Cancelled" && rec.lost_reason) {
    p[B.CANCEL_REASON] = STB_pRichText_(rec.lost_reason);
  }

  if (relatedLeadPageId) p[B.RELATED_LEAD] = TS_pRelation_(relatedLeadPageId);

  return p;
}

function TS_bookingFilter_(bookingId) {
  return { property: TRIPLESEAT.BOOKINGS.TS_ID, rich_text: { equals: String(bookingId) } };
}

// Event ids a booking groups (used to resolve the Related lead relation).
function TS_bookingEventIds_(rec) {
  var ids = rec.event_ids || [];
  return ids.map(function(x) { return String(x); });
}

// ============================================================
// Triple Seat pipeline — configuration.
// Notion data source IDs + exact property names verified against live
// Brain schema 2026-06-05 (Private Events sub-page, Phase 1 scaffold).
//
// Auth differs from Clover: Triple Seat uses OAuth 2.0 client_credentials
// (token exchange) rather than a static token. See TripleSeat.gs.
// ============================================================

var TRIPLESEAT = {
  // REST API base + OAuth 2.0 token endpoint.
  API_BASE:  "https://api.tripleseat.com/v1",
  TOKEN_URL: "https://api.tripleseat.com/oauth2/token",

  // Notion target data sources (Private Events sub-page).
  LEADS_DS:        "5c06cdba-25b6-4fc8-b7cc-79bfa3dd56bb",  // Triple Seat Leads
  BOOKINGS_DS:     "474fae7c-aca2-4b4e-9264-86f0fb460ae2",  // Bookings
  LEAD_SOURCES_DS: "55dfad30-9dc5-4f57-af4f-96d3d2940a42",  // Lead Sources (reference, auto-maintained)

  // Triple Seat Leads — exact Notion property names.
  LEADS: {
    TITLE:        "Lead title",              // title
    TS_ID:        "Lead ID (Triple Seat)",   // text — natural key
    CUST_NAME:    "Customer name",           // text
    CUST_EMAIL:   "Customer email",          // email
    CUST_PHONE:   "Customer phone",          // phone_number
    CUST_TYPE:    "Customer type",           // select: Corporate/Private/Repeat
    EVENT_TYPE:   "Event type",              // select: Corporate/Private celebration/Wedding/Other
    HEADCOUNT:    "Headcount estimate",      // number
    REQ_DATE:     "Requested event date",    // date (load-bearing for cohort aging)
    STATUS:       "Status",                  // select: Pending/Booked/Passed/Lost
    CREATED_AT:   "Created at",              // date
    CONVERTED_AT: "Converted at",            // date (NULL until Booked)
    STATUS_AT:    "Status changed at",       // date
    REP:          "Assigned rep",            // select: Marin/Taylor Beasley/Garrison/Other
    LOST_REASON:  "Lost reason",             // text
    SOURCE:       "Source"                   // relation → Lead Sources
    // "Notes" is editorial/manual — never written by pipeline.
    // "Related to Bookings/Event Configurations" — back-relations, set from the other side.
  },

  // Bookings — exact Notion property names.
  BOOKINGS: {
    TITLE:        "Booking title",           // title
    TS_ID:        "Booking ID (Triple Seat)",// text — natural key
    EVENT_DATE:   "Event date",              // date
    START_TIME:   "Event start time",        // text
    END_TIME:     "Event end time",          // text
    HOURS:        "Hours",                    // number
    STATUS:       "Status",                  // select: Confirmed/Completed/Cancelled
    QUOTED_REV:   "Quoted revenue",          // number, dollar
    ACTUAL_REV:   "Actual revenue",          // number, dollar
    BAR_ACTUAL:   "Bar sales actual",        // number, dollar (Cash Bar only)
    DEPOSIT_AMT:  "Deposit amount",          // number, dollar
    DEPOSIT_PAID: "Deposit paid",            // checkbox
    DEPOSIT_DATE: "Balance paid date",       // date  (see note in Transform — TS deposit/balance mapping)
    BALANCE_PAID: "Balance paid",            // checkbox
    BALANCE_DATE: "Balance paid date",       // date
    FINAL_HC:     "Final headcount",         // number
    REP:          "Assigned rep",            // select
    CONFIRMED_AT: "Confirmed at",            // date
    CANCEL_REASON:"Cancellation reason",     // text
    RELATED_LEAD: "Related lead"             // relation → Triple Seat Leads
    // "Notes" editorial/manual — never written.
    // "Winning configuration" — owned by the pricing-calculator integration (separate); never written here.
  },

  // Lead Sources — reference table. Pipeline find-or-creates rows so the
  // Leads "Source" relation resolves to a real page. Category is left for
  // manual classification (Marketing/Organic/Referral/Repeat); pipeline
  // only guarantees the row exists by name.
  LEAD_SOURCES: {
    NAME:     "Source name",  // title — natural key
    ACTIVE:   "Active",       // checkbox
    CATEGORY: "Category"      // select — left manual
  }
};

function TS_clientId_() {
  var v = PropertiesService.getScriptProperties().getProperty("TS_CLIENT_ID");
  if (!v) throw new Error("TS_CLIENT_ID not set in Script Properties.");
  return v;
}

function TS_clientSecret_() {
  var v = PropertiesService.getScriptProperties().getProperty("TS_CLIENT_SECRET");
  if (!v) throw new Error("TS_CLIENT_SECRET not set in Script Properties.");
  return v;
}

// ============================================================
// Clover pipeline — configuration.
// Notion data source IDs confirmed from Brain scaffold 2026-05-11.
// Exact property names verified against live schema 2026-05-20.
// ============================================================

var CLOVER = {
  API_BASE: "https://sandbox.dev.clover.com",

  // Notion target data sources
  DAILY_DS:    "eda5f5db-dc7d-4597-9589-04f23a428582",  // Taproom Daily
  SKU_WEEK_DS: "20a4cb25-85bf-4429-9931-697d18ed26a4",  // Taproom Sales by SKU by Week
  LABOR_DS:    "29c20be4-4cb2-4a8e-92f4-12974759a01b",  // Taproom Labor Daily

  // Taproom Daily — exact Notion property names
  DAILY: {
    DATE:         "Date",               // title (natural key)
    DAY_OF_WEEK:  "Day of week",        // select: Mon/Tue/Wed/Thu/Fri/Sat/Sun
    GROSS_REV:    "Gross revenue",      // number, dollar
    NET_REV:      "Net revenue",        // number, dollar
    TX_COUNT:     "Transaction count",  // number
    TAX:          "Tax collected",      // number, dollar
    TIPS:         "Tips",               // number, dollar
    DISCOUNTS:    "Discounts applied",  // number, dollar
    TENDER_CARD:  "Tender - card",      // number, dollar
    TENDER_CASH:  "Tender - cash",      // number, dollar
    TENDER_OTHER: "Tender - other"      // number, dollar
    // "Avg ticket" is a formula — not written by pipeline
    // "Notes" is editorial — not written by pipeline
  },

  // Taproom Sales by SKU by Week — exact Notion property names
  SKU: {
    TITLE:     "Title",           // title: "{Clover SKU name} — {week start ISO}" (natural key)
    WEEK_START:"Week start",      // date
    CATEGORY:  "Category",        // select: Beer/THC/Coffee/Food/Merch/Other
    SKU_NAME:  "Clover SKU name", // text
    REVENUE:   "Revenue",         // number, dollar
    UNITS:     "Units sold"       // number
    // "% of weekly taproom revenue" — computed later, not written by pipeline
    // "SKU mapping" — relation to SKU Mapping table, manually maintained
  },

  // Taproom Labor Daily — exact Notion property names
  LABOR: {
    DATE:       "Date",               // title (natural key)
    DAY_OF_WEEK:"Day of week",        // select: Mon/Tue/Wed/Thu/Fri/Sat/Sun
    HOURS:      "Total labor hours",  // number
    COST:       "Labor cost",         // number, dollar
    HEADCOUNT:  "Headcount",          // number
    QUALITY:    "Data quality"        // select: Clean/Partial/Estimated/Missing
    // "Notes" is editorial — not written by pipeline
  }
};

function CLOVER_apiToken_() {
  var t = PropertiesService.getScriptProperties().getProperty("CLOVER_API_TOKEN");
  if (!t) throw new Error("CLOVER_API_TOKEN not set in Script Properties.");
  return t;
}

function CLOVER_merchantId_() {
  var m = PropertiesService.getScriptProperties().getProperty("CLOVER_MERCHANT_ID");
  if (!m) throw new Error("CLOVER_MERCHANT_ID not set in Script Properties.");
  return m;
}

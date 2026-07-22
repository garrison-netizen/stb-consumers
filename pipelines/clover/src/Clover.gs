// ============================================================
// Clover API fetch layer.
// Sandbox: sandbox.dev.clover.com — token auth via Script Property.
// Production: api.clover.com — update CLOVER.API_BASE in Config.gs.
//
// Clover uses limit/offset pagination (max 200/page).
// Amounts are in cents throughout — divide by 100 in Transform.gs.
// ============================================================

function CLV_headers_() {
  return {
    "Authorization": "Bearer " + CLOVER_apiToken_(),
    "Accept": "application/json"
  };
}

// Paginate through all results for a given merchant endpoint + filter string.
function CLV_fetchAll_(endpoint, filterQS) {
  var mId  = CLOVER_merchantId_();
  var base = CLOVER.API_BASE + "/v3/merchants/" + mId + endpoint;
  var all  = [];
  var offset = 0;
  var limit  = 200;
  while (true) {
    var url = base + "?limit=" + limit + "&offset=" + offset + (filterQS ? "&" + filterQS : "");
    var resp = UrlFetchApp.fetch(url, {
      method: "GET",
      headers: CLV_headers_(),
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code !== 200) {
      throw new Error("Clover " + code + " on " + endpoint + ": " +
        resp.getContentText().substring(0, 300));
    }
    var body   = JSON.parse(resp.getContentText());
    var batch  = body.elements || [];
    all = all.concat(batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return all;
}

// Fetch all paid orders in a date range, expanding lineItems, payments,
// and discounts. Clover createdTime filters are in milliseconds (Unix epoch).
// The fetch window is widened ±12h around the UTC day boundaries so that
// Houston-local days (UTC-5/-6) are fully covered; Pipeline.gs re-filters
// each order to the exact local-date range after fetch.
function CLV_fetchOrders_(startISO, endISO) {
  var start = new Date(startISO + "T00:00:00Z").getTime() - 12 * 3600000;
  var end   = new Date(endISO   + "T23:59:59Z").getTime() + 12 * 3600000;
  return CLV_fetchOrdersWindow_(start, end);
}

// Clover's offset pagination silently stops at ~1000 records — the
// 2026-07-22 backfill "completed" with only the most recent 1000 orders
// (nothing before 2026-03-01). Any window that comes back with >= 1000
// records is treated as truncated and split in half recursively until
// every window fits under the cap.
function CLV_fetchOrdersWindow_(startMs, endMs) {
  return CLV_fetchWindowed_("/orders", "expand=lineItems,payments,discounts", startMs, endMs);
}

function CLV_fetchWindowed_(endpoint, extraQS, startMs, endMs) {
  var res = CLV_fetchAll_(
    endpoint,
    "filter=createdTime%3E%3D" + startMs +
    "&filter=createdTime%3C%3D" + endMs +
    (extraQS ? "&" + extraQS : "")
  );
  if (res.length >= 1000 && (endMs - startMs) > 3600000) {
    var mid = Math.floor((startMs + endMs) / 2);
    Logger.log("[CLV] " + endpoint + " window hit pagination cap (" + res.length +
               "); splitting " + new Date(startMs).toISOString().substring(0, 10) +
               ".." + new Date(endMs).toISOString().substring(0, 10));
    return CLV_fetchWindowed_(endpoint, extraQS, startMs, mid)
      .concat(CLV_fetchWindowed_(endpoint, extraQS, mid + 1, endMs));
  }
  return res;
}

// Fetch all payments in a date range. Used for the pre-2026-03 history
// rebuild: Clover purged old ORDER records from the API but kept payment
// records (verified by cloverProbe2025 on 2026-07-22 — June 2025 orders
// return 0, June 2025 payments return data).
function CLV_fetchPayments_(startISO, endISO) {
  var start = new Date(startISO + "T00:00:00Z").getTime() - 12 * 3600000;
  var end   = new Date(endISO   + "T23:59:59Z").getTime() + 12 * 3600000;
  return CLV_fetchWindowed_("/payments", "expand=tender", start, end);
}

// Fetch the merchant's tender registry: { tenderId → { label, labelKey } }.
// Production payments carry only a bare tender reference (id) — the
// label/labelKey needed for card-vs-cash classification live here.
function CLV_fetchTenderMap_() {
  var tenders = CLV_fetchAll_("/tenders", "");
  var map = {};
  (tenders || []).forEach(function(t) {
    map[t.id] = { label: t.label || "", labelKey: t.labelKey || "" };
  });
  return map;
}

// Fetch all inventory items with their categories.
// Returns a lookup map: { itemId → { name: string, category: string } }
// Category is already mapped to a Notion-ready value (Beer/THC/Coffee/Food/Merch/Other).
function CLV_fetchItemMap_() {
  var items = CLV_fetchAll_("/items", "expand=categories");
  var map   = {};
  (items || []).forEach(function(item) {
    var cloverCat = "Other";
    var cats = (item.categories && item.categories.elements) || [];
    if (cats.length > 0) cloverCat = cats[0].name || "Other";
    map[item.id] = {
      name:     item.name || ("item-" + item.id),
      category: CLV_mapCategory_(cloverCat)
    };
  });
  return map;
}

// Fetch all employee shifts in a date range.
// inTime (clock-in) is used for date bucketing; outTime for hours calc.
function CLV_fetchShifts_(startISO, endISO) {
  var start = new Date(startISO + "T00:00:00Z").getTime() - 12 * 3600000;
  var end   = new Date(endISO   + "T23:59:59Z").getTime() + 12 * 3600000;
  return CLV_fetchAll_(
    "/shifts",
    // Filter fields are snake_case (in_time) even though the response JSON
    // is camelCase (inTime) — production API rejects camelCase filters.
    "filter=in_time%3E%3D" + start +
    "&filter=in_time%3C%3D" + end +
    "&expand=employee,wage"
  );
}

// Map a Clover category name to the Notion Category select option.
// Clover-native categories confirmed by Garrison 2026-05-11.
function CLV_mapCategory_(cloverCat) {
  var c = String(cloverCat || "").toLowerCase();
  if (c.indexOf("thc") >= 0 || c.indexOf("cannabis") >= 0 || c.indexOf("hemp") >= 0) return "THC";
  if (c.indexOf("beer") >= 0 || c.indexOf("brew") >= 0 || c.indexOf("tap") >= 0 ||
      c.indexOf("draft") >= 0 || c.indexOf("cider") >= 0) return "Beer";
  if (c.indexOf("coffee") >= 0 || c.indexOf("espresso") >= 0 || c.indexOf("latte") >= 0) return "Coffee";
  if (c.indexOf("food") >= 0 || c.indexOf("snack") >= 0 || c.indexOf("kitchen") >= 0 ||
      c.indexOf("bite") >= 0) return "Food";
  if (c.indexOf("merch") >= 0 || c.indexOf("apparel") >= 0 || c.indexOf("glass") >= 0 ||
      c.indexOf("shirt") >= 0 || c.indexOf("hat") >= 0) return "Merch";
  return "Other";
}

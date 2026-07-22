// ============================================================
// Pure aggregations: Clover order/shift arrays → Notion property
// payloads. No I/O here (unit-reviewable core).
//
// Natural keys (idempotent, one row per bucket):
//   Taproom Daily:       dateISO (YYYY-MM-DD) — the "Date" title field
//   Taproom SKU by Week: "{SKU name} — {week start ISO}" — the Title field
//   Taproom Labor Daily: dateISO (YYYY-MM-DD) — the "Date" title field
//
// DURABLE LEARNING from Mailchimp: Notion `date.equals` does NOT treat
// datetime-vs-date as equal under Notion-Version 2025-09-03. All dates
// must be stored and filtered as date-only (YYYY-MM-DD). See CLV_dateISO_.
// ============================================================

var CLV_DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// A real sale = an order that was actually paid. Clover's orders feed
// includes abandoned register carts, test rings, and never-paid tabs;
// counting them produced $0-revenue ghost days on dates the taproom was
// closed, and inflated gross on real days (orders with a total but no
// payment). Trade-off: a 100%-comped order (total 0, no payment) drops
// out, so its discount isn't tracked — acceptable for a signal layer.
function CLV_isRealSale_(order) {
  return !!(order.payments && order.payments.elements &&
            order.payments.elements.length > 0);
}

// Convert a Clover millisecond timestamp to YYYY-MM-DD in HOUSTON local
// time (America/Chicago). UTC bucketing shifted all evening sales (after
// 6-7pm CT) onto the next calendar day — worst possible skew for a taproom
// whose volume is evenings. Utilities.formatDate handles CST/CDT for us.
function CLV_dateISO_(ms) {
  return Utilities.formatDate(new Date(parseInt(ms, 10)), "America/Chicago", "yyyy-MM-dd");
}

// ISO date of the Monday starting the week for a given YYYY-MM-DD.
// Week buckets are Monday-Sunday (ISO week convention).
function CLV_weekStart_(dateISO) {
  var d   = new Date(dateISO + "T12:00:00Z");
  var day = d.getUTCDay();              // 0=Sun … 6=Sat
  var diff = (day === 0) ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().substring(0, 10);
}

// ISO date of the Sunday ending the week containing a given YYYY-MM-DD.
function CLV_weekEnd_(dateISO) {
  var d = new Date(CLV_weekStart_(dateISO) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().substring(0, 10);
}

// --- Taproom Daily aggregation ---

// Aggregate orders → daily rollup map.
// Returns: { "YYYY-MM-DD": { grossRev, netRev, txCount, tax, tips, discounts, card, cash, other } }
// All amounts in dollars (converted from Clover cents).
// tenderMap: { tenderId → { label, labelKey } } from CLV_fetchTenderMap_.
// Production quirks this handles (all bit us on the 2026-07-22 dry run):
//   - tax/tips live on each PAYMENT (pmt.taxAmount/pmt.tipAmount), not the order
//   - payments carry a bare tender reference; classification needs the
//     tender registry (labelKey like "com.clover.tender.credit_card") or
//     the presence of pmt.cardTransaction
//   - order-level discounts arrive via expand=discounts as an elements array
function CLV_aggregateDaily_(orders, tenderMap) {
  tenderMap = tenderMap || {};
  var days = {};
  (orders || []).forEach(function(order) {
    if (!order.createdTime || !CLV_isRealSale_(order)) return;
    var d = CLV_dateISO_(order.createdTime);
    if (!days[d]) {
      days[d] = { grossRev: 0, netRev: 0, txCount: 0, tax: 0, tips: 0,
                  discounts: 0, card: 0, cash: 0, other: 0 };
    }
    var day = days[d];
    day.txCount++;
    day.grossRev += (order.total || 0) / 100;

    var discs = (order.discounts && order.discounts.elements) || [];
    if (discs.length > 0) {
      discs.forEach(function(dc) { day.discounts += Math.abs(dc.amount || 0) / 100; });
    } else {
      day.discounts += (order.discountAmount || 0) / 100;
    }

    ((order.payments && order.payments.elements) || []).forEach(function(pmt) {
      var amt = (pmt.amount || 0) / 100;
      day.tax  += (pmt.taxAmount || 0) / 100;
      day.tips += (pmt.tipAmount || 0) / 100;

      var reg   = (pmt.tender && tenderMap[pmt.tender.id]) || {};
      var label = String(reg.label || (pmt.tender && pmt.tender.label) || "").toLowerCase();
      var lkey  = String(reg.labelKey || "").toLowerCase();
      var isCard = lkey.indexOf("credit") >= 0 || lkey.indexOf("debit") >= 0 ||
                   label.indexOf("card") >= 0 || label.indexOf("credit") >= 0 ||
                   label.indexOf("debit") >= 0 || !!pmt.cardTransaction;
      var isCash = lkey.indexOf("com.clover.tender.cash") >= 0 || label === "cash";
      if (isCard)      day.card  += amt;
      else if (isCash) day.cash  += amt;
      else             day.other += amt;
    });
    day.netRev = day.grossRev - day.tax;
  });
  return days;
}

function CLV_dailyProps_(dateISO, agg) {
  var dow = CLV_DAY_NAMES[new Date(dateISO + "T12:00:00Z").getUTCDay()];
  var p   = {};
  p[CLOVER.DAILY.DATE]         = STB_pTitle_(dateISO);
  p[CLOVER.DAILY.DAY_OF_WEEK]  = STB_pSelect_(dow);
  p[CLOVER.DAILY.GROSS_REV]    = STB_pNumber_(CLV_round2_(agg.grossRev));
  p[CLOVER.DAILY.NET_REV]      = STB_pNumber_(CLV_round2_(agg.netRev));
  p[CLOVER.DAILY.TX_COUNT]     = STB_pNumber_(agg.txCount);
  p[CLOVER.DAILY.TAX]          = STB_pNumber_(CLV_round2_(agg.tax));
  p[CLOVER.DAILY.TIPS]         = STB_pNumber_(CLV_round2_(agg.tips));
  p[CLOVER.DAILY.DISCOUNTS]    = STB_pNumber_(CLV_round2_(agg.discounts));
  p[CLOVER.DAILY.TENDER_CARD]  = STB_pNumber_(CLV_round2_(agg.card));
  p[CLOVER.DAILY.TENDER_CASH]  = STB_pNumber_(CLV_round2_(agg.cash));
  p[CLOVER.DAILY.TENDER_OTHER] = STB_pNumber_(CLV_round2_(agg.other));
  return p;
}

// Natural-key filter: Date title = dateISO
function CLV_dailyFilter_(dateISO) {
  return { property: CLOVER.DAILY.DATE, rich_text: { equals: dateISO } };
}

// --- Taproom SKU by Week aggregation ---

// Aggregate orders → SKU-week map.
// itemMap: { itemId → { name, category } } from CLV_fetchItemMap_.
// Returns: { "{name} — {weekISO}": { skuName, category, weekStart, revenue, units } }
function CLV_aggregateSkuWeek_(orders, itemMap) {
  var buckets = {};
  (orders || []).forEach(function(order) {
    if (!order.createdTime || !CLV_isRealSale_(order)) return;
    var week = CLV_weekStart_(CLV_dateISO_(order.createdTime));
    ((order.lineItems && order.lineItems.elements) || []).forEach(function(li) {
      var itemId = li.item && li.item.id;
      var info   = (itemId && itemMap[itemId]) || { name: li.name || "Unknown", category: "Other" };
      var key    = info.name + " — " + week; // em-dash separator
      if (!buckets[key]) {
        buckets[key] = { skuName: info.name, category: info.category,
                         weekStart: week, revenue: 0, units: 0 };
      }
      buckets[key].units++;
      // li.price is unit price in cents; li.unitQty is quantity (default 1000 = 1 unit in Clover)
      var qty = li.unitQty ? li.unitQty / 1000 : 1;
      buckets[key].revenue += ((li.price || 0) * qty) / 100;
    });
  });
  return buckets;
}

function CLV_skuWeekProps_(key, b) {
  var p = {};
  p[CLOVER.SKU.TITLE]      = STB_pTitle_(key);
  p[CLOVER.SKU.WEEK_START] = STB_pDateISO_(b.weekStart);
  p[CLOVER.SKU.CATEGORY]   = STB_pSelect_(b.category);
  p[CLOVER.SKU.SKU_NAME]   = STB_pRichText_(b.skuName);
  p[CLOVER.SKU.REVENUE]    = STB_pNumber_(CLV_round2_(b.revenue));
  p[CLOVER.SKU.UNITS]      = STB_pNumber_(b.units);
  return p;
}

// Natural-key filter: Title = composite key string
function CLV_skuWeekFilter_(key) {
  return { property: CLOVER.SKU.TITLE, rich_text: { equals: key } };
}

// --- Taproom Labor Daily aggregation ---

// Aggregate shifts → labor-day map.
// Returns: { "YYYY-MM-DD": { hours, cost, headcount, quality } }
// quality: "Clean" unless any shift is missing outTime ("Partial").
function CLV_aggregateLabor_(shifts) {
  var days = {};
  (shifts || []).forEach(function(shift) {
    if (!shift.inTime) return;
    var d = CLV_dateISO_(shift.inTime);
    if (!days[d]) days[d] = { hours: 0, cost: 0, headcount: 0, quality: "Clean" };
    var day = days[d];
    day.headcount++;
    if (shift.outTime) {
      var hrs = (shift.outTime - shift.inTime) / 3600000; // ms → hours
      day.hours += hrs;
      // wage is in cents/hour; cost = wage_dollars * hours
      var wageCents = (shift.wage && shift.wage.wage) || 0;
      day.cost += (wageCents / 100) * hrs;
    } else {
      day.quality = "Partial"; // shift still open or clock-out missing
    }
  });
  return days;
}

function CLV_laborProps_(dateISO, agg) {
  var dow = CLV_DAY_NAMES[new Date(dateISO + "T12:00:00Z").getUTCDay()];
  var p   = {};
  p[CLOVER.LABOR.DATE]        = STB_pTitle_(dateISO);
  p[CLOVER.LABOR.DAY_OF_WEEK] = STB_pSelect_(dow);
  p[CLOVER.LABOR.HOURS]       = STB_pNumber_(CLV_round2_(agg.hours));
  p[CLOVER.LABOR.COST]        = STB_pNumber_(CLV_round2_(agg.cost));
  p[CLOVER.LABOR.HEADCOUNT]   = STB_pNumber_(agg.headcount);
  p[CLOVER.LABOR.QUALITY]     = STB_pSelect_(agg.quality);
  return p;
}

// Natural-key filter: Date title = dateISO
function CLV_laborFilter_(dateISO) {
  return { property: CLOVER.LABOR.DATE, rich_text: { equals: dateISO } };
}

// Round to 2 decimal places for dollar/hour values.
function CLV_round2_(n) { return Math.round((n || 0) * 100) / 100; }

// ============================================================
// Render.gs — dashboard model → Notion blocks, plus the page
// rewrite. Block-children calls use Notion-Version 2022-06-28
// (data-source queries use 2025-09-03 — documented split).
//
// SAFETY (mechanical, not behavioral): the first block the pipeline
// writes is a callout starting with PED.MARKER. On refresh, a
// non-empty page whose first block is NOT that marker is treated as
// "not ours" and the run aborts before deleting anything. A wrong
// PE_DASHBOARD_PAGE_ID can therefore never destroy another page.
// ============================================================

var PED_BLOCKS_VERSION = "2022-06-28";

function PED_blockHeaders_() {
  return {
    "Authorization": "Bearer " + STB_notionKey_(),
    "Notion-Version": PED_BLOCKS_VERSION
  };
}

// ---- Page rewrite ----------------------------------------------

function PED_writeDashboard_(model) {
  var pageId = PED_pageId_();
  var existing = PED_listChildren_(pageId);

  if (existing.length > 0) {
    var first = existing[0];
    var firstText = PED_blockPlainText_(first);
    if (firstText.indexOf(PED.MARKER) !== 0) {
      throw new Error("Refusing to clear page " + pageId + ": it has " + existing.length +
        " blocks and the first is not the pipeline marker. If this IS the intended " +
        "dashboard page, empty it manually once; the pipeline stamps it from then on.");
    }
  }

  existing.forEach(function(b) { PED_retry_(function() { PED_deleteBlock_(b.id); }); });

  var blocks = PED_render_(model);
  PED_appendChildren_(pageId, blocks);
  return blocks.length;
}

function PED_listChildren_(pageId) {
  var out = [], cursor = null, guard = 0;
  do {
    var url = "https://api.notion.com/v1/blocks/" + pageId + "/children?page_size=100" +
              (cursor ? "&start_cursor=" + encodeURIComponent(cursor) : "");
    var resp = UrlFetchApp.fetch(url, { method: "get", headers: PED_blockHeaders_(), muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      throw new Error("Notion list children " + resp.getResponseCode() + " for " + pageId +
        ": " + resp.getContentText().substring(0, 200));
    }
    var body = JSON.parse(resp.getContentText());
    out = out.concat(body.results || []);
    cursor = body.has_more ? body.next_cursor : null;
    guard++;
  } while (cursor && guard < 50);
  return out;
}

function PED_deleteBlock_(blockId) {
  var resp = UrlFetchApp.fetch("https://api.notion.com/v1/blocks/" + blockId, {
    method: "delete", headers: PED_blockHeaders_(), muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code !== 200) throw new Error("Notion delete block " + code + ": " + resp.getContentText().substring(0, 200));
}

function PED_appendChildren_(pageId, blocks) {
  for (var i = 0; i < blocks.length; i += 50) {   // API cap is 100/call; 50 keeps payloads small
    var chunk = blocks.slice(i, i + 50);
    PED_retry_(function() {
      var resp = UrlFetchApp.fetch("https://api.notion.com/v1/blocks/" + pageId + "/children", {
        method: "patch",
        contentType: "application/json",
        headers: PED_blockHeaders_(),
        payload: JSON.stringify({ children: chunk }),
        muteHttpExceptions: true
      });
      var code = resp.getResponseCode();
      if (code !== 200) throw new Error("Notion append " + code + ": " + resp.getContentText().substring(0, 300));
    });
  }
}

function PED_blockPlainText_(block) {
  var t = block.type, v = block[t] || {};
  return (v.rich_text || []).map(function(it) { return it.plain_text || ""; }).join("");
}

// Same backoff discipline as the Triple Seat pipeline's TS_retry429_.
function PED_retry_(fn) {
  var last;
  for (var attempt = 0; attempt < 5; attempt++) {
    try { return fn(); }
    catch (e) {
      last = e;
      var m = String(e.message || "").toLowerCase();
      if (m.indexOf(" 429") >= 0 || m.indexOf(" 409") >= 0 ||
          m.indexOf("rate_limited") >= 0 || m.indexOf("conflict") >= 0) {
        Utilities.sleep(800 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
  throw last;
}

// ---- Block builders --------------------------------------------

function PED_rt_(s, bold) {
  var it = { type: "text", text: { content: String(s == null ? "" : s) } };
  if (bold) it.annotations = { bold: true };
  return it;
}
function PED_h2_(s)   { return { object: "block", type: "heading_2", heading_2: { rich_text: [PED_rt_(s)] } }; }
function PED_h3_(s)   { return { object: "block", type: "heading_3", heading_3: { rich_text: [PED_rt_(s)] } }; }
function PED_para_(parts) { return { object: "block", type: "paragraph", paragraph: { rich_text: parts } }; }
function PED_divider_()   { return { object: "block", type: "divider", divider: {} }; }
function PED_callout_(parts, icon, color) {
  return { object: "block", type: "callout",
    callout: { rich_text: parts, icon: { type: "emoji", emoji: icon || "📊" }, color: color || "gray_background" } };
}
function PED_tableRow_(cells, boldRow) {
  return { type: "table_row", table_row: { cells: cells.map(function(c) { return [PED_rt_(c, !!boldRow)]; }) } };
}
function PED_table_(header, rows) {
  var children = [PED_tableRow_(header, true)].concat(rows.map(function(r) { return PED_tableRow_(r); }));
  return { object: "block", type: "table",
    table: { table_width: header.length, has_column_header: true, has_row_header: false, children: children } };
}

// ---- The dashboard itself --------------------------------------

function PED_render_(m) {
  var blocks = [];
  var k = m.kpis;

  // Marker + refresh stamp — MUST stay the first block (see safety note).
  blocks.push(PED_callout_([
    PED_rt_(PED.MARKER + " — last refreshed " + m.generatedAt +
      ". Edits to this page are overwritten daily.")
  ], "⚙️", "gray_background"));

  // KPI strip
  var vsLY = k.ytdLastYear > 0
    ? Math.round(100 * (k.ytdRevenue - k.ytdLastYear) / k.ytdLastYear) : null;
  blocks.push(PED_callout_([
    PED_rt_("YTD event revenue: ", true), PED_rt_(PED_money_(k.ytdRevenue) + " across " + k.ytdEvents + " events"),
    PED_rt_(vsLY === null ? "" : "  (" + (vsLY >= 0 ? "+" : "") + vsLY + "% vs same point last year)"),
    PED_rt_("   •   Next 30 days: ", true), PED_rt_(k.next30Count + " events, " + PED_money_(k.next30Revenue) + " booked"),
    PED_rt_("   •   Open leads: ", true), PED_rt_(String(k.openLeads))
  ], "💰", "blue_background"));

  // Needs attention
  var a = m.attention;
  if (a.unpaidBalances.length || a.unpaidDeposits.length || a.staleLeads.length) {
    blocks.push(PED_h2_("Needs attention"));
    if (a.unpaidBalances.length) {
      blocks.push(PED_h3_("Unpaid balances — past events (" + PED_money_(a.unpaidBalanceTotal) + " outstanding)"));
      blocks.push(PED_table_(["Event date", "Event", "Revenue", "Deposit", "Rep"],
        a.unpaidBalances.map(function(b) {
          return [b.eventDate, b.title, PED_money_(PED_rev_(b)), b.depositPaid ? "paid" : "UNPAID", b.rep || ""];
        })));
    }
    if (a.unpaidDeposits.length) {
      blocks.push(PED_h3_("Upcoming events with no deposit"));
      blocks.push(PED_table_(["Event date", "Event", "Revenue", "Deposit due", "Rep"],
        a.unpaidDeposits.map(function(b) {
          return [b.eventDate, b.title, PED_money_(PED_rev_(b)),
                  b.depositAmt != null ? PED_money_(b.depositAmt) : "—", b.rep || ""];
        })));
    }
    if (a.staleLeads.length) {
      blocks.push(PED_h3_("Pending leads older than " + PED.STALE_LEAD_DAYS + " days (" + a.staleLeads.length + ")"));
      blocks.push(PED_table_(["Created", "Lead", "Event type", "Requested date", "Source"],
        a.staleLeads.slice(0, 15).map(function(l) {
          return [l.createdAt, l.title, l.eventType || "", l.reqDate || "—", l.source];
        })));
      if (a.staleLeads.length > 15) {
        blocks.push(PED_para_([PED_rt_("…and " + (a.staleLeads.length - 15) + " more in Triple Seat Leads.")]));
      }
    }
  }

  // Upcoming events
  blocks.push(PED_h2_("Upcoming events — next " + PED.UPCOMING_DAYS + " days"));
  if (m.upcoming.length) {
    blocks.push(PED_table_(["Date", "Event", "Headcount", "Revenue", "Deposit", "Balance", "Rep"],
      m.upcoming.map(function(u) {
        return [u.date, u.title, u.headcount != null ? String(u.headcount) : "—",
                PED_money_(u.revenue), u.depositPaid ? "✓" : "✗", u.balancePaid ? "✓" : "✗", u.rep || ""];
      })));
  } else {
    blocks.push(PED_para_([PED_rt_("Nothing on the books in this window.")]));
  }

  // Monthly revenue
  blocks.push(PED_h2_("Event revenue by month"));
  blocks.push(PED_table_(["Month", "Events", "Revenue", "Bar sales", "Last year", "Δ vs LY"],
    m.monthly.map(function(r) {
      var delta = (r.lastYear > 0 || r.revenue > 0) ? PED_money_(r.revenue - r.lastYear) : "—";
      return [r.month, r.events ? String(r.events) : "—",
              PED_money_(r.revenue), r.bar ? PED_money_(r.bar) : "—",
              r.lastYear ? PED_money_(r.lastYear) : "—", delta];
    })));

  // Lead funnel
  var f = m.funnel;
  blocks.push(PED_h2_("Lead funnel — trailing " + f.windowDays + " days"));
  blocks.push(PED_para_([
    PED_rt_(f.total + " leads", true),
    PED_rt_(" — " + (f.byStatus.Booked || 0) + " booked (" + f.conversionPct + "% conversion), " +
            (f.byStatus.Pending || 0) + " pending, " +
            ((f.byStatus.Lost || 0) + (f.byStatus.Passed || 0)) + " lost/passed.")
  ]));
  if (f.topSources.length) {
    blocks.push(PED_table_(["Lead source", "Leads", "Booked"],
      f.topSources.map(function(s) { return [s.source, String(s.leads), String(s.booked)]; })));
  }

  blocks.push(PED_divider_());
  blocks.push(PED_para_([PED_rt_(
    "Data: Private Events databases (Triple Seat daily sync). Revenue = actual when recorded, else quoted; cancelled events excluded.")]));

  return blocks;
}

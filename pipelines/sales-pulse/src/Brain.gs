// ============================================================
// Brain.gs — pulls live context from Notion for the prompt.
//
// Two reads:
//   1. Section 4 Distribution page block children (distributor
//      directory + AI context rules — stable doctrine).
//   2. Living Archive entries (last N days, Sales dept) —
//      recent meeting notes, flags, decisions.
//
// Returns a single string injected into the Claude prompt.
// ============================================================

function SP_brainContext_() {
  var parts = [];

  try {
    parts.push("=== DISTRIBUTOR DIRECTORY & AI CONTEXT RULES (Brain Section 4) ===");
    parts.push(SP_readDistributionPage_());
  } catch (e) {
    Logger.log("WARN Brain Section 4 read failed: " + e.message);
    parts.push("[Section 4 unavailable — using hardcoded fallback below]");
    parts.push(SP_distributionFallback_());
  }

  try {
    var archive = SP_recentLivingArchive_();
    if (archive) {
      parts.push("\n=== RECENT LIVING ARCHIVE — SALES/DISTRIBUTION (last " +
        SP.LIVING_ARCHIVE_LOOKBACK_DAYS + " days) ===");
      parts.push(archive);
    }
  } catch (e) {
    Logger.log("WARN Living Archive read failed: " + e.message);
  }

  return parts.join("\n\n");
}

// Reads block children of the Section 4 Distribution page and
// flattens them to plain text. Notion-Version 2022-06-28 for
// block children (proven v6.3 pattern).
function SP_readDistributionPage_() {
  var url = "https://api.notion.com/v1/blocks/" +
    SP.DISTRIBUTION_PAGE_ID + "/children?page_size=100";
  var resp = UrlFetchApp.fetch(url, {
    method: "GET",
    headers: {
      "Authorization": "Bearer " + STB_notionKey_(),
      "Notion-Version": "2022-06-28"
    },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error("Block children " + resp.getResponseCode() + ": " + resp.getContentText());
  }
  var blocks = JSON.parse(resp.getContentText()).results || [];
  return SP_blocksToText_(blocks);
}

// Converts a flat array of Notion blocks to a readable string.
// Handles heading_1/2/3, paragraph, bulleted/numbered list,
// callout, quote, divider. Ignores child_page and databases.
function SP_blocksToText_(blocks) {
  var lines = [];
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    var type = b.type;
    var rich = (b[type] && b[type].rich_text) ? b[type].rich_text : null;
    var text = rich ? SP_richTextToPlain_(rich) : "";
    if (!text && type !== "divider") continue;
    switch (type) {
      case "heading_1": lines.push("# " + text); break;
      case "heading_2": lines.push("## " + text); break;
      case "heading_3": lines.push("### " + text); break;
      case "paragraph": lines.push(text); break;
      case "bulleted_list_item": lines.push("- " + text); break;
      case "numbered_list_item": lines.push("• " + text); break;
      case "callout":   lines.push("[NOTE] " + text); break;
      case "quote":     lines.push("> " + text); break;
      case "divider":   lines.push("---"); break;
    }
  }
  return lines.join("\n");
}

function SP_richTextToPlain_(rich) {
  return (rich || []).map(function(r) { return r.plain_text || ""; }).join("");
}

// Queries Living Archive for entries created in the last N days
// where Department contains "Sales" or "Distribution".
function SP_recentLivingArchive_() {
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SP.LIVING_ARCHIVE_LOOKBACK_DAYS);
  var cutoffISO = cutoff.toISOString().split("T")[0];

  var filter = {
    and: [
      {
        property: "Date",
        date: { on_or_after: cutoffISO }
      },
      {
        or: [
          { property: "Department", multi_select: { contains: "Sales" } },
          { property: "Department", multi_select: { contains: "Distribution" } }
        ]
      }
    ]
  };

  var url = "https://api.notion.com/v1/data_sources/" +
    SP.LIVING_ARCHIVE_DS + "/query";
  var resp = UrlFetchApp.fetch(url, {
    method: "POST",
    contentType: "application/json",
    headers: STB_notionHeaders_(),
    payload: JSON.stringify({ filter: filter, page_size: 20,
      sorts: [{ property: "Date", direction: "descending" }] }),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error("Living Archive query " + resp.getResponseCode() +
      ": " + resp.getContentText());
  }
  var rows = JSON.parse(resp.getContentText()).results || [];
  if (rows.length === 0) return null;

  return rows.map(function(row) {
    var p = row.properties || {};
    var title = SP_propText_(p["Name"] || p["Title"] || p["title"]);
    var date  = SP_propDate_(p["Date"]);
    var body  = SP_propText_(p["Summary"] || p["Body"] || p["Notes"]);
    var dept  = SP_propMultiSelect_(p["Department"]);
    return "[" + date + "] " + title + (dept ? " [" + dept + "]" : "") +
      (body ? "\n  " + body : "");
  }).join("\n\n");
}

// Property value extractors for Living Archive rows.
function SP_propText_(prop) {
  if (!prop) return "";
  var t = prop.type;
  var v = prop[t];
  if (!v) return "";
  if (Array.isArray(v)) return v.map(function(r) { return r.plain_text || ""; }).join("");
  return "";
}

function SP_propDate_(prop) {
  if (!prop || !prop.date) return "";
  return prop.date.start || "";
}

function SP_propMultiSelect_(prop) {
  if (!prop || !prop.multi_select) return "";
  return prop.multi_select.map(function(s) { return s.name; }).join(", ");
}

// Hardcoded fallback — key doctrine if Section 4 is unreachable.
// Mirrors the Critical AI Context block from Brain Section 4.
function SP_distributionFallback_() {
  return [
    "DISTRIBUTOR OVERVIEW:",
    "1. Standard Sales — Beer Only — West TX, Panhandle, Central TX, DFW metro",
    "2. L&F Distributors — Beer Only — Far West TX / Trans-Pecos",
    "3. Silver Eagle Distributing — Beer & THC — Harris County + Fort Bend + Houston metro. Primary volume partner. Key accounts: HEB, Specs, Total Wine, Yard House. VIP may show phantom Houston inventory after Cypress consolidation (April 2026) — treat as data artifact.",
    "4. Wismer Distributing — Beer Only — Galveston, Brazoria, SE Houston metro",
    "5. Dynamo Specialty — Beer & THC — Central TX + DFW (new April 2026, absorbed from Green Light). Benchmark DFW separately from Central TX. ~2 weeks inventory on hand standing practice.",
    "6. Green Light — TERMINATED mid-2025 (failure to pay). DFW now Dynamo.",
    "",
    "CRITICAL AI CONTEXT:",
    "HEB Reset: Spring 2023 mandate 150+ HEB stores for Houston Hustle + RTD brands. Lost majority in 2024 HEB restructuring. YoY volume declines on Houston Hustle and RTD = distribution loss, NOT brand failure. HEB door count recovery is a 2026 primary objective.",
    "2024 Dual Catastrophe: June 2024 had both a product recall (seamer issue) AND TABC license loss simultaneously. Do not use 2024 as a normal baseline year.",
    "Dynamo DFW: Volume growth expected and normal. DFW was unserved H2 2025 after Green Light termination. Do not flag as anomalous.",
    "Central (Arkansas) YoY: ~170 CE appeared in 2025 from a dormant distributor. Treat as anomalous baseline, not lost business.",
    "Industry context: STB has experienced ~50% YoY volume decline over 5 years (industry-wide craft decline, HEB reset, 2024 events). Contextualize all performance accordingly.",
    "Benchmarking: Flag territory >20% WoW decline. Flag accounts with zero activity >4 weeks (at-risk)."
  ].join("\n");
}

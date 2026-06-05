// ============================================================
// SPINDLETAP BEVERAGES — Weekly Executive Pulse  (v6.3)
// Google Apps Script
//
// CHANGES FROM V6.1:
//
// 1. SCHEMA BUG FIXES (three silent-failure bugs).
//    v6.1's PULSE_QUERY_FIELDS whitelist contained property names
//    that did not exist on the live data sources. The whitelist
//    pattern silently skips missing properties, so v6.1 was rendering
//    these queries with the title and key fields stripped out —
//    technically "working" but delivering empty or near-empty content
//    to Claude. Each fixed below:
//
//      OPERATING_DOCTRINE: "Principle" → "Title"
//        (doctrine title field is "Title", not "Principle")
//      LIVING_ARCHIVE:     "Name" → "Title"
//        (archive title field is "Title", not "Name")
//      DECISION_PIPELINE:  removed "Stakes" and "Owner" (don't exist);
//                          added "Context" (the prose field) and
//                          "Target resolution"
//
//    All verified against live Notion data sources 2026-05-11.
//
// 2. INTAKE QUEUE FILTER CHANGED — STRUCTURAL DATA-FEED GATE.
//    Was: Status = "Pending review"
//    Now: Status = "Routed"
//    Why: Pending review rows are pre-verification content. They
//    contain Advisor reconstructions of conversations, paraphrased
//    operational events, and captured-but-unverified source material
//    (e.g., personnel-sensitive employee data) that hasn't yet passed
//    the Architect's source-narrative verification step. A Pulse
//    running between Intake logging and Architect routing could land
//    that content in a report shared with Brody. Filtering to Routed
//    makes the Architect's verification step a structural gate, not
//    just a procedural one.
//
// 3. INTAKE QUEUE: ROUTED DATE ADDED to whitelist.
//    Now that we're showing routed items, Routed date is the relevant
//    recency signal (Date logged could be weeks or months old).
//
// 4. CROSS-AGENT CHANNEL QUERY ADDED.
//    New query block + new NOTION_DATABASES entry + new
//    PULSE_QUERY_FIELDS entry. Filters to Status in [Unread,
//    Acknowledged]. Body and Reply excluded (per Rule 7 of the
//    analytical-discipline block: surface as operational state, do
//    not paraphrase). Renders Subject, From, To, Type, Date sent,
//    Status only.
//
// 5. ANALYTICAL-DISCIPLINE BLOCK INJECTED INTO PROMPT.
//    New section prepended to userMessage in callClaudeAPI(). 9 rules
//    governing claim discipline:
//      1. No fabricated facts
//      2. No invented relations
//      3. No duration invention
//      4. Framed, not asserted, for judgment-class content
//      4b. Source quotation over synthesis (closes synthesis-drift
//          failure mode caught during 2026-05-10 fabrication incident)
//      5. Honest data gaps
//      6. Operational flags color interpretation
//      7. Cross-Agent Channel visibility (surface as operational
//         state; do not paraphrase message bodies)
//      8. No accumulation of bracketed speculation
//      9. No perspective-style framing for excluded content
//         (Executive Perspective is intentionally not in the feed;
//          do not reconstruct from references)
//
// 6. EXECUTIVE PERSPECTIVE INTENTIONALLY NOT QUERIED.
//    This Pulse is shared with Brody. Executive Perspective content
//    is Tier 3 (default) — held from future stakeholder advisors and
//    not appropriate for downstream distribution. Rule 9 of the
//    analytical-discipline block prevents the model from
//    reconstructing perspective content when it encounters references
//    to it in Brain content.
//
// 7. MODEL STRING UNCHANGED: claude-sonnet-4-6.
//    Verified against Claude API docs 2026-05-11. There is no Sonnet
//    4.7. The current family is Opus 4.7 (smartest) and Sonnet 4.6
//    (smart and cost-effective). Sonnet 4.6 is the right tier for
//    Pulse generation: instruction-following at acceptable cost.
//    Bumping to Opus 4.7 would multiply cost without changing the
//    output class. If Pulse output quality ever degrades on
//    instruction-following or fabrication despite the discipline
//    block, that's the trigger to reconsider.
//
// 8. ALL V6 / V6.1 ARCHITECTURE OTHERWISE UNCHANGED.
//    NOTION_DATABASES, NOTION_PAGES, queryNotionDatabase, format
//    contract, parser, HTML/Doc rendering — all untouched.
//
// LONG-TERM TOKEN GROWTH PLAN (carried forward from v6.1):
//   Stage 1 (v6.1): body-fetch toggle + property whitelist.
//   Stage 2 (when free headroom drops below ~20K tokens):
//     Living Archive digest pattern.
//   Stage 3 (only if Stages 1+2 stop holding):
//     Multi-call Pulse composition.
//
// MAINTENANCE NOTES:
// - When the Architect modifies Brain architecture, update both
//   NOTION_PAGES and NOTION_DATABASES blocks below.
// - When new database queries are added, add a property whitelist
//   to PULSE_QUERY_FIELDS for the new data source. The whitelist
//   pattern silently drops unknown property names — schema bugs
//   become invisible content gaps unless you verify the whitelist
//   names against the live data source.
// - The data_sources API requires the data_source_id (the collection
//   ID), NOT the database page ID. They look similar but they are
//   different.
//
// SETUP — RUN ONCE:
//   1. Project Settings → Script Properties → add:
//        CLAUDE_API_KEY    = sk-ant-...
//        NOTION_API_KEY    = ntn_...
//   2. Run setupWeeklyTrigger() once to schedule Mondays 7am CT
//   3. Run testNow() any time to generate a report immediately
//   4. Run testDatabaseQueries() to verify database fetches work
// ============================================================

var CONFIG = {
  ANTHROPIC_API_KEY: PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY'),
  NOTION_API_KEY:    PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY'),

  // Page IDs synced with Brain on 2026-05-09 (post-migration).
  // Page IDs persist through renames; only labels/sections changed.
  NOTION_PAGES: {
    // Persona — required first, frames everything that follows
    EXEC_PULSE_PROMPT:        "3591c57ac02b815a9a5dfce4912bf384",  // 6a

    // Section 1 — Company Identity
    COMPANY_IDENTITY:         "3591c57ac02b802db170cb90060180ad",
    BREWERY_HISTORY:          "3591c57ac02b802a9d0ddeaaba26387e",
    BREWERY_SOCIAL:           "3591c57ac02b80a4bb8cc29cf1f0be39",
    BRAND_BIBLE:              "3591c57ac02b80a79a94cd3e51c77170",
    COFFEE_HISTORY:           "3591c57ac02b806195a6c7d5f7da96df",
    COFFEE_SOCIAL:            "3591c57ac02b80cf956cce64fc2cbac6",
    THC_DIVISION_HISTORY:     "3591c57ac02b80fe8c3bc493e9d11378",

    // Section 2 — Data System Map (all 8 systems inline)
    DATA_SYSTEM_MAP:          "3591c57ac02b804e92ccfc1bdda4e756",

    // Section 3 — KPIs (sub-pages only; hub is just an index)
    BREWERY_KPIS:             "3591c57ac02b8048a0c6c445548368e0",
    COFFEE_KPIS:              "3591c57ac02b80f18d51d86c06d25f3e",

    // Section 4 — Distribution (all distributor + territory + critical context inline)
    DISTRIBUTION:             "3591c57ac02b807ead8df17d1e4535c4",

    // Section 5 — Human Resources (renamed from Personnel Roster 2026-05-09)
    HUMAN_RESOURCES:          "3591c57ac02b80669344cd3991910f59",
    EMPLOYEE_INBOX:           "d271c57ac02b8327aafc01ace99aef24",

    // Section 7 — Digital Brand Intelligence (all 7a–7f signals inline)
    DIGITAL_INTELLIGENCE:     "3591c57ac02b800da75ec99571234349",

    // Section 8 — Industry Context
    INDUSTRY_CRAFT_BEER:      "3591c57ac02b80c5a637cd98b3197eac",  // 8a
    INDUSTRY_HEMP_THC:        "3591c57ac02b804a85b8e00e03ec1cbc",  // 8b
    TX_HEMP_REGULATORY:       "35a1c57ac02b81a69664d31de87f8153",  // sub-page under 8b
    INDUSTRY_COFFEE:          "3591c57ac02b8096ae66ef58f8908083",  // 8c
    INDUSTRY_HOUSTON:         "3591c57ac02b807c9abdf7ddf2d9494a",  // 8d
    INDUSTRY_QTR_LOG:         "3591c57ac02b800aa90bebac183911e3",  // 8e

    // Section 9 — Financial Intelligence (renumbered from Section 10 on 2026-05-09)
    MARGIN_MODEL:             "35a1c57ac02b81e8991be7094a70faf6",  // 9a
    PRICING:                  "3591c57ac02b81c2b74bfd6d28f998ea",  // 9b
    FINANCIAL_TARGETS:        "3591c57ac02b819c894cd0711c59f9cb",  // 9c

    // Section 10 — Executive Console (renumbered from Section 11 on 2026-05-09)
    EXEC_CONSOLE:             "35a1c57ac02b8128af7ad9a2f808138c",
    INTAKE_REVIEW_PROCESS:    "35a1c57ac02b8155a307e6f63ac90ec4",  // sub-page

    // Top-level peers (no longer numbered sections post-migration)
    MEETING_NOTES:            "35a1c57ac02b8175b240ff2b11899cdb"
  },

  // Database IDs and data source (collection) IDs synced 2026-05-11.
  // NOTE: Executive Perspective is INTENTIONALLY EXCLUDED from this
  // Pulse — see analytical-discipline Rule 9 in callClaudeAPI().
  NOTION_DATABASES: {
    OPERATING_DOCTRINE: {
      database_id:    "e15a102eec75430ea157aa504d19753e",
      data_source_id: "42684b35-acb3-4d80-9518-2c72476725b8",
      label: "OPERATING DOCTRINE — STANDING PRINCIPLES (active)"
    },
    LIVING_ARCHIVE: {
      database_id:    "05a39295fb8f459d98b9dca09f8dd04b",
      data_source_id: "99e86096-d28f-4b0b-b26d-aedbe32f8489",
      label: "LIVING ARCHIVE"
    },
    INTAKE_QUEUE: {
      database_id:    "b69da070209e4094aae683b411504da4",
      data_source_id: "fe256c0c-78c7-4408-bd22-3453d865c6d3",
      label: "INTAKE QUEUE — RECENTLY ROUTED (verified content)"
    },
    DECISION_PIPELINE: {
      database_id:    "1ed5f619e11c4998abc59fcfaac68bc3",
      data_source_id: "75eb0d35-f03a-4544-8aa2-69b23994091f",
      label: "DECISION PIPELINE — READY TO GRADUATE"
    },
    STRATEGIC_BETS: {
      database_id:    "2bbda48ea8cc4138afddc047cbebc0d2",
      data_source_id: "87ccbab5-b1d6-4c7a-9a13-e1ca032ccbd1",
      label: "STRATEGIC BETS — ACTIVE"
    },
    OPEN_QUESTIONS: {
      database_id:    "ea47d424639f4bcc8e883d2d93373d81",
      data_source_id: "d9928995-91ab-4d28-b188-4cbac5538bb9",
      label: "OPEN QUESTIONS"
    },
    CROSS_AGENT_CHANNEL: {
      database_id:    "f7da27b757554b3b887f3cc03bada641",
      data_source_id: "ecc8ead5-0855-424e-8f2c-33399f28c601",
      label: "CROSS-AGENT CHANNEL — PENDING COORDINATION (operational state only)"
    }
  },

  // Property whitelists per database — what the Pulse actually needs.
  // If a query targets a data source listed here, only these fields render.
  // If a data source is NOT in this map, queryNotionDatabase falls back
  // to all properties (legacy behavior for safety).
  //
  // CAUTION: Whitelisted property names that don't exist on the live
  // data source are silently skipped. This means schema bugs become
  // invisible content gaps. ALWAYS verify whitelist names against the
  // live Notion schema (fetch the data source) before deploying changes.
  // The 2026-05-09 / 2026-05-11 schema-mismatch incident bit on exactly
  // this failure mode.
  PULSE_QUERY_FIELDS: {
    // Operating Doctrine: title carries the principle name; Adopted gives
    // the date; Status filters to Active; Domain optionally tags it.
    // Doctrine bodies are short prose and matter, so includeBody:true
    // is set at the query site.
    OPERATING_DOCTRINE: ["Title", "Adopted", "Status", "Domain"],

    // Living Archive: structured fields plus body (the 2-4 sentence prose
    // is where the actual archived information lives — body is included
    // at the query site).
    LIVING_ARCHIVE: ["Title", "Date", "Type", "Tags", "Active flag"],

    // Intake Queue: only Routed items are surfaced (Status filter at
    // query site). Summary, Routing tag, Type, Routed date carry the
    // signal. Body OFF — Summary is the canonical content.
    INTAKE_QUEUE: ["Summary", "Date logged", "Routed date", "Type", "Routing tag", "Status", "Captured by"],

    // Decision Pipeline: Decision (title), Context (prose), key dates,
    // Status. v6.1's whitelist named Stakes and Owner which don't exist
    // on this data source — fixed in v6.3.
    DECISION_PIPELINE: ["Decision", "Date logged", "Status", "Context", "Target resolution"],

    // Strategic Bets: not currently queried by Pulse but defined for
    // future use. CAUTION: not yet schema-verified. Verify before
    // adding a query that uses these names.
    STRATEGIC_BETS: ["Bet", "Status", "Horizon", "Owner"],

    // Open Questions: INTENTIONALLY NOT QUERIED by Pulse (pre-resolution
    // content). Defined here for future use only. Verify schema before
    // adding a query.
    OPEN_QUESTIONS: ["Question", "Status", "Domain", "Date logged"],

    // Cross-Agent Channel: render Subject, From, To, Type, Date sent,
    // Status only. Body and Reply EXCLUDED — per analytical-discipline
    // Rule 7, the Pulse surfaces channel as operational state (count +
    // headers), not as content to paraphrase. Body content may contain
    // analytical work in flight between agents, which is not appropriate
    // for downstream propagation.
    CROSS_AGENT_CHANNEL: ["Subject", "From", "To", "Type", "Date sent", "Status"]
  },

  DRIVE_FOLDER_ID: "18SyL5m1-qybOTqoAZJKc9VEix76UzFQz",
  REPORTS_FOLDER_NAME: "Business Pulse Reports",
  LOGO_FILE_ID:    "1X0OpxsRqHEqjxQWuGgh4IKCkOMU3BhKC",
  BRAND_MARK_ID:   "1frIV298jKCfCtaWhOljgVDXh0mquP24u",

  FILES: {
    BRAND_MATRIX:    "Distributor x Brand Matrix",
    ACCOUNT_DETAIL:  "Full Account Detail",
    KARMA_ACTIVITY:  "KARMA Weekly Activity"
  },

  REPORT_RECIPIENTS: ["garrison@spindletap.com"],

  // Brand palette
  BRAND: {
    INK:         "#1A1F2C",
    PAPER:       "#FAF7F2",
    CARD:        "#FFFFFF",
    RULE:        "#E8E2D7",
    MUTED:       "#6B6B6B",
    AMBER:       "#B8732A",
    AMBER_SOFT:  "#FBF1E4",
    GREEN:       "#2F7A4D",
    GREEN_SOFT:  "#E8F2EC",
    YELLOW:      "#C28A1C",
    YELLOW_SOFT: "#FBF3DD",
    RED:         "#A8321F",
    RED_SOFT:    "#F5E2DD"
  },

  SECTION_TITLES: {
    BREWERY:            "Brewery",
    COFFEE:             "Coffee",
    THC_COPACK:         "THC & Co-Packing",
    SALES_DISTRIBUTION: "Sales & Distribution",
    EVENTS:             "Events Pipeline",
    FINANCE:            "Finance",
    LABOR:              "Labor",
    BRAND_DIGITAL:      "Brand & Digital",
    INDUSTRY:           "Industry Context"
  },

  SECTION_ORDER: [
    "BREWERY", "COFFEE", "THC_COPACK", "SALES_DISTRIBUTION",
    "EVENTS", "FINANCE", "LABOR", "BRAND_DIGITAL", "INDUSTRY"
  ]
};

function generateWeeklyBusinessPulse() {
  try {
    Logger.log("=== Weekly Executive Pulse start ===");
    if (!CONFIG.ANTHROPIC_API_KEY) throw new Error("CLAUDE_API_KEY not set in Script Properties.");
    if (!CONFIG.NOTION_API_KEY)    throw new Error("NOTION_API_KEY not set in Script Properties.");

    var brainContext = fetchBrainContext();
    Logger.log("Brain context assembled: " + brainContext.length + " chars (~" +
               Math.round(brainContext.length / 4) + " tokens estimated)");

    var brandMatrix   = getFileContent(CONFIG.FILES.BRAND_MATRIX);
    var accountDetail = getFileContent(CONFIG.FILES.ACCOUNT_DETAIL);
    var karmaActivity = getFileContent(CONFIG.FILES.KARMA_ACTIVITY);

    var rawReport = callClaudeAPI(brainContext, brandMatrix, accountDetail, karmaActivity);
    if (!rawReport) throw new Error("Claude API returned empty response.");
    Logger.log("Raw report: " + rawReport.length + " chars");

    var parsed = parseReport(rawReport);
    Logger.log("Parsed sections: " + Object.keys(parsed.sections).length +
               ", KPIs: " + parsed.kpiCount +
               ", actions: " + parsed.actions.length);

    var docUrl = saveReportAsDoc(parsed, rawReport);
    sendReportEmail(parsed, docUrl);

    Logger.log("=== Weekly Executive Pulse delivered ===");
  } catch (e) {
    Logger.log("ERROR: " + e.message + "\n" + (e.stack || ""));
    MailApp.sendEmail(
      CONFIG.REPORT_RECIPIENTS[0],
      "⚠️ Weekly Executive Pulse — Generation Error",
      "The automated report failed:\n\n" + e.message +
      "\n\nCheck Apps Script logs at script.google.com"
    );
  }
}

function fetchBrainContext() {
  // Order: persona first, then identity → operations → people → market →
  // financial → executive layer. Operating Doctrine fetched FIRST after persona
  // since it governs interpretation of everything that follows.
  var pages = [
    { key: "EXEC_PULSE_PROMPT",     label: "REPORT INSTRUCTIONS (Persona 6a)" },
    { key: "COMPANY_IDENTITY",      label: "COMPANY IDENTITY" },
    { key: "BREWERY_HISTORY",       label: "BREWERY — COMPANY HISTORY" },
    { key: "BREWERY_SOCIAL",        label: "BREWERY — SOCIAL ACCOUNTS" },
    { key: "BRAND_BIBLE",           label: "BRAND BIBLE — SKU PORTFOLIO" },
    { key: "COFFEE_HISTORY",        label: "COFFEE — COMPANY HISTORY" },
    { key: "COFFEE_SOCIAL",         label: "COFFEE — SOCIAL ACCOUNTS" },
    { key: "THC_DIVISION_HISTORY",  label: "THC — DIVISION HISTORY" },
    { key: "DATA_SYSTEM_MAP",       label: "DATA SYSTEM MAP (Section 2)" },
    { key: "BREWERY_KPIS",          label: "BREWERY KPIs" },
    { key: "COFFEE_KPIS",           label: "COFFEE KPIs" },
    { key: "DISTRIBUTION",          label: "DISTRIBUTION & TERRITORIES (Section 4)" },
    { key: "HUMAN_RESOURCES",       label: "HUMAN RESOURCES (Section 5)" },
    { key: "EMPLOYEE_INBOX",        label: "EMPLOYEE INTELLIGENCE INBOX" },
    { key: "DIGITAL_INTELLIGENCE",  label: "DIGITAL BRAND INTELLIGENCE (7a–7f inline)" },
    { key: "INDUSTRY_CRAFT_BEER",   label: "INDUSTRY — CRAFT BEER (8a)" },
    { key: "INDUSTRY_HEMP_THC",     label: "INDUSTRY — HEMP & THC (8b)" },
    { key: "TX_HEMP_REGULATORY",    label: "INDUSTRY — TX HEMP & THC REGULATORY" },
    { key: "INDUSTRY_COFFEE",       label: "INDUSTRY — COFFEE (8c)" },
    { key: "INDUSTRY_HOUSTON",      label: "INDUSTRY — HOUSTON MARKET (8d)" },
    { key: "INDUSTRY_QTR_LOG",      label: "INDUSTRY — QUARTERLY UPDATE LOG (8e)" },
    { key: "MEETING_NOTES",         label: "MEETING NOTES" },
    { key: "MARGIN_MODEL",          label: "MARGIN MODEL (9a)" },
    { key: "PRICING",               label: "PRICING (9b)" },
    { key: "FINANCIAL_TARGETS",     label: "FINANCIAL TARGETS (9c)" },
    { key: "EXEC_CONSOLE",          label: "EXECUTIVE CONSOLE — Current Focus & Active Brainstorms (Section 10)" }
  ];

  var parts = ["=== SPINDLETAP BUSINESS BRAIN — LOADED " + new Date().toDateString() + " ===\n"];
  var sizeLog = [];  // track per-source size for the diagnostic log

  pages.forEach(function(p, i) {
    var id = CONFIG.NOTION_PAGES[p.key];
    if (!id) return;
    try {
      var content = fetchNotionPage(id);
      if (content) {
        parts.push("\n--- " + p.label + " ---\n" + content);
        sizeLog.push(p.key + ": " + content.length + " chars");
      }

      // After persona (index 0), inject Operating Doctrine before the rest
      // of the Brain so doctrine frames interpretation.
      if (i === 0) {
        try {
          var doctrine = queryNotionDatabase(
            CONFIG.NOTION_DATABASES.OPERATING_DOCTRINE.data_source_id,
            { property: "Status", select: { equals: "Active" } },
            [{ property: "Adopted", direction: "descending" }],
            { fieldWhitelist: CONFIG.PULSE_QUERY_FIELDS.OPERATING_DOCTRINE,
              includeBody: true }  // doctrine bodies are short prose, keep them
          );
          if (doctrine) {
            parts.push("\n--- " + CONFIG.NOTION_DATABASES.OPERATING_DOCTRINE.label + " ---\n" + doctrine);
            sizeLog.push("OPERATING_DOCTRINE_QUERY: " + doctrine.length + " chars");
          }
        } catch (e) {
          Logger.log("Warn: could not load Operating Doctrine: " + e.message);
        }
      }
    } catch (e) {
      Logger.log("Warn: could not load " + p.label + ": " + e.message);
    }
  });

  // Living Archive — last 30 days (recency) + active flags (operational context).
  // Body INCLUDED — Living Archive prose is the actual archived intelligence.
  try {
    var archiveRecent = queryNotionDatabase(
      CONFIG.NOTION_DATABASES.LIVING_ARCHIVE.data_source_id,
      { property: "Date", date: { past_month: {} } },
      [{ property: "Date", direction: "descending" }],
      { fieldWhitelist: CONFIG.PULSE_QUERY_FIELDS.LIVING_ARCHIVE,
        includeBody: true }
    );
    if (archiveRecent) {
      parts.push("\n--- LIVING ARCHIVE — LAST 30 DAYS ---\n" + archiveRecent);
      sizeLog.push("LIVING_ARCHIVE_RECENT: " + archiveRecent.length + " chars");
    }
  } catch (e) {
    Logger.log("Warn: could not load Living Archive recent: " + e.message);
  }

  try {
    var archiveFlags = queryNotionDatabase(
      CONFIG.NOTION_DATABASES.LIVING_ARCHIVE.data_source_id,
      {
        and: [
          { property: "Type", select: { equals: "Operational Flag" } },
          { property: "Active flag", checkbox: { equals: true } }
        ]
      },
      [{ property: "Date", direction: "descending" }],
      { fieldWhitelist: CONFIG.PULSE_QUERY_FIELDS.LIVING_ARCHIVE,
        includeBody: true }
    );
    if (archiveFlags) {
      parts.push("\n--- LIVING ARCHIVE — ACTIVE OPERATIONAL FLAGS (currently coloring interpretation) ---\n" + archiveFlags);
      sizeLog.push("LIVING_ARCHIVE_FLAGS: " + archiveFlags.length + " chars");
    }
  } catch (e) {
    Logger.log("Warn: could not load Living Archive active flags: " + e.message);
  }

  // Intake Queue — RECENTLY ROUTED ONLY (verified content).
  // v6.3 change: filter changed from "Pending review" to "Routed".
  // Pending review rows are pre-verification Advisor reconstructions that
  // should not propagate to a Brody-shared report before the Architect
  // routes them. Routed = verified-and-placed.
  // Body OFF; Summary property carries the signal.
  try {
    var intake = queryNotionDatabase(
      CONFIG.NOTION_DATABASES.INTAKE_QUEUE.data_source_id,
      { property: "Status", select: { equals: "Routed" } },
      [{ property: "Routed date", direction: "descending" }],
      { fieldWhitelist: CONFIG.PULSE_QUERY_FIELDS.INTAKE_QUEUE,
        includeBody: false }
    );
    if (intake) {
      parts.push("\n--- " + CONFIG.NOTION_DATABASES.INTAKE_QUEUE.label + " ---\n" + intake);
      sizeLog.push("INTAKE_QUEUE_ROUTED: " + intake.length + " chars");
    }
  } catch (e) {
    Logger.log("Warn: could not load Intake Queue routed: " + e.message);
  }

  // Decision Pipeline — Ready. Body OFF; Decision property + Context carry the signal.
  // v6.3 fix: whitelist corrected to use real field names (Context, Target
  // resolution) — v6.1 named non-existent Stakes and Owner.
  try {
    var pipeline = queryNotionDatabase(
      CONFIG.NOTION_DATABASES.DECISION_PIPELINE.data_source_id,
      { property: "Status", select: { equals: "Ready" } },
      [{ property: "Date logged", direction: "ascending" }],
      { fieldWhitelist: CONFIG.PULSE_QUERY_FIELDS.DECISION_PIPELINE,
        includeBody: false }
    );
    if (pipeline) {
      parts.push("\n--- " + CONFIG.NOTION_DATABASES.DECISION_PIPELINE.label + " ---\n" + pipeline);
      sizeLog.push("DECISION_PIPELINE: " + pipeline.length + " chars");
    }
  } catch (e) {
    Logger.log("Warn: could not load Decision Pipeline Ready: " + e.message);
  }

  // Cross-Agent Channel — v6.3 NEW.
  // Surfaces unread + acknowledged coordination messages between Architect
  // and Advisor. Headers only (Subject, From, To, Type, Date sent, Status).
  // Body and Reply EXCLUDED per analytical-discipline Rule 7 — channel
  // messages may carry analytical work in flight that hasn't been routed
  // or verified. We surface OPERATIONAL STATE (count + headers), not
  // content to paraphrase.
  // Notion's select-filter "or" pattern uses an 'or' array of single filters.
  try {
    var channel = queryNotionDatabase(
      CONFIG.NOTION_DATABASES.CROSS_AGENT_CHANNEL.data_source_id,
      {
        or: [
          { property: "Status", select: { equals: "Unread" } },
          { property: "Status", select: { equals: "Acknowledged" } }
        ]
      },
      [{ property: "Date sent", direction: "descending" }],
      { fieldWhitelist: CONFIG.PULSE_QUERY_FIELDS.CROSS_AGENT_CHANNEL,
        includeBody: false }
    );
    if (channel) {
      parts.push("\n--- " + CONFIG.NOTION_DATABASES.CROSS_AGENT_CHANNEL.label + " ---\n" + channel);
      sizeLog.push("CROSS_AGENT_CHANNEL: " + channel.length + " chars");
    }
  } catch (e) {
    Logger.log("Warn: could not load Cross-Agent Channel: " + e.message);
  }

  // Diagnostic: log per-source sizes so trends are visible run over run.
  Logger.log("Per-source sizes (chars):\n  " + sizeLog.join("\n  "));

  return parts.join("\n");
}

// ============================================================
// NOTION FETCH HELPERS
// ============================================================

function fetchNotionPage(pageId) {
  var url = "https://api.notion.com/v1/blocks/" + pageId + "/children?page_size=100";
  var resp = UrlFetchApp.fetch(url, {
    method: "GET",
    headers: {
      "Authorization": "Bearer " + CONFIG.NOTION_API_KEY,
      "Notion-Version": "2022-06-28"
    },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error("Notion API " + resp.getResponseCode() + " for " + pageId);
  }
  return extractTextFromBlocks(JSON.parse(resp.getContentText()).results);
}

/**
 * Query a Notion data source (the queryable layer of a database).
 * Returns formatted text with one row per database entry.
 *
 * @param {string} dataSourceId  The data source UUID (NOT the database page ID)
 * @param {object} filter        Notion filter object; pass null for no filter
 * @param {array}  sorts         Array of {property, direction}; pass null for default
 * @param {object} options       { fieldWhitelist: [string], includeBody: bool }
 *                               fieldWhitelist: render only these property names
 *                                 (omit or pass null to render all populated properties)
 *                               includeBody: if true, fetch the row's page body
 *                                 (default false — bodies are expensive)
 * @return {string}              Formatted text suitable for Claude context
 */
function queryNotionDatabase(dataSourceId, filter, sorts, options) {
  options = options || {};
  var fieldWhitelist = options.fieldWhitelist || null;
  var includeBody    = options.includeBody === true;

  var url = "https://api.notion.com/v1/data_sources/" + dataSourceId + "/query";
  var payload = { page_size: 100 };
  if (filter) payload.filter = filter;
  if (sorts && sorts.length) payload.sorts = sorts;

  var resp = UrlFetchApp.fetch(url, {
    method: "POST",
    contentType: "application/json",
    headers: {
      "Authorization": "Bearer " + CONFIG.NOTION_API_KEY,
      "Notion-Version": "2025-09-03"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error("Notion data source query " + code + " for " + dataSourceId + ": " + resp.getContentText());
  }

  var rows = JSON.parse(resp.getContentText()).results || [];
  if (rows.length === 0) return "(no rows match this filter)";

  var formatted = [];
  rows.forEach(function(row) {
    var props = formatRowProperties(row.properties, fieldWhitelist);
    var entry = props;
    if (includeBody) {
      try {
        var body = fetchNotionPage(row.id);
        if (body && body.trim()) entry += "\n" + body;
      } catch (e) {
        Logger.log("Warn: could not fetch row body for " + row.id + ": " + e.message);
      }
    }
    formatted.push(entry);
    formatted.push("---");
  });
  return formatted.join("\n");
}

/**
 * Format a row's properties dict as readable lines.
 * If fieldWhitelist is provided, render only those properties (in whitelist order).
 * Otherwise, render every populated property (legacy behavior).
 */
function formatRowProperties(properties, fieldWhitelist) {
  if (!properties) return "";
  var lines = [];
  var names = fieldWhitelist || Object.keys(properties);
  names.forEach(function(name) {
    var prop = properties[name];
    if (!prop) return;  // whitelisted property doesn't exist on this row — skip silently
    var rendered = renderPropertyValue(prop);
    if (rendered !== null && rendered !== "") {
      lines.push(name + ": " + rendered);
    }
  });
  return lines.join("\n");
}

function renderPropertyValue(prop) {
  if (!prop || !prop.type) return null;
  var t = prop.type;
  var v = prop[t];
  if (v === null || v === undefined) return null;

  switch (t) {
    case "title":
    case "rich_text":
      return (v || []).map(function(r){return r.plain_text || "";}).join("");
    case "select":
      return v ? v.name : "";
    case "multi_select":
      return (v || []).map(function(o){return o.name;}).join(", ");
    case "status":
      return v ? v.name : "";
    case "date":
      if (!v || !v.start) return "";
      return v.end ? (v.start + " → " + v.end) : v.start;
    case "checkbox":
      return v ? "true" : "false";
    case "number":
      return String(v);
    case "url":
    case "email":
    case "phone_number":
      return v || "";
    case "relation":
      var ids = (v || []).map(function(r){return r.id;});
      return ids.length ? "[" + ids.length + " linked]" : "";
    case "people":
      return (v || []).map(function(p){return p.name || p.id;}).join(", ");
    case "created_time":
    case "last_edited_time":
      return v || "";
    case "formula":
      if (!v) return "";
      return renderPropertyValue({ type: v.type, [v.type]: v[v.type] });
    case "rollup":
      if (!v) return "";
      if (v.type === "array") {
        return (v.array || []).map(function(item){
          return renderPropertyValue({ type: item.type, [item.type]: item[item.type] });
        }).filter(function(x){return x;}).join(", ");
      }
      return renderPropertyValue({ type: v.type, [v.type]: v[v.type] });
    default:
      return null;
  }
}

function extractTextFromBlocks(blocks) {
  if (!blocks) return "";
  var lines = [];
  blocks.forEach(function(block) {
    var t = block.type;
    if (!block[t]) return;
    var richTypes = ["paragraph","heading_1","heading_2","heading_3",
                     "bulleted_list_item","numbered_list_item","quote",
                     "callout","toggle","to_do"];
    var text = "";
    if (richTypes.indexOf(t) !== -1) {
      var rt = block[t].rich_text || [];
      text = rt.map(function(r){return r.plain_text || "";}).join("");
      if (t === "heading_1" || t === "heading_2" || t === "heading_3") {
        text = "\n" + text;
      } else if (t === "bulleted_list_item" || t === "numbered_list_item") {
        text = "  " + text;
      }
    } else if (t === "table_row") {
      var cells = block.table_row.cells || [];
      text = cells.map(function(c){return c.map(function(r){return r.plain_text||"";}).join("");}).join("   ");
    }
    if (text.trim()) lines.push(text);
  });
  return lines.join("\n");
}

// ============================================================
// CLAUDE API
// ============================================================

function callClaudeAPI(brainContext, brandMatrix, accountDetail, karmaActivity) {
  var dataSections = [];
  if (brandMatrix)   dataSections.push("=== DISTRIBUTOR x BRAND MATRIX (13-Week Rolling) ===\n" + brandMatrix);
  if (accountDetail) dataSections.push("=== FULL ACCOUNT DETAIL ===\n" + accountDetail);
  if (karmaActivity) dataSections.push("=== KARMA WEEKLY ACTIVITY ===\n" + karmaActivity);

  var dataNotice = dataSections.length === 0
    ? "NOTE: No CSV data files found in Drive this week. Generate the structured report based on Brain context only and explicitly flag the missing data in each section."
    : dataSections.join("\n\n");

  // ========================================================================
  // ANALYTICAL DISCIPLINE BLOCK — v6.3 NEW
  // ========================================================================
  // This is the prompt-layer protection against fabrication, synthesis-drift,
  // and inappropriate propagation of unverified or excluded content. Forged
  // out of the 2026-05-10 fabrication incident (Brody/Wright surname
  // fabrication, March 2026 / April 2025 date conflation, "Adam-faction
  // loyalty pattern" synthesis substituted for Garrison's "Adam's informant"
  // source language). The Pulse runs single-shot with no Garrison-in-the-loop
  // review before delivery, so the discipline has to hold structurally —
  // there is no human safety net before the report reaches the inbox.
  //
  // Rules verified by the Executive Advisor 2026-05-11.
  // ========================================================================
  var analyticalDiscipline =
"\n\n========================================\n" +
"ANALYTICAL DISCIPLINE — READ FIRST, APPLIES TO EVERY CLAIM BELOW\n" +
"========================================\n\n" +
"This report operates under STB's source-narrative discipline. The following rules govern every claim in the output. Violations are the worst class of error — they propagate fabricated content into a report that may be shared. If in doubt, omit and flag.\n\n" +
"1. NO FABRICATED FACTS. Every date, duration, named person, named relationship, percentage, or attributed claim must come from the Brain content or CSV data provided above. If the data doesn't support a specific number or claim, DO NOT invent one. Say 'data not available' or 'requires verification' instead.\n\n" +
"2. NO INVENTED RELATIONS. Do not assert that one person is related to, reports to, or has a specific dynamic with another person unless that relation is explicitly stated in the Brain. The Brain is the canonical source for relations. Surnames are not interchangeable; do not construct relations from partial-match patterns.\n\n" +
"3. NO DURATION INVENTION. If you state how long something has been true, that duration must be computable from explicit dates in the Brain or CSVs. 'For the past X months' without a verifiable start date is forbidden. Show the subtraction in your reasoning if it's load-bearing for the claim.\n\n" +
"4. FRAMED, NOT ASSERTED, FOR JUDGMENT-CLASS CONTENT. If interpreting a pattern, frame it: 'the data suggests', 'this reads as', 'one read is'. Do not present interpretations as facts.\n\n" +
"4b. SOURCE QUOTATION OVER SYNTHESIS. When Brain content directly states a person's words, framing, or claim (e.g., 'per Garrison: X,' 'Garrison's read is X,' direct quotation in a Living Archive entry), use that wording rather than synthesizing your own abstraction. If you must paraphrase for length, preserve the specific terms used — do not substitute your own framing terminology even if it reads as more analytically useful. Garrison's framing tends to be operationally specific ('informant,' 'bridge,' 'not on speaking terms') and synthesis tends to make it more general and abstract ('loyalty pattern,' 'aligned faction'). The specificity carries information; abstracting it loses signal.\n\n" +
"5. HONEST DATA GAPS. If a section's data source isn't integrated yet (Coffee, THC, Events, Finance, Labor, Brand & Digital all currently have data gaps), say so plainly. Do not pad with speculation. 'Data source not yet integrated' is a valid and required honest answer.\n\n" +
"6. OPERATIONAL FLAGS COLOR INTERPRETATION. Living Archive entries with Active flag = true are CURRENTLY affecting how data should be read (e.g., HEB reset, Silver Eagle Houston warehouse consolidation). Reference these flags when relevant to interpretation, do not ignore them.\n\n" +
"7. CROSS-AGENT CHANNEL VISIBILITY. The Pulse surfaces unread and acknowledged coordination messages between the Architect and Advisor agents. Report them by Subject, From, To, Type (FYI/Question/Action requested/Verification needed), and Date sent — surface as operational visibility ('there are N coordination messages pending between agents, oldest sent YYYY-MM-DD'). DO NOT paraphrase or expand on the body of any message. DO NOT speculate on what coordination is in progress. If a message Subject references content elsewhere in the Brain that independently appears in your data feed, you may reference that linked content; otherwise, treat the channel as operational state, not as content to interpret.\n\n" +
"8. NO ACCUMULATION OF BRACKETED SPECULATION. If you find yourself writing more than one '[awaiting verification]' or 'requires further confirmation' or similar hedge in the same report, that is itself a signal the discipline is slipping. Consolidate into a single 'Data gaps requiring verification' note rather than threading hedged claims through analytical content. Individual brackets read cautious; many brackets read as a stable hedged narrative that survives propagation despite being half-speculation.\n\n" +
"9. NO PERSPECTIVE-STYLE FRAMING FOR EXCLUDED CONTENT. The Executive Perspective database is intentionally NOT in this report's data feed (it contains Garrison's reads on people and dynamics, scoped to him and his agents only). If you encounter references to it in other Brain content (e.g., a Living Archive entry says 'Garrison's read on X is captured in Executive Perspective entry [Title]'), do not attempt to reconstruct, paraphrase, or characterize the referenced perspective content. Acknowledge the reference exists if operationally relevant ('Garrison's perspective on this is captured separately and is not in this report'), but do not generate substitute content. Fabricating a plausible-sounding read in place of content you don't have access to is the failure mode this rule exists to prevent.\n\n" +
"========================================\n" +
"END ANALYTICAL DISCIPLINE BLOCK\n" +
"========================================\n";

  var formatContract =
"\n\n========================================\n" +
"CRITICAL OUTPUT FORMAT — READ BEFORE WRITING\n" +
"========================================\n\n" +
"Your output is parsed by a script. If you deviate from the format below, the parser fails and the report is broken.\n\n" +
"Do NOT output markdown. No ##, no **, no |, no ```.\n" +
"Do NOT output prose paragraphs at the top.\n" +
"Do NOT output a flat bullet list.\n" +
"Output ONLY the tagged blocks shown below, in this exact order:\n\n" +
"[[META]]\n" +
"week_ending: 2026-05-02\n" +
"status: partial_data\n" +
"headline: Houston bleeding, DFW healthy, financials still dark.\n\n" +
"[[EXEC_SUMMARY]]\n" +
"- 🔴 Silver Eagle Houston down 11.9% YoY, HEB reset still bleeding through core volume.\n" +
"- 🔴 Houston Hustle collapse continues at -64.1% YoY, 472 cases lost vs prior year.\n" +
"- 🟢 Heavy Hands reactivation showing modest traction, decline narrowed to -15.7%.\n" +
"- 🟡 Dynamo Central TX -40.3% but DFW expansion partially offsetting the loss.\n" +
"- 🔴 Field rep photo capture uneven, Cory at 9 photos vs Carlos at 83.\n\n" +
"[[SECTION:BREWERY]]\n" +
"[[KPI:🔴|Silver Eagle Houston|-11.9% YoY|253 cases lost, HEB reset bleeding]]\n" +
"[[KPI:🟢|Dynamo DFW expansion|+ growing|New territory offsetting Central TX]]\n" +
"[[KPI:🔴|Houston Hustle|-64.1% YoY|HEB reset, 150+ stores lost]]\n" +
"NARRATIVE: Houston Hustle continues its collapse with 472 cases lost YoY, the direct legacy of the 2024 HEB reset. Silver Eagle remains the most stable territory despite the drag. Heavy Hands reactivation campaign is showing the first sign of traction.\n\n" +
"[[SECTION:COFFEE]]\n" +
"NARRATIVE: Data source not yet integrated. New Shopify site pending launch will set new benchmark from go-live date.\n\n" +
"[[SECTION:THC_COPACK]]\n" +
"NARRATIVE: Data source not yet integrated. Pipeline tracking requires co-pack contract data feed.\n\n" +
"[[SECTION:SALES_DISTRIBUTION]]\n" +
"[[KPI:🔴|Houston Hustle|-64.1% YoY|HEB door count unknown, recovery metric needed]]\n" +
"[[KPI:🟡|Carlos field activity|100 visits|Strong cadence, 83 photos]]\n" +
"[[KPI:🔴|Cory photo capture|9 photos|Visit volume strong but documentation lagging]]\n" +
"NARRATIVE: Field activity is uneven across reps. Carlos is maintaining high visual documentation while Cory is logging visits without photos. HEB door count remains the missing recovery metric.\n\n" +
"[[SECTION:EVENTS]]\n" +
"NARRATIVE: Data source not yet integrated. Triple Seat connector pending.\n\n" +
"[[SECTION:FINANCE]]\n" +
"NARRATIVE: Data source not yet integrated. QuickBooks Online migration in progress, no full P and L yet.\n\n" +
"[[SECTION:LABOR]]\n" +
"NARRATIVE: Data source not yet integrated. Paylocity export not yet on weekly cadence.\n\n" +
"[[SECTION:BRAND_DIGITAL]]\n" +
"NARRATIVE: Data source not yet integrated. GA4, Untappd, and social feeds not connected to weekly Pulse yet.\n\n" +
"[[SECTION:INDUSTRY]]\n" +
"NARRATIVE: Craft beer industry continues post-Covid contraction at the macro level. STB performance should be read against this backdrop.\n\n" +
"[[FLAGS]]\n" +
"- 🔴 Houston Hustle -64.1% YoY, 472 cases lost\n" +
"- 🔴 Total volume -27.6% YoY across all distributors\n" +
"- 🔴 Cory field documentation 9 photos in 2 weeks\n\n" +
"[[ACTIONS]]\n" +
"[[ACTION:1|Add HEB door count to weekly Pulse|Cannot measure Hustle recovery without it, request from Silver Eagle this week]]\n" +
"[[ACTION:2|Confirm Cory photo capture protocol|Visit volume is strong but documentation gap creates field intelligence blind spot]]\n" +
"[[ACTION:3|Accelerate QB Online migration|Finance section will remain dark until P and L feed is live]]\n\n" +
"========================================\n" +
"END OF EXAMPLE. NOW PRODUCE THE REAL REPORT.\n" +
"========================================\n\n" +
"Use the example above as a structural template ONLY. Replace all numbers and content with this week's actual data and analysis. Do not copy the example values.\n\n" +
"Required tag blocks, in order: [[META]], [[EXEC_SUMMARY]], [[SECTION:BREWERY]], [[SECTION:COFFEE]], [[SECTION:THC_COPACK]], [[SECTION:SALES_DISTRIBUTION]], [[SECTION:EVENTS]], [[SECTION:FINANCE]], [[SECTION:LABOR]], [[SECTION:BRAND_DIGITAL]], [[SECTION:INDUSTRY]], [[FLAGS]], [[ACTIONS]].\n\n" +
"Begin your response with [[META]] on the first line. End immediately after the last [[ACTION:3|...]] tag. No preamble, no closing.";

  var userMessage =
    "Please analyze this week's data and produce the Executive Business Pulse report.\n\n" +
    analyticalDiscipline +
    "\n\n" +
    dataNotice +
    formatContract;

  // Diagnostic: log estimated input token count BEFORE the API call.
  // Rough heuristic: ~4 chars per token. Flag if approaching cap.
  var estimatedTokens = Math.round((brainContext.length + userMessage.length) / 4);
  Logger.log("Estimated input tokens: ~" + estimatedTokens +
             " (cap: 200,000, headroom: ~" + (200000 - estimatedTokens) + ")");
  if (estimatedTokens > 180000) {
    Logger.log("WARNING: input approaching context cap. Consider Stage 2 token plan (Living Archive digest pattern).");
  }

  var payload = {
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: brainContext,
    messages: [{ role: "user", content: userMessage }]
  };

  var resp = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    contentType: "application/json",
    headers: {
      "x-api-key": CONFIG.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  if (code !== 200) throw new Error("Claude API " + code + ": " + resp.getContentText());

  var responseBody = JSON.parse(resp.getContentText());

  // Log actual token usage from API response — this is the source of truth.
  if (responseBody.usage) {
    Logger.log("Actual token usage — input: " + responseBody.usage.input_tokens +
               ", output: " + responseBody.usage.output_tokens);
  }

  var firstAttempt = responseBody.content[0].text;

  var hasStructure = firstAttempt.indexOf("[[META]]") !== -1 &&
                     firstAttempt.indexOf("[[SECTION:") !== -1 &&
                     firstAttempt.indexOf("[[ACTION:") !== -1;

  if (hasStructure) {
    Logger.log("Format validation: PASS on first attempt");
    return firstAttempt;
  }

  Logger.log("Format validation: FAIL on first attempt. Retrying with correction.");
  var correctionPayload = {
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: brainContext,
    messages: [
      { role: "user", content: userMessage },
      { role: "assistant", content: firstAttempt },
      { role: "user", content:
"Your output is missing the required tag blocks. The script parser cannot read your previous response. " +
"Re-emit the SAME analysis content, but rewrite it using the [[META]], [[EXEC_SUMMARY]], [[SECTION:NAME]], [[KPI:...]], NARRATIVE, [[FLAGS]], and [[ACTIONS]] tagged structure exactly as shown in the example. " +
"Begin your response with [[META]] on line 1. No preamble, no apology, no markdown."
      }
    ]
  };

  var retryResp = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    contentType: "application/json",
    headers: {
      "x-api-key": CONFIG.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    payload: JSON.stringify(correctionPayload),
    muteHttpExceptions: true
  });

  if (retryResp.getResponseCode() !== 200) {
    Logger.log("Retry failed, returning original output for fallback rendering.");
    return firstAttempt;
  }

  var retryBody = JSON.parse(retryResp.getContentText());
  if (retryBody.usage) {
    Logger.log("Retry token usage — input: " + retryBody.usage.input_tokens +
               ", output: " + retryBody.usage.output_tokens);
  }
  var retryText = retryBody.content[0].text;
  var retryHasStructure = retryText.indexOf("[[META]]") !== -1 &&
                          retryText.indexOf("[[SECTION:") !== -1;

  Logger.log("Format validation after retry: " + (retryHasStructure ? "PASS" : "STILL FAILING"));
  return retryHasStructure ? retryText : firstAttempt;
}

function getFileContent(fileName) {
  var folder;
  try {
    folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  } catch (e) {
    Logger.log("Warn: Drive folder not accessible (" + CONFIG.DRIVE_FOLDER_ID + "): " + e.message);
    return null;
  }
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (f.getName().indexOf(fileName) !== -1) return f.getBlob().getDataAsString();
  }
  return null;
}

// ============================================================
// PARSER — Claude's structured text → JS object
// ============================================================
function parseReport(text) {
  var out = {
    meta: { week_ending: "", status: "", headline: "" },
    execSummary: [],
    sections: {},
    flags: [],
    actions: [],
    kpiCount: 0
  };
  text = String(text).replace(/\r\n?/g, "\n");

  var metaMatch = text.match(/\[\[META\]\]([\s\S]*?)(?=\[\[)/);
  if (metaMatch) {
    var b = metaMatch[1];
    var we = b.match(/week_ending\s*:\s*([^\n]+)/i);
    var st = b.match(/status\s*:\s*([^\n]+)/i);
    var hl = b.match(/headline\s*:\s*([^\n]+)/i);
    if (we) out.meta.week_ending = we[1].trim();
    if (st) out.meta.status      = st[1].trim();
    if (hl) out.meta.headline    = hl[1].trim();
  }

  var esMatch = text.match(/\[\[EXEC_SUMMARY\]\]([\s\S]*?)(?=\[\[)/);
  if (esMatch) {
    out.execSummary = esMatch[1].split("\n")
      .map(function(l){return l.trim();})
      .filter(function(l){return l.indexOf("-") === 0;})
      .map(function(l){return l.replace(/^-\s*/, "").trim();})
      .filter(function(l){return l.length > 0;});
  }

  var sectionRegex = /\[\[SECTION:([A-Z_]+)\]\]([\s\S]*?)(?=\[\[SECTION:|\[\[FLAGS\]\]|\[\[ACTIONS\]\]|$)/g;
  var m;
  while ((m = sectionRegex.exec(text)) !== null) {
    var name = m[1];
    var body = m[2];
    var section = { kpis: [], narrative: "" };

    var kpiRegex = /\[\[KPI:([^|\]]+)\|([^|\]]+)\|([^|\]]+)\|([^\]]+)\]\]/g;
    var k;
    while ((k = kpiRegex.exec(body)) !== null) {
      section.kpis.push({
        status:  k[1].trim(),
        label:   k[2].trim(),
        value:   k[3].trim(),
        context: k[4].trim()
      });
      out.kpiCount++;
    }

    var narrMatch = body.match(/NARRATIVE\s*:\s*([\s\S]+)$/);
    if (narrMatch) {
      section.narrative = narrMatch[1].trim()
        .replace(/\[\[KPI:[^\]]+\]\]/g, "")
        .trim();
    }
    out.sections[name] = section;
  }

  var flagsMatch = text.match(/\[\[FLAGS\]\]([\s\S]*?)(?=\[\[ACTIONS\]\]|$)/);
  if (flagsMatch) {
    out.flags = flagsMatch[1].split("\n")
      .map(function(l){return l.trim();})
      .filter(function(l){return l.indexOf("-") === 0;})
      .map(function(l){return l.replace(/^-\s*/, "").trim();})
      .filter(function(l){return l.length > 0;});
  }

  var actionsMatch = text.match(/\[\[ACTIONS\]\]([\s\S]*)$/);
  if (actionsMatch) {
    var actionRegex = /\[\[ACTION:(\d+)\|([^|\]]+)\|([^\]]+)\]\]/g;
    var a;
    while ((a = actionRegex.exec(actionsMatch[1])) !== null) {
      out.actions.push({
        n: parseInt(a[1], 10),
        title: a[2].trim(),
        rationale: a[3].trim()
      });
    }
  }
  return out;
}

function colorForStatus(emoji) {
  if (emoji.indexOf("🔴") !== -1) return { fg: CONFIG.BRAND.RED,    bg: CONFIG.BRAND.RED_SOFT };
  if (emoji.indexOf("🟡") !== -1) return { fg: CONFIG.BRAND.YELLOW, bg: CONFIG.BRAND.YELLOW_SOFT };
  if (emoji.indexOf("🟢") !== -1) return { fg: CONFIG.BRAND.GREEN,  bg: CONFIG.BRAND.GREEN_SOFT };
  return { fg: CONFIG.BRAND.MUTED, bg: CONFIG.BRAND.PAPER };
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ============================================================
// EMAIL: executive HTML newsletter  (v6.4)
// ============================================================

function renderBulletLine(text, overrideTextColor) {
  var B = CONFIG.BRAND;
  var color = B.MUTED;
  var clean = String(text || "").trim();

  var c0 = clean.charCodeAt(0);
  var c1 = clean.charCodeAt(1);
  if      (c0 === 0xD83D && c1 === 0xDD34) { color = B.RED;    clean = clean.substring(2).trim(); }
  else if (c0 === 0xD83D && c1 === 0xDFE1) { color = B.YELLOW; clean = clean.substring(2).trim(); }
  else if (c0 === 0xD83D && c1 === 0xDFE2) { color = B.GREEN;  clean = clean.substring(2).trim(); }

  var dot = '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + color + ';margin-right:10px;vertical-align:middle;"></span>';
  var textStyle = overrideTextColor ? 'color:' + overrideTextColor + ';' : '';
  return dot + '<span style="' + textStyle + '">' + esc(clean) + '</span>';
}

function sendReportEmail(parsed, docUrl) {
  var today  = new Date();
  var dateStr = Utilities.formatDate(today, "America/Chicago", "MMMM d, yyyy");
  var subject = "Executive Business Pulse — " + dateStr;

  var inlineImages = {};
  try { inlineImages.logo = DriveApp.getFileById(CONFIG.LOGO_FILE_ID).getBlob(); }
  catch (e) { Logger.log("Warn: logo not loaded: " + e.message); }

  var B = CONFIG.BRAND;
  var html = [];

  html.push('<!DOCTYPE html><html><head><meta charset="UTF-8">');
  html.push('<meta name="viewport" content="width=device-width,initial-scale=1.0">');
  html.push('</head>');
  html.push('<body style="margin:0;padding:0;background:#EDEAE4;font-family:Georgia,\'Times New Roman\',serif;color:' + B.INK + ';">');

  html.push('<div style="max-width:680px;margin:32px auto;background:' + B.PAPER + ';border:1px solid ' + B.RULE + ';">');
  html.push('<div style="height:5px;background:' + B.AMBER + ';"></div>');

  html.push('<div style="padding:36px 44px 28px 44px;background:' + B.AMBER_SOFT + ';border-bottom:2px solid ' + B.INK + ';">');
  if (inlineImages.logo) {
    html.push('<div style="text-align:center;margin-bottom:16px;"><img src="cid:logo" alt="Spindletap Beverages" style="max-width:260px;height:auto;display:inline-block;"></div>');
  } else {
    html.push('<div style="text-align:center;margin-bottom:16px;font-size:11px;letter-spacing:4px;color:' + B.AMBER + ';font-family:Helvetica,Arial,sans-serif;text-transform:uppercase;">Spindletap Beverages</div>');
  }
  html.push('<div style="text-align:center;font-family:Georgia,serif;font-size:28px;font-weight:700;color:' + B.INK + ';margin-bottom:8px;">Executive Business Pulse</div>');
  html.push('<div style="text-align:center;font-size:12px;color:' + B.MUTED + ';font-family:Helvetica,Arial,sans-serif;">' + esc(dateStr) + '</div>');
  html.push('</div>');

  if (parsed.meta.headline) {
    html.push('<div style="padding:28px 44px 4px 44px;background:' + B.PAPER + ';">');
    html.push('<div style="font-family:Georgia,serif;font-size:22px;line-height:1.4;color:' + B.INK + ';font-style:italic;border-left:4px solid ' + B.AMBER + ';padding-left:16px;">');
    html.push('&ldquo;' + esc(parsed.meta.headline) + '&rdquo;');
    html.push('</div></div>');
  }

  if (parsed.execSummary.length) {
    html.push('<div style="padding:24px 44px 28px 44px;background:' + B.PAPER + ';">');
    html.push('<div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:3px;color:' + B.AMBER + ';text-transform:uppercase;margin-bottom:14px;">The Bottom Line</div>');
    html.push('<table style="width:100%;border-collapse:collapse;">');
    parsed.execSummary.forEach(function(bullet) {
      html.push('<tr><td style="padding:10px 0 10px 4px;font-family:Georgia,serif;font-size:14px;line-height:1.6;color:' + B.INK + ';border-bottom:1px solid ' + B.RULE + ';">');
      html.push(renderBulletLine(bullet));
      html.push('</td></tr>');
    });
    html.push('</table></div>');
  }

  CONFIG.SECTION_ORDER.forEach(function(key, i) {
    var sec = parsed.sections[key];
    if (!sec) return;
    var title = CONFIG.SECTION_TITLES[key] || key;
    var bg = i % 2 === 0 ? B.CARD : B.PAPER;

    html.push('<div style="padding:28px 44px 24px 44px;background:' + bg + ';border-top:1px solid ' + B.RULE + ';">');
    html.push('<div style="font-family:Helvetica,Arial,sans-serif;font-size:9px;letter-spacing:3px;color:' + B.AMBER + ';text-transform:uppercase;margin-bottom:4px;">Division</div>');
    html.push('<div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:' + B.INK + ';padding-bottom:10px;margin-bottom:16px;border-bottom:2px solid ' + B.AMBER + ';display:inline-block;">' + esc(title) + '</div>');

    if (sec.kpis && sec.kpis.length) {
      html.push('<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">');
      sec.kpis.forEach(function(kpi) {
        var c = colorForStatus(kpi.status);
        html.push('<tr>');
        html.push('<td style="padding:11px 14px;background:' + c.bg + ';border-left:4px solid ' + c.fg + ';width:40%;font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;color:' + B.INK + ';">' + esc(kpi.label) + '</td>');
        html.push('<td style="padding:11px 14px;background:' + c.bg + ';width:20%;font-family:Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;color:' + c.fg + ';white-space:nowrap;">' + esc(kpi.value) + '</td>');
        html.push('<td style="padding:11px 14px;background:' + c.bg + ';font-family:Helvetica,Arial,sans-serif;font-size:11px;color:' + B.MUTED + ';font-style:italic;">' + esc(kpi.context) + '</td>');
        html.push('</tr>');
        html.push('<tr><td colspan="3" style="height:3px;background:' + bg + ';"></td></tr>');
      });
      html.push('</table>');
    }

    if (sec.narrative) {
      html.push('<div style="font-family:Georgia,serif;font-size:14px;line-height:1.7;color:' + B.INK + ';">' + esc(sec.narrative) + '</div>');
    }
    html.push('</div>');
  });

  if (parsed.flags.length || parsed.actions.length) {
    html.push('<div style="padding:32px 44px 36px 44px;background:' + B.INK + ';color:' + B.PAPER + ';">');
    html.push('<div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:3px;color:' + B.AMBER + ';text-transform:uppercase;margin-bottom:18px;">Action Required</div>');

    if (parsed.flags.length) {
      html.push('<div style="font-family:Georgia,serif;font-size:16px;font-weight:700;color:' + B.PAPER + ';margin-bottom:12px;">Red Flags</div>');
      html.push('<table style="width:100%;border-collapse:collapse;margin-bottom:28px;">');
      parsed.flags.forEach(function(f) {
        html.push('<tr><td style="padding:9px 0;border-bottom:1px solid #2e3340;font-family:Georgia,serif;font-size:13px;line-height:1.5;">');
        html.push(renderBulletLine(f, B.PAPER));
        html.push('</td></tr>');
      });
      html.push('</table>');
    }

    if (parsed.actions.length) {
      html.push('<div style="font-family:Georgia,serif;font-size:16px;font-weight:700;color:' + B.PAPER + ';margin:0 0 16px 0;">This Week\'s Priorities</div>');
      parsed.actions.forEach(function(a) {
        html.push('<table style="width:100%;border-collapse:collapse;margin-bottom:16px;"><tr>');
        html.push('<td style="width:44px;vertical-align:top;padding-top:3px;"><div style="width:34px;height:34px;background:' + B.AMBER + ';color:' + B.PAPER + ';font-family:Georgia,serif;font-size:16px;font-weight:700;text-align:center;line-height:34px;border-radius:50%;">' + esc(a.n) + '</div></td>');
        html.push('<td style="vertical-align:top;padding-left:14px;">');
        html.push('<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;color:' + B.PAPER + ';margin-bottom:4px;">' + esc(a.title) + '</div>');
        html.push('<div style="font-family:Georgia,serif;font-size:13px;line-height:1.55;color:#c8ccd6;">' + esc(a.rationale) + '</div>');
        html.push('</td></tr></table>');
      });
    }
    html.push('</div>');
  }

  html.push('<div style="padding:28px 44px;text-align:center;background:' + B.PAPER + ';border-top:1px solid ' + B.RULE + ';">');
  html.push('<a href="' + esc(docUrl) + '" style="display:inline-block;padding:13px 30px;background:' + B.AMBER + ';color:' + B.PAPER + ';text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;border-radius:2px;">View Full Report in Google Docs</a>');
  html.push('</div>');

  html.push('<div style="height:3px;background:' + B.AMBER + ';"></div>');
  html.push('<div style="padding:18px 44px 24px 44px;background:' + B.PAPER + ';text-align:center;">');
  html.push('<div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;color:' + B.MUTED + ';letter-spacing:1px;">Generated by Spindletap Business Brain &nbsp;&middot;&nbsp; Every Monday 7am CT</div>');
  html.push('<div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;color:' + B.MUTED + ';margin-top:4px;">Confidential &nbsp;&middot;&nbsp; Owner distribution only.</div>');
  html.push('</div>');

  html.push('</div>');
  html.push('</body></html>');

  CONFIG.REPORT_RECIPIENTS.forEach(function(email) {
    MailApp.sendEmail(email, subject, "Executive Business Pulse — view in an HTML-capable email client.", {
      htmlBody: html.join("\n"),
      name: "Spindletap Business Brain",
      inlineImages: inlineImages
    });
  });
  Logger.log("Email sent to: " + CONFIG.REPORT_RECIPIENTS.join(", "));
}

// ============================================================
// SAVE: Google Doc with native formatting (no markdown leak)
// ============================================================
function saveReportAsDoc(parsed, rawReport) {
  var today = new Date();
  var dateStr = Utilities.formatDate(today, "America/Chicago", "MMM d, yyyy");
  var docTitle = "Executive Business Pulse — " + dateStr;

  var folders = DriveApp.getFoldersByName(CONFIG.REPORTS_FOLDER_NAME);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(CONFIG.REPORTS_FOLDER_NAME);

  var doc = DocumentApp.create(docTitle);
  var body = doc.getBody();
  body.clear();

  body.appendParagraph("Spindletap Beverages").setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(docTitle).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  var meta = body.appendParagraph(
    "Generated " + Utilities.formatDate(today, "America/Chicago", "MMM d, yyyy h:mm a 'CT'")
  );
  meta.setItalic(true);
  meta.editAsText().setForegroundColor("#666666");
  body.appendHorizontalRule();

  if (parsed.meta.headline) {
    var hl = body.appendParagraph(parsed.meta.headline);
    hl.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    hl.setItalic(true);
  }

  if (parsed.execSummary.length) {
    body.appendParagraph("Executive Summary").setHeading(DocumentApp.ParagraphHeading.HEADING2);
    parsed.execSummary.forEach(function(bullet) {
      body.appendListItem(bullet).setGlyphType(DocumentApp.GlyphType.BULLET);
    });
  }

  CONFIG.SECTION_ORDER.forEach(function(key) {
    var sec = parsed.sections[key];
    if (!sec) return;
    var title = CONFIG.SECTION_TITLES[key] || key;
    body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.HEADING2);

    if (sec.kpis && sec.kpis.length) {
      var rows = [["Status", "Metric", "Value", "Note"]];
      sec.kpis.forEach(function(k) {
        rows.push([k.status, k.label, k.value, k.context]);
      });
      var table = body.appendTable(rows);
      var header = table.getRow(0);
      for (var c = 0; c < header.getNumCells(); c++) {
        var cell = header.getCell(c);
        cell.editAsText().setBold(true);
        cell.setBackgroundColor("#1A1F2C");
        cell.editAsText().setForegroundColor("#FAF7F2");
      }
    }

    if (sec.narrative) body.appendParagraph(sec.narrative);
  });

  if (parsed.flags.length) {
    body.appendParagraph("Red Flags").setHeading(DocumentApp.ParagraphHeading.HEADING2);
    parsed.flags.forEach(function(f) {
      body.appendListItem(f).setGlyphType(DocumentApp.GlyphType.BULLET);
    });
  }

  if (parsed.actions.length) {
    body.appendParagraph("This Week's Priorities").setHeading(DocumentApp.ParagraphHeading.HEADING2);
    parsed.actions.forEach(function(a) {
      var p = body.appendParagraph(a.n + ". " + a.title);
      p.setHeading(DocumentApp.ParagraphHeading.HEADING3);
      body.appendParagraph(a.rationale);
    });
  }

  body.appendHorizontalRule();
  var raw = body.appendParagraph("— end of report —");
  raw.setItalic(true);
  raw.editAsText().setForegroundColor("#999999");

  doc.saveAndClose();

  var file = DriveApp.getFileById(doc.getId());
  folder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);

  Logger.log("Doc saved: " + doc.getUrl());
  return doc.getUrl();
}

// ============================================================
// SETUP & TEST
// ============================================================
function setupWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "generateWeeklyBusinessPulse") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("generateWeeklyBusinessPulse")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(7)
    .inTimezone("America/Chicago")
    .create();
  Logger.log("Trigger set: every Monday 7am CT");
}

function testNow() { generateWeeklyBusinessPulse(); }

function testNotionConnection() {
  try {
    var content = fetchNotionPage(CONFIG.NOTION_PAGES.EXEC_PULSE_PROMPT);
    Logger.log("OK. Pulse prompt length: " + content.length);
    Logger.log("First 800 chars:\n" + content.substring(0, 800));
  } catch (e) {
    Logger.log("FAIL: " + e.message);
  }
}

/**
 * Dry-run all configured database queries. Run before relying on the new
 * configuration in production.
 */
function testDatabaseQueries() {
  var dbs = [
    { name: "Operating Doctrine (All Active)",
      ds: CONFIG.NOTION_DATABASES.OPERATING_DOCTRINE.data_source_id,
      filter: { property: "Status", select: { equals: "Active" } },
      sorts: [{ property: "Adopted", direction: "descending" }],
      options: { fieldWhitelist: CONFIG.PULSE_QUERY_FIELDS.OPERATING_DOCTRINE,
                 includeBody: true } },
    { name: "Living Archive (Last 30 days)",
      ds: CONFIG.NOTION_DATABASES.LIVING_ARCHIVE.data_source_id,
      filter: { property: "Date", date: { past_month: {} } },
      sorts: [{ property: "Date", direction: "descending" }],
      options: { fieldWhitelist: CONFIG.PULSE_QUERY_FIELDS.LIVING_ARCHIVE,
                 includeBody: true } },
    { name: "Living Archive (Active flags)",
      ds: CONFIG.NOTION_DATABASES.LIVING_ARCHIVE.data_source_id,
      filter: {
        and: [
          { property: "Type", select: { equals: "Operational Flag" } },
          { property: "Active flag", checkbox: { equals: true } }
        ]
      },
      sorts: [{ property: "Date", direction: "descending" }],
      options: { fieldWhitelist: CONFIG.PULSE_QUERY_FIELDS.LIVING_ARCHIVE,
                 includeBody: true } },
    { name: "Intake Queue (Routed) — v6.3 changed from Pending review",
      ds: CONFIG.NOTION_DATABASES.INTAKE_QUEUE.data_source_id,
      filter: { property: "Status", select: { equals: "Routed" } },
      sorts: [{ property: "Routed date", direction: "descending" }],
      options: { fieldWhitelist: CONFIG.PULSE_QUERY_FIELDS.INTAKE_QUEUE,
                 includeBody: false } },
    { name: "Decision Pipeline (Ready)",
      ds: CONFIG.NOTION_DATABASES.DECISION_PIPELINE.data_source_id,
      filter: { property: "Status", select: { equals: "Ready" } },
      sorts: [{ property: "Date logged", direction: "ascending" }],
      options: { fieldWhitelist: CONFIG.PULSE_QUERY_FIELDS.DECISION_PIPELINE,
                 includeBody: false } },
    { name: "Cross-Agent Channel (Unread + Acknowledged) — v6.3 NEW",
      ds: CONFIG.NOTION_DATABASES.CROSS_AGENT_CHANNEL.data_source_id,
      filter: {
        or: [
          { property: "Status", select: { equals: "Unread" } },
          { property: "Status", select: { equals: "Acknowledged" } }
        ]
      },
      sorts: [{ property: "Date sent", direction: "descending" }],
      options: { fieldWhitelist: CONFIG.PULSE_QUERY_FIELDS.CROSS_AGENT_CHANNEL,
                 includeBody: false } }
  ];

  dbs.forEach(function(db) {
    try {
      var result = queryNotionDatabase(db.ds, db.filter, db.sorts, db.options);
      Logger.log("✓ " + db.name + " → " + result.length + " chars\n" +
                 "First 300 chars: " + result.substring(0, 300) + "\n");
    } catch (e) {
      Logger.log("✗ " + db.name + " FAILED: " + e.message);
    }
  });
}

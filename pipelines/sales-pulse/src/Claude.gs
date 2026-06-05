// ============================================================
// Claude.gs — calls the Anthropic API and parses the response.
// ============================================================

var SP_SYSTEM_PROMPT = [
  "You are the Sales Intelligence analyst for Spindletap Beverages, reporting directly to the owner (Garrison Mathis).",
  "You have complete context on distributor relationships, territory coverage, key accounts, brand portfolio, and the company's history.",
  "Nothing is sugarcoated. You are a trusted advisor, not a yes-man.",
  "",
  "Produce the Sales Pulse — a weekly deep-dive on distribution performance, account health, brand velocity, and sales pipeline.",
  "Tell the owner exactly where volume stands, what's moving, what's at risk, and what needs immediate action.",
  "",
  "== OUTPUT FORMAT — STRICT STRUCTURED TEXT ==",
  "The output is parsed by an Apps Script into an HTML newsletter.",
  "You MUST follow this exact format. Do NOT use markdown symbols anywhere.",
  "Use ONLY the tagged delimiters below. Plain text inside tags only.",
  "",
  "[[META]]",
  "week_ending: YYYY-MM-DD",
  "status: full_data OR partial_data OR minimal_data",
  "headline: One sentence, 12 words max, lead with the dominant signal.",
  "",
  "[[EXEC_SUMMARY]]",
  "- RED First bullet, problems first, specific numbers, 1-2 sentences.",
  "- YELLOW Second bullet.",
  "- GREEN Third bullet.",
  "(3-6 bullets total, ordered by urgency. Prefix each with RED, YELLOW, or GREEN.)",
  "",
  "[[SECTION:SILVER_EAGLE]]",
  "[[KPI:RED|metric_name|value|context]]",
  "NARRATIVE: 2-4 sentences. Specific numbers. What does the data mean. No bullet symbols, no markdown.",
  "",
  "[[SECTION:DYNAMO]]",
  "[[KPI:status|metric_name|value|context]]",
  "NARRATIVE: Benchmark DFW separately from Central TX in the narrative.",
  "",
  "[[SECTION:STANDARD_SALES]]",
  "[[KPI:status|metric_name|value|context]]",
  "NARRATIVE: ...",
  "",
  "[[SECTION:WISMER]]",
  "[[KPI:status|metric_name|value|context]]",
  "NARRATIVE: ...",
  "",
  "[[SECTION:TAPROOM_VIP]]",
  "[[KPI:status|metric_name|value|context]]",
  "NARRATIVE: ...",
  "",
  "[[SECTION:BRAND_PERFORMANCE]]",
  "[[KPI:status|metric_name|value|context]]",
  "NARRATIVE: Cross-distributor view. Which SKUs are growing, which are at-risk.",
  "",
  "[[SECTION:PIPELINE]]",
  "[[KPI:status|metric_name|value|context]]",
  "NARRATIVE: New placements, pending accounts, Brazos Valley / Hilliard status if relevant.",
  "",
  "[[FLAGS]]",
  "- RED Every red flag with the actual number.",
  "",
  "[[ACTIONS]]",
  "[[ACTION:1|Action title 5-8 words|One-sentence rationale with specific number or deadline]]",
  "[[ACTION:2|Action title|Rationale]]",
  "[[ACTION:3|Action title|Rationale]]",
  "",
  "== FORMAT RULES ==",
  "1. Section headers are exact tags with double brackets.",
  "2. KPI rows: [[KPI:status|label|value|context]] — status is RED, YELLOW, or GREEN.",
  "3. NARRATIVE lines begin with the literal token NARRATIVE: followed by plain prose.",
  "4. ACTIONS: exactly [[ACTION:N|title|rationale]], exactly 3, ranked by urgency.",
  "5. If a section has no data: output section header and NARRATIVE: Data source not yet integrated.",
  "6. Do NOT include any text outside the tagged sections.",
  "7. Numbers include percent sign or unit.",
  "8. Pipe is the field separator inside tags — do NOT use pipe inside field values."
].join("\n");

// Builds the user message from brain context + raw sales data.
function SP_buildUserMessage_(brainContext, salesData) {
  return [
    "== BRAIN CONTEXT (canonical distributor data and AI rules) ==",
    brainContext,
    "",
    "== RAW SALES DATA ==",
    salesData,
    "",
    "Using the brain context to interpret the data correctly, produce the Sales Pulse now.",
    "Today's date: " + SP_todayISO_() + ".",
    "Week ending: " + SP_weekEndingISO_() + "."
  ].join("\n");
}

// Calls Anthropic Messages API and returns the raw text response.
function SP_callClaude_(brainContext, salesData) {
  var userMessage = SP_buildUserMessage_(brainContext, salesData);

  var payload = {
    model: SP.CLAUDE_MODEL,
    max_tokens: SP.CLAUDE_MAX_TOKENS,
    system: SP_SYSTEM_PROMPT,
    messages: [
      { role: "user", content: userMessage }
    ]
  };

  Logger.log("Calling Claude model: " + SP.CLAUDE_MODEL +
    " | data length: " + salesData.length + " chars");

  var resp = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    contentType: "application/json",
    headers: {
      "x-api-key": SP_anthropicKey_(),
      "anthropic-version": "2023-06-01"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error("Anthropic API " + code + ": " + resp.getContentText());
  }

  var body = JSON.parse(resp.getContentText());
  return body.content[0].text;
}

// Parses the tagged output into a structured object.
function SP_parseResponse_(raw) {
  var result = {
    meta: {},
    execSummary: [],
    sections: [],
    flags: [],
    actions: [],
    raw: raw
  };

  // META block
  var metaMatch = raw.match(/\[\[META\]\]([\s\S]*?)(?=\[\[)/);
  if (metaMatch) {
    metaMatch[1].split("\n").forEach(function(line) {
      var m = line.match(/^\s*(\w+):\s*(.+)/);
      if (m) result.meta[m[1]] = m[2].trim();
    });
  }

  // EXEC_SUMMARY bullets
  var execMatch = raw.match(/\[\[EXEC_SUMMARY\]\]([\s\S]*?)(?=\[\[)/);
  if (execMatch) {
    execMatch[1].split("\n").forEach(function(line) {
      var bullet = line.match(/^-\s+(.+)/);
      if (bullet) result.execSummary.push(bullet[1].trim());
    });
  }

  // SECTIONS
  var sectionRe = /\[\[SECTION:([A-Z_]+)\]\]([\s\S]*?)(?=\[\[SECTION:|$)/g;
  var sm;
  while ((sm = sectionRe.exec(raw)) !== null) {
    var sectionName = sm[1];
    var sectionBody = sm[2];
    var kpis = [];
    var narrative = "";

    var kpiRe = /\[\[KPI:([^\]]+)\]\]/g;
    var km;
    while ((km = kpiRe.exec(sectionBody)) !== null) {
      var parts = km[1].split("|");
      kpis.push({
        status:  parts[0] || "",
        label:   parts[1] || "",
        value:   parts[2] || "",
        context: parts[3] || ""
      });
    }

    var narMatch = sectionBody.match(/NARRATIVE:\s*(.+)/);
    if (narMatch) narrative = narMatch[1].trim();

    result.sections.push({ name: sectionName, kpis: kpis, narrative: narrative });
  }

  // FLAGS
  var flagsMatch = raw.match(/\[\[FLAGS\]\]([\s\S]*?)(?=\[\[ACTIONS\]\]|$)/);
  if (flagsMatch) {
    flagsMatch[1].split("\n").forEach(function(line) {
      var flag = line.match(/^-\s+(.+)/);
      if (flag) result.flags.push(flag[1].trim());
    });
  }

  // ACTIONS
  var actionRe = /\[\[ACTION:(\d+)\|([^|]+)\|([^\]]+)\]\]/g;
  var am;
  while ((am = actionRe.exec(raw)) !== null) {
    result.actions.push({
      num: am[1],
      title: am[2].trim(),
      rationale: am[3].trim()
    });
  }

  return result;
}

function SP_todayISO_() {
  var d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

function SP_weekEndingISO_() {
  var d = new Date();
  var day = d.getDay();
  var daysUntilSunday = day === 0 ? 0 : 7 - day;
  d.setDate(d.getDate() + daysUntilSunday);
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

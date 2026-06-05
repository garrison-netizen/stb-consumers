// ============================================================
// Pure transforms — Mailchimp objects -> Notion property payloads.
// No I/O here (the unit-reviewable core).
//
// Idempotency natural key (Architect directive 2026-05-19):
// Send date + Subject line. Human-recognizable and Send-date-indexed
// for diff queries. NOT campaign id. Collision risk (A/B tests,
// same-day resends) is handled by Shared.gs STB_notionFindOne_, which
// fails loudly on >1 match rather than overwriting. See README.
// ============================================================

// Truncate an ISO datetime to date-only (YYYY-MM-DD). Notion stores
// Phase 1 manual rows as date-only; Mailchimp returns full datetimes.
// Both filter and create normalize to date-only so they match cleanly.
function MC_dateOnly_(iso) { return String(iso || "").substring(0, 10); }

// Notion rich_text caps a single text content at 2000 chars — chunk.
function MC_rt_(s) {
  s = String(s == null ? "" : s);
  if (s.length === 0) return { rich_text: [] };
  var parts = [];
  for (var i = 0; i < s.length; i += 1900) {
    parts.push({ text: { content: s.substring(i, i + 1900) } });
  }
  return { rich_text: parts };
}

// Natural key = Send date (date-only) + Subject line. Resolved 2026-05-19
// after dry-run: Notion `date.equals` does NOT treat datetime-vs-date as
// equal — values must match in granularity. Both sides normalized to
// date-only. Same-day collisions (A/B tests, resends sharing a subject)
// are caught loudly by STB_notionFindOne_, never silently overwritten.
function MC_naturalKeyFilter_(sendISO, subject) {
  return {
    and: [
      { property: MC.PROP.SEND_DATE, date: { equals: MC_dateOnly_(sendISO) } },
      { property: MC.PROP.SUBJECT_LINE, rich_text: { equals: String(subject == null ? "" : subject) } }
    ]
  };
}

// Full row, written only when the campaign is NOT already in Notion.
function MC_createProps_(campaign, bodyPlain, report) {
  var settings = campaign.settings || {};
  var recips = campaign.recipients || {};
  var props = {};
  props[MC.PROP.CAMPAIGN_NAME] = STB_pTitle_(settings.title || settings.subject_line || campaign.id);
  props[MC.PROP.SEND_DATE]     = STB_pDateISO_(MC_dateOnly_(campaign.send_time));
  props[MC.PROP.SUBJECT_LINE]  = STB_pRichText_(settings.subject_line || "");
  props[MC.PROP.CAMPAIGN_BODY] = MC_rt_(bodyPlain);
  if (recips.segment_text) props[MC.PROP.TARGET_SEG] = MC_rt_(recips.segment_text);
  props[MC.PROP.PHASE]         = STB_pSelect_(MC.PHASE_API);
  // Focus area / Notes / Source file are editorial — pipeline never sets them.
  var metrics = MC_metricsProps_(report);
  for (var k in metrics) props[k] = metrics[k];
  return props;
}

// Metric fields only (used for backfill onto existing rows).
// Mailchimp report rates are already fractions (0.42 == 42%) — matches
// the Notion percent number_format directive (store 0.42).
function MC_metricsProps_(report) {
  report = report || {};
  var opens = report.opens || {};
  var clicks = report.clicks || {};
  var props = {};
  if (typeof opens.open_rate === "number")   props[MC.PROP.OPEN_RATE]  = STB_pNumber_(opens.open_rate);
  if (typeof clicks.click_rate === "number") props[MC.PROP.CLICK_RATE] = STB_pNumber_(clicks.click_rate);
  if (typeof report.emails_sent === "number") props[MC.PROP.RECIPIENTS] = STB_pNumber_(report.emails_sent);
  return props;
}

// Candidate fills for an EXISTING row — metrics + body/segment only.
// Identity (name/date/subject), Phase, and human fields are never in here.
function MC_backfillCandidates_(campaign, bodyPlain, report) {
  var recips = campaign.recipients || {};
  var props = MC_metricsProps_(report);
  if (bodyPlain) props[MC.PROP.CAMPAIGN_BODY] = MC_rt_(bodyPlain);
  if (recips.segment_text) props[MC.PROP.TARGET_SEG] = MC_rt_(recips.segment_text);
  return props;
}

// ============================================================
// Render.gs — HTML email. Matches Executive Pulse v6.4 styling.
// CSS indicator dots replace emoji (cross-client compatible).
// ============================================================

var SP_BRAND = {
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
};

var SP_SECTION_LABELS = {
  SILVER_EAGLE:      "Silver Eagle (Houston)",
  DYNAMO:            "Dynamo Specialty (Central TX + DFW)",
  STANDARD_SALES:    "Standard Sales",
  WISMER:            "Wismer Distributing",
  TAPROOM_VIP:       "Taproom & VIP",
  BRAND_PERFORMANCE: "Brand Performance",
  PIPELINE:          "Sales Pipeline"
};

var SP_SECTION_ORDER = [
  "SILVER_EAGLE", "DYNAMO", "STANDARD_SALES",
  "WISMER", "TAPROOM_VIP", "BRAND_PERFORMANCE", "PIPELINE"
];

function SP_renderEmail_(pulse) {
  var meta       = pulse.meta || {};
  var weekEnding = meta.week_ending || "";
  var headline   = meta.headline    || "";
  var B = SP_BRAND;

  var today   = new Date();
  var dateStr = Utilities.formatDate(today, "America/Chicago", "MMMM d, yyyy");

  var html = [];

  html.push('<!DOCTYPE html><html><head><meta charset="UTF-8">');
  html.push('<meta name="viewport" content="width=device-width,initial-scale=1.0">');
  html.push('</head>');
  html.push('<body style="margin:0;padding:0;background:#EDEAE4;font-family:Georgia,\'Times New Roman\',serif;color:' + B.INK + ';">');

  // Outer centering wrapper with subtle border for desktop
  html.push('<div style="max-width:680px;margin:32px auto;background:' + B.PAPER + ';border:1px solid ' + B.RULE + ';">');

  // Top accent bar
  html.push('<div style="height:5px;background:' + B.AMBER + ';"></div>');

  // ---- Header ----
  html.push('<div style="padding:36px 44px 28px 44px;background:' + B.AMBER_SOFT + ';border-bottom:2px solid ' + B.INK + ';">');
  html.push('<div style="text-align:center;font-size:11px;letter-spacing:4px;color:' + B.AMBER + ';font-family:Helvetica,Arial,sans-serif;text-transform:uppercase;margin-bottom:10px;">Spindletap Beverages</div>');
  html.push('<div style="text-align:center;font-family:Georgia,serif;font-size:28px;font-weight:700;color:' + B.INK + ';margin-bottom:8px;">Sales Pulse</div>');
  html.push('<div style="text-align:center;font-size:12px;color:' + B.MUTED + ';font-family:Helvetica,Arial,sans-serif;">' + SP_esc_(dateStr));
  if (weekEnding) html.push('&nbsp;&nbsp;&middot;&nbsp;&nbsp;Week ending ' + SP_esc_(weekEnding));
  html.push('</div>');
  html.push('</div>');

  // ---- Headline ----
  if (headline) {
    html.push('<div style="padding:28px 44px 4px 44px;background:' + B.PAPER + ';">');
    html.push('<div style="font-family:Georgia,serif;font-size:22px;line-height:1.4;color:' + B.INK + ';font-style:italic;border-left:4px solid ' + B.AMBER + ';padding-left:16px;">');
    html.push('&ldquo;' + SP_esc_(headline) + '&rdquo;');
    html.push('</div></div>');
  }

  // ---- The Bottom Line ----
  if (pulse.execSummary && pulse.execSummary.length) {
    html.push('<div style="padding:24px 44px 28px 44px;background:' + B.PAPER + ';">');
    html.push('<div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:3px;color:' + B.AMBER + ';text-transform:uppercase;margin-bottom:14px;">The Bottom Line</div>');
    html.push('<table style="width:100%;border-collapse:collapse;">');
    pulse.execSummary.forEach(function(bullet) {
      html.push('<tr><td style="padding:10px 0 10px 4px;font-family:Georgia,serif;font-size:14px;line-height:1.6;color:' + B.INK + ';border-bottom:1px solid ' + B.RULE + ';">');
      html.push(SP_renderBullet_(bullet));
      html.push('</td></tr>');
    });
    html.push('</table></div>');
  }

  // ---- Sections ----
  SP_SECTION_ORDER.forEach(function(key, i) {
    var sec = pulse.sections ? pulse.sections.filter(function(s){ return s.name === key; })[0] : null;
    if (!sec) return;
    var title = SP_SECTION_LABELS[key] || key;
    var bg = i % 2 === 0 ? B.CARD : B.PAPER;

    html.push('<div style="padding:28px 44px 24px 44px;background:' + bg + ';border-top:1px solid ' + B.RULE + ';">');

    // Section label + title
    html.push('<div style="font-family:Helvetica,Arial,sans-serif;font-size:9px;letter-spacing:3px;color:' + B.AMBER + ';text-transform:uppercase;margin-bottom:4px;">Distributor / Channel</div>');
    html.push('<div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:' + B.INK + ';padding-bottom:10px;margin-bottom:16px;border-bottom:2px solid ' + B.AMBER + ';display:inline-block;">' + SP_esc_(title) + '</div>');

    // KPI table
    if (sec.kpis && sec.kpis.length) {
      html.push('<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">');
      sec.kpis.forEach(function(kpi) {
        var c = SP_colorForStatus_(kpi.status);
        html.push('<tr style="margin-bottom:6px;">');
        html.push('<td style="padding:11px 14px;background:' + c.bg + ';border-left:4px solid ' + c.fg + ';width:40%;font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;color:' + B.INK + ';">' + SP_esc_(kpi.label) + '</td>');
        html.push('<td style="padding:11px 14px;background:' + c.bg + ';width:20%;font-family:Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;color:' + c.fg + ';white-space:nowrap;">' + SP_esc_(kpi.value) + '</td>');
        html.push('<td style="padding:11px 14px;background:' + c.bg + ';font-family:Helvetica,Arial,sans-serif;font-size:11px;color:' + B.MUTED + ';font-style:italic;">' + SP_esc_(kpi.context) + '</td>');
        html.push('</tr>');
        html.push('<tr><td colspan="3" style="height:3px;background:' + bg + ';"></td></tr>');
      });
      html.push('</table>');
    }

    if (sec.narrative) {
      html.push('<div style="font-family:Georgia,serif;font-size:14px;line-height:1.7;color:' + B.INK + ';">' + SP_esc_(sec.narrative) + '</div>');
    }
    html.push('</div>');
  });

  // ---- Action Required ----
  if ((pulse.flags && pulse.flags.length) || (pulse.actions && pulse.actions.length)) {
    html.push('<div style="padding:32px 44px 36px 44px;background:' + B.INK + ';color:' + B.PAPER + ';">');
    html.push('<div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:3px;color:' + B.AMBER + ';text-transform:uppercase;margin-bottom:18px;">Action Required</div>');

    if (pulse.flags && pulse.flags.length) {
      html.push('<div style="font-family:Georgia,serif;font-size:16px;font-weight:700;color:' + B.PAPER + ';margin-bottom:12px;">Red Flags</div>');
      html.push('<table style="width:100%;border-collapse:collapse;margin-bottom:28px;">');
      pulse.flags.forEach(function(f) {
        html.push('<tr><td style="padding:9px 0;border-bottom:1px solid #2e3340;font-family:Georgia,serif;font-size:13px;line-height:1.5;color:' + B.PAPER + ';">');
        html.push(SP_renderBullet_(f, B.PAPER));
        html.push('</td></tr>');
      });
      html.push('</table>');
    }

    if (pulse.actions && pulse.actions.length) {
      html.push('<div style="font-family:Georgia,serif;font-size:16px;font-weight:700;color:' + B.PAPER + ';margin:0 0 16px 0;">This Week\'s Priorities</div>');
      pulse.actions.forEach(function(a) {
        html.push('<table style="width:100%;border-collapse:collapse;margin-bottom:16px;"><tr>');
        html.push('<td style="width:44px;vertical-align:top;padding-top:3px;">');
        html.push('<div style="width:34px;height:34px;background:' + B.AMBER + ';color:' + B.PAPER + ';font-family:Georgia,serif;font-size:16px;font-weight:700;text-align:center;line-height:34px;border-radius:50%;">' + SP_esc_(a.num) + '</div>');
        html.push('</td>');
        html.push('<td style="vertical-align:top;padding-left:14px;">');
        html.push('<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;color:' + B.PAPER + ';margin-bottom:4px;">' + SP_esc_(a.title) + '</div>');
        html.push('<div style="font-family:Georgia,serif;font-size:13px;line-height:1.55;color:#c8ccd6;">' + SP_esc_(a.rationale) + '</div>');
        html.push('</td></tr></table>');
      });
    }
    html.push('</div>');
  }

  // ---- Footer ----
  html.push('<div style="height:3px;background:' + B.AMBER + ';"></div>');
  html.push('<div style="padding:20px 44px;background:' + B.PAPER + ';text-align:center;">');
  html.push('<div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;color:' + B.MUTED + ';letter-spacing:1px;">Generated by Spindletap Business Brain &nbsp;&middot;&nbsp; Every Monday 7am CT</div>');
  html.push('<div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;color:' + B.MUTED + ';margin-top:4px;">Confidential &nbsp;&middot;&nbsp; Owner distribution only.</div>');
  html.push('</div>');

  html.push('</div>');  // end outer wrapper
  html.push('</body></html>');
  return html.join("\n");
}

// Renders a bullet line: strips leading emoji / status token,
// prepends a CSS-rendered colored dot. Works in all email clients.
function SP_renderBullet_(text, overrideTextColor) {
  var RED_DOT    = "🔴";
  var YELLOW_DOT = "🟡";
  var GREEN_DOT  = "🟢";
  var B = SP_BRAND;

  var color = B.MUTED;
  var clean = String(text || "").trim();

  // Strip emoji prefix (2 code units) or text token
  if (clean.charAt(0) === RED_DOT.charAt(0) && clean.charAt(1) === RED_DOT.charAt(1)) {
    color = B.RED; clean = clean.substring(2).trim();
  } else if (clean.charAt(0) === YELLOW_DOT.charAt(0) && clean.charAt(1) === YELLOW_DOT.charAt(1)) {
    color = B.YELLOW; clean = clean.substring(2).trim();
  } else if (clean.charAt(0) === GREEN_DOT.charAt(0) && clean.charAt(1) === GREEN_DOT.charAt(1)) {
    color = B.GREEN; clean = clean.substring(2).trim();
  } else if (/^RED\s/i.test(clean)) {
    color = B.RED; clean = clean.replace(/^RED\s*/i, "");
  } else if (/^YELLOW\s/i.test(clean)) {
    color = B.YELLOW; clean = clean.replace(/^YELLOW\s*/i, "");
  } else if (/^GREEN\s/i.test(clean)) {
    color = B.GREEN; clean = clean.replace(/^GREEN\s*/i, "");
  }

  var dotStyle = 'display:inline-block;width:9px;height:9px;border-radius:50%;background:' + color + ';margin-right:10px;vertical-align:middle;flex-shrink:0;';
  var textColor = overrideTextColor ? 'color:' + overrideTextColor + ';' : '';
  return '<span style="' + dotStyle + '"></span><span style="' + textColor + '">' + SP_esc_(clean) + '</span>';
}

function SP_colorForStatus_(status) {
  var s = String(status || "").toUpperCase();
  if (s.indexOf("RED")    !== -1) return { fg: SP_BRAND.RED,    bg: SP_BRAND.RED_SOFT };
  if (s.indexOf("YELLOW") !== -1) return { fg: SP_BRAND.YELLOW, bg: SP_BRAND.YELLOW_SOFT };
  if (s.indexOf("GREEN")  !== -1) return { fg: SP_BRAND.GREEN,  bg: SP_BRAND.GREEN_SOFT };
  return { fg: SP_BRAND.MUTED, bg: SP_BRAND.PAPER };
}

function SP_esc_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

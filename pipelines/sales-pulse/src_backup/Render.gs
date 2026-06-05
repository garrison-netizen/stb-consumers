// ============================================================
// Render.gs — builds the HTML email from parsed pulse data.
// Mirrors the Executive Pulse visual language: dark header,
// status-colored KPI chips, clean section cards.
// ============================================================

var SP_SECTION_LABELS = {
  SILVER_EAGLE:      "Silver Eagle (Houston)",
  DYNAMO:            "Dynamo Specialty (Central TX + DFW)",
  STANDARD_SALES:    "Standard Sales",
  WISMER:            "Wismer Distributing",
  TAPROOM_VIP:       "Taproom & VIP",
  BRAND_PERFORMANCE: "Brand Performance",
  PIPELINE:          "Sales Pipeline"
};

var SP_STATUS_COLORS = {
  "RED":    "#c0392b",
  "YELLOW": "#e67e22",
  "GREEN":  "#27ae60"
};

function SP_renderEmail_(pulse) {
  var meta = pulse.meta || {};
  var weekEnding = meta.week_ending || "Unknown week";
  var headline   = meta.headline    || "";
  var status     = meta.status      || "partial_data";

  var statusLabel = { full_data: "Full Data", partial_data: "Partial Data", minimal_data: "Minimal Data" }[status] || status;
  var statusColor = { full_data: "#27ae60",   partial_data: "#e67e22",      minimal_data: "#c0392b"     }[status] || "#888";

  var html = [];

  // ---- Wrapper ----
  html.push('<div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:0 auto;background:#f5f5f5;">');

  // ---- Header ----
  html.push('<div style="background:#1a1a2e;padding:28px 32px 20px;">');
  html.push('<div style="color:#aaa;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">Spindletap Beverages</div>');
  html.push('<div style="color:#fff;font-size:22px;font-weight:700;margin-bottom:8px;">Sales Pulse</div>');
  html.push('<div style="color:#ccc;font-size:13px;">Week ending ' + SP_esc_(weekEnding) + '</div>');
  if (headline) {
    html.push('<div style="color:#e8e8e8;font-size:15px;margin-top:14px;line-height:1.4;">' + SP_esc_(headline) + '</div>');
  }
  html.push('<div style="margin-top:10px;display:inline-block;background:' + statusColor + ';color:#fff;font-size:11px;padding:3px 8px;border-radius:3px;">' + statusLabel + '</div>');
  html.push('</div>');

  // ---- Exec Summary ----
  if (pulse.execSummary && pulse.execSummary.length > 0) {
    html.push('<div style="background:#fff;margin:16px 16px 0;padding:20px 24px;border-radius:6px;border-left:4px solid #1a1a2e;">');
    html.push('<div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#444;margin-bottom:12px;">Executive Summary</div>');
    html.push('<ul style="margin:0;padding:0 0 0 4px;list-style:none;">');
    pulse.execSummary.forEach(function(bullet) {
      var color = SP_bulletColor_(bullet);
      html.push('<li style="padding:5px 0;font-size:14px;color:#222;line-height:1.5;border-bottom:1px solid #f0f0f0;">' + SP_esc_(bullet) + '</li>');
    });
    html.push('</ul>');
    html.push('</div>');
  }

  // ---- Sections ----
  (pulse.sections || []).forEach(function(section) {
    var label = SP_SECTION_LABELS[section.name] || section.name;
    html.push('<div style="background:#fff;margin:12px 16px 0;padding:20px 24px;border-radius:6px;">');
    html.push('<div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#444;border-bottom:2px solid #1a1a2e;padding-bottom:8px;margin-bottom:14px;">' + SP_esc_(label) + '</div>');

    // KPI chips
    if (section.kpis && section.kpis.length > 0) {
      html.push('<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">');
      section.kpis.forEach(function(kpi) {
        var borderColor = SP_STATUS_COLORS[kpi.status] || "#888";
        html.push('<div style="border-left:3px solid ' + borderColor + ';background:#f9f9f9;padding:8px 12px;border-radius:4px;min-width:160px;max-width:220px;">');
        html.push('<div style="font-size:11px;color:#666;margin-bottom:2px;">' + SP_esc_(kpi.label) + '</div>');
        html.push('<div style="font-size:16px;font-weight:700;color:#1a1a2e;">' + SP_esc_(kpi.value) + '</div>');
        if (kpi.context) {
          html.push('<div style="font-size:11px;color:#888;margin-top:2px;">' + SP_esc_(kpi.context) + '</div>');
        }
        html.push('</div>');
      });
      html.push('</div>');
    }

    // Narrative
    if (section.narrative) {
      html.push('<div style="font-size:14px;color:#333;line-height:1.65;">' + SP_esc_(section.narrative) + '</div>');
    }

    html.push('</div>');
  });

  // ---- Flags ----
  if (pulse.flags && pulse.flags.length > 0) {
    html.push('<div style="background:#fff3f3;margin:12px 16px 0;padding:20px 24px;border-radius:6px;border-left:4px solid #c0392b;">');
    html.push('<div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#c0392b;margin-bottom:12px;">Flags</div>');
    html.push('<ul style="margin:0;padding:0 0 0 4px;list-style:none;">');
    pulse.flags.forEach(function(flag) {
      html.push('<li style="padding:4px 0;font-size:14px;color:#333;">' + SP_esc_(flag) + '</li>');
    });
    html.push('</ul>');
    html.push('</div>');
  }

  // ---- Actions ----
  if (pulse.actions && pulse.actions.length > 0) {
    html.push('<div style="background:#fff;margin:12px 16px 0;padding:20px 24px;border-radius:6px;border-left:4px solid #e67e22;">');
    html.push('<div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#e67e22;margin-bottom:14px;">Actions This Week</div>');
    pulse.actions.forEach(function(action) {
      html.push('<div style="display:flex;align-items:flex-start;margin-bottom:12px;">');
      html.push('<div style="background:#e67e22;color:#fff;font-size:12px;font-weight:700;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:10px;margin-top:1px;">' + action.num + '</div>');
      html.push('<div>');
      html.push('<div style="font-size:14px;font-weight:600;color:#1a1a2e;">' + SP_esc_(action.title) + '</div>');
      html.push('<div style="font-size:13px;color:#555;margin-top:2px;">' + SP_esc_(action.rationale) + '</div>');
      html.push('</div>');
      html.push('</div>');
    });
    html.push('</div>');
  }

  // ---- Footer ----
  html.push('<div style="text-align:center;padding:20px;font-size:11px;color:#aaa;">');
  html.push('Spindletap Beverages Sales Pulse &middot; Generated ' + SP_todayISO_());
  html.push('</div>');

  html.push('</div>');

  return html.join("\n");
}

function SP_esc_(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function SP_bulletColor_(bullet) {
  var up = bullet.toUpperCase();
  if (up.indexOf("RED") >= 0)    return SP_STATUS_COLORS["RED"];
  if (up.indexOf("YELLOW") >= 0) return SP_STATUS_COLORS["YELLOW"];
  if (up.indexOf("GREEN") >= 0)  return SP_STATUS_COLORS["GREEN"];
  return "#333";
}

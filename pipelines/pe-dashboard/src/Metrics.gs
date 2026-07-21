// ============================================================
// Metrics.gs — pure computation, no I/O. Takes normalized leads +
// bookings, returns the dashboard model Render.gs draws from.
//
// Revenue convention (matches the Q2 2026 close method): booking
// revenue = Actual revenue when present, else Quoted revenue.
// Cancelled bookings are excluded from revenue everywhere; bar sales
// are shown as their own column, not folded into event revenue.
// ============================================================

function PED_metrics_(leads, bookings) {
  var today = PED_todayISO_();
  var year  = Number(today.substring(0, 4));

  var live = bookings.filter(function(b) { return b.status !== "Cancelled" && b.eventDate; });

  return {
    generatedAt: PED_nowStampCT_(),
    kpis:        PED_kpis_(leads, live, today, year),
    monthly:     PED_monthly_(live, year),
    upcoming:    PED_upcoming_(live, today),
    attention:   PED_attention_(leads, live, today),
    funnel:      PED_funnel_(leads, today)
  };
}

// ---- KPI strip -------------------------------------------------

function PED_kpis_(leads, live, today, year) {
  var ytd = 0, ytdLY = 0, ytdEvents = 0;
  var lyCutoff = (year - 1) + today.substring(4);  // same day last year
  live.forEach(function(b) {
    var rev = PED_rev_(b);
    if (b.eventDate.substring(0, 4) == year && b.eventDate <= today) { ytd += rev; ytdEvents++; }
    if (b.eventDate.substring(0, 4) == (year - 1) && b.eventDate <= lyCutoff) ytdLY += rev;
  });

  var horizon = PED_addDaysISO_(today, 30);
  var next30 = live.filter(function(b) { return b.eventDate > today && b.eventDate <= horizon; });
  var next30Rev = next30.reduce(function(n, b) { return n + PED_rev_(b); }, 0);

  var openLeads = leads.filter(function(l) { return l.status === "Pending"; }).length;

  return {
    ytdRevenue: ytd, ytdEvents: ytdEvents, ytdLastYear: ytdLY,
    next30Count: next30.length, next30Revenue: next30Rev,
    openLeads: openLeads
  };
}

// ---- Monthly revenue table (current year vs last year) ---------

function PED_monthly_(live, year) {
  var months = [];
  for (var m = 1; m <= 12; m++) {
    var mm = (m < 10 ? "0" : "") + m;
    var row = { month: PED_MONTHS[m - 1], events: 0, revenue: 0, bar: 0, lastYear: 0 };
    live.forEach(function(b) {
      var y = b.eventDate.substring(0, 4), bm = b.eventDate.substring(5, 7);
      if (bm !== mm) return;
      if (y == year) { row.events++; row.revenue += PED_rev_(b); row.bar += (b.barActual || 0); }
      else if (y == (year - 1)) { row.lastYear += PED_rev_(b); }
    });
    months.push(row);
  }
  return months;
}

// ---- Upcoming events board -------------------------------------

function PED_upcoming_(live, today) {
  var horizon = PED_addDaysISO_(today, PED.UPCOMING_DAYS);
  return live
    .filter(function(b) { return b.eventDate > today && b.eventDate <= horizon; })
    .sort(function(a, b) { return a.eventDate < b.eventDate ? -1 : 1; })
    .map(function(b) {
      return {
        date: b.eventDate, title: b.title, headcount: b.finalHc,
        revenue: PED_rev_(b), depositPaid: b.depositPaid,
        balancePaid: b.balancePaid, rep: b.rep
      };
    });
}

// ---- Needs attention -------------------------------------------

function PED_attention_(leads, live, today) {
  var floor = PED_addDaysISO_(today, -PED.COLLECTIONS_LOOKBACK_DAYS);

  // Past events (recent window) with an unpaid balance.
  var unpaidBalances = live.filter(function(b) {
    return b.eventDate <= today && b.eventDate >= floor &&
           !b.balancePaid && PED_rev_(b) > 0;
  }).sort(function(a, b) { return a.eventDate < b.eventDate ? -1 : 1; });

  // Upcoming events with no deposit on file.
  var unpaidDeposits = live.filter(function(b) {
    return b.eventDate > today && !b.depositPaid;
  }).sort(function(a, b) { return a.eventDate < b.eventDate ? -1 : 1; });

  // Pending leads sitting longer than the stale threshold.
  var staleCutoff = PED_addDaysISO_(today, -PED.STALE_LEAD_DAYS);
  var staleLeads = leads.filter(function(l) {
    return l.status === "Pending" && l.createdAt && l.createdAt <= staleCutoff;
  }).sort(function(a, b) { return a.createdAt < b.createdAt ? -1 : 1; });

  return {
    unpaidBalances: unpaidBalances,
    unpaidBalanceTotal: unpaidBalances.reduce(function(n, b) { return n + PED_rev_(b); }, 0),
    unpaidDeposits: unpaidDeposits,
    staleLeads: staleLeads
  };
}

// ---- Lead funnel (trailing window) -----------------------------

function PED_funnel_(leads, today) {
  var floor = PED_addDaysISO_(today, -PED.FUNNEL_LOOKBACK_DAYS);
  var win = leads.filter(function(l) { return l.createdAt && l.createdAt >= floor; });

  var by = { Pending: 0, Booked: 0, Passed: 0, Lost: 0 };
  var bySource = {};
  win.forEach(function(l) {
    if (by[l.status] === undefined) by[l.status] = 0;
    by[l.status]++;
    var s = l.source || "Unknown";
    if (!bySource[s]) bySource[s] = { leads: 0, booked: 0 };
    bySource[s].leads++;
    if (l.status === "Booked") bySource[s].booked++;
  });

  var sources = Object.keys(bySource).map(function(s) {
    return { source: s, leads: bySource[s].leads, booked: bySource[s].booked };
  }).sort(function(a, b) { return b.leads - a.leads; }).slice(0, PED.TOP_SOURCES);

  return {
    windowDays: PED.FUNNEL_LOOKBACK_DAYS,
    total: win.length,
    byStatus: by,
    conversionPct: win.length ? Math.round(100 * by.Booked / win.length) : 0,
    topSources: sources
  };
}

// ---- Small helpers ---------------------------------------------

var PED_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function PED_rev_(b) {
  return (b.actualRev != null) ? b.actualRev : (b.quotedRev || 0);
}

// Date-only, Central Time — tz-safe (the documented Notion granularity gotcha).
function PED_todayISO_() {
  return Utilities.formatDate(new Date(), "America/Chicago", "yyyy-MM-dd");
}
function PED_nowStampCT_() {
  return Utilities.formatDate(new Date(), "America/Chicago", "yyyy-MM-dd h:mm a") + " CT";
}
function PED_addDaysISO_(iso, days) {
  var d = new Date(iso + "T12:00:00Z");  // noon UTC avoids DST edge shifts
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().substring(0, 10);
}

function PED_money_(n) {
  var v = Math.round(n || 0);
  return "$" + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

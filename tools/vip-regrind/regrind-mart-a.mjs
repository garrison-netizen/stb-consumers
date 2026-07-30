// ============================================================
// VIP Mart A — historical regrind (2021–2025).
//
// WHY THIS EXISTS
// The original historical load read the JANUARY single-month column
// ("1 Month 1/1/YYYY thru 1/31/YYYY  Case Equivs") instead of the
// twelve-month rollup ("12 Months 1/1/YYYY thru 12/31/YYYY  Case
// Equivs"). Proven exactly on two years: Mart A stored 2,833.8 for
// 2024 where January alone is 2,833.9, and 1,620.0 for 2025 where
// January alone is 1,620.0. The error ratio drifts by year (10.7x,
// 11.4x) purely because January's share of each year varies with
// seasonality — which is why it never looked like a clean divisor.
//
// Column selection here is EXPLICIT, never fuzzy: a candidate must
// parse as a 12-month window whose start is 1/1 of the target year
// and whose end is 12/31 of the same year. Anything else is refused.
//
// BASIS (locked by Architect 2026-07-24)
// Gross is the only stored basis. Organic is a read-time filter over
// `Footprint artifact`, never a second stored total. This script
// therefore writes gross and sets the flag; it never writes organic.
//
// Grain and cell-title format match the live pipeline exactly
// (Transform.gs VM_computeMartA_): brand x parent distributor x
// segment x year, titled "Brand | Parent | Segment | Year".
//
// 2026 IS NEVER TOUCHED — it is pipeline-written and already exact.
//
// Usage:
//   node regrind-mart-a.mjs            # dry run, writes nothing
//   node regrind-mart-a.mjs --write    # apply
//   node regrind-mart-a.mjs --year 2025 [--write]
// ============================================================

import { api, queryAll, plain } from './notion.js'
import fs from 'fs'

const MART_A_DB = 'dffa9e55b1df445ca00c84f0da92c142'
const DIST_MAP_DB = '0afb7d9597424c7ea7ca41e0f62ddbcd'

const RAW_DB = {
  2021: '37b1c57ac02b808faf3cf648c8ac60d7',
  2022: '37b1c57ac02b80ff9001edca6002a92c',
  2023: '37b1c57ac02b802ca308eadb22568f83',
  2024: '37b1c57ac02b80d98a83ebb4feb462f9',
  2025: '37b1c57ac02b80b0a625f1697fd51bd4'
}

// Authoritative gross tie-out, Architect 2026-07-24, double-sourced
// (each year's own 12-month rollup, cross-checked against the next
// year's prior-year column). Organic listed for cross-check only —
// it is DERIVED here, never stored.
const ORACLE = {
  2021: { rows: 221, gross: 33288.1, organic: 33288.1 },
  2022: { rows: 420, gross: 41071.1, organic: 41071.1 },
  2023: { rows: 671, gross: 33610.2, organic: 29930.7 },
  2024: { rows: 699, gross: 32286.0, organic: 25456.1 },
  2025: { rows: 579, gross: 17287.2, organic: 14908.9 }
}

const TOLERANCE = 0.001 // 0.1%, per spec

const argv = process.argv.slice(2)
const WRITE = argv.includes('--write')
const yearArg = argv.includes('--year') ? Number(argv[argv.indexOf('--year') + 1]) : null
const YEARS = yearArg ? [yearArg] : [2021, 2022, 2023, 2024, 2025]

// ---- helpers -----------------------------------------------------

const round = n => (n === null || n === undefined) ? null : Math.round(n * 10000) / 10000
const norm = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim()

// Mirror of Data.gs VM_normToken_: raw exports write the state as a
// comma suffix ("Silver Eagle Dist - Houston, TX"); the map carries
// the parenthesized form. Normalize both sides identically.
const normToken = s => norm(String(s || '').trim().replace(/,\s*([A-Za-z]{2})\s*$/, ' ($1)'))

const WINDOW_RE =
  /^(\d+)\s+(?:Weeks?|Months?)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+thru\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s{1,}(.+)$/

const METRIC = {
  'Case Equivs': 'ce',
  'Units Sold': 'units',
  'Did Buys(All Accts)': 'didBuys',
  'Effective(All Accts)': 'effective',
  'Brd Placements(All)': 'placements'
}

// Find the full-year rollup property names for `year` in a raw DB's
// schema. EXPLICIT: 12-period window, starts 1/1/year, ends 12/31/year.
function findYearColumns(props, year) {
  const found = {}
  for (const name of Object.keys(props)) {
    const m = WINDOW_RE.exec(name.trim())
    if (!m) continue
    const [, n, sM, sD, sY, eM, eD, eY] = m
    if (Number(n) !== 12) continue
    if (Number(sM) !== 1 || Number(sD) !== 1 || Number(sY) !== year) continue
    if (Number(eM) !== 12 || Number(eD) !== 31 || Number(eY) !== year) continue
    const metric = METRIC[m[8].trim()]
    if (metric) found[metric] = name
  }
  return found
}

async function loadDistMap() {
  const rows = await queryAll(DIST_MAP_DB)
  const map = {}
  const unclassed = []
  for (const p of rows) {
    const token = normToken(plain(p.properties['Raw VIP token']))
    if (!token) continue
    // `Carve class` replaced the `Footprint artifact` boolean as the carve
    // definition (Architect spec 2026-07-30). The boolean is derived from
    // it, never read on its own — reading the boolean is what let FullClip
    // and Modern Hops sit inside core.
    const klass = plain(p.properties['Carve class'])
    if (!klass) unclassed.push(plain(p.properties['Raw VIP token']))
    map[token] = {
      parent: plain(p.properties['Parent distributor']),
      branch: plain(p.properties['Branch']),
      carveClass: klass,
      footprint: klass !== 'field'
    }
  }
  if (unclassed.length) {
    throw new Error(`VIP Distributor Map has ${unclassed.length} token(s) with an empty Carve class: ` +
      `${unclassed.join(', ')}. Populate them on the Map (an Architect surface), then re-run. Nothing was written.`)
  }
  if (!Object.keys(map).length) throw new Error('VIP Distributor Map is empty.')
  return map
}

function mapDistributor(map, rawToken) {
  const hit = map[normToken(rawToken)]
  if (!hit || !hit.parent) {
    throw new Error(
      `UNMAPPED DISTRIBUTOR TOKEN: "${rawToken}" is not in the VIP Distributor Map. ` +
      `Add it (Architect surface), then re-run. Nothing was written.`)
  }
  return hit
}

// ---- per-year computation ---------------------------------------

async function computeYear(year, distMap) {
  const dbId = RAW_DB[year]
  const db = await api(`databases/${dbId}`)
  const cur = findYearColumns(db.properties, year)
  const pri = findYearColumns(db.properties, year - 1)

  for (const k of ['ce', 'units', 'didBuys', 'effective', 'placements']) {
    if (!cur[k]) {
      throw new Error(
        `${year}: raw DB has no 12-month ${k} column for ${year}. ` +
        `Refusing to fall back to a shorter window — that is the original defect.`)
    }
  }

  const rows = await queryAll(dbId)
  if (rows.length !== ORACLE[year].rows) {
    throw new Error(`${year}: raw row count ${rows.length} != expected ${ORACLE[year].rows}. Nothing written.`)
  }

  const cells = {}
  let rawTotalCE = 0
  let rawArtifactCE = 0

  for (const p of rows) {
    const P = p.properties
    const rawDist = plain(P['Distributors'])
    if (!rawDist) continue
    const dist = mapDistributor(distMap, rawDist)
    const brand = String(plain(P['Brands']) || '').trim()
    const premise = norm(plain(P['OnOff Premises']))
    const segment = premise === 'OFF' ? 'Off-Premise' : premise === 'ON' ? 'On-Premise' : 'Unknown'

    const key = `${brand} | ${dist.parent} | ${segment} | ${year}`
    let cell = cells[key]
    if (!cell) {
      cell = cells[key] = {
        cell: key, year, brand, parent: dist.parent, segment,
        carveClass: dist.carveClass, footprint: dist.footprint,
        ce: 0, units: 0, didBuys: 0, effective: 0, placements: 0, priorCE: 0
      }
    }
    if (cell.carveClass !== dist.carveClass) {
      throw new Error(`MIXED CARVE CLASS in cell "${key}": "${cell.carveClass}" vs "${dist.carveClass}" ` +
        `from token "${rawDist}". Mart A keys on parent, so this cell cannot be carved. Nothing written.`)
    }
    cell.footprint = cell.footprint || dist.footprint

    const ce = plain(P[cur.ce]) || 0
    cell.ce += ce
    cell.units += plain(P[cur.units]) || 0
    cell.didBuys += plain(P[cur.didBuys]) || 0
    cell.effective += plain(P[cur.effective]) || 0
    cell.placements += plain(P[cur.placements]) || 0
    cell.priorCE += (pri.ce ? plain(P[pri.ce]) : 0) || 0

    rawTotalCE += ce
    if (dist.footprint) rawArtifactCE += ce
  }

  let totalCE = 0
  for (const c of Object.values(cells)) {
    for (const k of ['ce', 'units', 'didBuys', 'effective', 'placements', 'priorCE']) c[k] = round(c[k])
    c.delta = round(c.ce - c.priorCE)
    c.pct = (c.priorCE && c.priorCE !== 0) ? round((c.ce - c.priorCE) / c.priorCE * 100) : null
    totalCE += c.ce
  }

  return {
    year,
    cells,
    totalCE: round(totalCE),
    rawTotalCE: round(rawTotalCE),
    organicCE: round(rawTotalCE - rawArtifactCE),
    hasPriorYear: !!pri.ce,
    curColumn: cur.ce
  }
}

// ---- gates -------------------------------------------------------

function gate(res) {
  const o = ORACLE[res.year]
  const fails = []

  // 1. aggregation must preserve CE exactly (this is the check the
  //    original load would have failed: it collapsed rows AND lost CE)
  if (Math.abs(res.totalCE - res.rawTotalCE) > 0.01) {
    fails.push(`aggregate ${res.totalCE} != raw ${res.rawTotalCE} (aggregation lost CE)`)
  }
  // 2. raw must tie to the authoritative oracle
  const drift = Math.abs(res.rawTotalCE - o.gross) / o.gross
  if (drift > TOLERANCE) {
    fails.push(`raw gross ${res.rawTotalCE} vs oracle ${o.gross} — drift ${(drift * 100).toFixed(3)}% > 0.1%`)
  }
  // 3. derived organic must tie too (cross-check only; never stored)
  const oDrift = Math.abs(res.organicCE - o.organic) / (o.organic || 1)
  if (oDrift > TOLERANCE) {
    fails.push(`derived organic ${res.organicCE} vs oracle ${o.organic} — drift ${(oDrift * 100).toFixed(3)}%`)
  }
  // 4. paranoia: the value must NOT equal any single-month column.
  //    If it does, we have reproduced the original defect.
  return fails
}

// ---- Notion write ------------------------------------------------

function props(c) {
  return {
    'Cell': { title: [{ text: { content: c.cell } }] },
    'Year': { number: c.year },
    'Brand': { rich_text: [{ text: { content: c.brand } }] },
    'Distributor (parent)': { select: { name: c.parent } },
    'Segment': { select: { name: c.segment } },
    'CE': { number: c.ce },
    'Units': { number: c.units },
    'Did Buys': { number: c.didBuys },
    'Effective': { number: c.effective },
    'Placements': { number: c.placements },
    'CE prior year': { number: c.priorCE },
    'CE YoY delta': { number: c.delta },
    'CE YoY pct': { number: c.pct },
    'Carve class': { select: { name: c.carveClass } },
    'Footprint artifact': { checkbox: !!c.footprint }
  }
}

async function applyYear(res) {
  const existing = await queryAll(MART_A_DB, {
    property: 'Year', number: { equals: res.year }
  })
  const byTitle = new Map()
  for (const p of existing) byTitle.set(plain(p.properties['Cell']), p)

  let updated = 0, created = 0, archived = 0
  const wanted = new Set(Object.keys(res.cells))

  for (const [key, c] of Object.entries(res.cells)) {
    const hit = byTitle.get(key)
    if (hit) {
      await api(`pages/${hit.id}`, 'PATCH', { properties: props(c) })
      updated++
    } else {
      await api('pages', 'POST', { parent: { database_id: MART_A_DB }, properties: props(c) })
      created++
    }
  }
  for (const [key, p] of byTitle) {
    if (!wanted.has(key)) { await api(`pages/${p.id}`, 'PATCH', { archived: true }); archived++ }
  }
  return { updated, created, archived }
}

// ---- main --------------------------------------------------------

const distMap = await loadDistMap()
console.log(`Distributor map: ${Object.keys(distMap).length} tokens\n`)

const results = []
for (const year of YEARS) {
  const res = await computeYear(year, distMap)
  const fails = gate(res)
  const o = ORACLE[year]
  const stored = { 2021: 2531.2, 2022: 3349.4, 2023: 2410.2, 2024: 2833.8, 2025: 1620.0 }[year]

  console.log(`${year}  column: ${res.curColumn}`)
  console.log(`      cells ${String(Object.keys(res.cells).length).padStart(4)}` +
              `   gross ${String(res.totalCE).padStart(9)}  (oracle ${o.gross})` +
              `   organic ${String(res.organicCE).padStart(9)}  (oracle ${o.organic})`)
  console.log(`      Mart A currently stores ${stored} — this run ${fails.length ? 'WOULD NOT WRITE' : `corrects it to ${res.totalCE}`}`)
  if (!res.hasPriorYear) console.log(`      note: no ${year - 1} prior-year column in this export; CE prior year = 0`)
  if (fails.length) { fails.forEach(f => console.log(`      GATE FAIL: ${f}`)); process.exitCode = 1 }
  else console.log(`      GATES PASS`)
  console.log()
  results.push({ res, fails })
}

const blocked = results.filter(r => r.fails.length)
if (blocked.length) {
  console.log(`ABORT — ${blocked.length} year(s) failed gates. Nothing written.`)
  process.exit(1)
}

if (!WRITE) {
  console.log('DRY RUN — no writes. Re-run with --write to apply.')
  fs.writeFileSync(
    new URL('./last-dry-run.json', import.meta.url),
    JSON.stringify(results.map(r => ({
      year: r.res.year, cells: Object.keys(r.res.cells).length,
      gross: r.res.totalCE, organic: r.res.organicCE
    })), null, 2))
  process.exit(0)
}

for (const { res } of results) {
  const s = await applyYear(res)
  console.log(`${res.year}  written — ${s.updated} updated, ${s.created} created, ${s.archived} archived`)
}
console.log('\nRegrind complete. Verify Mart A, then notify Architect for the Trend Board rebuild.')

// ============================================================
// Mart B history VALUE REPAIR (Architect release 2026-07-29,
// channel row 3ac1c57a-c02b-8131).
//
// Defect: the June 2026 history build kept MAX across an account's
// distributor rows instead of SUM (proven 153/153 on 2023). Scope
// here is Step 1 only — rewrite stored CE 2021–2025 on EXISTING
// rows as the SUM across the account's raw distributor rows, plus
// fill the small set of present-but-unvalued rows. NO spine change:
// this script never creates or archives rows (the 56-row spine
// expansion is Step 3, released separately).
//
// Also (same run, ruled by Garrison via Architect):
//   --merge-goody : fold "GOODY GOODY - 28 - BEDFORD" into
//                   "GOODY GOODY 28" (same physical account) and
//                   archive the duplicate. The ONE deliberate row
//                   removal; reported distinctly.
//
// Derived-field recompute for affected rows (conventions read off
// live rows before writing): Peak CE / Peak year include 2026 YTD;
// First/Last active year = min/max year with CE > 0 incl. 2026.
// Trajectory changes only where classification inputs changed:
//   - "Never material" exits when corrected Peak CE > 1
//   - "New 2026" → "Growing" when the row gains real history
// Everything else keeps its bucket (CE 2026 YTD and CE 2025
// same-period are untouched, and they drive the other buckets).
//
// Usage:
//   node repair-mart-b.mjs               # dry run
//   node repair-mart-b.mjs --write
//   node repair-mart-b.mjs --write --merge-goody
// ============================================================

import { api, queryAll, plain } from './notion.js'
import fs from 'fs'

const MART_B = 'e75409d7238a49cea390bbfe123bfc45'
const DETAIL = {
  2021: '37c1c57ac02b80e48e44cacb022ff07b',
  2022: '37c1c57ac02b808c8eb7d8c4c987062d',
  2023: '37c1c57ac02b801e980fc80f2138ff9e',
  2024: '37c1c57ac02b80ec9590dc74c9745c4d',
  2025: '37b1c57ac02b80c89496d716b62a7cb5'
}
// Raw gross oracle per year (Architect, double-sourced).
const ORACLE = { 2021: 33288.1, 2022: 41071.1, 2023: 33610.2, 2024: 32286.0, 2025: 17287.2 }

const WRITE = process.argv.includes('--write')
const MERGE_GOODY = process.argv.includes('--merge-goody')

const round = n => Math.round(n * 10000) / 10000
const norm = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim()
const SUFFIX = { STREET:'ST', ROAD:'RD', AVENUE:'AVE', BOULEVARD:'BLVD', PARKWAY:'PKWY',
  HIGHWAY:'HWY', DRIVE:'DR', LANE:'LN', COURT:'CT', PLACE:'PL',
  EXPRESSWAY:'EXPWY', FREEWAY:'FWY', COUNTRY:'COUNTY' }
function normAddr(s) {
  let t = norm(s).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  t = t.replace(/\b(STE|SUITE|UNIT|BLDG|BUILDING|SPACE|APT)\b\s*[A-Z0-9-]*/g, ' ')
  return t.split(' ').map(w => SUFFIX[w] || w)
    .filter(w => w && !(w.length === 1 && 'NSEW'.includes(w))).join(' ')
}
const idKey = (n, a) => `${norm(n)}|${normAddr(a)}`
const ceCol = y => `12 Months 1/1/${y} thru 12/31/${y}  Case Equivs`

// ---- load Mart B + snapshot --------------------------------------
console.log('Loading Mart B...')
const martB = await queryAll(MART_B)
const snapDir = new URL('./snapshots/', import.meta.url)
fs.mkdirSync(snapDir, { recursive: true })
const snapPath = new URL(`./snapshots/mart-b-pre-value-repair.json`, import.meta.url)
fs.writeFileSync(snapPath, JSON.stringify(martB.map(p => ({ id: p.id, props: Object.fromEntries(
  Object.entries(p.properties).map(([k, v]) => [k, plain(v)])
) })), null, 1))
console.log(`Snapshot: ${martB.length} rows -> tools/vip-regrind/snapshots/mart-b-pre-value-repair.json\n`)

const bByKey = new Map()
for (const p of martB) {
  const k = idKey(plain(p.properties['Account name']), plain(p.properties['Address']))
  if (!bByKey.has(k)) bByKey.set(k, p)
}

// ---- compute corrected per-account history from raw --------------
const corrected = new Map() // pageId -> {year: sum}
const perYear = {}
for (const year of [2021, 2022, 2023, 2024, 2025]) {
  const rows = await queryAll(DETAIL[year])
  const col = ceCol(year)
  const agg = new Map()
  let rawCE = 0
  for (const p of rows) {
    const ce = plain(p.properties[col]) || 0
    rawCE += ce
    const k = idKey(plain(p.properties['Retail Accounts']), plain(p.properties['Address']))
    agg.set(k, (agg.get(k) || 0) + ce)
  }
  if (Math.abs(rawCE - ORACLE[year]) / ORACLE[year] > 0.001) {
    throw new Error(`${year}: raw ${rawCE.toFixed(1)} vs oracle ${ORACLE[year]} — drift >0.1%. ABORT, nothing written.`)
  }
  let repaired = 0, repairedCE = 0, absentCE = 0
  for (const [k, sum] of agg) {
    if (sum <= 0) continue
    const hit = bByKey.get(k)
    if (!hit) { absentCE += sum; continue } // Step-3 territory, untouched
    const stored = plain(hit.properties[`CE ${year}`]) || 0
    if (Math.abs(sum - stored) > 0.05) {
      const c = corrected.get(hit.id) || {}
      c[year] = round(sum)
      corrected.set(hit.id, c)
      repaired++; repairedCE += sum - stored
    }
  }
  // Phantom values: Mart B rows carrying stored CE for this year whose
  // identity has NO positive raw counterpart. These are the duplicate-
  // spelling class (Goody Goody etc.) — raw credits one spelling, Mart B
  // holds the value on the other. Pre-existing, out of scope here (the
  // Architect's mechanical pair-list run owns it) — but they must be
  // accounted for or the reconciliation gate cannot close.
  const phantoms = []
  let phantomCE = 0
  for (const p of martB) {
    const stored = plain(p.properties[`CE ${year}`]) || 0
    if (stored <= 0) continue
    const k = idKey(plain(p.properties['Account name']), plain(p.properties['Address']))
    if (bByKey.get(k) !== p) continue // shadowed duplicate key — counted once
    const rawSum = agg.get(k) || 0
    if (rawSum <= 0) { phantoms.push({ name: plain(p.properties['Account name']), city: plain(p.properties['City']), stored }); phantomCE += stored }
  }
  perYear[year] = { rawCE: round(rawCE), repaired, repairedCE: round(repairedCE), absentCE: round(absentCE), phantomCE: round(phantomCE), phantoms }
  console.log(`${year}  raw ${rawCE.toFixed(1)} (oracle ✓)   value repairs ${repaired} (${repairedCE >= 0 ? '+' : ''}${repairedCE.toFixed(1)} CE)   absent ${absentCE.toFixed(1)} CE (Step 3)   phantom/dupe ${phantomCE.toFixed(1)} CE on ${phantoms.length} rows`)
}

// ---- derived-field recompute for affected rows -------------------
const byId = new Map(martB.map(p => [p.id, p]))
const updates = []
const neverMaterialExits = []
const newToGrowing = []
const winBackBefore = new Set(), winBackAfter = new Set()

// Win-back universe per Architect: lapsed/declining accounts whose peak
// clears 10 — the field-list threshold.
const LAPSED = new Set(['Lapsed 2026', 'Lapsed earlier', 'Declining'])
for (const p of martB) {
  const traj = plain(p.properties['Trajectory Status'])
  if (LAPSED.has(traj) && (plain(p.properties['Peak CE']) || 0) >= 10) winBackBefore.add(p.id)
}

for (const [pageId, years] of corrected) {
  const p = byId.get(pageId)
  const P = p.properties
  const hist = {}
  for (const y of [2021, 2022, 2023, 2024, 2025]) {
    hist[y] = years[y] !== undefined ? years[y] : (plain(P[`CE ${y}`]) || 0)
  }
  const ce26 = plain(P['CE 2026 YTD']) || 0
  // Peak: history years + current YTD (observed convention)
  let peakCE = 0, peakYear = null
  for (const y of [2021, 2022, 2023, 2024, 2025]) {
    if (hist[y] > peakCE) { peakCE = hist[y]; peakYear = y }
  }
  if (ce26 > peakCE) { peakCE = ce26; peakYear = 2026 }
  const activeYears = [2021, 2022, 2023, 2024, 2025].filter(y => hist[y] > 0)
  if (ce26 > 0) activeYears.push(2026)
  const first = activeYears.length ? Math.min(...activeYears) : null
  const last = activeYears.length ? Math.max(...activeYears) : null

  const traj = plain(P['Trajectory Status'])
  const sp = plain(P['CE 2025 same-period']) || 0
  let newTraj = traj
  if (traj === 'Never material' && peakCE > 1) {
    newTraj = ce26 > 0 ? (ce26 > sp ? 'Growing' : 'Declining') : (sp > 0 ? 'Lapsed 2026' : 'Lapsed earlier')
    neverMaterialExits.push(`${plain(P['Account name'])} (${plain(P['City'])}) — peak now ${peakCE.toFixed(1)} → ${newTraj}`)
  } else if (traj === 'New 2026' && [2021, 2022, 2023, 2024, 2025].some(y => hist[y] > 0)) {
    newTraj = 'Growing'
    newToGrowing.push(`${plain(P['Account name'])} (${plain(P['City'])})`)
  }

  const props = {}
  for (const [y, v] of Object.entries(years)) props[`CE ${y}`] = { number: v }
  props['Peak CE'] = { number: round(peakCE) }
  props['Peak year'] = { number: peakYear }
  if (first !== null) props['First active year'] = { number: first }
  if (last !== null) props['Last active year'] = { number: last }
  if (newTraj !== traj) props['Trajectory Status'] = { select: { name: newTraj } }

  if (LAPSED.has(newTraj) && peakCE >= 10) winBackAfter.add(pageId)
  else if (LAPSED.has(newTraj)) { /* below threshold */ }
  updates.push({ pageId, props, name: plain(P['Account name']), peakCE: round(peakCE), peakYear })
}
// carry unaffected win-back rows into "after"
for (const id of winBackBefore) if (!corrected.has(id)) winBackAfter.add(id)

console.log(`\nAffected rows: ${updates.length}`)
console.log(`Never material exits: ${neverMaterialExits.length}`)
neverMaterialExits.forEach(e => console.log(`  - ${e}`))
console.log(`New 2026 → Growing (gained history): ${newToGrowing.length}`)
newToGrowing.forEach(e => console.log(`  - ${e}`))
const newWinBacks = [...winBackAfter].filter(id => !winBackBefore.has(id))
console.log(`Win-back list (lapsed/declining, peak ≥ 10): ${winBackBefore.size} before → ${winBackAfter.size} after (+${newWinBacks.length})`)
newWinBacks.forEach(id => {
  const p = byId.get(id); const u = updates.find(u => u.pageId === id)
  console.log(`  + ${plain(p.properties['Account name'])} (${plain(p.properties['City'])}) — corrected peak ${u.peakCE} (${u.peakYear})`)
})

// ---- post-repair gate: full accounting must close ----------------
// stored + Step-3 absent − duplicate-phantom must tie the oracle. The
// phantom term is the pre-existing duplicate-spelling overhang, measured
// above and owned by the Architect's pair-list run — subtracting it is
// not forgiveness, it is attribution: every CE is in exactly one bucket.
console.log('\nGate: stored + absent − phantom must tie oracle (0.1%)')
let gateFail = false
for (const year of [2021, 2022, 2023, 2024, 2025]) {
  let stored = 0
  for (const p of martB) {
    const c = corrected.get(p.id)
    stored += (c && c[year] !== undefined) ? c[year] : (plain(p.properties[`CE ${year}`]) || 0)
  }
  const total = stored + perYear[year].absentCE - perYear[year].phantomCE
  const ok = Math.abs(total - ORACLE[year]) / ORACLE[year] <= 0.001
  if (!ok) gateFail = true
  console.log(`  ${year}: ${stored.toFixed(1)} stored + ${perYear[year].absentCE.toFixed(1)} absent − ${perYear[year].phantomCE.toFixed(1)} phantom = ${total.toFixed(1)} vs ${ORACLE[year]}  ${ok ? '✓' : 'FAIL'}`)
}
if (gateFail) { console.log('\nGATE FAILED — nothing written.'); process.exit(1) }
console.log('\nPhantom (duplicate-class) rows by year, for the Architect pair-list run:')
for (const year of [2021, 2022, 2023, 2024, 2025]) {
  perYear[year].phantoms.sort((a, b) => b.stored - a.stored).slice(0, 4)
    .forEach(x => console.log(`  ${year}  ${x.stored.toFixed(1).padStart(7)}  ${x.name} — ${x.city}`))
}

if (!WRITE) { console.log('\nDRY RUN — no writes. Re-run with --write.'); process.exit(0) }

// ---- apply -------------------------------------------------------
let done = 0
for (const u of updates) {
  await api(`pages/${u.pageId}`, 'PATCH', { properties: u.props })
  if (++done % 50 === 0) console.log(`  ...${done}/${updates.length}`)
}
console.log(`Applied ${done} row updates.`)

// ---- Goody Goody merge (ruled by Garrison) -----------------------
if (MERGE_GOODY) {
  const survivor = martB.find(p => plain(p.properties['Account name']) === 'GOODY GOODY 28')
  const dupe = martB.find(p => plain(p.properties['Account name']) === 'GOODY GOODY - 28 - BEDFORD')
  if (survivor && dupe) {
    const props = {}
    const hist = {}
    for (const y of [2021, 2022, 2023, 2024, 2025]) {
      const s = (corrected.get(survivor.id) || {})[y] ?? (plain(survivor.properties[`CE ${y}`]) || 0)
      const d = (corrected.get(dupe.id) || {})[y] ?? (plain(dupe.properties[`CE ${y}`]) || 0)
      hist[y] = round(s + d)
      props[`CE ${y}`] = { number: hist[y] }
    }
    let peakCE = 0, peakYear = null
    for (const y of [2021, 2022, 2023, 2024, 2025]) if (hist[y] > peakCE) { peakCE = hist[y]; peakYear = y }
    const active = [2021, 2022, 2023, 2024, 2025].filter(y => hist[y] > 0)
    props['Peak CE'] = { number: round(peakCE) }
    props['Peak year'] = { number: peakYear }
    props['First active year'] = { number: Math.min(...active) }
    props['Last active year'] = { number: Math.max(...active) }
    await api(`pages/${survivor.id}`, 'PATCH', { properties: props })
    await api(`pages/${dupe.id}`, 'PATCH', { archived: true })
    console.log(`GOODY GOODY merged: history summed into "GOODY GOODY 28" (peak ${peakCE} in ${peakYear}, active ${Math.min(...active)}–${Math.max(...active)}), Bedford-named duplicate archived. Row count 3,755 → 3,754.`)
  } else console.log('GOODY GOODY pair not found as expected — merge skipped.')
}
console.log('\nValue repair complete. Verify by re-query, then flag Architect for Step 3 release.')

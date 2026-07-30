// ============================================================
// GOODY GOODY chain merge — Architect rule 2026-07-30
// (channel row 3ad1c57a-c02b-8166, rule page 3ac1c57a-c02b-8192).
//
// VIP renamed the chain partway through the series and the name+address
// key read the rename as churn, so every store's history is SEVERED at
// the rename: pre-rename years on a row that looks long-dead, post-rename
// years on a row that looks new and small. The chain therefore reads as
// having died earlier and harder than it did — a field-work signal
// pointing away from doors that are still buying.
//
// Rule: two rows are the same account when their normalised store number
// matches. Survivor is the row with the later `Last active year` (do NOT
// hardcode which spelling wins — #40 and #44 reverse direction). Address
// must corroborate at CITY level; a city mismatch blocks and escalates.
//
// Volumes must not move. Only counts and trajectories change.
//
// Usage:
//   node merge-goody-goody.mjs            # dry run, writes nothing
//   node merge-goody-goody.mjs --write
// ============================================================

import { api, queryAll, plain } from './notion.js'
import { chainStoreKey, norm, idKey } from './identity.js'
import fs from 'fs'

const MART_B = 'e75409d7238a49cea390bbfe123bfc45'
const YEARS = [2021, 2022, 2023, 2024, 2025]
const YEAR = 2026
const GROWTH_PCT = 0.10

const EXPECT_MERGES = 15
const EXPECT_AFTER = 3761

const WRITE = process.argv.includes('--write')
const round = n => Math.round(n * 10000) / 10000
const num = (p, k) => plain(p.properties[k]) || 0

console.log('Loading Mart B...')
const rows = await queryAll(MART_B)
console.log(`  ${rows.length} rows`)

// Guard carried from Step 3: nothing an earlier step deliberately archived
// may come back. #28 was merged 2026-07-29 on Garrison's ruling.
let archivedNames = new Set()
try {
  const snap = JSON.parse(fs.readFileSync(new URL('./snapshots/mart-b-pre-value-repair.json', import.meta.url)))
  const live = new Set(rows.map(p => p.id))
  archivedNames = new Set(snap.filter(r => !live.has(r.id)).map(r => norm(r.props['Account name'])))
  console.log(`  ${archivedNames.size} row(s) archived by an earlier step, held out`)
} catch (e) {
  throw new Error('Cannot read snapshots/mart-b-pre-value-repair.json, so a previously ' +
    'archived row could silently return. ABORT. (' + e.message + ')')
}

// ---- group by store number --------------------------------------
const groups = new Map()
for (const p of rows) {
  const k = chainStoreKey(plain(p.properties['Account name']))
  if (!k) continue
  if (!groups.has(k)) groups.set(k, [])
  groups.get(k).push(p)
}
const pairs = [...groups].filter(([, v]) => v.length > 1).sort((a, b) =>
  parseInt(a[0].split('#')[1], 10) - parseInt(b[0].split('#')[1], 10))
console.log(`\n${groups.size} Goody Goody store numbers, ${pairs.length} with 2+ rows`)

// ---- city corroboration gate ------------------------------------
const blocked = []
for (const [k, v] of pairs) {
  const cities = new Set(v.map(p => norm(plain(p.properties['City']))))
  if (cities.size > 1) blocked.push({ k, cities: [...cities], v })
}
if (blocked.length) {
  console.error(`\nBLOCKED — city mismatch on ${blocked.length} group(s); the rule says escalate, not guess:`)
  blocked.forEach(b => {
    console.error(`  ${b.k}: ${b.cities.join(' vs ')}`)
    b.v.forEach(p => console.error(`     "${plain(p.properties['Account name'])}" — ${plain(p.properties['City'])}`))
  })
  console.error('Nothing written.')
  process.exit(1)
}
console.log('City corroboration: all groups agree.')

// ---- build the merges -------------------------------------------
const merges = []
for (const [k, v] of pairs) {
  // Survivor = later Last active year. Tie-break on later Peak year, then
  // on having 2026 activity, so the choice is deterministic either way.
  const ranked = v.slice().sort((a, b) =>
    (num(b, 'Last active year') - num(a, 'Last active year')) ||
    (num(b, 'Peak year') - num(a, 'Peak year')) ||
    (num(b, 'CE 2026 YTD') - num(a, 'CE 2026 YTD')))
  const survivor = ranked[0]
  const absorbed = ranked.slice(1)

  for (const p of [survivor, ...absorbed]) {
    if (archivedNames.has(norm(plain(p.properties['Account name'])))) {
      throw new Error(`"${plain(p.properties['Account name'])}" was archived by an earlier step ` +
        `and is back in the live table. ABORT — investigate before merging.`)
    }
  }

  const hist = {}
  for (const y of YEARS) hist[y] = round(v.reduce((s, p) => s + num(p, `CE ${y}`), 0))
  const ytd = round(v.reduce((s, p) => s + num(p, 'CE 2026 YTD'), 0))
  const sp = round(v.reduce((s, p) => s + num(p, 'CE 2025 same-period'), 0))

  // Trajectory per the live pipeline's derive() (Transform.gs), recomputed
  // on the merged series — this is the whole point of the exercise.
  const hasPrior = YEARS.some(y => hist[y] > 0)
  const spPrior = sp > 0
  let status
  if (ytd > 0) {
    if (!hasPrior && !spPrior) status = `New ${YEAR}`
    else if (sp > 0) {
      const g = (ytd - sp) / sp
      status = g > GROWTH_PCT ? 'Growing' : g < -GROWTH_PCT ? 'Declining' : 'Steady'
    } else status = 'Growing'
  } else {
    status = (hasPrior || spPrior)
      ? ((hist[2025] > 0 || spPrior) ? `Lapsed ${YEAR}` : 'Lapsed earlier')
      : 'Never material'
  }

  let peakCE = null, peakYear = null
  for (const y of YEARS) if (hist[y] > 0 && (peakCE === null || hist[y] > peakCE)) { peakCE = hist[y]; peakYear = y }
  if (ytd > 0 && (peakCE === null || ytd > peakCE)) { peakCE = ytd; peakYear = YEAR }
  const active = YEARS.filter(y => hist[y] > 0)
  if (ytd > 0) active.push(YEAR)

  const props = {}
  for (const y of YEARS) props[`CE ${y}`] = { number: hist[y] }
  props['CE 2026 YTD'] = { number: ytd }
  props['CE 2025 same-period'] = { number: sp }
  props['Current YoY delta'] = { number: round(ytd - sp) }
  props['Trajectory Status'] = { select: { name: status } }
  props['Peak CE'] = { number: peakCE }
  props['Peak year'] = { number: peakYear }
  props['First active year'] = { number: active.length ? Math.min(...active) : null }
  props['Last active year'] = { number: active.length ? Math.max(...active) : null }

  merges.push({
    key: k, survivor, absorbed, props, status, peakCE, peakYear, ytd,
    before: v.map(p => ({
      name: plain(p.properties['Account name']),
      traj: plain(p.properties['Trajectory Status']),
      peak: num(p, 'Peak CE'), ce25: num(p, 'CE 2025'), ce26: num(p, 'CE 2026 YTD')
    }))
  })
}

console.log(`\nMerges planned: ${merges.length}  (rows ${rows.length} -> ${rows.length - merges.reduce((s, m) => s + m.absorbed.length, 0)})\n`)
for (const m of merges) {
  console.log(`  ${m.key}`)
  m.before.forEach(b => console.log(`     was: "${b.name}"  ${b.traj}  peak ${b.peak}  CE25 ${b.ce25}  CE26 ${b.ce26}`))
  console.log(`     now: "${plain(m.survivor.properties['Account name'])}"  ${m.status}  peak ${m.peakCE} (${m.peakYear})  CE26 ${m.ytd}`)
}

// ---- trajectory-corruption summary ------------------------------
const fixed = merges.filter(m => m.before.some(b => b.traj === 'Lapsed earlier') && m.status !== 'Lapsed earlier')
console.log(`\nTrajectory corrections: ${fixed.length} store(s) leave "Lapsed earlier" once their history is whole:`)
fixed.forEach(m => console.log(`  ${m.key}  ${m.before.map(b => b.traj).join(' + ')}  ->  ${m.status}`))

// ---- ACCEPTANCE: volumes must not move --------------------------
console.log('\nAcceptance:')
let fail = false
const before = {}, after = {}
for (const y of [...YEARS, 'CE 2026 YTD']) {
  const col = y === 'CE 2026 YTD' ? y : `CE ${y}`
  before[col] = round(rows.reduce((s, p) => s + num(p, col), 0))
  const touched = new Set(merges.flatMap(m => [m.survivor.id, ...m.absorbed.map(a => a.id)]))
  let t = round(rows.filter(p => !touched.has(p.id)).reduce((s, p) => s + num(p, col), 0))
  for (const m of merges) t += (m.props[col]?.number || 0)
  after[col] = round(t)
  const ok = Math.abs(after[col] - before[col]) < 0.01
  if (!ok) fail = true
  console.log(`  ${col.padEnd(14)} ${before[col].toFixed(4).padStart(12)} -> ${after[col].toFixed(4).padStart(12)}  ${ok ? 'UNCHANGED' : 'MOVED — FAIL'}`)
}
const rowsAfter = rows.length - merges.reduce((s, m) => s + m.absorbed.length, 0)
const rowOk = merges.length === EXPECT_MERGES && rowsAfter === EXPECT_AFTER
if (!rowOk) fail = true
console.log(`  row count      ${String(rows.length).padStart(12)} -> ${String(rowsAfter).padStart(12)}  ${rowOk ? `OK (expected ${EXPECT_AFTER})` : `FAIL (expected ${EXPECT_AFTER} via ${EXPECT_MERGES} merges)`}`)

if (fail) { console.error('\nACCEPTANCE FAILED — nothing written.'); process.exit(1) }

if (!WRITE) { console.log('\nDRY RUN — no writes. Re-run with --write.'); process.exit(0) }

// ---- apply ------------------------------------------------------
fs.writeFileSync(new URL('./snapshots/mart-b-pre-goody-merge.json', import.meta.url),
  JSON.stringify(rows.map(p => ({ id: p.id, props: Object.fromEntries(
    Object.entries(p.properties).map(([k, v]) => [k, plain(v)]) ) })), null, 1))
console.log(`\nSnapshot: ${rows.length} rows -> snapshots/mart-b-pre-goody-merge.json`)

let done = 0
for (const m of merges) {
  await api(`pages/${m.survivor.id}`, 'PATCH', { properties: m.props })
  for (const a of m.absorbed) await api(`pages/${a.id}`, 'PATCH', { archived: true })
  console.log(`  merged ${m.key} (${++done}/${merges.length})`)
}
console.log(`\nMerged ${done} store(s). Verify by independent re-query before reporting.`)

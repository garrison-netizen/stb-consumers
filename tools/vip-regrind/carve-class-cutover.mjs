// ============================================================
// Carve class cutover — Mart A + Mart C (Architect spec
// 2026-07-30, channel row 3ad1c57a-c02b-8198-99be-c67815ccee69).
//
// The VIP Distributor Map gained a `Carve class` SELECT
// (field / transferred_territory / lapsed_out_of_state) that
// REPLACES the `Footprint artifact` boolean as the carve
// definition. This is a CORRECTION, not a relabel: FullClip and
// Modern Hops were both flagged footprint=NO and were therefore
// being counted inside core.
//
// Scope is DISTRIBUTOR-LEVEL ONLY. Account-level classes
// (stb_self_account, airport/concession channel) live on Mart B
// and are explicitly out of scope — do not touch them here.
//
// What this does:
//   1. Reads the Map and derives parent -> carve class, asserting
//      the class is constant within each parent (the property that
//      makes a parent-keyed backfill sound). Fails loud otherwise.
//   2. Adds the `Carve class` select to Mart A and Mart C if absent.
//   3. Backfills every Mart A and Mart C row from its
//      `Distributor (parent)`.
//   4. Gates on the Architect's single acceptance number:
//      core 2022 (sum CE where Carve class = field) = 29,603.6.
//
// Usage:
//   node carve-class-cutover.mjs            # dry run, writes nothing
//   node carve-class-cutover.mjs --write
// ============================================================

import { api, queryAll, plain } from './notion.js'
import fs from 'fs'

const MAP    = '0afb7d9597424c7ea7ca41e0f62ddbcd'
const MART_A = 'dffa9e55b1df445ca00c84f0da92c142'
const MART_C = '2973f478ea3541f1962b109feb183d3d'

const CLASSES = ['field', 'transferred_territory', 'lapsed_out_of_state']

// Architect's acceptance test. Core = sum over Carve class = field.
const ACCEPT_2022 = 29603.6
// Secondary check — core by year.
const CORE_BY_YEAR = {
  2021: 29804.3, 2022: 29603.6, 2023: 25666.0,
  2024: 25463.3, 2025: 14911.1, 2026: 7244.7
}

const WRITE = process.argv.includes('--write')
const round = n => Math.round(n * 10000) / 10000

// ---- 1. Map -> parent carve class --------------------------------
console.log('Loading VIP Distributor Map...')
const mapRows = await queryAll(MAP)
console.log(`  ${mapRows.length} rows`)

const byParent = new Map()   // parent -> Set(class)
const tokenClass = new Map() // raw token -> class
let unclassed = []

for (const p of mapRows) {
  const token  = plain(p.properties['Raw VIP token'])
  const parent = plain(p.properties['Parent distributor'])
  const klass  = plain(p.properties['Carve class'])
  if (!klass) { unclassed.push(token); continue }
  if (!CLASSES.includes(klass)) throw new Error(`Unknown Carve class "${klass}" on token "${token}".`)
  tokenClass.set(token, klass)
  if (!parent) throw new Error(`Map row "${token}" has Carve class but no Parent distributor.`)
  if (!byParent.has(parent)) byParent.set(parent, new Set())
  byParent.get(parent).add(klass)
}

if (unclassed.length) {
  console.error(`\nFAIL LOUD — ${unclassed.length} Map row(s) have an empty Carve class:`)
  unclassed.forEach(t => console.error(`  - ${t}`))
  console.error('Populate them on the Map (an Architect surface) and re-run. Nothing written.')
  process.exit(1)
}

// The soundness assertion for a parent-keyed backfill: Mart A and Mart C
// store `Distributor (parent)`, not the raw token, so this only works if
// carve class never varies within a parent. Verified, not assumed.
const mixed = [...byParent].filter(([, s]) => s.size > 1)
if (mixed.length) {
  console.error('\nFAIL LOUD — carve class is not constant within these parents:')
  mixed.forEach(([p, s]) => console.error(`  - ${p}: ${[...s].join(', ')}`))
  console.error('Mart A/C key on parent, so a parent-keyed backfill would be ambiguous.')
  console.error('This needs an Architect ruling on how to split the cell. Nothing written.')
  process.exit(1)
}

const parentClass = new Map([...byParent].map(([p, s]) => [p, [...s][0]]))
console.log('\nParent -> carve class (verified constant within each parent):')
for (const [p, k] of [...parentClass].sort()) {
  const n = mapRows.filter(r => plain(r.properties['Parent distributor']) === p).length
  console.log(`  ${p.padEnd(32)} ${k.padEnd(22)} (${n} token${n === 1 ? '' : 's'})`)
}

// Cross-check against the legacy boolean so the correction is visible.
console.log('\nCorrection surface — where Carve class disagrees with the legacy boolean:')
let disagree = 0
for (const p of mapRows) {
  const token = plain(p.properties['Raw VIP token'])
  const fp    = !!plain(p.properties['Footprint artifact'])
  const carved = tokenClass.get(token) !== 'field'
  if (fp !== carved) {
    console.log(`  ${token}  footprint=${fp ? 'YES' : 'NO'} but class=${tokenClass.get(token)}`)
    disagree++
  }
}
console.log(disagree === 0
  ? '  none — Map boolean and class agree on all rows (Architect holds them in sync).'
  : `  ${disagree} row(s). The class is authoritative.`)

// ---- 2. Ensure the property exists on Mart A and Mart C ----------
async function ensureCarveProp(dbId, label) {
  const db = await api(`databases/${dbId}`)
  if (db.properties['Carve class']) {
    const opts = (db.properties['Carve class'].select.options || []).map(o => o.name)
    const missing = CLASSES.filter(c => !opts.includes(c))
    if (missing.length) throw new Error(`${label}: Carve class exists but is missing options ${missing.join(', ')}`)
    console.log(`  ${label}: Carve class already present.`)
    return
  }
  if (!WRITE) { console.log(`  ${label}: Carve class MISSING — would add (dry run).`); return }
  await api(`databases/${dbId}`, 'PATCH', {
    properties: { 'Carve class': { select: { options: CLASSES.map(name => ({ name })) } } }
  })
  console.log(`  ${label}: Carve class property ADDED.`)
}

console.log('\nSchema:')
await ensureCarveProp(MART_A, 'Mart A')
await ensureCarveProp(MART_C, 'Mart C')

// ---- 3. Compute the backfill ------------------------------------
async function planBackfill(dbId, label) {
  const rows = await queryAll(dbId)
  const updates = []
  const noParent = []
  for (const p of rows) {
    const parent = plain(p.properties['Distributor (parent)'])
    if (!parent) { noParent.push(plain(p.properties['Cell'])); continue }
    const want = parentClass.get(parent)
    if (!want) throw new Error(`${label}: parent "${parent}" is not on the VIP Distributor Map. Add it there and re-run.`)
    const have = plain(p.properties['Carve class'])
    // The denormalized `Footprint artifact` boolean on Mart A/C is stale
    // against the Map (FullClip and Modern Hops still read NO). Hold it in
    // sync with the class, exactly as the Architect does on the Map, so a
    // consumer still reading the boolean mid-cutover gets the SAME carve
    // rather than the superseded basis. The boolean is dropped only after
    // every consumer is cut over — that is the Architect's call, not this
    // script's.
    const wantFp = want !== 'field'
    const haveFp = !!plain(p.properties['Footprint artifact'])
    if (have !== want || haveFp !== wantFp) {
      updates.push({ pageId: p.id, want, wantFp, fpFlip: haveFp !== wantFp, cell: plain(p.properties['Cell']) })
    }
  }
  if (noParent.length) {
    console.error(`\nFAIL LOUD — ${label}: ${noParent.length} row(s) have no Distributor (parent):`)
    noParent.slice(0, 10).forEach(c => console.error(`  - ${c}`))
    process.exit(1)
  }
  const flips = updates.filter(u => u.fpFlip)
  console.log(`  ${label}: ${rows.length} rows, ${updates.length} need Carve class set` +
    `, ${flips.length} also need the stale Footprint boolean corrected.`)
  if (flips.length) {
    const byParent = {}
    for (const u of flips) {
      const par = (u.cell || '').split(' | ')[1] || '?'
      byParent[par] = (byParent[par] || 0) + 1
    }
    for (const [par, n] of Object.entries(byParent).sort((a, b) => b[1] - a[1])) {
      console.log(`      boolean correction: ${par} — ${n} row(s)`)
    }
  }
  return { rows, updates }
}

console.log('\nBackfill plan:')
const A = await planBackfill(MART_A, 'Mart A')
const C = await planBackfill(MART_C, 'Mart C')

// ---- 4. Acceptance test, computed BEFORE and AFTER --------------
// Core = sum CE over Carve class = field. Computed against the values
// the backfill WILL produce, so a dry run proves the cutover lands
// before anything is written.
function coreByYear(rows, updates) {
  const want = new Map(updates.map(u => [u.pageId, u.want]))
  const out = {}, all = {}
  for (const p of rows) {
    const year = plain(p.properties['Year'])
    const ce = plain(p.properties['CE']) || 0
    const k = want.get(p.id) || plain(p.properties['Carve class'])
    all[year] = round((all[year] || 0) + ce)
    if (k === 'field') out[year] = round((out[year] || 0) + ce)
  }
  return { core: out, gross: all }
}

// Old basis, for the contrast the Architect asked to be visible.
function coreByYearOldBasis(rows) {
  const out = {}
  for (const p of rows) {
    const year = plain(p.properties['Year'])
    const ce = plain(p.properties['CE']) || 0
    if (!plain(p.properties['Footprint artifact'])) out[year] = round((out[year] || 0) + ce)
  }
  return out
}

const post = coreByYear(A.rows, A.updates)
const pre  = coreByYearOldBasis(A.rows)

console.log('\nMart A core (Carve class = field) by year:')
console.log('  year    old basis      new basis       gross      expected')
let gateFail = false
for (const y of Object.keys(CORE_BY_YEAR).map(Number).sort()) {
  const nv = post.core[y] || 0
  const exp = CORE_BY_YEAR[y]
  const ok = Math.abs(nv - exp) <= 0.5
  if (!ok) gateFail = true
  console.log(`  ${y}  ${(pre[y] || 0).toFixed(1).padStart(11)}  ${nv.toFixed(1).padStart(12)}  ${(post.gross[y] || 0).toFixed(1).padStart(11)}  ${exp.toFixed(1).padStart(11)}  ${ok ? 'OK' : 'FAIL'}`)
}

const core2022 = post.core[2022] || 0
console.log(`\nACCEPTANCE TEST — core 2022 must read ${ACCEPT_2022.toFixed(1)}`)
console.log(`  computed: ${core2022.toFixed(1)}`)
if (Math.abs(core2022 - ACCEPT_2022) > 0.5) {
  console.error(`  FAIL — reads ${core2022.toFixed(1)}. If this is 41,071.1 the cutover did not take.`)
  gateFail = true
} else {
  console.log('  PASS')
}

if (gateFail) { console.error('\nGATE FAILED — nothing written.'); process.exit(1) }

if (!WRITE) {
  console.log('\nDRY RUN — no writes. Gates pass against the planned values. Re-run with --write.')
  process.exit(0)
}

// ---- 5. Apply ---------------------------------------------------
async function apply(plan, label) {
  let done = 0
  for (const u of plan.updates) {
    await api(`pages/${u.pageId}`, 'PATCH', { properties: {
      'Carve class': { select: { name: u.want } },
      'Footprint artifact': { checkbox: u.wantFp }
    } })
    if (++done % 100 === 0) console.log(`  ${label} ...${done}/${plan.updates.length}`)
  }
  console.log(`  ${label}: ${done} rows written.`)
}
console.log('\nApplying:')
await apply(A, 'Mart A')
await apply(C, 'Mart C')

fs.writeFileSync(new URL('./snapshots/carve-class-cutover.json', import.meta.url),
  JSON.stringify({ ranAt: new Date().toISOString(),
    parentClass: Object.fromEntries(parentClass),
    martA: A.updates.length, martC: C.updates.length,
    coreByYear: post.core }, null, 1))

console.log('\nCutover complete. Re-verify by independent re-query before reporting.')

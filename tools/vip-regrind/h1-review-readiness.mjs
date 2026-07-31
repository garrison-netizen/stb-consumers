// ============================================================
// "IS THE DATA READY FOR AN H1 SALES & DISTRIBUTION REVIEW?"
//
// Read-only. Writes nothing. Answers ONE question with a plain-language
// verdict, so readiness is a check that runs rather than a claim an agent
// makes in chat.
//
// This is deliberately NOT the same question as mart-state.mjs, which asks
// "are the three marts internally correct right now." A mart can be perfectly
// correct and still be the wrong basis for this particular review — the marts
// were correct on 2026-07-30 while account counts were frozen and DFW volume
// was missing. Correct != ready. This composes mart-state and then adds the
// gates specific to the analysis.
//
// Usage:
//   node h1-review-readiness.mjs              # full, includes mart-state
//   node h1-review-readiness.mjs --fast       # skip the deep mart tie-out
// ============================================================

import { queryAll, plain } from './notion.js'
import { spawnSync } from 'child_process'
import fs from 'fs'

const MART_A = 'dffa9e55b1df445ca00c84f0da92c142'
const MART_B = 'e75409d7238a49cea390bbfe123bfc45'
const MART_C = '2973f478ea3541f1962b109feb183d3d'
const FAST = process.argv.includes('--fast')

// DFW is the territory whose absence caps 2026 as a FLOOR rather than a read.
const DFW = new Set(['DALLAS', 'FORT WORTH', 'PLANO', 'FRISCO', 'DENTON', 'FLOWER MOUND',
  'ARLINGTON', 'HIGHLAND VILLAGE', 'LEWISVILLE', 'CARROLLTON', 'IRVING', 'GRAPEVINE',
  'COPPELL', 'BEDFORD', 'EULESS', 'HURST', 'RICHARDSON', 'GARLAND', 'MESQUITE', 'ALLEN',
  'MCKINNEY', 'KELLER', 'SOUTHLAKE', 'COLLEYVILLE', 'ADDISON', 'THE COLONY', 'ROCKWALL'])

const norm = s => String(s || '').toUpperCase().trim()
const gates = []
const gate = (name, state, detail, owner) => gates.push({ name, state, detail, owner })

console.log('Reading live marts...\n')
const [A, B, C] = [await queryAll(MART_A), await queryAll(MART_B), await queryAll(MART_C)]

// ---- GATE 1: are the marts correct at all? ----------------------
if (FAST) {
  gate('Marts tie the oracle', 'SKIPPED', 'run without --fast to check', 'Code')
} else {
  const r = spawnSync('node', ['mart-state.mjs'], { cwd: new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), encoding: 'utf8' })
  const out = (r.stdout || '') + (r.stderr || '')
  const pass = /ALL CHECKS PASS/.test(out)
  const failLine = (out.match(/(\d+) CHECK\(S\) FAILED/) || [])[0]
  gate('Marts tie the oracle', pass ? 'PASS' : 'BLOCKED',
    pass ? 'all three marts correct on a single declared basis' : (failLine || 'mart-state.mjs did not report a pass'),
    'Code')
}

// ---- GATE 2: DFW / transferred territory present ----------------
// Until Dynamo's DFW book is visible, 2026 gross UNDERSTATES and any
// year-over-year distribution read is a floor, not a measurement.
const dfwByDist = new Map()
for (const p of B) {
  const city = norm(plain(p.properties['City']))
  if (!DFW.has(city)) continue
  const d = plain(p.properties['Distributor (parent, last-active)']) || '(none)'
  const ce26 = plain(p.properties['CE 2026 YTD']) || 0
  if (!dfwByDist.has(d)) dfwByDist.set(d, { rows: 0, ce26: 0 })
  const e = dfwByDist.get(d); e.rows++; e.ce26 += ce26
}
const dynamoDFW = dfwByDist.get('Dynamo Specialty') || { rows: 0, ce26: 0 }
const dfwLive = [...dfwByDist.entries()].filter(([, v]) => v.ce26 > 0)
gate('DFW territory attributed',
  dynamoDFW.ce26 > 0 ? 'PASS' : 'BLOCKED',
  dynamoDFW.ce26 > 0
    ? `Dynamo carries ${dynamoDFW.ce26.toFixed(1)} CE across ${dynamoDFW.rows} DFW rows`
    : `no Dynamo volume in DFW (${dynamoDFW.rows} rows, 0 CE). 2026 gross is a FLOOR, not a read. ` +
      `DFW distributors with 2026 volume: ${dfwLive.length ? dfwLive.map(([d, v]) => `${d} ${v.ce26.toFixed(1)}`).join(', ') : 'NONE'}`,
  'VIP / Garrison')

// ---- GATE 3: account counts unfrozen ----------------------------
// CE is safe; COUNTS are not, while duplicate identities remain unmerged.
// A split account counts twice and its history splits with it.
let outstanding = null
try {
  const j = JSON.parse(fs.readFileSync(new URL('./output/merge-candidates.json', import.meta.url), 'utf8'))
  outstanding = j.sectionA.length
} catch { /* generator not yet run */ }
gate('Account counts publishable',
  outstanding === 0 ? 'PASS' : 'BLOCKED',
  outstanding === null
    ? 'merge-candidate generator has not been run — run generate-merge-candidates.mjs'
    : `${outstanding} candidate clusters still unadjudicated. CE/volume are CLEARED; ` +
      `door counts, POD counts and account universe totals are NOT`,
  'Architect')

// ---- GATE 4: H1 2026 window actually covers H1 ------------------
let b26 = 0, a26 = 0
for (const p of B) b26 += plain(p.properties['CE 2026 YTD']) || 0
for (const p of A) if (plain(p.properties['Year']) === 2026) a26 += plain(p.properties['CE']) || 0
const weeks = new Set()
for (const p of C) { const w = p.properties['Week']?.date?.start; if (w) weeks.add(w) }
const wk = [...weeks].sort()
const covers = a26 > 0 && b26 > 0
gate('H1 2026 data present', covers ? 'PASS' : 'BLOCKED',
  covers ? `Mart A 2026 ${a26.toFixed(1)} CE, Mart B 2026 YTD ${b26.toFixed(1)} CE`
         : 'no 2026 volume found', 'Code')
gate('Mart C weekly current', wk.length ? 'INFO' : 'BLOCKED',
  wk.length ? `${wk.length} weeks, ${wk[0]} → ${wk[wk.length - 1]} (re-tie due after the ~8/1 accumulating pull)`
            : 'no weeks loaded', 'Code')

// ---- GATE 5: airport carve available ----------------------------
// STANDING RULE: airport cluster and organic field are presented separately,
// never blended. The review cannot comply if the flag is not populated.
let air = 0, airCE = 0
for (const p of B) if (plain(p.properties['Airport cluster']) === true) { air++; airCE += plain(p.properties['CE 2026 YTD']) || 0 }
gate('Airport carve available', air > 0 ? 'PASS' : 'BLOCKED',
  air > 0 ? `${air} flagged accounts, ${airCE.toFixed(1)} CE in 2026 YTD — carve AC vs organic field separately`
          : 'no accounts carry the Airport cluster flag', 'Code')

// ---- verdict ----------------------------------------------------
const blocked = gates.filter(g => g.state === 'BLOCKED')
const W = Math.max(...gates.map(g => g.name.length))
console.log('='.repeat(78))
console.log('H1 2026 SALES & DISTRIBUTION REVIEW — DATA READINESS')
console.log('='.repeat(78))
for (const g of gates) {
  console.log(`\n  ${g.state.padEnd(8)} ${g.name.padEnd(W)}   [${g.owner}]`)
  console.log(`           ${g.detail}`)
}
console.log('\n' + '='.repeat(78))
if (!blocked.length) {
  console.log('READY — every gate green. The review can be built on this data.')
} else {
  console.log(`NOT READY — ${blocked.length} gate(s) blocking:`)
  blocked.forEach(g => console.log(`   - ${g.name}  [${g.owner}]`))
  console.log('\nWhat IS safe to analyse today: CE and volume, all bases, all years,')
  console.log('all three marts. What is NOT: anything counting accounts or doors,')
  console.log('and any 2026 distribution read that treats gross as a measurement')
  console.log('rather than a floor.')
}
console.log('='.repeat(78))

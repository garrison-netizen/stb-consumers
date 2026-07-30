// ============================================================
// DUPLICATE-ACCOUNT CANDIDATE GENERATOR — Architect ruling 2026-07-30
// (channel row 3ad1c57a-c02b-818a; correction 3ad1c57a-c02b-8152).
//
// GENERATES, NEVER MERGES. This script writes nothing to Notion. It emits a
// candidate list; the Architect adjudicates it; a separate executor applies
// only the ruled set, the way merge-goody-goody.mjs did.
//
// WHY THERE IS NO RULE HERE. Goody Goody had a genuine invariant — the store
// number — so auto-merge was safe. This class has none. Every candidate key
// has a counterexample inside a single chain in a single region:
//   - street number is NOT invariant: 350 -> 305 N GUADALUPE (transposition)
//   - city is NOT invariant:          1761 S Hwy 46 flips SEGUIN <-> NEW BRAUNFELS
//   - name is NOT invariant:          SKIPS - CIBOLO vs SKIP S - CIBOLO
// Merging two genuinely different stores is the unrecoverable direction, and
// "a rule with two known holes gets trusted as though it has none."
//
// ⛔ NO HANDOVER ASSUMPTION. An earlier framing of this work claimed "Dynamo
// handed Central TX to Green Light in 2024." That is FALSE and was retracted
// 2026-07-30 (Dynamo was flat across 2024: 7,200.6 -> 7,020.9; Green Light's
// growth was the FullClip book via the GLD acquisition, in DFW). The real
// shape is CONCURRENT — a second distributor booking occasional out-of-
// territory sales into a store its true distributor still serves. So this
// generator must NOT look for "distributor A ends, distributor B begins."
// Same-year co-occurrence is NORMAL here, never disqualifying, and year
// adjacency is a CONFIRMING SIGNAL THAT SORTS, never a filter that removes.
//
// Usage:  node generate-merge-candidates.mjs
// Output: output/merge-candidates.md    (for Architect adjudication)
//         output/merge-candidates.json  (for the executor, once ruled)
// ============================================================

import { queryAll, plain } from './notion.js'
import { normAddr, chainStoreKey, isPseudo } from './identity.js'
import fs from 'fs'

const MART_B = 'e75409d7238a49cea390bbfe123bfc45'
const YEARS = [2021, 2022, 2023, 2024, 2025]

const normName = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()

// Street-type and directional tokens carry no identifying signal — they are
// exactly what VIP re-spells (ROAD/RD, STATE/ST, W/WEST, dropped entirely).
const SUFFIX_TOK = new Set(['ST', 'RD', 'AVE', 'BLVD', 'PKWY', 'HWY', 'DR', 'LN', 'CT',
  'PL', 'EXPWY', 'FWY', 'TRL', 'RR', 'FM'])
const DIR_TOK = new Set(['NORTH', 'SOUTH', 'EAST', 'WEST', 'NE', 'NW', 'SE', 'SW'])

// The invariant that actually survives every observed re-spelling is the
// SIGNIFICANT STREET-NAME TOKEN: 337 / COUNTY LINE / HWY 46 / BULVERDE /
// GUADALUPE / GREEN VALLEY all persist, while the leading street number, the
// directional, the suffix, the ordering and the city label all move.
//
// The LEADING numeric is the street number and is dropped (it transposes).
// A non-leading numeric is a highway/loop number and is KEPT — it is the only
// thing tying "1761 S ST HWY 46" to "1761 S STATE HWY 46" once ST/HWY go.
function sigTokens(addr) {
  const t = normAddr(addr).split(' ').filter(Boolean)
  const out = new Set()
  t.forEach((w, i) => {
    if (i === 0 && /^\d+$/.test(w)) return
    if (SUFFIX_TOK.has(w) || DIR_TOK.has(w)) return
    out.add(w)
  })
  return out
}

// Metro clusters for "city or an ADJACENT city". Two cities are adjacent when
// they share any cluster. This table is necessarily incomplete, so a pair that
// passes every other test but fails the city test is NOT dropped — it is
// reported under NEAR MISSES, where the gap is visible instead of silent.
const METROS = [
  ['SAN ANTONIO', 'NEW BRAUNFELS', 'CIBOLO', 'SCHERTZ', 'SELMA', 'LIVE OAK', 'UNIVERSAL CITY',
    'CONVERSE', 'BOERNE', 'BULVERDE', 'SPRING BRANCH', 'SEGUIN', 'MARION', 'GARDEN RIDGE',
    'HELOTES', 'LEON VALLEY', 'ALAMO HEIGHTS', 'CASTLE HILLS', 'SHAVANO PARK', 'FAIR OAKS RANCH',
    'WINDCREST', 'KIRBY', 'TERRELL HILLS', 'BALCONES HEIGHTS', 'HOLLYWOOD PARK', 'ADKINS',
    'LA VERNIA', 'FLORESVILLE', 'PLEASANTON', 'LYTLE', 'CASTROVILLE', 'SAN MARCOS', 'KYLE', 'BUDA'],
  ['AUSTIN', 'ROUND ROCK', 'CEDAR PARK', 'GEORGETOWN', 'PFLUGERVILLE', 'LEANDER', 'KYLE', 'BUDA',
    'SAN MARCOS', 'NEW BRAUNFELS', 'BEE CAVE', 'LAKEWAY', 'HUTTO', 'MANOR', 'DEL VALLE',
    'DRIPPING SPRINGS', 'WIMBERLEY', 'TAYLOR', 'ELGIN', 'BASTROP', 'LOCKHART', 'WEST LAKE HILLS',
    'SUNSET VALLEY', 'JONESTOWN', 'LAGO VISTA', 'LIBERTY HILL'],
  ['HOUSTON', 'KATY', 'SUGAR LAND', 'PEARLAND', 'MISSOURI CITY', 'STAFFORD', 'BELLAIRE',
    'WEST UNIVERSITY PLACE', 'THE WOODLANDS', 'SPRING', 'CONROE', 'MAGNOLIA', 'TOMBALL', 'CYPRESS',
    'HUMBLE', 'KINGWOOD', 'ATASCOCITA', 'BAYTOWN', 'LEAGUE CITY', 'FRIENDSWOOD', 'WEBSTER',
    'CLEAR LAKE', 'PASADENA', 'DEER PARK', 'LA PORTE', 'SEABROOK', 'KEMAH', 'GALVESTON',
    'TEXAS CITY', 'ROSENBERG', 'RICHMOND', 'FULSHEAR', 'BROOKSHIRE', 'WALLER', 'SEALY',
    'DICKINSON', 'ALVIN', 'MANVEL', 'JERSEY VILLAGE'],
  ['DALLAS', 'FORT WORTH', 'PLANO', 'FRISCO', 'DENTON', 'FLOWER MOUND', 'ARLINGTON',
    'HIGHLAND VILLAGE', 'LEWISVILLE', 'CARROLLTON', 'IRVING', 'GRAPEVINE', 'COPPELL', 'BEDFORD',
    'EULESS', 'HURST', 'RICHARDSON', 'GARLAND', 'MESQUITE', 'ALLEN', 'MCKINNEY', 'KELLER',
    'SOUTHLAKE', 'COLLEYVILLE', 'JUSTIN', 'ARGYLE', 'ROANOKE', 'TROPHY CLUB', 'ADDISON',
    'FARMERS BRANCH', 'THE COLONY', 'LITTLE ELM', 'PROSPER', 'CELINA', 'ROCKWALL', 'WYLIE',
    'MURPHY', 'SACHSE', 'ROWLETT', 'DESOTO', 'DUNCANVILLE', 'CEDAR HILL', 'MANSFIELD',
    'BURLESON', 'CROWLEY', 'HALTOM CITY', 'NORTH RICHLAND HILLS', 'WATAUGA', 'SAGINAW', 'AZLE',
    'WEATHERFORD', 'GRANBURY', 'CORINTH', 'LAKE DALLAS', 'SANGER', 'KRUM', 'PILOT POINT',
    'AUBREY', 'PONDER'],
  ['SAN ANGELO', 'ODESSA', 'MIDLAND', 'LUBBOCK', 'ABILENE', 'BIG SPRING'],
  ['NEW ORLEANS', 'METAIRIE', 'KENNER', 'HARAHAN', 'GRETNA', 'MARRERO', 'SLIDELL', 'COVINGTON',
    'MANDEVILLE', 'HAMMOND', 'BATON ROUGE', 'LAFAYETTE'],
  ['JEFFERSON', 'MARSHALL', 'LONGVIEW', 'TYLER', 'KILGORE']
]
const CITY_METRO = new Map()
METROS.forEach((m, i) => m.forEach(c => {
  if (!CITY_METRO.has(c)) CITY_METRO.set(c, new Set())
  CITY_METRO.get(c).add(i)
}))
function cityAdjacent(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  const A = CITY_METRO.get(a), B = CITY_METRO.get(b)
  if (!A || !B) return false
  for (const i of A) if (B.has(i)) return true
  return false
}

// ---- load -------------------------------------------------------
console.log('Loading Mart B...')
const pages = await queryAll(MART_B)
console.log(`  ${pages.length} rows`)

const rows = []
for (const p of pages) {
  const name = plain(p.properties['Account name'])
  if (isPseudo(name)) continue
  const addr = plain(p.properties['Address']) || ''
  // "THE WOODLANDS" and "WOODLANDS" are one city; a leading article is noise.
  const city = normName(plain(p.properties['City'])).replace(/^THE /, '')
  const chain = normName(plain(p.properties['Chain']))
  const ce = {}
  for (const y of YEARS) ce[y] = plain(p.properties[`CE ${y}`]) || 0
  ce['2026 YTD'] = plain(p.properties['CE 2026 YTD']) || 0
  rows.push({
    id: p.id,
    uid: plain(p.properties['account_uid']),
    name, addr, city, chain,
    chainAccount: plain(p.properties['Chain account']) === true,
    canonAddr: normAddr(addr),
    tokens: sigTokens(addr),
    dist: plain(p.properties['Distributor (parent, last-active)']) || '(none)',
    first: plain(p.properties['First active year']),
    last: plain(p.properties['Last active year']),
    peak: plain(p.properties['Peak CE']) || 0,
    traj: plain(p.properties['Trajectory Status']),
    ce
  })
}
console.log(`  ${rows.length} retail rows (pseudo-accounts excluded)`)

// ---- family key -------------------------------------------------
// VIP carries a normalized `Chain` field, and for real chains it is stable
// across every spelling of the account name — all 15 Skip's identities read
// "SKIPS BEER WINE AND LIQUOR". That is a far better family key than a name
// prefix. But INDEPENDENTS is a catch-all bucket, not a chain, so those fall
// back to a two-token name prefix.
const GENERIC_CHAIN = new Set(['', 'INDEPENDENTS', 'INDEPENDENT', 'NONE', 'N A'])
function familyKey(r) {
  if (r.chainAccount && !GENERIC_CHAIN.has(r.chain)) return `CHAIN:${r.chain}`
  let t = normName(r.name).split(' ').filter(Boolean)
  if (t[0] === 'THE') t = t.slice(1)
  return `NAME:${t.slice(0, 2).join(' ')}`
}
rows.forEach(r => { r.family = familyKey(r) })

// ---- union-find -------------------------------------------------
const parent = new Map(rows.map(r => [r.id, r.id]))
const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }

const shareToken = (a, b) => { for (const t of a.tokens) if (b.tokens.has(t)) return t; return null }

// ---- store-code BLOCK (precision guard, added by Code) -----------
// First run clustered four genuinely different HEB stores (#110, #474, #553,
// #627) into one candidate because they all sit on "HWY 6" — transitive
// clustering on a common street token over-merges, and it BURIED the one real
// pair (#760) inside the noise. Same for TOTAL WINE 512 + 526 on "FM 1960".
//
// This is the Architect's own Goody Goody insight generalized: where a chain
// carries a store code in the name, a DIFFERING code proves a DIFFERENT store.
// Used only to BLOCK an edge, never to create one, so it can only ever split a
// cluster — it cannot cause a bad merge, and it cannot lower recall on any pair
// where a code is absent on either side.
//
// Deliberately narrow, 3-4 digits only:
//   - Skip's "#1" (1 digit) must NOT block — 305 vs 350 N Guadalupe is one of
//     the two hardest cases the ruling exists to catch.
//   - VIP's "_2" disambiguator is a row suffix, not a store code — excluded.
function storeCode(name) {
  const n = String(name || '').toUpperCase()
  const m = n.match(/(^|[^_\dA-Z])#?(\d{3,4})(?![\dA-Z])/)
  return m ? m[2] : null
}
function codeBlocks(a, b) {
  const ca = storeCode(a.name), cb = storeCode(b.name)
  return ca && cb && ca !== cb
}
// The same guard used POSITIVELY. Within one chain family, a MATCHING store
// code is the Goody Goody invariant — it identifies the store more strongly
// than city adjacency does, so it stands in for the city test. Added because
// the first clean run pushed two real pairs into NEAR MISSES on nothing but a
// city typo: HEB #431 (EDINBURG vs EDINGBURG) and TOTAL WINE 524 (WOODLANDS
// vs THE WOODLANDS). Both are the same store code inside the same chain.
function codeMatches(a, b) {
  const ca = storeCode(a.name), cb = storeCode(b.name)
  return !!(ca && cb && ca === cb)
}

// PATH 1 — the ruled discriminator, deliberately loose:
//   chain-name family matches
//   AND >= 1 significant street-name token matches
//   AND city or an adjacent city matches
//   AND distributor token differs        (applied at CLUSTER level, below)
const byFamily = new Map()
for (const r of rows) {
  if (!byFamily.has(r.family)) byFamily.set(r.family, [])
  byFamily.get(r.family).push(r)
}
const edges = []
const nearMiss = []
for (const [fam, fr] of byFamily) {
  if (fr.length < 2) continue
  for (let i = 0; i < fr.length; i++) for (let j = i + 1; j < fr.length; j++) {
    const a = fr[i], b = fr[j]
    if (codeBlocks(a, b)) continue
    // Matching store code inside one chain: identity is settled, city and
    // street-token spelling are both allowed to differ.
    if (codeMatches(a, b)) { union(a.id, b.id); edges.push({ a, b, tok: `store #${storeCode(a.name)}`, via: 'store-code' }); continue }
    const tok = shareToken(a, b)
    if (!tok) continue
    if (cityAdjacent(a.city, b.city)) { union(a.id, b.id); edges.push({ a, b, tok, via: 'family' }) }
    else if (a.dist !== b.dist) nearMiss.push({ a, b, tok, fam })   // city test is the only failure
  }
}

// PATH 2 — identical canonical address in the same city, ACROSS families.
// Added by Code, not in the ruling, and flagged as such: the Cibolo address
// carries a fourth row under a different name (BIG HOPS CIBOLO) that no
// family-keyed rule can reach. Same door, same city, different sign is worth
// a review line under the same false-positive-is-cheap logic.
// Keyed on the address ALONE, deliberately not address+city. Two real pairs
// sat in NEAR MISSES on nothing but an enclave city label: WHOLE FOODS at
// 4100 LOMO ALTO DR (DALLAS vs HIGHLAND PARK, an enclave inside Dallas) and
// FOSSIL CREEK at 4130 S BOWEN RD (ARLINGTON vs DALWORTHINGTON GARDENS). The
// metro table will never be complete, so the full street address carries the
// match and any city disagreement is TAGGED for review instead of excluded.
const byAddr = new Map()
for (const r of rows) {
  if (!r.canonAddr) continue
  if (!byAddr.has(r.canonAddr)) byAddr.set(r.canonAddr, [])
  byAddr.get(r.canonAddr).push(r)
}
const addrOnly = new Set()
const codeAnomaly = []
for (const [, g] of byAddr) {
  if (g.length < 2) continue
  for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
    // Two different store codes at ONE address is not a merge candidate — but
    // it is not nothing either, so it is surfaced separately rather than lost.
    if (codeBlocks(g[i], g[j])) { codeAnomaly.push({ a: g[i], b: g[j] }); continue }
    if (find(g[i].id) !== find(g[j].id)) addrOnly.add(g[i].canonAddr)
    union(g[i].id, g[j].id)
  }
}

// ---- assemble clusters ------------------------------------------
const clusters = new Map()
for (const r of rows) {
  const root = find(r.id)
  if (!clusters.has(root)) clusters.set(root, [])
  clusters.get(root).push(r)
}
let cands = [...clusters.values()].filter(c => c.length > 1)

for (const c of cands) {
  c.sort((x, y) => (x.first || 0) - (y.first || 0) || x.name.localeCompare(y.name))
  c.dists = [...new Set(c.map(r => r.dist))]
  c.addrs = [...new Set(c.map(r => r.canonAddr))]
  c.cities = [...new Set(c.map(r => r.city))]
  c.exactAddr = c.addrs.length === 1
  // Year adjacency is a CONFIRMING SIGNAL used only to sort — never a filter.
  const spans = c.map(r => [r.first || 9999, r.last || 0])
  c.overlap = spans.some((s, i) => spans.some((t, j) => i !== j && s[0] <= t[1] && t[0] <= s[1]))
  c.ce = {}
  for (const y of [...YEARS, '2026 YTD']) c.ce[y] = Math.round(c.reduce((s, r) => s + r.ce[y], 0) * 10000) / 10000
  c.goody = c.some(r => chainStoreKey(r.name))
}

// The ruling's fourth criterion. A cluster with only ONE distributor is not
// discarded — the Cibolo case proves same-distributor duplicates are real
// (two Green Light branches entered one store in one year) — it is reported
// separately so the Architect sees it as a distinct, weaker class.
// A pair flagged as a near miss during the family pass may have been united
// afterwards by the address path. Those are candidates, not misses.
const stillMissed = nearMiss.filter(p => find(p.a.id) !== find(p.b.id))
nearMiss.length = 0
nearMiss.push(...stillMissed)

const multiDist = cands.filter(c => c.dists.length > 1)
const singleDist = cands.filter(c => c.dists.length === 1)
const goodyLeft = cands.filter(c => c.goody)

// ---- report -----------------------------------------------------
const fmt = r => `"${r.name}" | ${r.addr} | ${r.city} | ${r.dist} | ${r.first}-${r.last} | peak ${r.peak} | ${r.traj}`
const L = []
const say = s => { L.push(s); console.log(s) }

say('')
say('='.repeat(78))
say('DUPLICATE-ACCOUNT MERGE CANDIDATES — for Architect adjudication')
say('Generated by tools/vip-regrind/generate-merge-candidates.mjs. NOTHING WRITTEN.')
say('='.repeat(78))
say(`Mart B rows scanned:            ${rows.length}`)
say(`Candidate clusters (dist differ): ${multiDist.length}  covering ${multiDist.reduce((s, c) => s + c.length, 0)} rows`)
say(`Single-distributor clusters:      ${singleDist.length}  covering ${singleDist.reduce((s, c) => s + c.length, 0)} rows`)
say(`Near misses (city test only):     ${nearMiss.length} pairs`)
say(`Rows that would collapse if ALL candidates merged: ${cands.reduce((s, c) => s + c.length - 1, 0)}`)
if (goodyLeft.length) say(`\n!! REGRESSION: ${goodyLeft.length} Goody Goody cluster(s) still present — the 07-30 merge should have left none.`)

function dump(title, list, note) {
  say('')
  say('-'.repeat(78))
  say(title)
  if (note) say(note)
  say('-'.repeat(78))
  if (!list.length) { say('  (none)'); return }
  list.sort((a, b) => b.peak - a.peak)
  list.forEach((c, i) => {
    const tags = []
    if (c.exactAddr) tags.push('IDENTICAL ADDRESS')
    if (c.cities.length > 1) tags.push(`CITY VARIES: ${c.cities.join(' / ')}`)
    if (c.overlap) tags.push('YEARS OVERLAP')
    if (addrOnly.has(c[0].canonAddr)) tags.push('ADDRESS-ONLY PATH (cross-family)')
    if (c.cities.length > 1 && !c.cities.every(x => cityAdjacent(x, c.cities[0]))) tags.push('CITIES NOT ADJACENT — rests on address alone')
    say('')
    say(`[${i + 1}] ${c.length} rows | ${c[0].family} | ${c.dists.join(' + ')}${tags.length ? '  <' + tags.join('; ') + '>' : ''}`)
    c.forEach(r => say(`      ${fmt(r)}`))
    say(`      combined CE: ${YEARS.map(y => `${y} ${c.ce[y]}`).join('  ')}  2026YTD ${c.ce['2026 YTD']}`)
  })
}

cands.forEach(c => { c.peak = Math.max(...c.map(r => r.peak)) })
dump('SECTION A — CANDIDATES (all four ruled criteria met)',
  multiDist,
  'chain-name family + >=1 significant street token + city-or-adjacent + distributor differs.')
dump('SECTION B — SAME-DISTRIBUTOR CLUSTERS (weaker; ruling\'s 4th criterion not met)',
  singleDist,
  'Reported, not dropped: Cibolo proves one distributor can enter one store twice via two branches.')

say('')
say('-'.repeat(78))
say('SECTION C — NEAR MISSES: passed family + street token + distributor differs,')
say('            FAILED only the city-adjacency test. The metro table is')
say('            incomplete by construction, so these are surfaced, not dropped.')
say('-'.repeat(78))
if (!nearMiss.length) say('  (none)')
nearMiss.sort((x, y) => Math.max(y.a.peak, y.b.peak) - Math.max(x.a.peak, x.b.peak))
nearMiss.slice(0, 60).forEach((p, i) => {
  say('')
  say(`[N${i + 1}] token "${p.tok}" | ${p.fam}`)
  say(`      ${fmt(p.a)}`)
  say(`      ${fmt(p.b)}`)
})
if (nearMiss.length > 60) say(`\n  ... ${nearMiss.length - 60} more near misses in the JSON output (nothing truncated there).`)

say('')
say('-'.repeat(78))
say('SECTION D — SAME ADDRESS, DIFFERENT STORE CODE. Not merge candidates:')
say('            two different store numbers at one address. Surfaced because')
say('            one of them is likely mis-addressed in the raw feed.')
say('-'.repeat(78))
if (!codeAnomaly.length) say('  (none)')
codeAnomaly.sort((x, y) => Math.max(y.a.peak, y.b.peak) - Math.max(x.a.peak, x.b.peak))
codeAnomaly.forEach((p, i) => {
  say('')
  say(`[D${i + 1}] ${p.a.canonAddr} | ${p.a.city}`)
  say(`      ${fmt(p.a)}`)
  say(`      ${fmt(p.b)}`)
})

// ---- write ------------------------------------------------------
const outDir = new URL('./output/', import.meta.url)
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(new URL('./output/merge-candidates.md', import.meta.url), L.join('\n') + '\n')

const slim = r => ({
  id: r.id, uid: r.uid, name: r.name, address: r.addr, city: r.city, distributor: r.dist,
  first: r.first, last: r.last, peak: r.peak, trajectory: r.traj, ce: r.ce
})
fs.writeFileSync(new URL('./output/merge-candidates.json', import.meta.url), JSON.stringify({
  generated: 'run node generate-merge-candidates.mjs',
  martBRows: rows.length,
  ruling: 'Architect 2026-07-30 — generate only, no auto-merge, no handover assumption',
  sectionA: multiDist.map(c => ({ family: c[0].family, distributors: c.dists, cities: c.cities, exactAddress: c.exactAddr, yearsOverlap: c.overlap, combinedCE: c.ce, rows: c.map(slim) })),
  sectionB: singleDist.map(c => ({ family: c[0].family, distributors: c.dists, cities: c.cities, exactAddress: c.exactAddr, combinedCE: c.ce, rows: c.map(slim) })),
  sectionC: nearMiss.map(p => ({ family: p.fam, token: p.tok, rows: [slim(p.a), slim(p.b)] }))
}, null, 1))

say('')
say('Wrote output/merge-candidates.md and output/merge-candidates.json')
say('NOTHING WRITTEN TO NOTION. Awaiting Architect adjudication.')

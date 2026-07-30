// ============================================================
// Mart B SPINE EXPANSION — Step 3.
// Architect release 2026-07-30 (reply on channel row
// 3ac1c57a-c02b-8144-ae4e-fc78b706cf01): "RELEASED — run Step 3.
// 56 rows, 1,005.9 CE, 3,754 -> ~3,810, landing long-lapsed with
// pre-2026 history only and explicitly NOT reading as new decline."
//
// Step 1 (repair-mart-b.mjs) rewrote CE on rows that EXIST. This is
// the other half: accounts that carry positive CE in the frozen raw
// account_detail year DBs but have no Mart B row at all, because the
// original 2026-06-11 spine was seeded from recent-year exports and
// backfilled — an account whose entire lifespan sat inside the
// 2023-2024 window was never reachable.
//
// These rows land INACTIVE by construction: CE 2026 YTD = 0 and
// CE 2025 same-period = 0, so Current YoY delta = 0. They cannot
// read as new decline in a YoY view — they contribute zero to both
// sides. Trajectory follows the live pipeline's own classifier
// (VM_computeMartB_ derive() in pipelines/vip-marts/src/Transform.gs)
// for the inactive-with-history case: "Lapsed 2026" when CE 2025 > 0,
// otherwise "Lapsed earlier".
//
// Usage:
//   node expand-mart-b-spine.mjs            # dry run, writes nothing
//   node expand-mart-b-spine.mjs --write
// ============================================================

import { api, queryAll, plain } from './notion.js'
import { idKey, norm, ceCol, isPseudo, isAirport, buildResolver } from './identity.js'
import crypto from 'crypto'
import fs from 'fs'

const MART_B = 'e75409d7238a49cea390bbfe123bfc45'
const MAP    = '0afb7d9597424c7ea7ca41e0f62ddbcd'
const DETAIL = {
  2021: '37c1c57ac02b80e48e44cacb022ff07b',
  2022: '37c1c57ac02b808c8eb7d8c4c987062d',
  2023: '37c1c57ac02b801e980fc80f2138ff9e',
  2024: '37c1c57ac02b80ec9590dc74c9745c4d',
  2025: '37b1c57ac02b80c89496d716b62a7cb5'
}
const ORACLE = { 2021: 33288.1, 2022: 41071.1, 2023: 33610.2, 2024: 32286.0, 2025: 17287.2 }
const YEARS = [2021, 2022, 2023, 2024, 2025]
const YEAR  = 2026   // current pipeline year — never written here

// The Architect's released figures. Deviation is reported, not silently absorbed.
const EXPECT_ROWS = 56
const EXPECT_CE   = 1005.9

const WRITE = process.argv.includes('--write')
const round = n => Math.round(n * 10000) / 10000
const md5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex')

// ---- distributor map --------------------------------------------
const mapRows = await queryAll(MAP)
const tokenParent = new Map()
for (const p of mapRows) {
  tokenParent.set(norm(plain(p.properties['Raw VIP token'])), plain(p.properties['Parent distributor']))
}
// The raw exports write state as a comma suffix ("... - Houston, TX")
// while the Map carries the parenthesized form ("... - Houston (TX)").
const normToken = s => norm(String(s || '').trim().replace(/,\s*([A-Za-z]{2})\s*$/, ' ($1)'))
function parentFor(token) {
  const hit = tokenParent.get(normToken(token))
  if (!hit) throw new Error(`UNMAPPED DISTRIBUTOR TOKEN: "${token}" is not in the VIP Distributor Map. ` +
    `Add it there (an Architect surface) and re-run. Nothing was written.`)
  return hit
}

// ---- Mart B ------------------------------------------------------
console.log('Loading Mart B...')
const martB = await queryAll(MART_B)
console.log(`  ${martB.length} rows`)

const bByKey = new Map()
const usedUids = new Set()
for (const p of martB) {
  const k = idKey(plain(p.properties['Account name']), plain(p.properties['Address']))
  if (!bByKey.has(k)) bByKey.set(k, p)
  const u = plain(p.properties['account_uid'])
  if (u) usedUids.add(u)
}

// Resolve raw identities the way the LIVE PIPELINE does, not by strict
// key. Without the name|city fallback the expansion mints duplicates for
// accounts already in Mart B under a re-spelled address.
const resolve = buildResolver(martB,
  p => plain(p.properties['Account name']),
  p => plain(p.properties['Address']),
  p => plain(p.properties['City']))

// Rows Step 1 deliberately archived must never come back. Today that is
// the Goody Goody Bedford duplicate, merged on Garrison's ruling — its
// raw identity now has no Mart B row and would otherwise read as absent,
// so the expansion would silently undo the merge.
let archivedKeys = new Set()
try {
  const snap = JSON.parse(fs.readFileSync(new URL('./snapshots/mart-b-pre-value-repair.json', import.meta.url)))
  const live = new Set(martB.map(p => p.id))
  const gone = snap.filter(r => !live.has(r.id))
  archivedKeys = new Set(gone.map(r => idKey(r.props['Account name'], r.props['Address'])))
  if (gone.length) {
    console.log(`\n  ${gone.length} row(s) archived by an earlier step — excluded from re-creation:`)
    gone.forEach(r => console.log(`    "${r.props['Account name']}" — ${r.props['City']}`))
  }
} catch (e) {
  throw new Error('Cannot read snapshots/mart-b-pre-value-repair.json, so deliberately archived rows ' +
    'cannot be excluded and the merge could be silently undone. ABORT. (' + e.message + ')')
}

// ---- raw: aggregate per identity per year ------------------------
const acct = new Map()  // idKey -> { years:{y:sum}, meta per last-active year, pseudo }
const perYear = {}

for (const year of YEARS) {
  const rows = await queryAll(DETAIL[year])
  const col = ceCol(year)
  const agg = new Map()
  let rawCE = 0
  for (const p of rows) {
    const P = p.properties
    const ce = plain(P[col]) || 0
    rawCE += ce
    const name = plain(P['Retail Accounts'])
    const addr = plain(P['Address'])
    const k = idKey(name, addr)
    agg.set(k, (agg.get(k) || 0) + ce)
    let a = acct.get(k)
    if (!a) a = acct.set(k, { years: {}, meta: null, metaYear: -1, pseudo: isPseudo(name) }).get(k)
    // Meta (name spelling, address, distributor) from the most recent
    // year the account actually moved volume — the identity a reader
    // would recognise, and the distributor that last shipped it.
    if (ce > 0 && year >= a.metaYear) {
      a.metaYear = year
      a.meta = {
        name, address: addr,
        city: plain(P['City']),
        chains: plain(P['Chains']),
        classOfTrade: plain(P['Classes of Trade']),
        distributor: plain(P['Distributors'])
      }
    }
  }
  if (Math.abs(rawCE - ORACLE[year]) / ORACLE[year] > 0.001) {
    throw new Error(`${year}: raw ${rawCE.toFixed(1)} vs oracle ${ORACLE[year]} — drift >0.1%. ABORT, nothing written.`)
  }
  for (const [k, sum] of agg) if (sum > 0) acct.get(k).years[year] = round(sum)
  perYear[year] = { rawCE: round(rawCE), agg }
  console.log(`  ${year} raw ${rawCE.toFixed(1)} (oracle OK)  ${agg.size} identities`)
}

// ---- absent set --------------------------------------------------
const absentAll = []
const respelled = []   // already in Mart B under a different address spelling
const archivedHits = []
for (const [k, a] of acct) {
  const total = YEARS.reduce((s, y) => s + (a.years[y] || 0), 0)
  if (total <= 0) continue
  if (bByKey.has(k)) continue
  const m = a.meta
  if (archivedKeys.has(k)) {
    archivedHits.push({ key: k, ...a, total: round(total) })
    continue
  }
  const hit = resolve(m.name, m.address, m.city)
  if (hit) {
    respelled.push({ key: k, ...a, total: round(total),
      liveName: plain(hit.row.properties['Account name']),
      liveAddr: plain(hit.row.properties['Address']) })
    continue
  }
  absentAll.push({ key: k, ...a, total: round(total) })
}

if (archivedHits.length) {
  console.log(`\nEXCLUDED — deliberately archived, would undo a merge: ${archivedHits.length} identity(ies), ` +
    `${round(archivedHits.reduce((s, a) => s + a.total, 0)).toFixed(1)} CE`)
  archivedHits.forEach(a => console.log(`  ${a.meta.name} — ${a.meta.city} — ${a.total.toFixed(1)} CE`))
}

if (respelled.length) {
  console.log(`\nEXCLUDED — already in Mart B under a re-spelled address (pipeline findExisting matches ` +
    `these; creating them would mint duplicates): ${respelled.length} identity(ies), ` +
    `${round(respelled.reduce((s, a) => s + a.total, 0)).toFixed(1)} CE`)
  respelled.sort((a, b) => b.total - a.total).forEach(a =>
    console.log(`  ${a.total.toFixed(1).padStart(7)} CE  "${a.meta.name}" ${a.meta.address}  ->  live "${a.liveName}" ${a.liveAddr}`))
  console.log('  These are identity breaks, not missing accounts. Their CE belongs on the EXISTING')
  console.log('  row — that is the Architect\'s pair-list/merge lane, not a spine expansion.')
}

// The Architect ruled (2026-07-21) that VIP's "OPEN | ..." allocation
// rows are bookkeeping, not retail accounts, and are excluded from
// Mart B entirely — their CE reaches Mart A via the distributor
// matrix instead. The Step 1 reconciliation measured "absent" without
// applying that exclusion, so any pseudo rows here are inside the
// released 1,005.9 but MUST NOT be created. Split and report.
const pseudo = absentAll.filter(a => a.pseudo)
const absent = absentAll.filter(a => !a.pseudo)

const sumCE = xs => round(xs.reduce((s, a) => s + a.total, 0))
console.log(`\nAbsent from Mart B: ${absentAll.length} identities, ${sumCE(absentAll).toFixed(1)} CE`)
console.log(`  real retail accounts : ${absent.length} (${sumCE(absent).toFixed(1)} CE)  <- to create`)
console.log(`  OPEN| pseudo-accounts: ${pseudo.length} (${sumCE(pseudo).toFixed(1)} CE)  <- excluded per Architect ruling 2026-07-21`)
if (pseudo.length) pseudo.forEach(a => console.log(`      ${a.meta.name} — ${a.total.toFixed(1)} CE`))

console.log(`\nAgainst the released figures (${EXPECT_ROWS} rows, ${EXPECT_CE} CE):`)
const rowDelta = absent.length - EXPECT_ROWS
const ceDelta  = round(sumCE(absent) - EXPECT_CE)
console.log(`  rows ${absent.length} (${rowDelta >= 0 ? '+' : ''}${rowDelta})   CE ${sumCE(absent).toFixed(1)} (${ceDelta >= 0 ? '+' : ''}${ceDelta.toFixed(1)})`)

// ---- build the creates -------------------------------------------
const creates = []
for (const a of absent) {
  const hist = {}
  for (const y of YEARS) if (a.years[y] > 0) hist[y] = a.years[y]
  const activeYears = YEARS.filter(y => hist[y] > 0)
  let peakCE = null, peakYear = null
  for (const y of YEARS) if (hist[y] !== undefined && (peakCE === null || hist[y] > peakCE)) { peakCE = hist[y]; peakYear = y }

  // Pipeline classifier, inactive-with-history branch: ytd = 0 and
  // samePeriod = 0, so status keys on whether the last full year moved.
  const status = (hist[2025] || 0) > 0 ? `Lapsed ${YEAR}` : 'Lapsed earlier'

  let uid = 'acct_' + md5(a.key).slice(0, 8)
  if (usedUids.has(uid)) uid = 'acct_' + md5(a.key).slice(0, 12)
  if (usedUids.has(uid)) throw new Error(`uid collision that the pipeline's fallback cannot resolve: ${uid}`)
  usedUids.add(uid)

  const m = a.meta
  const props = {
    'Account name':   { title: [{ text: { content: m.name || '(unnamed)' } }] },
    'Address':        { rich_text: m.address ? [{ text: { content: m.address } }] : [] },
    'City':           { rich_text: m.city ? [{ text: { content: m.city } }] : [] },
    'Class of Trade': { rich_text: m.classOfTrade ? [{ text: { content: m.classOfTrade } }] : [] },
    'Chain':          { rich_text: m.chains ? [{ text: { content: m.chains } }] : [] },
    'Chain account':  { checkbox: !!(m.chains && norm(m.chains) !== 'INDEPENDENTS') },
    'Airport cluster': { checkbox: isAirport(String(m.address || ''), m.city) },
    'Distributor (parent, last-active)': { select: { name: parentFor(m.distributor) } },
    'account_uid':    { rich_text: [{ text: { content: uid } }] },
    'CE 2026 YTD':        { number: 0 },
    'CE 2025 same-period': { number: 0 },
    'Current YoY delta':  { number: 0 },
    'Trajectory Status':  { select: { name: status } },
    'Peak CE':            { number: peakCE },
    'Peak year':          { number: peakYear },
    'First active year':  { number: activeYears.length ? Math.min(...activeYears) : null },
    'Last active year':   { number: activeYears.length ? Math.max(...activeYears) : null }
  }
  for (const y of YEARS) if (hist[y] !== undefined) props[`CE ${y}`] = { number: hist[y] }

  creates.push({ props, name: m.name, city: m.city, total: a.total, status, peakCE, peakYear, hist })
}

const byStatus = {}
creates.forEach(c => { byStatus[c.status] = (byStatus[c.status] || 0) + 1 })
console.log('\nTrajectory of the new rows:')
for (const [s, n] of Object.entries(byStatus)) console.log(`  ${s.padEnd(16)} ${n}`)
console.log('  (all carry CE 2026 YTD = 0 and CE 2025 same-period = 0, so YoY delta = 0 —')
console.log('   they contribute nothing to either side of a 2026-vs-2025 read.)')

console.log('\nLargest new rows:')
creates.slice().sort((a, b) => b.total - a.total).slice(0, 12).forEach(c =>
  console.log(`  ${c.total.toFixed(1).padStart(7)} CE  ${c.name} — ${c.city}  [${c.status}, peak ${c.peakCE} in ${c.peakYear}]`))

// ---- reconciliation gate ----------------------------------------
// Every CE must land in exactly one bucket:
//   stored (post-Step-1) + newly created - duplicate phantom = oracle
// The phantom term is the pre-existing duplicate-spelling overhang the
// Architect's pair-list run owns; it is measured the same way Step 1
// measured it, so the two runs are comparable.
console.log('\nGate: stored + created - phantom must tie oracle (0.1%)')
let gateFail = false
for (const year of YEARS) {
  let stored = 0
  for (const p of martB) stored += plain(p.properties[`CE ${year}`]) || 0
  const created = round(creates.reduce((s, c) => s + (c.hist[year] || 0), 0))
  let phantomCE = 0
  for (const p of martB) {
    const v = plain(p.properties[`CE ${year}`]) || 0
    if (v <= 0) continue
    const k = idKey(plain(p.properties['Account name']), plain(p.properties['Address']))
    if (bByKey.get(k) !== p) continue
    if ((perYear[year].agg.get(k) || 0) <= 0) phantomCE += v
  }
  const yearSum = xs => round(xs.reduce((s, a) => s + (a.years[year] || 0), 0))
  const pseudoCE = yearSum(pseudo)
  const respelledCE = yearSum(respelled)
  const archivedCE = yearSum(archivedHits)
  // Every CE lands in exactly one bucket. `respelled` and `archived` are
  // added back because their volume is real and sits in raw, but belongs
  // on an EXISTING Mart B row rather than a new one — the matching live
  // row shows up on the phantom side, so the two cancel.
  const total = stored + created + pseudoCE + respelledCE + archivedCE - phantomCE
  const ok = Math.abs(total - ORACLE[year]) / ORACLE[year] <= 0.001
  if (!ok) gateFail = true
  console.log(`  ${year}: ${stored.toFixed(1)} stored + ${created.toFixed(1)} created + ${pseudoCE.toFixed(1)} pseudo` +
    ` + ${respelledCE.toFixed(1)} respelled + ${archivedCE.toFixed(1)} archived - ${phantomCE.toFixed(1)} phantom` +
    ` = ${total.toFixed(1)} vs ${ORACLE[year]}  ${ok ? 'OK' : 'FAIL'}`)
}
if (gateFail) { console.error('\nGATE FAILED — nothing written.'); process.exit(1) }

console.log(`\nRow count: ${martB.length} -> ${martB.length + creates.length}`)

if (!WRITE) {
  console.log('\nDRY RUN — no writes. Re-run with --write.')
  process.exit(0)
}

// ---- snapshot + apply -------------------------------------------
fs.writeFileSync(new URL('./snapshots/mart-b-pre-spine-expansion.json', import.meta.url),
  JSON.stringify(martB.map(p => ({ id: p.id, props: Object.fromEntries(
    Object.entries(p.properties).map(([k, v]) => [k, plain(v)]) ) })), null, 1))
console.log(`Snapshot: ${martB.length} rows -> snapshots/mart-b-pre-spine-expansion.json`)

let done = 0
const created = []
for (const c of creates) {
  const res = await api('pages', 'POST', { parent: { database_id: MART_B }, properties: c.props })
  created.push({ id: res.id, name: c.name, total: c.total })
  if (++done % 10 === 0) console.log(`  ...${done}/${creates.length}`)
}
fs.writeFileSync(new URL('./snapshots/spine-expansion-created.json', import.meta.url),
  JSON.stringify(created, null, 1))
console.log(`\nCreated ${done} rows. Verify by independent re-query before reporting.`)

// Independent re-query verification of the Step 3 spine expansion.
// Re-reads Mart B from scratch and re-derives every claim rather than
// trusting the run report. Read-only.
import { queryAll, plain } from './notion.js'
import { idKey, ceCol } from './identity.js'
import fs from 'fs'

const MART_B = 'e75409d7238a49cea390bbfe123bfc45'
const DETAIL = {
  2021: '37c1c57ac02b80e48e44cacb022ff07b', 2022: '37c1c57ac02b808c8eb7d8c4c987062d',
  2023: '37c1c57ac02b801e980fc80f2138ff9e', 2024: '37c1c57ac02b80ec9590dc74c9745c4d',
  2025: '37b1c57ac02b80c89496d716b62a7cb5'
}
const ORACLE = { 2021: 33288.1, 2022: 41071.1, 2023: 33610.2, 2024: 32286.0, 2025: 17287.2 }
const YEARS = [2021, 2022, 2023, 2024, 2025]
const round = n => Math.round(n * 10000) / 10000

const created = JSON.parse(fs.readFileSync(new URL('./snapshots/spine-expansion-created.json', import.meta.url)))
const createdIds = new Set(created.map(c => c.id))

const rows = await queryAll(MART_B)
console.log(`Mart B live row count: ${rows.length}  (expected 3776)  ${rows.length === 3776 ? 'OK' : 'MISMATCH'}`)

const newRows = rows.filter(p => createdIds.has(p.id))
console.log(`New rows found live: ${newRows.length} of ${created.length}  ${newRows.length === created.length ? 'OK' : 'MISSING SOME'}`)

// Every new row must be inert in a 2026-vs-2025 read.
let bad2026 = 0, badSP = 0, badDelta = 0
for (const p of newRows) {
  if ((plain(p.properties['CE 2026 YTD']) || 0) !== 0) bad2026++
  if ((plain(p.properties['CE 2025 same-period']) || 0) !== 0) badSP++
  if ((plain(p.properties['Current YoY delta']) || 0) !== 0) badDelta++
}
console.log(`\nInertness in a YoY read (the "must not read as new decline" condition):`)
console.log(`  CE 2026 YTD non-zero:        ${bad2026}  ${bad2026 === 0 ? 'OK' : 'FAIL'}`)
console.log(`  CE 2025 same-period non-zero:${badSP}  ${badSP === 0 ? 'OK' : 'FAIL'}`)
console.log(`  Current YoY delta non-zero:  ${badDelta}  ${badDelta === 0 ? 'OK' : 'FAIL'}`)

const byStatus = {}
newRows.forEach(p => { const s = plain(p.properties['Trajectory Status']); byStatus[s] = (byStatus[s] || 0) + 1 })
console.log(`  trajectory:`, JSON.stringify(byStatus))
const nonLapsed = newRows.filter(p => !/^Lapsed/.test(plain(p.properties['Trajectory Status']) || ''))
console.log(`  non-lapsed new rows: ${nonLapsed.length}  ${nonLapsed.length === 0 ? 'OK' : 'REVIEW'}`)

// Duplicate check: no new row may share an identity key with a pre-existing row.
const preKeys = new Map()
for (const p of rows) if (!createdIds.has(p.id)) preKeys.set(idKey(plain(p.properties['Account name']), plain(p.properties['Address'])), p)
let dupes = 0
for (const p of newRows) {
  const k = idKey(plain(p.properties['Account name']), plain(p.properties['Address']))
  if (preKeys.has(k)) { dupes++; console.log(`  DUPLICATE: ${plain(p.properties['Account name'])}`) }
}
console.log(`\nNew rows colliding with an existing identity: ${dupes}  ${dupes === 0 ? 'OK' : 'FAIL'}`)

// The Step 1 merge folded "GOODY GOODY - 28 - BEDFORD" into "GOODY GOODY
// 28" and archived the former. Check for THAT row specifically — Goody
// Goody is a ~36-store chain, so counting the whole chain proves nothing.
const survivor = rows.filter(p => plain(p.properties['Account name']) === 'GOODY GOODY 28')
const revived  = rows.filter(p => plain(p.properties['Account name']) === 'GOODY GOODY - 28 - BEDFORD')
console.log(`\nGoody Goody merge (Step 1, Garrison's ruling):`)
console.log(`  survivor "GOODY GOODY 28"          present: ${survivor.length}  ${survivor.length === 1 ? 'OK' : 'FAIL'}`)
console.log(`  archived "GOODY GOODY - 28 - BEDFORD" back: ${revived.length}  ${revived.length === 0 ? 'OK (merge intact)' : 'FAIL (merge undone)'}`)

// Standing observation for the Architect's pair-list run: this chain
// carries the same duplicate-spelling pattern on many other stores —
// "GOODY GOODY {n}" alongside "GOODY GOODY - {n} - {LOCATION}". Same
// class as the row Step 1 merged, and none of the others are merged.
const num = n => { const m = /GOODY GOODY\D*(\d+)/i.exec(n || ''); return m ? String(parseInt(m[1], 10)) : null }
const groups = new Map()
for (const p of rows) {
  const n = plain(p.properties['Account name']) || ''
  if (!/^GOODY GOODY/i.test(n)) continue
  const k = num(n)
  if (!k) continue
  if (!groups.has(k)) groups.set(k, [])
  groups.get(k).push({ n, city: plain(p.properties['City']) })
}
const pairs = [...groups].filter(([, v]) => v.length > 1)
if (pairs.length) {
  console.log(`\n  PAIR-LIST CANDIDATE: ${pairs.length} Goody Goody store numbers appear on 2+ rows —`)
  console.log(`  the same duplicate-spelling class Step 1 merged for #28, still unmerged:`)
  pairs.sort((a, b) => Number(a[0]) - Number(b[0])).forEach(([k, v]) =>
    console.log(`    #${k}: ${v.map(x => `"${x.n}"`).join('  vs  ')}`))
}

// Full reconciliation, recomputed from raw.
console.log('\nReconciliation, recomputed from raw:')
for (const year of YEARS) {
  let stored = 0
  for (const p of rows) stored += plain(p.properties[`CE ${year}`]) || 0
  const raw = await queryAll(DETAIL[year])
  const col = ceCol(year)
  const agg = new Map()
  for (const p of raw) {
    const k = idKey(plain(p.properties['Retail Accounts']), plain(p.properties['Address']))
    agg.set(k, (agg.get(k) || 0) + (plain(p.properties[col]) || 0))
  }
  const bByKey = new Map()
  for (const p of rows) { const k = idKey(plain(p.properties['Account name']), plain(p.properties['Address'])); if (!bByKey.has(k)) bByKey.set(k, p) }
  let absent = 0
  for (const [k, sum] of agg) if (sum > 0 && !bByKey.has(k)) absent += sum
  let phantom = 0
  for (const p of rows) {
    const v = plain(p.properties[`CE ${year}`]) || 0
    if (v <= 0) continue
    const k = idKey(plain(p.properties['Account name']), plain(p.properties['Address']))
    if (bByKey.get(k) !== p) continue
    if ((agg.get(k) || 0) <= 0) phantom += v
  }
  const total = stored + absent - phantom
  const ok = Math.abs(total - ORACLE[year]) / ORACLE[year] <= 0.001
  console.log(`  ${year}: ${stored.toFixed(1)} stored + ${absent.toFixed(1)} still-absent - ${phantom.toFixed(1)} phantom = ${total.toFixed(1)} vs ${ORACLE[year]}  ${ok ? 'OK' : 'FAIL'}`)
}

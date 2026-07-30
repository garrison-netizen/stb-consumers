// Acceptance harness for the Carve class cutover, plus the absent-set
// count reconciliation that explains the released Step-3 figure.
//
// (1) Re-queries Mart A and Mart C live and re-runs the Architect's
//     single acceptance test: core 2022 (sum CE where Carve class =
//     field) must read 29,603.6. 41,071.1 means the cutover did not take.
// (2) Shows why the released Step-3 figure reads "56 rows" while the
//     spine expansion creates far fewer: 56 is the SUM OF PER-YEAR
//     absent-identity counts, so an account that moved volume in three
//     years is counted three times. One Mart B row per account is the
//     correct grain.
//
// Usage: node verify-carve-class.mjs   (read-only, never writes)
import { api, queryAll, plain } from './notion.js'
import { idKey, ceCol, isPseudo } from './identity.js'

const MART_A = 'dffa9e55b1df445ca00c84f0da92c142'
const MART_C = '2973f478ea3541f1962b109feb183d3d'
const MART_B = 'e75409d7238a49cea390bbfe123bfc45'
const DETAIL = {
  2021: '37c1c57ac02b80e48e44cacb022ff07b', 2022: '37c1c57ac02b808c8eb7d8c4c987062d',
  2023: '37c1c57ac02b801e980fc80f2138ff9e', 2024: '37c1c57ac02b80ec9590dc74c9745c4d',
  2025: '37b1c57ac02b80c89496d716b62a7cb5'
}
const YEARS = [2021, 2022, 2023, 2024, 2025]
const round = n => Math.round(n * 10000) / 10000

console.log('=== (1) Carve class cutover — independent re-query ===')
for (const [label, db] of [['Mart A', MART_A], ['Mart C', MART_C]]) {
  const rows = await queryAll(db)
  const missing = rows.filter(p => !plain(p.properties['Carve class'])).length
  const disagree = rows.filter(p => {
    const k = plain(p.properties['Carve class'])
    return (!!plain(p.properties['Footprint artifact'])) !== (k !== 'field')
  }).length
  console.log(`${label}: ${rows.length} rows, ${missing} without Carve class, ${disagree} where boolean disagrees with class`)
  const byClass = {}
  rows.forEach(p => { const k = plain(p.properties['Carve class']) || '(empty)'; byClass[k] = (byClass[k] || 0) + 1 })
  console.log('  ', JSON.stringify(byClass))
}

const aRows = await queryAll(MART_A)
const core = {}, gross = {}
for (const p of aRows) {
  const y = plain(p.properties['Year']); const ce = plain(p.properties['CE']) || 0
  gross[y] = round((gross[y] || 0) + ce)
  if (plain(p.properties['Carve class']) === 'field') core[y] = round((core[y] || 0) + ce)
}
console.log('\nMart A core (Carve class = field), read back from live:')
for (const y of Object.keys(core).sort()) console.log(`  ${y}  core ${core[y].toFixed(1).padStart(10)}   gross ${gross[y].toFixed(1).padStart(10)}`)
console.log(`\nACCEPTANCE: core 2022 = ${core[2022].toFixed(1)} — ` +
  (Math.abs(core[2022] - 29603.6) <= 0.5 ? 'PASS (29,603.6)' : `FAIL (expected 29,603.6; 41,071.1 would mean no cutover)`))

console.log('\n\n=== (2) Step-3 absent set: 56 vs 32 ===')
const martB = await queryAll(MART_B)
const bByKey = new Set()
for (const p of martB) bByKey.add(idKey(plain(p.properties['Account name']), plain(p.properties['Address'])))

let pairCount = 0, pairCE = 0
const distinct = new Map()
const perYearCounts = {}
for (const year of YEARS) {
  const rows = await queryAll(DETAIL[year])
  const col = ceCol(year)
  const agg = new Map(); const nameOf = new Map()
  for (const p of rows) {
    const name = plain(p.properties['Retail Accounts'])
    const k = idKey(name, plain(p.properties['Address']))
    agg.set(k, (agg.get(k) || 0) + (plain(p.properties[col]) || 0))
    nameOf.set(k, name)
  }
  let n = 0, ce = 0
  for (const [k, sum] of agg) {
    if (sum <= 0 || bByKey.has(k)) continue
    n++; ce += sum
    pairCount++; pairCE += sum
    distinct.set(k, (distinct.get(k) || 0) + 1)
    if (!isPseudo(nameOf.get(k))) { /* real */ }
  }
  perYearCounts[year] = { n, ce: round(ce) }
  console.log(`  ${year}: ${String(n).padStart(3)} absent identities, ${ce.toFixed(1)} CE`)
}
console.log(`\n  SUM of per-year absent counts (an account counted once PER YEAR it moved volume): ${pairCount}`)
console.log(`  DISTINCT absent identities (one Mart B row each):                                  ${distinct.size}`)
console.log(`  Total absent CE: ${round(pairCE).toFixed(1)}`)
console.log('\n  Years-present distribution among the distinct absent accounts:')
const dist = {}
for (const v of distinct.values()) dist[v] = (dist[v] || 0) + 1
Object.keys(dist).sort().forEach(k => console.log(`    present in ${k} year(s): ${dist[k]} account(s)`))

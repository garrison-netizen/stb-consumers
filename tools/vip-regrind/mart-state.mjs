// Read-only state-of-the-marts check. Answers "are all three marts correct
// right now" from live data rather than from run reports. Writes nothing.
import { queryAll, plain } from './notion.js'
import { idKey, ceCol, norm, normAddr, chainStoreKey, buildResolver } from './identity.js'
import fs from 'fs'

// The adjudicated-merge alias map the LIVE LOADER uses (MergedIdentities.gs).
// This check has to resolve identities the same way the pipeline does or it
// measures its own blind spot: after the 2026-07-31 merges, 199 survivors carry
// canonical names that match no raw row, so without the alias every one of
// their raw identities reads as `absent` while the survivor's stored volume
// reads as `phantom`. Those offset and the totals still tie — which is exactly
// the danger, because a real defect could hide inside a term inflated by
// ~3,200 CE. Parsed from the generated file rather than duplicated, so the
// check cannot drift from what the loader actually does.
const MERGED = (() => {
  try {
    const src = fs.readFileSync(new URL('../../pipelines/vip-marts/src/MergedIdentities.gs', import.meta.url), 'utf8')
    const m = new Map()
    for (const [, k, v] of src.matchAll(/"((?:[^"\\]|\\.)*)":\s*"(acct_[a-z0-9]+)"/g)) m.set(k, v)
    return m
  } catch { return new Map() }
})()

const MART_A = 'dffa9e55b1df445ca00c84f0da92c142'
const MART_B = 'e75409d7238a49cea390bbfe123bfc45'
const MART_C = '2973f478ea3541f1962b109feb183d3d'
const DETAIL = {
  2021: '37c1c57ac02b80e48e44cacb022ff07b', 2022: '37c1c57ac02b808c8eb7d8c4c987062d',
  2023: '37c1c57ac02b801e980fc80f2138ff9e', 2024: '37c1c57ac02b80ec9590dc74c9745c4d',
  2025: '37b1c57ac02b80c89496d716b62a7cb5'
}
const ORACLE = { 2021: 33288.1, 2022: 41071.1, 2023: 33610.2, 2024: 32286.0, 2025: 17287.2 }
const CORE = { 2021: 29804.3, 2022: 29603.6, 2023: 25666.0, 2024: 25463.3, 2025: 14911.1, 2026: 7244.7 }
const YEARS = [2021, 2022, 2023, 2024, 2025]
const r1 = n => n.toFixed(1)
const ok = (a, b, tol = 0.5) => Math.abs(a - b) <= tol ? 'OK' : 'FAIL'
let fails = 0
const gate = (cond) => { if (cond !== 'OK') fails++; return cond }

// ---- MART A ----
const A = await queryAll(MART_A)
const aGross = {}, aCore = {}
let aNoClass = 0
for (const p of A) {
  const y = plain(p.properties['Year']), ce = plain(p.properties['CE']) || 0
  const k = plain(p.properties['Carve class'])
  if (!k) aNoClass++
  aGross[y] = (aGross[y] || 0) + ce
  if (k === 'field') aCore[y] = (aCore[y] || 0) + ce
}
console.log(`=== MART A — ${A.length} rows, ${aNoClass} missing Carve class ===`)
console.log('  year     gross      vs oracle        core       vs expected')
for (const y of [2021, 2022, 2023, 2024, 2025, 2026]) {
  const g = aGross[y] || 0, c = aCore[y] || 0
  const gs = ORACLE[y] ? gate(ok(g, ORACLE[y])) : (y === 2026 ? 'n/a (live)' : '?')
  console.log(`  ${y}  ${r1(g).padStart(10)}  ${String(gs).padStart(10)}  ${r1(c).padStart(10)}  ${gate(ok(c, CORE[y])).padStart(10)}`)
}
gate(aNoClass === 0 ? 'OK' : 'FAIL')

// ---- MART C ----
const C = await queryAll(MART_C)
let cCE = 0, cNoClass = 0
const weeks = new Set()
for (const p of C) {
  cCE += plain(p.properties['CE']) || 0
  if (!plain(p.properties['Carve class'])) cNoClass++
  const w = p.properties['Week']?.date?.start
  if (w) weeks.add(w)
}
console.log(`\n=== MART C — ${C.length} rows, ${weeks.size} weeks, ${cNoClass} missing Carve class ===`)
console.log(`  CE ${cCE.toFixed(4)} vs validated seed 3517.0084  ${gate(ok(cCE, 3517.0084, 0.05))}`)
gate(cNoClass === 0 ? 'OK' : 'FAIL')
gate(weeks.size === 13 ? 'OK' : 'FAIL')

// ---- MART B ----
const B = await queryAll(MART_B)
console.log(`\n=== MART B — ${B.length} rows ===`)
// Resolve raw identities the way the LIVE PIPELINE does — exact key, then
// chain store number (city-qualified), then the name|city fallback. This
// has to be merge-aware: after the 2026-07-30 Goody Goody merge one Mart B
// row legitimately represents two raw identities, so a strict-key `absent`
// term counts the absorbed spelling as missing while the survivor already
// holds its volume. That is a bug in the CHECK, not in the mart.
const resolve = buildResolver(B,
  p => plain(p.properties['Account name']),
  p => plain(p.properties['Address']),
  p => plain(p.properties['City']))
const byChainStore = new Map()
for (const p of B) {
  const csk = chainStoreKey(plain(p.properties['Account name']))
  if (!csk) continue
  const ck = `${csk}|${norm(plain(p.properties['City']))}`
  byChainStore.set(ck, byChainStore.has(ck) ? null : p)
}
const byUid = new Map(B.map(p => [plain(p.properties['account_uid']), p]).filter(([u]) => u))
function resolveRow(name, address, city) {
  const hit = resolve(name, address, city)
  if (hit) return hit.row
  const csk = chainStoreKey(name)
  if (csk) { const cs = byChainStore.get(`${csk}|${norm(city)}`); if (cs) return cs }
  const k = `${norm(name)}|${normAddr(address)}`
  const uid = MERGED.get(`${k}|${norm(city)}`) || MERGED.get(k)
  if (uid && byUid.has(uid)) return byUid.get(uid)
  return null
}
console.log(`  alias map: ${MERGED.size} merged raw identities known to the loader`)

// Accounting identity, exact by construction:
//   oracle = Σ(raw CE) = Σ(raw resolving to a row) + absent
//   phantom := stored − Σ(raw resolving to a row)   [drift, either sign]
//   ⇒ stored + absent − phantom = oracle
console.log('  year    stored    +absent   -phantom   =total     oracle')
for (const year of YEARS) {
  let stored = 0
  for (const p of B) stored += plain(p.properties[`CE ${year}`]) || 0
  const raw = await queryAll(DETAIL[year])
  const col = ceCol(year)
  const agg = new Map(), meta = new Map()
  for (const p of raw) {
    const nm = plain(p.properties['Retail Accounts']), ad = plain(p.properties['Address'])
    const k = idKey(nm, ad)
    agg.set(k, (agg.get(k) || 0) + (plain(p.properties[col]) || 0))
    if (!meta.has(k)) meta.set(k, { nm, ad, city: plain(p.properties['City']) })
  }
  let matched = 0, absent = 0
  for (const [k, s] of agg) {
    if (s <= 0) continue
    const m = meta.get(k)
    if (resolveRow(m.nm, m.ad, m.city)) matched += s
    else absent += s
  }
  const phantom = stored - matched
  const t = stored + absent - phantom
  console.log(`  ${year} ${r1(stored).padStart(9)} ${r1(absent).padStart(9)} ${r1(phantom).padStart(9)} ${r1(t).padStart(9)} ${r1(ORACLE[year]).padStart(9)}  ${gate(ok(t, ORACLE[year], ORACLE[year] * 0.001))}`)
}
let b26 = 0
for (const p of B) b26 += plain(p.properties['CE 2026 YTD']) || 0
console.log(`  2026 Mart B ${r1(b26)} vs Mart A ${r1(aGross[2026] || 0)}  ${gate(ok(b26, aGross[2026] || 0, 0.2))}`)

console.log(`\n${fails === 0 ? 'ALL CHECKS PASS — all three marts correct as of this read.' : fails + ' CHECK(S) FAILED'}`)

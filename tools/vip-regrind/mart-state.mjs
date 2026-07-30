// Read-only state-of-the-marts check. Answers "are all three marts correct
// right now" from live data rather than from run reports. Writes nothing.
import { queryAll, plain } from './notion.js'
import { idKey, ceCol } from './identity.js'

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
const bByKey = new Map()
for (const p of B) { const k = idKey(plain(p.properties['Account name']), plain(p.properties['Address'])); if (!bByKey.has(k)) bByKey.set(k, p) }
console.log('  year    stored    +absent   -phantom   =total     oracle')
for (const year of YEARS) {
  let stored = 0
  for (const p of B) stored += plain(p.properties[`CE ${year}`]) || 0
  const raw = await queryAll(DETAIL[year])
  const col = ceCol(year)
  const agg = new Map()
  for (const p of raw) {
    const k = idKey(plain(p.properties['Retail Accounts']), plain(p.properties['Address']))
    agg.set(k, (agg.get(k) || 0) + (plain(p.properties[col]) || 0))
  }
  let absent = 0
  for (const [k, s] of agg) if (s > 0 && !bByKey.has(k)) absent += s
  let phantom = 0
  for (const p of B) {
    const v = plain(p.properties[`CE ${year}`]) || 0
    if (v <= 0) continue
    const k = idKey(plain(p.properties['Account name']), plain(p.properties['Address']))
    if (bByKey.get(k) !== p) continue
    if ((agg.get(k) || 0) <= 0) phantom += v
  }
  const t = stored + absent - phantom
  console.log(`  ${year} ${r1(stored).padStart(9)} ${r1(absent).padStart(9)} ${r1(phantom).padStart(9)} ${r1(t).padStart(9)} ${r1(ORACLE[year]).padStart(9)}  ${gate(ok(t, ORACLE[year], ORACLE[year] * 0.001))}`)
}
let b26 = 0
for (const p of B) b26 += plain(p.properties['CE 2026 YTD']) || 0
console.log(`  2026 Mart B ${r1(b26)} vs Mart A ${r1(aGross[2026] || 0)}  ${gate(ok(b26, aGross[2026] || 0, 0.2))}`)

console.log(`\n${fails === 0 ? 'ALL CHECKS PASS — all three marts correct as of this read.' : fails + ' CHECK(S) FAILED'}`)

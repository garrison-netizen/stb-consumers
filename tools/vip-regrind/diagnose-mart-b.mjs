// Mart B history diagnostic — REQUIRED by Architect before any write.
//
// The question: are the accounts missing from Mart B's history absent as ROWS,
// or present as rows carrying zero/null in those years?
//   - absent as rows  -> spine expansion (row count grows; bigger ruling, needs sign-off)
//   - present as null -> column repair (values only; safe under the existing spine)
//
// Read-only. Writes nothing.

import { api, queryAll, plain } from './notion.js'

const MART_B = 'e75409d7238a49cea390bbfe123bfc45'
const DETAIL = {
  2021: '37c1c57ac02b80e48e44cacb022ff07b',
  2022: '37c1c57ac02b808c8eb7d8c4c987062d',
  2023: '37c1c57ac02b801e980fc80f2138ff9e',
  2024: '37c1c57ac02b80ec9590dc74c9745c4d',
  2025: '37b1c57ac02b80c89496d716b62a7cb5'
}

// Architect's raw oracle (2026-07-29), for gating later.
const ORACLE = {
  2021: { ce: 33288.1, rows: 1480, pos: 1475 },
  2022: { ce: 41071.1, rows: 2233, pos: 1879 },
  2023: { ce: 33610.2, rows: 2854, pos: 2191 },
  2024: { ce: 32286.0, rows: 2803, pos: 1787 },
  2025: { ce: 17287.2, rows: 2077, pos: 1230 }
}

// --- identity, mirrored from pipelines/vip-marts/src/Data.gs ---
const norm = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim()
const SUFFIX = { STREET:'ST', ROAD:'RD', AVENUE:'AVE', BOULEVARD:'BLVD', PARKWAY:'PKWY',
  HIGHWAY:'HWY', DRIVE:'DR', LANE:'LN', COURT:'CT', PLACE:'PL',
  EXPRESSWAY:'EXPWY', FREEWAY:'FWY', COUNTRY:'COUNTY' }
function normAddr(s) {
  let t = norm(s).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  t = t.replace(/\b(STE|SUITE|UNIT|BLDG|BUILDING|SPACE|APT)\b\s*[A-Z0-9-]*/g, ' ')
  return t.split(' ').map(w => SUFFIX[w] || w)
    .filter(w => w && !(w.length === 1 && 'NSEW'.includes(w)))
    .join(' ')
}
const idKey = (name, addr) => `${norm(name)}|${normAddr(addr)}`

const ceCol = y => `12 Months 1/1/${y} thru 12/31/${y}  Case Equivs`

// --- load Mart B once ---
console.log('Loading Mart B...')
const martB = await queryAll(MART_B)
const bByKey = new Map()
for (const p of martB) {
  const k = idKey(plain(p.properties['Account name']), plain(p.properties['Address']))
  if (!bByKey.has(k)) bByKey.set(k, p)
}
console.log(`Mart B: ${martB.length} rows, ${bByKey.size} distinct identity keys\n`)

const summary = []

for (const year of [2021, 2022, 2023, 2024, 2025]) {
  const rows = await queryAll(DETAIL[year])
  const col = ceCol(year)

  // Raw carries one row per account PER DISTRIBUTOR — aggregate to account
  // identity first, or a naive join double-counts matches.
  let rawCE = 0
  const byKey = new Map()
  for (const p of rows) {
    const ce = plain(p.properties[col]) || 0
    rawCE += ce
    const name = plain(p.properties['Retail Accounts'])
    const addr = plain(p.properties['Address'])
    const k = idKey(name, addr)
    const cur = byKey.get(k) || { ce: 0, name, city: plain(p.properties['City']), rows: 0 }
    cur.ce += ce; cur.rows++
    byKey.set(k, cur)
  }
  const rawPos = [...byKey.values()].filter(v => v.ce > 0).length

  let missingRows = 0, missingRowsCE = 0   // no Mart B row at all -> spine expansion
  let nullInMartB = 0, nullInMartBCE = 0   // row exists, no stored value -> column repair
  let understated = 0, understatedCE = 0   // row exists WITH a value, but too small
  let okCount = 0
  const examples = []

  for (const [k, v] of byKey) {
    if (v.ce <= 0) continue
    const hit = bByKey.get(k)
    if (!hit) {
      missingRows++; missingRowsCE += v.ce
      if (examples.length < 5) examples.push(`ROW-ABSENT   raw ${v.ce.toFixed(1).padStart(7)}                  ${v.name} — ${v.city}`)
      continue
    }
    const stored = plain(hit.properties[`CE ${year}`]) || 0
    const delta = v.ce - stored
    if (stored <= 0) {
      nullInMartB++; nullInMartBCE += v.ce
      if (examples.length < 5) examples.push(`VALUE-NULL   raw ${v.ce.toFixed(1).padStart(7)}  stored 0        ${v.name} — ${v.city}`)
    } else if (delta > 0.05) {
      understated++; understatedCE += delta
      if (examples.length < 5) examples.push(`UNDERSTATED  raw ${v.ce.toFixed(1).padStart(7)}  stored ${stored.toFixed(1).padStart(7)}  ${v.name} — ${v.city}`)
    } else okCount++
  }

  const o = ORACLE[year]
  const tie = Math.abs(rawCE - o.ce) < 0.5 ? 'ties' : `DRIFT vs oracle ${o.ce}`
  console.log(`${year}  raw rows ${rows.length} (oracle ${o.rows})  CE ${rawCE.toFixed(1)} — ${tie}`)
  console.log(`      distinct accounts ${byKey.size}, positive ${rawPos} (Architect's raw count ${o.pos})`)
  console.log(`      correct in Mart B   : ${String(okCount).padStart(5)}`)
  console.log(`      row absent from B   : ${String(missingRows).padStart(5)}   ${missingRowsCE.toFixed(1).padStart(9)} CE  <-- spine expansion`)
  console.log(`      row present, no val : ${String(nullInMartB).padStart(5)}   ${nullInMartBCE.toFixed(1).padStart(9)} CE  <-- column repair`)
  console.log(`      row present, TOO LOW: ${String(understated).padStart(5)}   ${understatedCE.toFixed(1).padStart(9)} CE  <-- value repair`)
  const explained = missingRowsCE + nullInMartBCE + understatedCE
  console.log(`      total explained     : ${explained.toFixed(1)} CE`)
  if (examples.length) { console.log('      examples:'); examples.forEach(e => console.log(`        ${e}`)) }
  console.log()

  summary.push({ year, missingRows, missingRowsCE, nullInMartB, nullInMartBCE, understated, understatedCE })
}

const totAbsent = summary.reduce((a, s) => a + s.missingRows, 0)
const totAbsentCE = summary.reduce((a, s) => a + s.missingRowsCE, 0)
const totNull = summary.reduce((a, s) => a + s.nullInMartB, 0)
const totUnder = summary.reduce((a, s) => a + s.understated, 0)
const totUnderCE = summary.reduce((a, s) => a + s.understatedCE, 0)
console.log('='.repeat(74))
console.log(`rows absent from Mart B : ${String(totAbsent).padStart(5)}   ${totAbsentCE.toFixed(1).padStart(9)} CE`)
console.log(`rows present, unvalued  : ${String(totNull).padStart(5)}`)
console.log(`rows present, too low   : ${String(totUnder).padStart(5)}   ${totUnderCE.toFixed(1).padStart(9)} CE`)
console.log()
console.log(totAbsent > 0
  ? 'SPINE EXPANSION REQUIRED — row count grows. Architect wants this flagged BEFORE any run.'
  : 'COLUMN REPAIR ONLY — spine unchanged.')
if (totUnderCE > totAbsentCE) {
  console.log('NOTE: understated values dominate missing rows. This is NOT pure account dropout —')
  console.log('      it contradicts the account-dropout-only mechanism and must be reported.')
}

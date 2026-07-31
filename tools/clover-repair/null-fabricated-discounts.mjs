// ============================================================
// Null the fabricated $0.00 discounts on payments-derived Taproom Daily rows.
//
// WHY
// Clover purged ORDER records before ~May 2026, so daily history for
// 2025-03-13 .. 2026-04-30 was rebuilt from PAYMENTS. Payments carry no
// discount data. The rebuild wrote 0 anyway (Transform.gs literally said
// "discounts unknowable without orders -> 0").
//
// Zero is a claim. It says "we ran no promotions for fourteen months."
// Null says "payments cannot tell us." The difference is not cosmetic:
//
//   Taproom Daily        2025-03 .. 2026-04   $0.00
//   Taproom SKU by Month  same period          ~$132,500
//
// Two Brain surfaces contradicting each other on the same months, and the
// Console read the zero as fact (`num(r,'Discounts applied') || 0`).
//
// The Arryved era already does this correctly -- gross, tips, transaction
// count and tenders are NULL there precisely so absence is never read as a
// measurement. This restores that rule to the Clover payments era.
//
// SAFETY
//   - Touches ONLY Source=Clover rows on/before the cutover, and ONLY rows
//     whose Discounts applied is exactly 0. A non-zero value is real data
//     and is never overwritten.
//   - Revenue, tax, tips, tenders and transaction count are NOT touched:
//     payments genuinely carry those, so they are real.
//   - Snapshots every row it will change before changing it.
//
// Usage:  node null-fabricated-discounts.mjs           # dry run
//         node null-fabricated-discounts.mjs --write
// ============================================================

import { api, queryAll, plain } from '../vip-regrind/notion.js'
import fs from 'fs'

const DAILY = '19fe60e4894d4b2cb502ac8b42e94811'
// Last day of the payments-derived rebuild. Orders (and therefore real
// discount data) resume 2026-05-01.
const CUTOVER = '2026-04-30'
const FIRST_DAY = '2025-03-13'   // taproom's true first Clover sales day

const WRITE = process.argv.includes('--write')
const sleep = ms => new Promise(r => setTimeout(r, ms))

console.log('Loading Taproom Daily...')
const rows = await queryAll(DAILY)
console.log(`  ${rows.length} rows`)

const clover = rows.filter(p => plain(p.properties['Source']) === 'Clover')
const inEra = clover.filter(p => {
  const d = plain(p.properties['Date'])
  return d && d >= FIRST_DAY && d <= CUTOVER
})
console.log(`  ${clover.length} Clover rows, ${inEra.length} in the payments-derived era (${FIRST_DAY} .. ${CUTOVER})`)

const zero = inEra.filter(p => plain(p.properties['Discounts applied']) === 0)
const nonZero = inEra.filter(p => {
  const v = plain(p.properties['Discounts applied'])
  return v !== null && v !== undefined && v !== 0
})
const alreadyNull = inEra.filter(p => plain(p.properties['Discounts applied']) === null)

console.log(`\n  exactly 0  : ${zero.length}   <- fabricated, will be nulled`)
console.log(`  already null: ${alreadyNull.length}`)
console.log(`  non-zero    : ${nonZero.length}   <- real data, NOT touched`)
if (nonZero.length) {
  console.log('  non-zero rows held back:')
  nonZero.slice(0, 10).forEach(p =>
    console.log(`    ${plain(p.properties['Date'])}  $${plain(p.properties['Discounts applied'])}`))
}

// Guard: if discounts appear AFTER the cutover, the cutover is right. If they
// do not, the cutover may be wrong and nulling would destroy real zeros.
const after = clover.filter(p => {
  const d = plain(p.properties['Date'])
  return d && d > CUTOVER
})
const afterWithDisc = after.filter(p => (plain(p.properties['Discounts applied']) || 0) > 0)
console.log(`\nCutover sanity: ${after.length} rows after ${CUTOVER}, ${afterWithDisc.length} of them carry a non-zero discount.`)
if (after.length && afterWithDisc.length === 0) {
  console.error('ABORT: no discounts anywhere after the cutover either, so 0 may be genuine')
  console.error('rather than fabricated. Verify the seam before nulling anything.')
  process.exit(1)
}

// Guard: don't touch anything if the era is empty (wrong DB / wrong dates).
if (!zero.length) { console.log('\nNothing to do.'); process.exit(0) }

// Report what the truth actually is, from the surface that has it.
console.log(`\nFor reference, the SKU-by-Month table reports real discounts over this`)
console.log(`period; that surface stays the answer for "how much did we discount".`)

if (!WRITE) {
  console.log(`\nDRY RUN -- would null ${zero.length} row(s). Re-run with --write.`)
  process.exit(0)
}

fs.mkdirSync(new URL('./snapshots/', import.meta.url), { recursive: true })
fs.writeFileSync(new URL('./snapshots/daily-pre-discount-null.json', import.meta.url),
  JSON.stringify(inEra.map(p => ({
    id: p.id,
    date: plain(p.properties['Date']),
    discounts: plain(p.properties['Discounts applied'])
  })), null, 1))
console.log(`\nSnapshot: ${inEra.length} rows -> snapshots/daily-pre-discount-null.json`)

let done = 0, failed = 0
for (const p of zero) {
  try {
    await api(`pages/${p.id}`, 'PATCH', { properties: { 'Discounts applied': { number: null } } })
    done++
    if (done % 50 === 0) console.log(`  ${done}/${zero.length}...`)
  } catch (e) {
    failed++
    console.error(`  FAILED ${plain(p.properties['Date'])}: ${e.message}`)
  }
  await sleep(340)
}
console.log(`\nNulled ${done} row(s), ${failed} failed. Verify by independent re-query.`)

// ============================================================
// check-fake-zeros.mjs -- STB fabricated-zero gate
//
// WHY THIS EXISTS
// A pipeline that cannot measure something has two options: write null, or
// write 0. Null says "we don't know." Zero says "it was nothing." They render
// identically in a dashboard and sum identically in a report, and only one of
// them is a lie.
//
// The Clover daily rebuild took the second option. Order records were purged,
// so it was rebuilt from payments, which carry no discount data -- and it
// wrote 0. Taproom Daily then reported $0.00 of discounts across 356 days
// while the SKU-by-Month table, built from item-level exports over the SAME
// months, reported about $132,500. Both surfaces sat in the Brain contradicting
// each other for months. The Console read the zero as fact and would have told
// anyone who asked that STB ran no promotions for over a year.
//
// Nothing errored. Nothing looked broken. That is the signature of this class,
// and it is why the guard has to be mechanical.
//
// WHAT IT DOES
//   1. ZERO-RUN: finds long runs of exact 0 in a series that is non-zero
//      elsewhere. A field that works everywhere except one contiguous span is
//      describing a collection gap, not a business fact.
//   2. CROSS-SURFACE: compares two surfaces that should agree on the same
//      period. One reporting 0 while the other reports real money is the
//      strongest possible signal, because it needs no threshold to judge.
//
// It flags 0, never null. Null is the correct representation of unknown and
// must never be "fixed" into a number.
//
// EXIT CODES  0 clean | 1 suspected fabricated zeros | 2 could not verify
//
// USAGE
//   node check-fake-zeros.mjs
//   node check-fake-zeros.mjs --quiet
//   node check-fake-zeros.mjs --selftest   # prove the detector still fires
// ============================================================

import { queryAll, plain } from '../vip-regrind/notion.js'
import fs from 'fs'

const QUIET = process.argv.includes('--quiet')
const SELFTEST = process.argv.includes('--selftest')

const DAILY = '19fe60e4894d4b2cb502ac8b42e94811'
const SKU_MONTH = '88f43c26b68748adbbbcdbeac5ced04b'

// A run this long is not a coincidence. Chosen so a genuinely quiet stretch
// (a slow month with no promos) never trips it, but a collection gap does.
const RUN_THRESHOLD = 45

let violations = 0, unverified = 0
const say = (...a) => { if (!QUIET) console.log(...a) }
const flag = (...a) => { violations++; console.log(...a) }

// ---- detector --------------------------------------------------------
// points: [{ key, value }] sorted by key. Zeros are candidates; nulls are not.
function longestZeroRun(points) {
  let best = null, cur = null
  for (const p of points) {
    if (p.value === 0) {
      cur = cur ? { from: cur.from, to: p.key, n: cur.n + 1 } : { from: p.key, to: p.key, n: 1 }
      if (!best || cur.n > best.n) best = cur
    } else if (p.value !== null && p.value !== undefined) {
      cur = null
    }
    // null neither extends nor breaks a run -- it is simply not evidence.
  }
  return best
}

function zeroRunCheck(label, points, note) {
  const nonZero = points.filter(p => p.value !== null && p.value !== undefined && p.value !== 0)
  const zeros = points.filter(p => p.value === 0)
  const nulls = points.filter(p => p.value === null || p.value === undefined)
  say(`\n${label}: ${points.length} periods -- ${nonZero.length} non-zero, ${zeros.length} zero, ${nulls.length} null`)

  if (!nonZero.length) { say(`  skipped -- never non-zero, so there is no baseline to judge against`); return }
  const run = longestZeroRun(points)
  if (run && run.n >= RUN_THRESHOLD) {
    flag(`  FABRICATED ZERO SUSPECTED -- ${run.n} consecutive zero periods (${run.from} .. ${run.to})`)
    console.log(`    but the same field is non-zero in ${nonZero.length} other period(s).`)
    console.log(`    A field that works everywhere except one contiguous span is describing a`)
    console.log(`    collection gap. If it is unmeasurable there, it must be NULL, not 0.`)
    if (note) console.log(`    ${note}`)
  } else say(`  OK -- longest zero run is ${run ? run.n : 0} period(s), under the ${RUN_THRESHOLD} threshold`)
}

// ---- self-test: the detector must still catch the original defect -----
if (SELFTEST) {
  const snap = new URL('../clover-repair/snapshots/daily-pre-discount-null.json', import.meta.url)
  let rows
  try { rows = JSON.parse(fs.readFileSync(snap, 'utf8')) }
  catch { console.log('SELFTEST SKIPPED -- pre-fix snapshot not present'); process.exit(0) }
  const points = rows.map(r => ({ key: r.date, value: r.discounts })).sort((a, b) => a.key < b.key ? -1 : 1)
  const run = longestZeroRun(points)
  const caught = run && run.n >= RUN_THRESHOLD
  console.log(`SELFTEST against the pre-fix snapshot (${rows.length} rows):`)
  console.log(`  longest zero run = ${run ? run.n : 0} (${run ? run.from + ' .. ' + run.to : 'none'})`)
  console.log(caught
    ? `  PASS -- the detector still fires on the defect it was built for.`
    : `  FAIL -- the detector no longer catches the original defect. Do not trust this gate.`)
  process.exit(caught ? 0 : 1)
}

// ---- 1. Taproom Daily, per-field zero runs ---------------------------
let daily
try { daily = await queryAll(DAILY) }
catch (e) { console.log(`CANNOT VERIFY Taproom Daily: ${e.message}`); unverified++ }

if (daily) {
  const rows = daily
    .map(p => ({
      date: plain(p.properties['Date']),
      source: plain(p.properties['Source']),
      disc: plain(p.properties['Discounts applied']),
      tips: plain(p.properties['Tips']),
      tax: plain(p.properties['Tax collected'])
    }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date || ''))
    .sort((a, b) => a.date < b.date ? -1 : 1)

  for (const [label, key] of [['Discounts applied', 'disc'], ['Tips', 'tips'], ['Tax collected', 'tax']]) {
    zeroRunCheck(`Taproom Daily / ${label}`,
      rows.map(r => ({ key: r.date, value: r[key] })),
      label === 'Discounts applied'
        ? 'Payment records carry no discount data; those rows must stay NULL.'
        : null)
  }
}

// ---- 2. Cross-surface: daily vs SKU-month on the same months ---------
// The check that would have caught the original defect on day one: two Brain
// surfaces describing the same months, one reporting zero and one reporting
// real money.
let skus
try { skus = await queryAll(SKU_MONTH) }
catch (e) { console.log(`CANNOT VERIFY SKU by Month: ${e.message}`); unverified++ }

if (daily && skus) {
  const dailyByMonth = new Map()
  for (const p of daily) {
    const d = plain(p.properties['Date'])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) continue
    if (plain(p.properties['Source']) !== 'Clover') continue
    const m = d.slice(0, 7)
    const v = plain(p.properties['Discounts applied'])
    const e = dailyByMonth.get(m) || { sum: 0, allNull: true }
    if (v !== null && v !== undefined) { e.sum += v; e.allNull = false }
    dailyByMonth.set(m, e)
  }
  const skuByMonth = new Map()
  for (const p of skus) {
    if (plain(p.properties['Source']) !== 'Clover') continue
    const m = (p.properties['Month']?.date?.start || '').slice(0, 7)
    if (!m) continue
    skuByMonth.set(m, (skuByMonth.get(m) || 0) + (plain(p.properties['Discounts']) || 0))
  }

  const bad = []
  for (const [m, sku] of [...skuByMonth].sort()) {
    const d = dailyByMonth.get(m)
    if (!d || d.allNull) continue          // null is honest, not a violation
    if (d.sum === 0 && sku > 0) bad.push({ m, sku })
  }
  say(`\nCross-surface: Taproom Daily vs SKU by Month, discounts, ${skuByMonth.size} shared month(s)`)
  if (bad.length) {
    const total = bad.reduce((t, b) => t + b.sku, 0)
    flag(`  SURFACES DISAGREE -- ${bad.length} month(s) where daily reports $0 and SKU-by-Month reports real money:`)
    bad.slice(0, 6).forEach(b => console.log(`    ${b.m}  daily $0.00  vs  SKU $${b.sku.toFixed(2)}`))
    if (bad.length > 6) console.log(`    ... and ${bad.length - 6} more`)
    console.log(`    Total unreported: $${total.toFixed(2)}`)
  } else say(`  OK -- no month where one surface claims zero and the other reports money`)
}

// ---- summary ---------------------------------------------------------
console.log('')
if (violations) {
  console.log(`FABRICATED ZEROS: ${violations} finding(s).`)
  console.log('A zero that means "unmeasured" is worse than a gap: it sums, it charts, and it')
  console.log('reads as fact. Write NULL where the data does not exist -- never 0.')
  process.exit(1)
}
if (unverified) { console.log(`Checked what it could; ${unverified} source(s) unverified.`); process.exit(2) }
console.log('No fabricated zeros detected.')

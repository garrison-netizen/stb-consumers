// ============================================================
// check-category-semantics.mjs -- STB product-category gate
//
// WHY THIS EXISTS
// STB deliberately repurposes POS category codes: the only clean way to split
// THC out from beer was to book it under a category the business does not
// otherwise use (Arryved's RETAIL_CIDER). That is a sound operational call, but
// it means a category LABEL LIES ABOUT ITS CONTENTS -- and a label that lies is
// invisible to anyone who was not in the room when it was decided.
//
// On 2026-07-31 it reached an analysis spec written as "RETAIL_BEER +
// RETAIL_CIDER" for a beer-to-go test. Run as written it would have flipped
// Feb-2025 from -25% to +23% and scored a promo a success on THC volume.
//
// So this gate does two things, and the split matters:
//   1. It RECORDS the intentional conventions as data (category-conventions.json)
//      so a future reader consults the register instead of trusting the label.
//   2. It ENFORCES that items land where the convention says they should, and
//      fails when one does not -- because the conventions are only safe while
//      they actually hold.
//
// It classifies from ITEM NAMES, never from the category label, since the label
// is the thing under test.
//
// EXIT CODES  0 clean | 1 violations found | 2 could not verify
//
// USAGE
//   node check-category-semantics.mjs          # both eras
//   node check-category-semantics.mjs --quiet  # problems only
// ============================================================

import { queryAll, plain } from '../vip-regrind/notion.js'
import fs from 'fs'

const QUIET = process.argv.includes('--quiet')
const CONV = JSON.parse(fs.readFileSync(new URL('./category-conventions.json', import.meta.url), 'utf8'))

const SKU_WEEK = '641885a1e72f4e78835adfadef5cfa89'
const SKU_MONTH = '88f43c26b68748adbbbcdbeac5ced04b'
const ARRYVED = 'C:/Users/garrison/STB_Arryved_Analytical/'

const THC = CONV.product_lines.THC
const norm = s => String(s || '').toLowerCase()
const looksTHC = name => {
  const n = norm(name)
  if (THC.not_item_patterns.some(p => n.includes(p))) return false   // merch first
  return THC.item_patterns.some(p => n.includes(p))
}

let violations = 0, checked = 0, unverified = 0
const say = (...a) => { if (!QUIET) console.log(...a) }
const flag = (...a) => { violations++; console.log(...a) }

// ---- 1. Clover era: item name vs stored Category ---------------------
// The pipeline maps from the CLOVER CATEGORY NAME, so an item filed under a
// category whose name carries no THC token silently becomes Beer or Other.
for (const [label, db] of [['SKU by Week', SKU_WEEK], ['SKU by Month', SKU_MONTH]]) {
  let rows
  try { rows = await queryAll(db) }
  catch (e) { console.log(`CANNOT VERIFY  Clover ${label}: ${e.message}`); unverified++; continue }

  const allowed = new Set(CONV.allowed_categories.clover_notion)
  const bad = [], unknownCat = []
  for (const p of rows) {
    const name = plain(p.properties['Clover SKU name']) || plain(p.properties['Title']) || ''
    const cat = plain(p.properties['Category'])
    const rev = plain(p.properties['Revenue']) ?? plain(p.properties['Net revenue']) ?? 0
    checked++
    if (cat && !allowed.has(cat)) unknownCat.push({ name, cat })
    if (looksTHC(name) && cat !== 'THC') bad.push({ name, cat, rev })
  }

  say(`\nClover ${label}: ${rows.length} rows`)
  if (bad.length) {
    // Aggregate: the same SKU repeats across periods and one line per period is noise.
    const bySku = new Map()
    for (const b of bad) {
      const k = `${b.name}|${b.cat}`
      const e = bySku.get(k) || { ...b, rev: 0, n: 0 }
      e.rev += b.rev || 0; e.n++
      bySku.set(k, e)
    }
    flag(`  THC-LOOKING ITEM NOT IN THC CATEGORY -- ${bySku.size} SKU(s):`)
    for (const e of [...bySku.values()].sort((a, b) => b.rev - a.rev))
      console.log(`    "${e.name}"  filed as ${e.cat}  $${Math.round(e.rev)} across ${e.n} period(s)`)
    console.log(`    Fix at source: file these under a Clover category whose NAME contains "THC".`)
    console.log(`    CLV_mapCategory_ reads the category name, not the item name.`)
  } else say(`  OK -- every THC-looking item is categorised THC`)

  if (unknownCat.length) {
    flag(`  UNKNOWN CATEGORY VALUE -- ${unknownCat.length} row(s):`)
    ;[...new Set(unknownCat.map(u => u.cat))].forEach(c => console.log(`    "${c}" is not in allowed_categories.clover_notion`))
  }
}

// ---- 2. Arryved era: does the recorded convention still hold? --------
// RETAIL_CIDER is THC by convention. Two ways that can go wrong: it stops
// being all-THC, or a real cider gets filed into it.
try {
  const parse = t => {
    const L = t.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
    const P = l => { const o = []; let c = '', q = false
      for (let i = 0; i < l.length; i++) { const ch = l[i]
        if (q) { if (ch === '"') { if (l[i + 1] === '"') { c += '"'; i++ } else q = false } else c += ch }
        else if (ch === '"') q = true
        else if (ch === ',') { o.push(c); c = '' } else c += ch }
      o.push(c); return o }
    const h = P(L[0]); return L.slice(1).map(l => { const v = P(l); const r = {}; h.forEach((x, i) => r[x] = v[i]); return r })
  }
  const cm = parse(fs.readFileSync(ARRYVED + 'arryved_category_month.csv', 'utf8'))
  const items = parse(fs.readFileSync(ARRYVED + 'arryved_item_day.csv', 'utf8'))
  const n = v => { const x = Number(String(v).replace(/,/g, '')); return isFinite(x) ? x : 0 }

  const allowed = new Set(CONV.allowed_categories.arryved_category_month)
  const unknown = [...new Set(cm.map(r => r.category))].filter(c => !allowed.has(c))
  say(`\nArryved category_month: ${cm.length} rows`)
  if (unknown.length) flag(`  UNKNOWN CATEGORY VALUE: ${unknown.join(', ')}`)

  // The convention's own claim: RETAIL_CIDER carries THC and nothing before 2024-09.
  const conv = CONV.conventions.find(c => c.id === 'arryved-retail-cider-is-thc')
  const cider = cm.filter(r => r.category === 'RETAIL_CIDER' && n(r.gross) > 0).map(r => r.month).sort()
  const thcMonths = [...new Set(items.filter(r => r.pos_type === 'TR_THC_PRODUCTS').map(r => r.month))].sort()
  say(`  RETAIL_CIDER non-zero from ${cider[0]} (convention says ${conv.effective_from})`)
  if (cider.length && cider[0] < conv.effective_from) {
    flag(`  CONVENTION BROKEN: RETAIL_CIDER has volume at ${cider[0]}, before the recorded start ${conv.effective_from}.`)
    console.log(`    Either the convention started earlier than recorded, or real cider is in there.`)
  }
  if (!thcMonths.length) { flag('  No TR_THC_PRODUCTS rows found -- the THC line has moved or been renamed.'); }

  // A real cider anywhere in retail would break the "we sell no cider" premise
  // the whole convention rests on.
  const realCider = [...new Set(items.filter(r => /cider/i.test(r.item)).map(r => `${r.item} [${r.pos_type}]`))]
  const retailCider = realCider.filter(s => !/TR:_ONSITE_CANS/.test(s))
  if (retailCider.length) {
    flag(`  REAL CIDER OUTSIDE ON-PREMISE -- the premise behind the RETAIL_CIDER convention is that STB sells no cider:`)
    retailCider.forEach(s => console.log(`    ${s}`))
  } else say(`  OK -- the only cider items are on-premise cans, so the convention's premise holds`)
  checked += cm.length
} catch (e) {
  console.log(`CANNOT VERIFY  Arryved flat copy: ${e.message}`)
  unverified++
}

// ---- summary ---------------------------------------------------------
console.log('')
if (violations) {
  console.log(`CATEGORY SEMANTICS: ${violations} violation(s) across ${checked} rows checked.`)
  console.log('A category label that disagrees with its contents produces confident wrong numbers,')
  console.log('not obvious errors. Fix at source or record the new convention in')
  console.log('category-conventions.json -- do not delete a convention to silence this.')
  process.exit(1)
}
if (unverified) { console.log(`Checked what it could; ${unverified} source(s) unverified.`); process.exit(2) }
console.log(`All category conventions hold (${checked} rows checked).`)

// ============================================================
// Load merge candidates into "VIP Mart B — Duplicate Account Candidates"
// (Architect ruling 2026-07-31, channel row 3ad1c57a-c02b-819b).
//
// WRITE SPLIT — this loader honours it strictly:
//   Code on load :  Cluster, Section, Rows in cluster, Account spellings,
//                   Address, Cities, Distributors, Match basis,
//                   Address-only non-adjacent cities, Peak CE
//   Code later   :  Executed, Executor note        (after the merge runs)
//   ARCHITECT ONLY: Ruling, Canonical spelling, Ruling rationale, Ruled on
//
// The one exception is Section D, where the Architect ruled the rows in
// advance and asked Code to TRANSCRIBE his ruling. That text is his, quoted
// verbatim from his reply; it is not authored here.
//
// Idempotent: keyed on Cluster title, which the generator derives from cluster
// MEMBERSHIP (sha1 of sorted account_uids), so a rerun updates in place rather
// than duplicating, and an Architect ruling stays attached across a regenerate.
// Existing rows are updated ONLY on Code-owned fields — a ruling already
// entered is never overwritten.
//
// Usage:  node load-candidates.mjs            # dry run
//         node load-candidates.mjs --write
// ============================================================

import { api } from './notion.js'
import fs from 'fs'

const DB = 'b5208dda63c1433b8ec77a40a83678c3'
const WRITE = process.argv.includes('--write')
const sleep = ms => new Promise(r => setTimeout(r, ms))

const txt = s => ({ rich_text: [{ text: { content: String(s ?? '').slice(0, 1900) } }] })
const uniq = a => [...new Set(a.filter(Boolean))]

const j = JSON.parse(fs.readFileSync(new URL('./output/merge-candidates.json', import.meta.url), 'utf8'))
const all = [
  ...j.sectionA.map(c => ({ ...c, section: 'A' })),
  ...j.sectionB.map(c => ({ ...c, section: 'B' })),
  ...j.sectionC.map(c => ({ ...c, section: 'C' })),
  ...j.sectionD.map(c => ({ ...c, section: 'D' }))
]
console.log(`Candidates: A ${j.sectionA.length}  B ${j.sectionB.length}  C ${j.sectionC.length}  D ${j.sectionD.length}  = ${all.length}`)

const keys = new Set(all.map(c => c.key))
if (keys.size !== all.length) throw new Error(`ABORT: cluster keys are not unique (${keys.size} of ${all.length}) — loading would collide rows.`)

// ---- existing rows ------------------------------------------------
console.log('Reading existing rows...')
const existing = new Map()
let cursor
do {
  const q = await api(`databases/${DB}/query`, 'POST', cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 })
  for (const p of q.results) {
    const t = (p.properties['Cluster']?.title || []).map(x => x.plain_text).join('')
    if (t) existing.set(t, p)
  }
  cursor = q.has_more ? q.next_cursor : null
} while (cursor)
console.log(`  ${existing.size} already present`)

// ---- build + write ------------------------------------------------
let created = 0, updated = 0, skipped = 0
for (const c of all) {
  const props = {
    'Cluster': { title: [{ text: { content: c.key.slice(0, 1900) } }] },
    'Section': { select: { name: c.section } },
    'Rows in cluster': { number: c.rows.length },
    'Account spellings': txt(c.rows.map(r => r.name).join('\n')),
    'Address': txt(uniq(c.rows.map(r => r.address)).join('\n')),
    'Cities': txt(uniq(c.rows.map(r => r.city)).join(' / ')),
    'Distributors': txt(c.distributors.join(' + ')),
    'Match basis': { select: { name: c.matchBasis } },
    'Address-only non-adjacent cities': { checkbox: !!c.addressOnlyNonAdjacent },
    // Sort key for volume-first adjudication — populated even where small,
    // per the Architect's load note.
    'Peak CE': { number: c.peakCE ?? 0 }
  }
  // Section D only: his ruling, transcribed.
  if (c.ruling) {
    props['Ruling'] = { select: { name: c.ruling } }
    props['Ruling rationale'] = txt(c.rulingRationale)
  }

  const hit = existing.get(c.key)
  if (hit) {
    // Never touch a ruling that already exists — Architect-owned.
    const ruled = hit.properties['Ruling']?.select?.name
    if (ruled && ruled !== 'Not reviewed') { delete props['Ruling']; delete props['Ruling rationale'] }
    if (WRITE) { await api(`pages/${hit.id}`, 'PATCH', { properties: props }); await sleep(340) }
    updated++
  } else {
    if (WRITE) { await api('pages', 'POST', { parent: { database_id: DB }, properties: props }); await sleep(340) }
    created++
  }
  const n = created + updated + skipped
  if (WRITE && n % 25 === 0) console.log(`  ${n}/${all.length}...`)
}

console.log(`\n${WRITE ? 'LOADED' : 'DRY RUN'} — created ${created}, updated ${updated}`)
if (!WRITE) console.log('Add --write to commit.')
else console.log('Architect-owned fields (Ruling, Canonical spelling, Ruling rationale, Ruled on) untouched except Section D transcription.')

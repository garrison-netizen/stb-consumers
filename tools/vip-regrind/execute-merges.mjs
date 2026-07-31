// ============================================================
// EXECUTE the Architect's Merge rulings on
// "VIP Mart B — Duplicate Account Candidates" (ruling complete 2026-07-31,
// channel row 3ae1c57a-c02b-81d3: 199 Merge / 77 Not a merge / 28 NCR / 3 Deferred).
//
// Runs on GARRISON'S AUTHORIZATION, not on the Architect's readiness FYI
// (Doctrine 9). Authorized 2026-07-31.
//
// WRITE SPLIT, unchanged from load-candidates.mjs:
//   ARCHITECT ONLY: Ruling, Canonical spelling, Ruling rationale, Ruled on
//   Code:           Executed, Executor note   (set here, after the gate passes)
//
// Executes ONLY rows reading `Merge`. `Needs canonical read` and `Deferred`
// are explicitly NOT executable and are asserted untouched.
//
// CANONICAL SPELLING IS PRESCRIPTIVE, NOT A SELECTION. 152 of the 199 rulings
// name a string that matches NO live row ("TOTAL WINE & MORE #525" against
// members "TOTAL WINE & SPIRITS 525" / "TOTAL WINE & MORE 525") — the Architect
// is restoring apostrophes and adding city qualifiers. So the survivor is
// chosen by rule and then RENAMED to his spelling.
//
// ⚠ THE RENAME IS ONLY SAFE BECAUSE OF THE ALIAS MAP. The loader resolves raw
// rows by name|address, so a renamed survivor matches nothing: the next run
// would mint fresh rows for both raw spellings AND zero the survivor's YTD as
// a vanished account — three rows where there was one, merge silently undone,
// history stranded on a row labelled Lapsed. This script therefore emits
// pipelines/vip-marts/src/MergedIdentities.gs mapping every member's RAW
// identity to the survivor's account_uid, which Transform.gs findExisting
// consults. Same requirement the Goody Goody merge had, generalized.
// DEPLOY THAT FILE (clasp push) BEFORE OR WITH THIS RUN.
//
// Volumes must not move. Only counts and trajectories change.
//
// Usage:
//   node execute-merges.mjs             # dry run, writes nothing
//   node execute-merges.mjs --write
// ============================================================

import { api, queryAll, plain } from './notion.js'
import { norm, normAddr } from './identity.js'
import fs from 'fs'

const MART_B = 'e75409d7238a49cea390bbfe123bfc45'
const CAND_DB = 'b5208dda63c1433b8ec77a40a83678c3'
const YEARS = [2021, 2022, 2023, 2024, 2025]
const YEAR = 2026
const GROWTH_PCT = 0.10

// From the Architect's completed ruling. If live counts differ, the ruling
// moved under us and this run is against a stale premise — abort.
const EXPECT_MERGE_ROWS = 199
const EXPECT_NOT_EXECUTABLE = { 'Needs canonical read': 28, 'Deferred': 3 }

const WRITE = process.argv.includes('--write')
const round = n => Math.round(n * 10000) / 10000
const num = (p, k) => plain(p.properties[k]) || 0
const sleep = ms => new Promise(r => setTimeout(r, ms))
const txt = s => ({ rich_text: [{ text: { content: String(s ?? '').slice(0, 1900) } }] })

const abort = msg => { console.error(`\nABORT — ${msg}\nNothing written.`); process.exit(1) }

// ---- load the ruled set ------------------------------------------
console.log('Reading candidate rulings...')
const cand = await queryAll(CAND_DB)
console.log(`  ${cand.length} candidate rows`)

const byRuling = {}
for (const p of cand) {
  const r = plain(p.properties['Ruling']) || 'Not reviewed'
  byRuling[r] = (byRuling[r] || 0) + 1
}
console.log('  ' + Object.entries(byRuling).map(([k, v]) => `${k}: ${v}`).join('  |  '))

const merges0 = cand.filter(p => plain(p.properties['Ruling']) === 'Merge')
if (merges0.length !== EXPECT_MERGE_ROWS)
  abort(`expected ${EXPECT_MERGE_ROWS} Merge rulings, found ${merges0.length}. The ruling changed; re-read it before executing.`)
for (const [k, n] of Object.entries(EXPECT_NOT_EXECUTABLE))
  if ((byRuling[k] || 0) !== n)
    abort(`expected ${n} "${k}" rulings, found ${byRuling[k] || 0}. These are NOT executable and the counts must match the ruling.`)

const already = merges0.filter(p => plain(p.properties['Executed']) === true)
if (already.length) console.log(`  ${already.length} already marked Executed — will be skipped`)
const todo = merges0.filter(p => plain(p.properties['Executed']) !== true)

// ---- the generator's cluster membership --------------------------
const j = JSON.parse(fs.readFileSync(new URL('./output/merge-candidates.json', import.meta.url), 'utf8'))
const clusters = new Map()
for (const s of ['sectionA', 'sectionB', 'sectionC', 'sectionD'])
  for (const c of j[s]) clusters.set(c.key, c)
console.log(`  ${clusters.size} clusters in the generator output`)

// ---- live Mart B -------------------------------------------------
console.log('Loading Mart B...')
const rows = await queryAll(MART_B)
const live = new Map(rows.map(p => [p.id, p]))
console.log(`  ${rows.length} rows`)

// Guard carried from every prior step: nothing an earlier step deliberately
// archived may be back in the live table.
try {
  const snap = JSON.parse(fs.readFileSync(new URL('./snapshots/mart-b-pre-goody-merge.json', import.meta.url)))
  const gone = snap.filter(r => !live.has(r.id)).map(r => norm(r.props['Account name']))
  const back = new Set(rows.map(p => norm(plain(p.properties['Account name']))))
  const resurrected = gone.filter(n => back.has(n))
  if (resurrected.length) abort(`${resurrected.length} previously archived spelling(s) are live again: ${resurrected.slice(0, 5).join(', ')}. Investigate before merging.`)
  console.log(`  ${gone.length} row(s) archived by an earlier step, none resurrected`)
} catch (e) {
  if (e.message.startsWith('ABORT')) throw e
  abort(`cannot read snapshots/mart-b-pre-goody-merge.json, so a previously archived row could silently return. (${e.message})`)
}

// ---- resolve each ruled cluster ----------------------------------
const plan = [], problems = []
for (const p of todo) {
  const key = plain(p.properties['Cluster'])
  const canonical = (plain(p.properties['Canonical spelling']) || '').trim()
  const section = plain(p.properties['Section'])
  const c = clusters.get(key)
  if (!c) { problems.push({ key, why: 'cluster key not present in merge-candidates.json' }); continue }

  const members = c.rows.map(r => live.get(r.id)).filter(Boolean)
  if (members.length !== c.rows.length) {
    problems.push({ key, why: `${c.rows.length - members.length} of ${c.rows.length} member row(s) no longer live in Mart B` }); continue
  }
  if (members.length < 2) { problems.push({ key, why: 'fewer than 2 live members' }); continue }

  if (!canonical) { problems.push({ key, why: 'Merge ruled but Canonical spelling is empty — survivor cannot be read' }); continue }

  // Survivor = latest Last active year, then later Peak year, then live 2026
  // volume — the Goody Goody rule, reused deliberately. It keeps the row whose
  // identity the raw feed still produces, so the merge degrades to "matched by
  // its own key" if the alias map is ever missing, rather than to a re-mint.
  const ranked = members.slice().sort((a, b) =>
    (num(b, 'Last active year') - num(a, 'Last active year')) ||
    (num(b, 'Peak year') - num(a, 'Peak year')) ||
    (num(b, 'CE 2026 YTD') - num(a, 'CE 2026 YTD')) ||
    (num(b, 'Peak CE') - num(a, 'Peak CE')))
  const survivor = ranked[0]

  const uid = plain(survivor.properties['account_uid'])
  if (!uid || !uid.trim()) {
    problems.push({ key, why: `survivor "${plain(survivor.properties['Account name'])}" has no account_uid — the alias map could not point at it` }); continue
  }

  plan.push({ candPage: p, key, section, canonical, survivor, uid: uid.trim(),
    absorbed: members.filter(m => m.id !== survivor.id), members })
}

if (problems.length) {
  console.error(`\n${problems.length} ruled cluster(s) could not be resolved:`)
  problems.forEach(x => {
    console.error(`  ${x.key}\n     ${x.why}`)
    if (x.names) x.names.forEach(n => console.error(`       member: "${n}"`))
  })
  abort('every Merge ruling must resolve to exactly one survivor. Escalate the unresolved ones to the Architect rather than guessing.')
}
console.log(`\nResolved ${plan.length} cluster(s), all with a single canonical survivor.`)

// ---- OVERLAP GATE ------------------------------------------------
// A Mart B row appearing in two ruled clusters would be merged twice: its CE
// counted into two survivors, or archived as absorbed while also acting as a
// survivor. Both silently move volume. This cannot be auto-resolved.
const seen = new Map()
const overlaps = []
for (const m of plan) for (const r of m.members) {
  if (seen.has(r.id)) overlaps.push({ id: r.id, name: plain(r.properties['Account name']), a: seen.get(r.id), b: m.key })
  else seen.set(r.id, m.key)
}
if (overlaps.length) {
  console.error(`\n${overlaps.length} row(s) appear in more than one ruled Merge cluster:`)
  overlaps.forEach(o => console.error(`  "${o.name}"\n     in: ${o.a}\n     and: ${o.b}`))
  abort('overlapping clusters would merge a row twice and move volume. Needs the Architect to re-cluster.')
}
console.log(`Overlap gate: ${seen.size} distinct rows across ${plan.length} clusters, no row claimed twice.`)

// ---- compute merged values ---------------------------------------
for (const m of plan) {
  const hist = {}
  for (const y of YEARS) hist[y] = round(m.members.reduce((s, p) => s + num(p, `CE ${y}`), 0))
  const ytd = round(m.members.reduce((s, p) => s + num(p, 'CE 2026 YTD'), 0))
  const sp = round(m.members.reduce((s, p) => s + num(p, 'CE 2025 same-period'), 0))

  // Trajectory per the live pipeline's derive() (Transform.gs), recomputed on
  // the merged series — recovering the true trajectory is the point of this.
  const hasPrior = YEARS.some(y => hist[y] > 0)
  const spPrior = sp > 0
  let status
  if (ytd > 0) {
    if (!hasPrior && !spPrior) status = `New ${YEAR}`
    else if (sp > 0) {
      const g = (ytd - sp) / sp
      status = g > GROWTH_PCT ? 'Growing' : g < -GROWTH_PCT ? 'Declining' : 'Steady'
    } else status = 'Growing'
  } else {
    status = (hasPrior || spPrior)
      ? ((hist[2025] > 0 || spPrior) ? `Lapsed ${YEAR}` : 'Lapsed earlier')
      : 'Never material'
  }

  let peakCE = null, peakYear = null
  for (const y of YEARS) if (hist[y] > 0 && (peakCE === null || hist[y] > peakCE)) { peakCE = hist[y]; peakYear = y }
  if (ytd > 0 && (peakCE === null || ytd > peakCE)) { peakCE = ytd; peakYear = YEAR }
  const active = YEARS.filter(y => hist[y] > 0)
  if (ytd > 0) active.push(YEAR)

  const props = {}
  // The Architect's canonical spelling. Safe only alongside MergedIdentities.gs.
  if (norm(plain(m.survivor.properties['Account name'])) !== norm(m.canonical))
    props['Account name'] = { title: [{ text: { content: m.canonical.slice(0, 1900) } }] }
  for (const y of YEARS) props[`CE ${y}`] = { number: hist[y] }
  props['CE 2026 YTD'] = { number: ytd }
  props['CE 2025 same-period'] = { number: sp }
  props['Current YoY delta'] = { number: round(ytd - sp) }
  props['Trajectory Status'] = { select: { name: status } }
  props['Peak CE'] = { number: peakCE }
  props['Peak year'] = { number: peakYear }
  props['First active year'] = { number: active.length ? Math.min(...active) : null }
  props['Last active year'] = { number: active.length ? Math.max(...active) : null }

  Object.assign(m, { props, status, peakCE, peakYear, ytd })
  m.before = m.members.map(p => ({
    name: plain(p.properties['Account name']),
    traj: plain(p.properties['Trajectory Status']),
    peak: num(p, 'Peak CE'), ce25: num(p, 'CE 2025'), ce26: num(p, 'CE 2026 YTD')
  }))
}

const absorbedTotal = plan.reduce((s, m) => s + m.absorbed.length, 0)
console.log(`\nMerges planned: ${plan.length}   rows absorbed: ${absorbedTotal}   (${rows.length} -> ${rows.length - absorbedTotal})`)
console.log(`  by section: ` + Object.entries(plan.reduce((a, m) => (a[m.section] = (a[m.section] || 0) + 1, a), {})).map(([k, v]) => `${k} ${v}`).join('  '))

const show = process.argv.includes('--verbose') ? plan : plan.slice(0, 12)
for (const m of show) {
  console.log(`\n  ${m.key}`)
  m.before.forEach(b => console.log(`     was: "${b.name}"  ${b.traj}  peak ${b.peak}  CE25 ${b.ce25}  CE26 ${b.ce26}`))
  console.log(`     now: "${m.canonical}"  ${m.status}  peak ${m.peakCE} (${m.peakYear})  CE26 ${m.ytd}`)
}
if (!process.argv.includes('--verbose') && plan.length > show.length)
  console.log(`\n  ... ${plan.length - show.length} more (use --verbose)`)

// ---- trajectory-corruption summary -------------------------------
const fixed = plan.filter(m => m.before.some(b => b.traj === 'Lapsed earlier' || b.traj === 'Lapsed 2026') &&
  !String(m.status).startsWith('Lapsed'))
console.log(`\nTrajectory corrections: ${fixed.length} account(s) leave a lapsed state once their history is whole.`)
const winBack = fixed.filter(m => m.ytd > 0)
console.log(`  of those, ${winBack.length} have live 2026 volume — they were never lost.`)

// ---- ACCEPTANCE: volumes must not move ---------------------------
console.log('\nAcceptance:')
let fail = false
const touched = new Set(plan.flatMap(m => m.members.map(r => r.id)))
for (const col of [...YEARS.map(y => `CE ${y}`), 'CE 2026 YTD', 'CE 2025 same-period']) {
  const before = round(rows.reduce((s, p) => s + num(p, col), 0))
  let after = round(rows.filter(p => !touched.has(p.id)).reduce((s, p) => s + num(p, col), 0))
  for (const m of plan) after += (m.props[col]?.number || 0)
  after = round(after)
  const ok = Math.abs(after - before) < 0.01
  if (!ok) fail = true
  console.log(`  ${col.padEnd(22)} ${before.toFixed(4).padStart(12)} -> ${after.toFixed(4).padStart(12)}  ${ok ? 'UNCHANGED' : 'MOVED — FAIL'}`)
}
const rowsAfter = rows.length - absorbedTotal
console.log(`  ${'row count'.padEnd(22)} ${String(rows.length).padStart(12)} -> ${String(rowsAfter).padStart(12)}  (${absorbedTotal} absorbed)`)

if (fail) abort('ACCEPTANCE FAILED — volume moved.')
console.log('\nAll gates green.')

// ---- emit the loader alias map -----------------------------------
// Written on dry run too, so it can be deployed BEFORE the merges land.
// Harmless pre-merge: every raw identity still matches its own row on the
// loader's first path, so the alias never fires until the rename makes it need to.
{
  const cityQ = new Map(), plainK = new Map(), ambiguous = new Set()
  for (const m of plan) for (const r of m.members) {
    const name = plain(r.properties['Account name'])
    const addr = plain(r.properties['Address'])
    const city = plain(r.properties['City'])
    const k = `${norm(name)}|${normAddr(addr)}`
    cityQ.set(`${k}|${norm(city)}`, m.uid)
    if (plainK.has(k) && plainK.get(k) !== m.uid) ambiguous.add(k)
    else plainK.set(k, m.uid)
  }
  for (const k of ambiguous) plainK.delete(k)

  const entries = [...[...cityQ].map(([k, v]) => [k, v]), ...[...plainK].map(([k, v]) => [k, v])]
  const body = entries.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')
  const gs = `// GENERATED by tools/vip-regrind/execute-merges.mjs — DO NOT HAND-EDIT.
//
// Adjudicated duplicate-account merges: raw VIP identity -> surviving Mart B
// account_uid. Consulted by VM_mergedSurvivorUid_ (Data.gs) from findExisting.
//
// Why this file exists: the loader resolves accounts by name|address. A merged
// account's absorbed spelling no longer matches any row, and the survivor is
// renamed to the Architect's canonical spelling, which matches no raw row
// either. Without this map the next run re-mints both raw spellings as new
// rows and zeroes the survivor as a vanished account — the merge undone, the
// history stranded, the account count inflated.
//
// Source of truth is the Architect's ruling on "VIP Mart B — Duplicate Account
// Candidates"; regenerate rather than edit. Keys are city-qualified first with
// an unqualified fallback emitted only where unambiguous.
//
// Clusters: ${plan.length}   raw identities mapped: ${cityQ.size}   generated ${new Date().toISOString().slice(0, 10)}

var VM_MERGED_IDENTITIES_ = {
${body}
};
`
  const out = new URL('../../pipelines/vip-marts/src/MergedIdentities.gs', import.meta.url)
  fs.writeFileSync(out, gs)
  console.log(`\nAlias map: ${cityQ.size} city-qualified + ${plainK.size} unqualified key(s) -> ${plan.length} survivors`)
  console.log(`  written to pipelines/vip-marts/src/MergedIdentities.gs`)
  console.log(`  ⚠ clasp push this BEFORE the next pipeline run or the merges will be undone.`)
}

if (!WRITE) { console.log('\nDRY RUN — no writes to Notion. Re-run with --write.'); process.exit(0) }

// ---- apply -------------------------------------------------------
fs.writeFileSync(new URL('./snapshots/mart-b-pre-merge-executor.json', import.meta.url),
  JSON.stringify(rows.map(p => ({ id: p.id, props: Object.fromEntries(
    Object.entries(p.properties).map(([k, v]) => [k, plain(v)]) ) })), null, 1))
console.log(`\nSnapshot: ${rows.length} rows -> snapshots/mart-b-pre-merge-executor.json`)

let done = 0, failed = 0
for (const m of plan) {
  try {
    await api(`pages/${m.survivor.id}`, 'PATCH', { properties: m.props })
    for (const a of m.absorbed) { await api(`pages/${a.id}`, 'PATCH', { archived: true }); await sleep(340) }
    await sleep(340)
    done++
  } catch (e) {
    failed++
    m.failedWrite = true
    console.error(`  FAILED ${m.key}: ${e.message}`)
    await api(`pages/${m.candPage.id}`, 'PATCH', { properties: {
      'Executor note': txt(`FAILED ${new Date().toISOString().slice(0, 10)}: ${e.message}`.slice(0, 1900)) } }).catch(() => {})
    continue
  }
  if (done % 25 === 0) console.log(`  ${done}/${plan.length} merged...`)
}
console.log(`\nMerged ${done} cluster(s), ${failed} failed.`)

// ---- audit fields on the candidate rows --------------------------
// Written only after the merge itself succeeded, so Executed never claims
// more than happened.
console.log('Writing Executed + Executor note...')
const stamp = new Date().toISOString().slice(0, 10)
let marked = 0
for (const m of plan) {
  if (m.failedWrite) continue
  const note = `Executed ${stamp} by Code (Machine A). Survivor "${m.canonical}", ` +
    `${m.absorbed.length} row(s) absorbed. Volume-unchanged gate PASSED across all six CE columns ` +
    `plus 2025 same-period. Trajectory recomputed on the merged series: ${m.status}.`
  try {
    await api(`pages/${m.candPage.id}`, 'PATCH', { properties: { 'Executed': { checkbox: true }, 'Executor note': txt(note) } })
    marked++
    await sleep(340)
  } catch (e) { console.error(`  note failed on ${m.key}: ${e.message}`) }
}
console.log(`\nDone. ${done} merged, ${marked} candidate row(s) stamped.`)
console.log('Verify by independent re-query (mart-state.mjs) before reporting.')

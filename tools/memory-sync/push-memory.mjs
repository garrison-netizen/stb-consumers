// Delta-push memory .md files to the Code Memory Store via the Notion REST API.
// Avoids round-tripping large bodies through the tool layer.
//   node push-memory.mjs <file.md> [file2.md ...] [--write]
// Machine tag derived from USERNAME (garrison -> Machine A, garri -> Machine B).

import { api } from './notion.js'
import fs from 'fs'
import path from 'path'

const MEM_DS = '77fca85d-f6ef-426d-8451-5d2e05b37b80' // database id (NOT the collection:// ds id)
const WRITE = process.argv.includes('--write')
const files = process.argv.slice(2).filter(a => a.endsWith('.md'))
const MACHINE = process.env.USERNAME === 'garri' ? 'Machine B' : 'Machine A'
const TODAY = new Date(Date.now()).toISOString().slice(0, 10)

// Notion rich_text caps at 2000 chars per object — chunk long bodies.
const chunk = s => {
  const out = []
  for (let i = 0; i < s.length; i += 1900) out.push({ text: { content: s.slice(i, i + 1900) } })
  return out.length ? out : [{ text: { content: '' } }]
}

function parse(file) {
  const raw = fs.readFileSync(file, 'utf8')
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!m) throw new Error(`${file}: no frontmatter`)
  const fm = m[1], body = m[2].replace(/^\s+/, '')
  const g = k => {
    const r = new RegExp(`^\\s*${k}:\\s*(.*)$`, 'm').exec(fm)
    return r ? r[1].trim().replace(/^["']|["']$/g, '') : null
  }
  return { name: g('name'), description: g('description'), type: g('type'), body }
}

for (const f of files) {
  const e = parse(f)
  if (!e.name || !e.type) { console.log(`SKIP ${f} — missing name/type`); continue }
  const q = await api(`databases/${MEM_DS}/query`, 'POST', {
    filter: { property: 'Name', title: { equals: e.name } }, page_size: 5
  })
  const props = {
    'Description': { rich_text: chunk(e.description || '') },
    'Body': { rich_text: chunk(e.body) },
    'Type': { select: { name: e.type } },
    'Source machine': { select: { name: MACHINE } },
    'Last synced': { date: { start: TODAY } }
  }
  if (q.results.length) {
    const row = q.results[0]
    const existing = (row.properties.Body?.rich_text || []).map(t => t.plain_text).join('')
    if (!e.body.trim() && existing.trim()) { console.log(`REFUSED ${e.name} — would push empty over ${existing.length} chars`); continue }
    console.log(`${WRITE ? 'UPDATE' : 'would update'}  ${e.name}  (${existing.length} -> ${e.body.length} chars)`)
    if (WRITE) await api(`pages/${row.id}`, 'PATCH', { properties: props })
  } else {
    props['Name'] = { title: [{ text: { content: e.name } }] }
    props['Status'] = { select: { name: 'Active' } }
    props['Load at startup'] = { checkbox: true }
    console.log(`${WRITE ? 'CREATE' : 'would create'}  ${e.name}  (${e.body.length} chars)`)
    if (WRITE) await api('pages', 'POST', { parent: { database_id: MEM_DS }, properties: props })
  }
}
console.log(WRITE ? 'Done.' : 'DRY RUN — add --write.')

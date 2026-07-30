// Minimal Notion API client for the Mart A regrind.
import fs from 'fs'

const envPath = 'C:/Users/garrison/stb-exec-console/.env'
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
export const TOKEN = env.NOTION_TOKEN

export async function api(path, method = 'GET', body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.notion.com/v1/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    })
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 5) throw new Error(`${res.status} after retries on ${path}`)
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      continue
    }
    const j = await res.json()
    if (!res.ok) throw new Error(`${res.status} ${path}: ${j.message || JSON.stringify(j).slice(0, 300)}`)
    return j
  }
}

export async function queryAll(dsId, filter) {
  const out = []
  let cursor
  do {
    const body = { page_size: 100 }
    if (cursor) body.start_cursor = cursor
    if (filter) body.filter = filter
    const j = await api(`databases/${dsId}/query`, 'POST', body)
    out.push(...j.results)
    cursor = j.has_more ? j.next_cursor : null
  } while (cursor)
  return out
}

export function plain(prop) {
  if (!prop) return null
  switch (prop.type) {
    case 'number': return prop.number
    case 'title': return (prop.title || []).map(t => t.plain_text).join('')
    case 'rich_text': return (prop.rich_text || []).map(t => t.plain_text).join('')
    case 'select': return prop.select ? prop.select.name : null
    case 'checkbox': return prop.checkbox
    default: return null
  }
}

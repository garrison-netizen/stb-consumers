// Airport-cluster flag rebuild — Architect-approved rule (2026-07-29):
//   Hobby = address starts "7800 AIRPORT BLVD" AND carries a HOUF code
//   Bush  = Houston address on TERMINAL RD/ROAD/WAY in the 3100–3999 range
//   Everything else loses the flag. CITY KITCHEN (8101 Airport Blvd) stays
//   unflagged. The old flag matched the WORD "airport" in the street
//   address, sweeping in Austin/Bedford/Richmond/Stafford/Sugar Land
//   street names.
// Usage: node rebuild-airport-flag.mjs [--write]

import { api, queryAll, plain } from './notion.js'
const MART_B = 'e75409d7238a49cea390bbfe123bfc45'
const WRITE = process.argv.includes('--write')

const isHobby = a => /^7800 AIRPORT BLVD/i.test(a) && /HOUF/i.test(a)
const isBush = (a, city) => /HOUSTON/i.test(city || '') &&
  /\bTERMINAL (RD|ROAD|WAY|B\b)/i.test(a) && /\b3[1-9]\d{2}\b/.test(a)

const rows = await queryAll(MART_B)
const changes = []
for (const p of rows) {
  const addr = String(plain(p.properties['Address']) || '')
  const city = plain(p.properties['City'])
  const cur = !!plain(p.properties['Airport cluster'])
  const want = isHobby(addr) || isBush(addr, city)
  if (cur !== want) changes.push({ id: p.id, name: plain(p.properties['Account name']), city, addr, cur, want })
}
console.log(`Flag currently set: ${rows.filter(p => plain(p.properties['Airport cluster'])).length}`)
console.log(`Changes needed: ${changes.length}`)
changes.forEach(c => console.log(`  ${c.want ? 'SET  ' : 'CLEAR'}  ${c.name} — ${c.city} — ${c.addr}`))
if (!WRITE) { console.log('\nDRY RUN — re-run with --write.'); process.exit(0) }
for (const c of changes) {
  await api(`pages/${c.id}`, 'PATCH', { properties: { 'Airport cluster': { checkbox: c.want } } })
}
console.log(`Applied ${changes.length} flag changes.`)

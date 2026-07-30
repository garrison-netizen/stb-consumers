// ============================================================
// Account identity canonicalization, shared by the Mart B tools.
//
// Extracted from repair-mart-b.mjs (2026-07-30) with behaviour
// unchanged. It lives here because the Step 3 spine expansion is
// only correct if "absent from Mart B" means EXACTLY what it meant
// during the Step 1 value repair — the 56-row / 1,005.9 CE figures
// the Architect released against are the complement of the set
// repair-mart-b.mjs matched. Two near-identical copies of this
// normalization drifting apart would silently change that set.
//
// Mirrors VM_identityKey_ / VM_normAddr_ in the GAS pipeline
// (pipelines/vip-marts/src/Data.gs) closely enough for the same
// accounts to match; the pipeline stays the authority for live runs.
// ============================================================

export const norm = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim()

const SUFFIX = {
  STREET: 'ST', ROAD: 'RD', AVENUE: 'AVE', BOULEVARD: 'BLVD', PARKWAY: 'PKWY',
  HIGHWAY: 'HWY', DRIVE: 'DR', LANE: 'LN', COURT: 'CT', PLACE: 'PL',
  EXPRESSWAY: 'EXPWY', FREEWAY: 'FWY', COUNTRY: 'COUNTY'
}

export function normAddr(s) {
  let t = norm(s).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  t = t.replace(/\b(STE|SUITE|UNIT|BLDG|BUILDING|SPACE|APT)\b\s*[A-Z0-9-]*/g, ' ')
  return t.split(' ').map(w => SUFFIX[w] || w)
    .filter(w => w && !(w.length === 1 && 'NSEW'.includes(w))).join(' ')
}

export const idKey = (n, a) => `${norm(n)}|${normAddr(a)}`

// ---- Chain store-number identity (Architect merge rule, 2026-07-30) ----
//
// VIP changed its naming convention for the Goody Goody chain partway
// through the series. The name+address key read the rename as churn, so
// every store in the chain has its history SEVERED at the rename: the
// pre-rename years sit on a row that looks long-dead and the post-rename
// years on a row that looks new and small. #44 is the clearest case —
// "GOODY GOODY 44" files as Lapsed earlier while "GOODY GOODY LIQUOR #44"
// is Growing with 7 CE in 2026. Same store, half of it filed as dead.
//
// The store number survives every spelling, so it is the key. Address
// does NOT work for this class: #12 reads "1950 JUSTIN RD" against
// "1950 FM 407 E." — in Highland Village, Justin Road IS FM 407, and no
// address canonicaliser will ever catch that.
//
// Forms covered:  GOODY GOODY {n} · GOODY GOODY {n} - STORE
//                 GOODY GOODY - 0?{n} - {LOC} · GOODY GOODY BUCKEYE - {n} - {LOC}
//                 GOODY GOODY LIQUOR #{n}
// Returns e.g. "GOODY GOODY#15", or null when the name is not in the chain.
export function chainStoreKey(name) {
  const n = norm(name)
  const m = /^GOODY GOODY\b(.*)$/.exec(n)
  if (!m) return null
  const d = /(\d+)/.exec(m[1])
  if (!d) return null
  return `GOODY GOODY#${parseInt(d[1], 10)}`
}

// Token-overlap similarity of two canonical addresses (0..1).
// Mirrors VM_addrOverlap_ in pipelines/vip-marts/src/Data.gs.
export function addrOverlap(a, b) {
  const A = normAddr(a).split(' '), B = normAddr(b).split(' ')
  const setB = new Set(B)
  let inter = 0
  for (const t of A) if (setB.has(t)) { inter++; setB.delete(t) }
  const union = A.length + B.length - inter
  return union ? inter / union : 0
}

// The live pipeline's identity resolution (VM_computeMartB_ findExisting):
// exact canonical key first, then a name|city fallback for rows whose
// address VIP re-spelled beyond canonicalization — but ONLY when that
// name|city is unambiguous AND the addresses still overlap, so two
// same-named locations in one city never merge.
//
// This matters for the spine expansion specifically: without the
// fallback, "MIDWAY MART / 406 W HICKORY ST" reads as absent when
// "MIDWAY MART / 406 WEST HICKORY" is already in Mart B, and the
// expansion would mint a duplicate rather than skip it.
export function buildResolver(rows, getName, getAddr, getCity) {
  const byKey = new Map()
  const byNameCity = new Map()
  for (const r of rows) {
    const k = idKey(getName(r), getAddr(r))
    if (!byKey.has(k)) byKey.set(k, r)
    const nc = `${norm(getName(r))}|${norm(getCity(r))}`
    if (!byNameCity.has(nc)) byNameCity.set(nc, r)
    else byNameCity.set(nc, null)   // null = ambiguous, never fall back
  }
  return function findExisting(name, address, city) {
    const hit = byKey.get(idKey(name, address))
    if (hit) return { row: hit, how: 'key' }
    const nc = byNameCity.get(`${norm(name)}|${norm(city)}`)
    if (nc && addrOverlap(address, getAddr(nc)) >= 0.5) return { row: nc, how: 'name-city' }
    return null
  }
}

// Full-year rollup column in the frozen raw account_detail year DBs.
export const ceCol = y => `12 Months 1/1/${y} thru 12/31/${y}  Case Equivs`

// VIP bookkeeping allocation rows are not retail accounts (Architect
// ruling 2026-07-21) — excluded from Mart B entirely. Their CE still
// reaches Mart A via the distributor matrix.
export const isPseudo = name => norm(name) === 'OPEN' || norm(name).indexOf('OPEN |') === 0

// Airport cluster, per the Architect-approved rule (2026-07-29):
//   Hobby = "7800 AIRPORT BLVD" prefix AND a HOUF code
//   Bush  = Houston address on TERMINAL RD/ROAD/WAY, 3100-3999
// Everything else is unflagged; CITY KITCHEN (8101 Airport Blvd) in
// particular stays off.
export const isHobby = a => /^7800 AIRPORT BLVD/i.test(a) && /HOUF/i.test(a)
export const isBush = (a, city) => /HOUSTON/i.test(city || '') &&
  /\bTERMINAL (RD|ROAD|WAY|B\b)/i.test(a) && /\b3[1-9]\d{2}\b/.test(a)
export const isAirport = (a, city) => isHobby(a) || isBush(a, city)

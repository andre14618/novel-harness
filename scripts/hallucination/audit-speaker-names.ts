/**
 * Audit speaker-name patterns in scenarios-draft.ts.
 *
 * Classifies every speaker key by shape (single-name, First Last, Title +
 * First Last, Multi-Title + First Last, etc.) and reports which scenarios
 * would have NO usable First Last speaker after title stripping.
 *
 * A scenario is "clean" iff at least one speaker has a bare `First Last`
 * personal name (after stripping honorific titles). FAIL_FIRST_NEW_LAST and
 * PASS_LAST_NAME_ALIAS variants require this shape.
 */

import { SCENARIOS } from "./scenarios-draft"

// Title allowlist — any leading token matching these is stripped before
// parsing the personal name. Case-sensitive; first token of speaker key.
const TITLES = new Set([
  // Nobility
  "Lord", "Lady", "Sir", "Dame", "King", "Queen", "Prince", "Princess",
  "Count", "Countess", "Duke", "Duchess", "Baron", "Baroness", "Earl", "Margrave",
  "Viscount", "Viscountess", "Archduke", "Emperor", "Empress",
  // Military / police / security
  "Captain", "Commander", "Lieutenant", "Sergeant", "General", "Admiral",
  "Marshal", "Major", "Colonel", "Corporal", "Private", "Sheriff", "Deputy",
  "Officer", "Inspector", "Detective", "Chief", "Warden", "Guard", "Agent",
  "Operator", "Pilot", "Constable", "Magistrate", "Centurion", "Tribune",
  // Religious
  "Bishop", "Priest", "Deacon", "Abbot", "Abbess", "Monk", "Nun", "Brother",
  "Sister", "Mother", "Father", "Chaplain", "Pope", "Cardinal", "Oracle",
  // Academic / professional
  "Doctor", "Dr.", "Dr", "Professor", "Master", "Mistress", "Porter",
  "Scholar", "Archivist", "Librarian", "Keeper", "Steward",
  // Magical / fictional titles
  "Seer", "Elder", "Sage", "Chancellor", "Witness", "Witch", "Warlock",
  "Healer", "Ranger", "Knight", "Squire", "Bard", "Mage", "Wizard",
  "Liche-Speaker", "Speaker",
  // Gaming
  "Raid", "Leader", "DPS", "Tank", "Support", "Healer",
  // Corporate / modern
  "CEO", "CTO", "CFO", "Director", "Manager",
])

function stripTitles(name: string): string[] {
  const parts = name.split(/\s+/)
  let i = 0
  while (i < parts.length && TITLES.has(parts[i]!)) i++
  return parts.slice(i)
}

function canonicalFirstLast(name: string): { first: string; last: string } | null {
  const residual = stripTitles(name)
  if (residual.length < 2) return null
  // Take the last two residual tokens — handles "Yun Sael" (2), "Mavet Osel" (2),
  // and hyphenated last-name cases where author used space accidentally.
  return {
    first: residual[residual.length - 2]!,
    last: residual[residual.length - 1]!,
  }
}

interface AuditRow {
  scenarioId: string
  speakers: Array<{
    raw: string
    parts: number
    residualAfterTitles: string[]
    canonical: { first: string; last: string } | null
  }>
  hasCleanFirstLast: boolean
}

const rows: AuditRow[] = []
const badScenarios: string[] = []

for (const s of SCENARIOS) {
  const speakers = Object.keys(s.speakers).map(raw => {
    const residual = stripTitles(raw)
    const canonical = canonicalFirstLast(raw)
    return { raw, parts: raw.split(/\s+/).length, residualAfterTitles: residual, canonical }
  })
  const hasCleanFirstLast = speakers.some(sp => sp.canonical !== null)
  rows.push({ scenarioId: s.id, speakers, hasCleanFirstLast })
  if (!hasCleanFirstLast) badScenarios.push(s.id)
}

// ── Distribution report ───────────────────────────────────────────────────

const speakerCount = rows.reduce((n, r) => n + r.speakers.length, 0)
const titledSpeakerCount = rows.reduce(
  (n, r) => n + r.speakers.filter(sp => sp.parts > sp.residualAfterTitles.length).length, 0,
)
const residualShapeTally: Record<string, number> = {}
for (const r of rows) for (const sp of r.speakers) {
  const shape = sp.residualAfterTitles.length === 0 ? "0-all-title"
    : sp.residualAfterTitles.length === 1 ? "1-mononym"
    : sp.residualAfterTitles.length === 2 ? "2-First-Last"
    : `${sp.residualAfterTitles.length}-multi`
  residualShapeTally[shape] = (residualShapeTally[shape] ?? 0) + 1
}

console.log(`Total scenarios: ${SCENARIOS.length}`)
console.log(`Total speakers: ${speakerCount}`)
console.log(`Speakers with title prefix: ${titledSpeakerCount} (${(titledSpeakerCount / speakerCount * 100).toFixed(0)}%)`)
console.log(`\nResidual shape after title stripping:`)
for (const [shape, n] of Object.entries(residualShapeTally).sort()) {
  console.log(`  ${shape}: ${n}`)
}

console.log(`\nScenarios with NO usable First Last speaker after stripping: ${badScenarios.length}`)
for (const id of badScenarios) {
  const r = rows.find(x => x.scenarioId === id)!
  console.log(`  ${id}`)
  for (const sp of r.speakers) {
    console.log(`    ${sp.raw.padEnd(40)} → residual: [${sp.residualAfterTitles.join(", ")}]`)
  }
}

// Also report a sample of titled speakers to validate stripping
console.log(`\nSample: 15 titled speakers and their canonical personal names:`)
let shown = 0
for (const r of rows) {
  for (const sp of r.speakers) {
    if (shown >= 15) break
    if (sp.parts > sp.residualAfterTitles.length && sp.canonical) {
      console.log(`  ${sp.raw.padEnd(40)} → ${sp.canonical.first} ${sp.canonical.last}`)
      shown++
    }
  }
  if (shown >= 15) break
}

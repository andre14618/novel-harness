/**
 * Build a natural-distribution leak val from the v1 natural val set.
 *
 * Scans `halluc-checker-v1-val.jsonl` for beats whose expected `issues[]`
 * include any token from the Salvatore §A leak list (case-insensitive).
 * Converts each to the leak-adapter schema: prose-only user content +
 * {has_leak, leaks[]} assistant label.
 *
 * Also pulls clean negative beats (v1 expected pass=true with no leak
 * mentioned) so we get a reasonable pos/neg balance.
 *
 * Output: finetune-data/halluc-leak-salvatore-natural-val.jsonl
 */

import { readFileSync, writeFileSync } from "fs"
import { regexLeakMatches } from "../../src/agents/halluc-leak-salvatore/regex-leak"
import injectionPools from "./injection-pools.json"

// Benign injection-pool tokens that must NEVER auto-label as leak. The
// previous builder used case-insensitive substring `.includes()` against a
// hand-maintained list that included generic one-token names like
// "Cassius" (also in the benign characterNames pool) and raw words like
// "drow" (substring-matched "drowsy" / "drown" / "crowded"). Clean
// synthetic prose got marked leak-positive, rewarding the detector for
// overfiring. Codex audit finding 2026-04-21.
//
// Fix: (1) delegate detection to `regexLeakMatches` so we inherit
// inference-time word-boundary semantics; (2) post-filter any hit whose
// exact lowercase form collides with a benign injection pool, logging the
// drop so the filter stays auditable.
const BENIGN_NAMES = new Set<string>([
  ...injectionPools.characterNames.map((n: string) => n.toLowerCase()),
  ...injectionPools.realWorldRefs.map((n: string) => n.toLowerCase()),
])

function findLeaks(prose: string): { kept: string[]; dropped: string[] } {
  const raw = regexLeakMatches(prose)
  const kept: string[] = []
  const dropped: string[] = []
  const seen = new Set<string>()
  for (const token of raw) {
    const key = token.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (BENIGN_NAMES.has(key)) dropped.push(token)
    else kept.push(token)
  }
  return { kept, dropped }
}

function extractProse(userContent: string): string {
  const m = userContent.match(/PROSE TO CHECK:\n([\s\S]+)$/)
  return m ? m[1]!.trim() : userContent
}

const LEAK_SYSTEM = `You are a corpus-leak detector for generated fiction beats.

Given prose, identify any token that belongs to R.A. Salvatore's Icewind Dale / Forgotten Realms vocabulary — character names, places, items, races, or distinctive naming patterns that should never appear in a non-Salvatore novel.

Examples of leak tokens (case-insensitive):
Characters: Drizzt, Bruenor, Wulfgar, Regis, Catti-brie, Entreri, Jarlaxle, Zaknafein, Guenhwyvar, Akar Kessell, Dendybar, Pasha Pook, Deudermont, Rumblebelly.
Places: Mithril Hall, Mithral Hall, Icewind Dale, Ten-Towns, Bryn Shander, Termalaine, Easthaven, Luskan, Silverymoon, Calimport, Maer Dualdon, Kelvin's Cairn, Cryshal-Tirith, Faerûn, Sword Coast, Forgotten Realms.
Items: Crystal Shard, Crenshinibon, Aegis-fang, Twinkle, Icingdeath, Taulmaril.
Races: drow, verbeeg, duergar, svirfneblin.
Naming patterns: Do'Urden suffix, Battlehammer surname.

Output ONLY valid JSON:
{"has_leak": bool, "leaks": ["token1", "token2", ...]}

Empty leaks array if has_leak is false. Grounded-context checks are NOT in scope for this checker — a separate adapter handles ungrounded-named-entity detection.`

const NATURAL_PATH = "finetune-data/halluc-checker-v1-val.jsonl"
const OUT = "finetune-data/halluc-leak-salvatore-natural-val.jsonl"

const lines = readFileSync(NATURAL_PATH, "utf8").trim().split("\n")
const pairs = lines.map(l => JSON.parse(l))
console.log(`Scanning ${pairs.length} natural val pairs for leak tokens...`)

let positives = 0, negatives = 0
const out: any[] = []
const droppedCounts: Record<string, number> = {}

for (let i = 0; i < pairs.length; i++) {
  const p = pairs[i]
  const userContent = p.messages[1].content
  const prose = extractProse(userContent)
  const { kept: detectedLeaks, dropped } = findLeaks(prose)
  for (const d of dropped) droppedCounts[d] = (droppedCounts[d] ?? 0) + 1

  const hasLeak = detectedLeaks.length > 0

  out.push({
    messages: [
      { role: "system", content: LEAK_SYSTEM },
      { role: "user", content: `PROSE:\n${prose}` },
      { role: "assistant", content: JSON.stringify({ has_leak: hasLeak, leaks: detectedLeaks }) },
    ],
    _meta: {
      source_idx: i,
      has_leak: hasLeak,
      leaks: detectedLeaks,
      dropped_benign_overlaps: dropped,
      from: "v1_natural_val",
    },
  })

  if (hasLeak) positives++
  else negatives++
}

writeFileSync(OUT, out.map(r => JSON.stringify(r)).join("\n") + "\n")
console.log(`Wrote ${OUT}: ${positives} positive (has_leak) + ${negatives} negative = ${out.length} total`)

// Sample leak entities found
const leakCounts: Record<string, number> = {}
for (const r of out) {
  for (const l of r._meta.leaks) leakCounts[l] = (leakCounts[l] ?? 0) + 1
}
console.log("\nLeak term frequency in natural val:")
for (const [term, n] of Object.entries(leakCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${term}: ${n}`)
}

if (Object.keys(droppedCounts).length > 0) {
  console.log("\nDropped (benign-pool overlap — would have auto-labeled positive under old substring matcher):")
  for (const [term, n] of Object.entries(droppedCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${term}: ${n}`)
  }
}

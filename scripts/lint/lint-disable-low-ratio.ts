/**
 * Disable lint patterns with low AI/human ratio (<1.5).
 *
 * Based on baseline calibration (scripts/lint-baseline.ts, 2026-04-04):
 * 221k words published fiction (Christie, Cather) vs 254k words AI prose.
 *
 * Patterns that fire equally or more on human prose are not AI tells —
 * they're general style advice that erodes linter credibility.
 */

import db from "../../src/db/connection"

// Pattern IDs to disable, identified from baseline calibration output.
// We match by substring of the pattern regex since IDs may differ across environments.
const TO_DISABLE: { match: string; reason: string }[] = [
  // SAID_BOOKISM — exclaimed, murmured, etc (0.3x ratio)
  { match: "exclaimed|proclaimed", reason: "0.3x — normal dialogue tags in published fiction" },
  // SAID_BOOKISM — said softly/loudly (0.3x)
  { match: "said\\s+(softly|loudly", reason: "0.3x — normal dialogue" },
  // SAID_BOOKISM — said+adverb after tag (0.6x)
  { match: "said|asked|replied|answe", reason: "0.6x — normal dialogue mechanics" },
  // HEDGE — perhaps/maybe (0.9x)
  { match: "(perhaps|maybe)", reason: "0.9x — normal English" },
  // HEDGE — sort/kind of (0.4x)
  { match: "(sort|kind)\\s+of", reason: "0.4x — normal speech" },
  // HEDGE — somehow/somewhat (0.2x)
  { match: "(somehow|somewhat)", reason: "0.2x — normal English" },
  // HEDGE — it/there seemed (0.2x)
  { match: "(it|there)\\s+seemed", reason: "0.2x — normal narration" },
  // HEDGE — a certain/some kind (0.2x)
  { match: "a\\s+certain|some\\s+kind", reason: "0.2x — normal English" },
  // HEDGE — it was as though/if (0.2x)
  { match: "it\\s+was\\s+as\\s+(though|if)", reason: "0.2x — normal comparison" },
  // HEDGE — almost as if (0x both)
  { match: "almost\\s+as\\s+if", reason: "0x hits on both corpora" },
  // FILTER — seemed to (0.3x)
  { match: "seemed\\s+to", reason: "0.3x — common in published fiction" },
  // FILLER — began/started/continued (0.4x)
  { match: "began|started|continued", reason: "0.4x — common in published fiction" },
  // FILLER — the fact that (0.2x)
  { match: "the fact that", reason: "0.2x — normal English" },
  // FILLER — in order to (0x AI)
  { match: "in order to", reason: "0x AI — already avoided" },
  // FILLER — due to the fact that (0x both)
  { match: "due to the fact", reason: "0x both corpora" },
  // EMPTY_TRANSITION — And then (0.3x)
  { match: "And then", reason: "0.3x — common transition" },
  // EMPTY_TRANSITION — After that (0.2x)
  { match: "After th", reason: "0.2x — common transition" },
  // REDUNDANT_BODY — sat down (0.1x)
  { match: "sat\\s+down", reason: "0.1x — normal action" },
  // REDUNDANT_BODY — shrugged shoulders (0x AI)
  { match: "shrugged\\s+(his|her|their)", reason: "0x AI — already avoided" },
  // REDUNDANT_BODY — nodded head (0x AI)
  { match: "nodded\\s+(his|her|their)", reason: "0x AI — already avoided" },
  // REDUNDANT_ADVERB — murmured softly (0x both)
  { match: "murmured\\s+softly", reason: "0x both corpora" },
  // DECLARED_EMOTION — she/he felt (0.1x)
  { match: "(she|he|they|[A-Z][a-z]+)\\s+(was|were|felt)\\s+(filled|overcome|consumed)", reason: "0.1x — heuristic detector handles this better" },
]

async function main() {
  const patterns = await db`
    SELECT id, category, pattern FROM lint_patterns
    WHERE enabled = true AND pattern != '-- heuristic --'
    ORDER BY id
  ` as { id: number; category: string; pattern: string }[]

  console.log(`Checking ${patterns.length} enabled patterns...\n`)

  let disabled = 0
  for (const p of patterns) {
    const match = TO_DISABLE.find(d => p.pattern.includes(d.match))
    if (match) {
      await db`UPDATE lint_patterns SET enabled = false WHERE id = ${p.id}`
      console.log(`  Disabled #${p.id} ${p.category}: /${p.pattern.slice(0, 55)}/ — ${match.reason}`)
      disabled++
    }
  }

  console.log(`\nDisabled ${disabled} patterns`)

  const remaining = await db`
    SELECT id, category, pattern FROM lint_patterns
    WHERE enabled = true AND pattern != '-- heuristic --'
    ORDER BY category, id
  ` as { id: number; category: string; pattern: string }[]

  console.log(`Remaining enabled: ${remaining.length} patterns\n`)
  for (const r of remaining) {
    console.log(`  #${r.id} ${r.category}: /${r.pattern.slice(0, 60)}/`)
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})

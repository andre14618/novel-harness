#!/usr/bin/env bun
/**
 * strip-salvatore-corpus.ts
 *
 * Reads the Salvatore v4 training pairs (JSONL), applies corpus-vocabulary
 * stripping to the PROSE side only, and emits:
 *
 *   1. finetune-data/salvatore-1988-v5-stripped-pairs.jsonl
 *      The stripped (brief, prose) pairs ready for downstream formatting.
 *      Each line: { brief, prose_original, prose_stripped, strip_log }
 *
 *   2. finetune-data/salvatore-1988-v5-strip-stats.json
 *      Per-token replacement counts, unmatched corpus references, and
 *      brief-only tokens that were correctly left alone.
 *
 * USAGE
 *   bun scripts/finetune/strip-salvatore-corpus.ts \
 *     --input scripts/lora-data/salvatore-1988-training-pairs-fixed.jsonl \
 *     --out-dir finetune-data
 *
 * STRIPPING RULES  (see docs/ablation/salvatore-v5-stripped.md for rationale)
 *
 *   Characters  → generic epithets (context-sensitive: only when appearing as
 *                 a standalone proper noun, not mid-word or as a pronoun).
 *   Place names → [PLACE] placeholder.
 *   Items       → [ARTIFACT] placeholder.
 *   World nouns → lowest-common-denominator generics ("drow" → "dark elf",
 *                 "Underdark" → "the deep").
 *
 *   IMPORTANT INVARIANT: tokens that appear in the BRIEF text but NOT in the
 *   prose are NOT stripped — they are plot/character anchors that must survive
 *   so the formatter can assemble a coherent user prompt.
 *
 * REVERSIBILITY
 *   The output JSONL carries both prose_original and prose_stripped. A diff
 *   of the two fields reconstructs the exact substitutions made. The
 *   strip_log field lists each substitution as { token, replacement, offset }.
 */

import * as fs from "fs"
import * as path from "path"

// ── Replacement tables ────────────────────────────────────────────────────

/**
 * Character name → generic epithet.
 * Only applied in the PROSE, never the brief.
 * Rules:
 *   - Match whole-word, case-insensitive.
 *   - Prefer the epithet that best fits the grammatical slot:
 *     "Drizzt" as subject → "the dark elf"
 *   - We cannot do deep parse; we do whole-word substitution and accept that
 *     the replacement may be slightly off-register in a small fraction of cases.
 */
const CHARACTER_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bDrizzt(?:\s+Do'Urden)?\b/gi, "the dark elf"],
  [/\bDo'Urden\b/gi, "the dark elf"],
  [/\bBruenor(?:\s+Battlehammer)?\b/gi, "the dwarf king"],
  [/\bBattlehammer\b/gi, "the dwarf king"],
  [/\bWulfgar\b/gi, "the barbarian"],
  [/\bRegis\b/gi, "the halfling"],
  [/\bCatti-brie\b/gi, "the ranger"],
  [/\bCattibrie\b/gi, "the ranger"],
  [/\bGuenhwyvar\b/gi, "the panther"],
  [/\bArtmis\s+Entreri\b/gi, "the assassin"],
  [/\bEntreri\b/gi, "the assassin"],
  [/\bAkar\s+Kessell\b/gi, "the wizard"],
  [/\bKessell\b/gi, "the wizard"],
  [/\bHeafstaag\b/gi, "the barbarian king"],
  [/\bDeudermont\b/gi, "the sea captain"],
  [/\bDendybar\b/gi, "the mottled wizard"],
  [/\bAlustriel\b/gi, "the silver lady"],
  [/\bMalchor\s+Harpell\b/gi, "the mage"],
  [/\bHarpell\b/gi, "the mage"],
  [/\bLaValle\b/gi, "the guild mage"],
  [/\bPook\b/gi, "the thieves' guildmaster"],
  [/\bCassius\b/gi, "the spokesman"],
  [/\bBiggrin\b/gi, "the ogre"],
  [/\bShimmergloom\b/gi, "the shadow dragon"],
  [/\bErrtu\b/gi, "the demon"],
  [/\bSydney\b/gi, "the apprentice"],
]

/**
 * Place names → [PLACE].
 * Ordered longest-match first to avoid partial replacements.
 */
const PLACE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bIcewind\s+Dale\b/gi, "[PLACE]"],
  [/\bTen-?Towns\b/gi, "[PLACE]"],
  [/\bMithril\s+Hall\b/gi, "[PLACE]"],
  [/\bBryn\s+Shander\b/gi, "[PLACE]"],
  [/\bLonelywood\b/gi, "[PLACE]"],
  [/\bTargos\b/gi, "[PLACE]"],
  [/\bCaer-Konig\b/gi, "[PLACE]"],
  [/\bCaer-Dineval\b/gi, "[PLACE]"],
  [/\bTermalaine\b/gi, "[PLACE]"],
  [/\bEasthaven\b/gi, "[PLACE]"],
  [/\bCalimport\b/gi, "[PLACE]"],
  [/\bSilverymoon\b/gi, "[PLACE]"],
  [/\bLongsaddle\b/gi, "[PLACE]"],
  [/\bMirabar\b/gi, "[PLACE]"],
  [/\bLuskan\b/gi, "[PLACE]"],
  [/\bSundabar\b/gi, "[PLACE]"],
  [/\bSword\s+Coast\b/gi, "[PLACE]"],
  [/\bForgotten\s+Realms\b/gi, "[PLACE]"],
  [/\bFaer[uû]n\b/gi, "[PLACE]"],
  [/\bCryshal-Tirith\b/gi, "[PLACE]"],
  [/\bKelvin'?s?\s+Cairn\b/gi, "[PLACE]"],
  [/\bSpine\s+of\s+the\s+World\b/gi, "[PLACE]"],
  [/\bUnderdark\b/gi, "the deep"],
  [/\bUnder-realms?\b/gi, "the deep"],
]

/**
 * Named items / artifacts → [ARTIFACT].
 */
const ITEM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bCrenshinibon\b/gi, "[ARTIFACT]"],
  [/\bCrystal\s+Shard\b/gi, "[ARTIFACT]"],
  [/\bAegis-fang\b/gi, "[ARTIFACT]"],
  [/\bTwinkle\b/gi, "[ARTIFACT]"],  // sword name
  [/\bIcingdeath\b/gi, "[ARTIFACT]"],
  [/\bTaulmaril\b/gi, "[ARTIFACT]"],
  [/\bHeartstealer\b/gi, "[ARTIFACT]"],
]

/**
 * World / race nouns → lowercase generics (not [PLACEHOLDER] — these are
 * common-enough fantasy words the model can have learned from other corpora).
 */
const WORLD_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bdrow\s+elves\b/gi, "dark elves"],
  [/\bdrow\b/gi, "dark elf"],
  [/\bduergar\b/gi, "grey dwarf"],
  [/\bverbeeg\b/gi, "moor giant"],
  [/\bsvirfneblin\b/gi, "deep gnome"],
]

// All rules in application order (characters last so epithets survive
// further world-element passes cleanly)
const ALL_RULES: Array<[RegExp, string]> = [
  ...ITEM_REPLACEMENTS,
  ...PLACE_REPLACEMENTS,
  ...WORLD_REPLACEMENTS,
  ...CHARACTER_REPLACEMENTS,
]

// ── Helpers ───────────────────────────────────────────────────────────────

interface StripLog {
  token: string
  replacement: string
  count: number
}

interface StripResult {
  prose_stripped: string
  strip_log: StripLog[]
}

function stripProse(prose: string): StripResult {
  const log: StripLog[] = []
  let result = prose

  for (const [regex, replacement] of ALL_RULES) {
    // Reset lastIndex on global regexes
    regex.lastIndex = 0
    const matches = result.match(regex)
    if (matches && matches.length > 0) {
      // Collect unique matched tokens with counts
      const countByToken = new Map<string, number>()
      for (const m of matches) {
        countByToken.set(m, (countByToken.get(m) ?? 0) + 1)
      }
      for (const [token, count] of countByToken) {
        log.push({ token, replacement, count })
      }
      regex.lastIndex = 0
      result = result.replace(regex, replacement)
    }
  }

  return { prose_stripped: result, strip_log: log }
}

/**
 * Extract all prose-vocabulary tokens (from the brief text) that should NOT
 * be stripped — characters/places listed in the brief are plot anchors.
 *
 * Strategy: build a flat set of words from the brief's characters list,
 * setting, and summary. Any corpus token that appears ONLY in the brief
 * (not in the prose) should not be substituted there anyway, but this check
 * is bookkeeping for the stats report.
 */
function briefOnlyTokens(brief: Record<string, unknown>, prose: string): string[] {
  const briefText = JSON.stringify(brief).toLowerCase()
  const proseText = prose.toLowerCase()

  const allCorpusTokens = [
    "drizzt", "bruenor", "wulfgar", "regis", "catti-brie", "guenhwyvar",
    "entreri", "kessell", "icewind dale", "ten-towns", "mithril hall",
    "crenshinibon", "crystal shard", "aegis-fang", "twinkle", "icingdeath",
    "taulmaril", "drow", "underdark",
  ]

  return allCorpusTokens.filter(t =>
    briefText.includes(t) && !proseText.includes(t),
  )
}

// ── Main ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (flag: string, def: string) => {
    const idx = args.indexOf(flag)
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : def
  }
  return {
    input: get("--input", "scripts/lora-data/salvatore-1988-training-pairs-fixed.jsonl"),
    outDir: get("--out-dir", "finetune-data"),
  }
}

async function main() {
  const { input, outDir } = parseArgs()

  if (!fs.existsSync(input)) {
    console.error(`ERROR: input file not found: ${input}`)
    console.error("Expected: scripts/lora-data/salvatore-1988-training-pairs-fixed.jsonl")
    process.exit(1)
  }

  fs.mkdirSync(outDir, { recursive: true })

  const pairsPath = path.join(outDir, "salvatore-1988-v5-stripped-pairs.jsonl")
  const statsPath = path.join(outDir, "salvatore-1988-v5-strip-stats.json")

  const lines = fs.readFileSync(input, "utf-8").split("\n").filter(l => l.trim())
  console.log(`Loaded ${lines.length} pairs from ${input}`)

  // Accumulate stats
  const globalTokenCounts = new Map<string, number>()
  let totalReplacements = 0
  let pairsWithReplacements = 0
  let pairsClean = 0
  const briefOnlyByToken = new Map<string, number>()

  const outHandle = fs.createWriteStream(pairsPath)

  for (const line of lines) {
    const pair = JSON.parse(line) as { brief: Record<string, unknown>; prose: string }
    const { brief, prose } = pair

    const { prose_stripped, strip_log } = stripProse(prose)
    const brief_only = briefOnlyTokens(brief, prose)

    // Stats accumulation
    const totalInPair = strip_log.reduce((s, e) => s + e.count, 0)
    totalReplacements += totalInPair
    if (totalInPair > 0) pairsWithReplacements++
    else pairsClean++

    for (const entry of strip_log) {
      globalTokenCounts.set(
        entry.token,
        (globalTokenCounts.get(entry.token) ?? 0) + entry.count,
      )
    }
    for (const t of brief_only) {
      briefOnlyByToken.set(t, (briefOnlyByToken.get(t) ?? 0) + 1)
    }

    // Emit both versions
    const out = {
      brief,
      prose_original: prose,
      prose_stripped,
      strip_log,
      brief_only_tokens: brief_only,
    }
    outHandle.write(JSON.stringify(out) + "\n")
  }

  outHandle.end()

  // Build stats object
  const tokenCountsSorted = Array.from(globalTokenCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([token, count]) => ({ token, count }))

  const briefOnlySorted = Array.from(briefOnlyByToken.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([token, count]) => ({ token, occurrences_in_briefs_not_prose: count }))

  const stats = {
    generated: new Date().toISOString(),
    source: input,
    total_pairs: lines.length,
    pairs_with_replacements: pairsWithReplacements,
    pairs_clean: pairsClean,
    total_token_replacements: totalReplacements,
    avg_replacements_per_dirty_pair: pairsWithReplacements > 0
      ? (totalReplacements / pairsWithReplacements).toFixed(2)
      : "n/a",
    per_token_counts: tokenCountsSorted,
    brief_only_tokens: briefOnlySorted,
    note: "brief_only_tokens are corpus tokens that appear in a brief but not in the corresponding prose — these are not replaced in the prose (correct), and they will appear in the user prompt when v4-sft formatter runs. Review these to decide whether brief stripping is also needed.",
  }

  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2))

  console.log("")
  console.log("=== Strip stats ===")
  console.log(`  Total pairs:               ${lines.length}`)
  console.log(`  Pairs with replacements:   ${pairsWithReplacements} (${(100 * pairsWithReplacements / lines.length).toFixed(1)}%)`)
  console.log(`  Pairs untouched:           ${pairsClean}`)
  console.log(`  Total token replacements:  ${totalReplacements}`)
  console.log(`  Top replaced tokens:`)
  for (const { token, count } of tokenCountsSorted.slice(0, 10)) {
    console.log(`    ${token.padEnd(24)} ${count}`)
  }
  console.log(`  Brief-only corpus tokens (not replaced in prose — expected):`)
  for (const { token, occurrences_in_briefs_not_prose: n } of briefOnlySorted.slice(0, 10)) {
    console.log(`    ${token.padEnd(24)} ${n} briefs`)
  }
  console.log("")
  console.log(`Pairs   → ${pairsPath}`)
  console.log(`Stats   → ${statsPath}`)
  console.log("")
  console.log("NEXT STEP: review the stripped pairs manually (diff prose_original vs prose_stripped),")
  console.log("then run format-salvatore-v4-sft.py with --input pointing at the stripped pairs file")
  console.log("and --name salvatore-v5-stripped to produce the final SFT JSONL.")
  console.log("")
  console.log("DO NOT submit training until you have reviewed the stripped data.")
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})

/**
 * Rung 0 regex-ceiling measurement for halluc-leak-salvatore v2
 * (docs/scoping/halluc-leak-salvatore-v2.md §5).
 *
 * Question: if we OR-combine a case-insensitive substring-regex detector
 * with the `halluc-leak-salvatore-v1` adapter at inference time, do we
 * close the 16% FR-name recall gap without training spend?
 *
 * Method:
 *   1. Build the regex pattern from LEAK_TOKENS + LEAK_TERMS in the
 *      existing scripts + the scoping doc's proposed additions.
 *   2. Apply case-insensitive substring match to the prose field of all
 *      production halluc-leak-salvatore calls.
 *   3. Cross-tab regex verdict vs adapter verdict per beat.
 *   4. Report: regex-only catches (= "regex adds recall"), adapter-only
 *      catches (= "regex misses something adapter got"), agree/disagree.
 *   5. Emit a sample of regex-only catches + adapter-only catches for
 *      downstream Sonnet adjudication.
 *
 * No training. No inference. Pure regex over already-logged prose.
 */

import db from "../../../src/db/connection"
import { writeFileSync, mkdirSync } from "node:fs"

// ── Token list ─────────────────────────────────────────────────────────
//
// Union of:
//   - `scripts/hallucination/expand-leak-vocab.ts` LEAK_TOKENS (canonical
//     IWD trilogy + select FR wider bibliography, pre-charter)
//   - `docs/scoping/halluc-leak-salvatore-v2.md` §B additions (exp #254
//     + production-panel-confirmed gaps)
//
// Lowercase race terms stay lowercase; proper nouns are matched
// case-insensitively but multi-word proper nouns are preserved as
// whole-string matches.

const TOKENS = [
  // Characters (canonical IWD)
  "Drizzt", "Bruenor", "Wulfgar", "Regis", "Catti-brie", "Rumblebelly",
  "Akar Kessell", "Entreri", "Jarlaxle", "Zaknafein", "Guenhwyvar",
  "Dendybar", "Pasha Pook", "Deudermont", "Cassius", "Heafstaag",
  "Biggrin", "Alustriel", "Do'Urden",
  // Places (IWD)
  "Mithril Hall", "Mithral Hall", "Icewind Dale", "Ten-Towns",
  "Bryn Shander", "Termalaine", "Easthaven", "Luskan", "Silverymoon",
  "Calimport", "Maer Dualdon", "Kelvin's Cairn", "Cryshal-Tirith",
  "Faerûn", "Sword Coast", "Forgotten Realms", "Lonelywood", "Targos",
  "Spine of the World",
  // Places (wider FR — scoping-doc additions)
  "Waterdeep", "Baldur's Gate", "Chionthar", "Neverwinter",
  "Menzoberranzan", "Gauntlgrym", "Helm's Hold", "Sea of Swords",
  "Sea Sprite",
  // Items
  "Crystal Shard", "Crenshinibon", "Aegis-fang", "Twinkle", "Icingdeath",
  "Taulmaril",
  // Races / creatures — longer alternations before shorter so the regex
  // engine prefers "drow elf"/"dark elves" over the bare "drow"/"dark" prefix
  "dark elves", "dark elf", "drow elves", "drow elf", "drow",
  "duergar", "verbeeg",
  // Standalone corpus-vocabulary terms (case-insensitive via `gi` flag)
  "mithril",
  // Scoping-doc exp-#254 additions
  "Drossen Ironbelly", "Harpells", "Nine-Towns",
]

function buildRegex(): RegExp {
  // Escape regex special chars, join with alternation, anchor on word boundaries
  // where possible. Apostrophes and hyphens inside tokens need to stay literal.
  const escaped = TOKENS.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  // Wrap each alt in (^|\W) ... (?=\W|$) so "drow" doesn't match "drowsy" or "drown".
  // Using lookbehind + lookahead for word boundaries without consuming chars.
  // Optional `(?:'s?|s')` suffix handles possessive forms ("Rumblebelly's",
  // "Harpells'"); lookahead checks the char AFTER the suffix.
  return new RegExp(
    `(?<=^|[^\\w'-])(?:${escaped.join("|")})(?:'s?|s')?(?=[^\\w'-]|$)`,
    "gi"
  )
}

interface Row {
  id: number
  novel_id: string
  chapter: number
  beat_index: number
  attempt: number
  user_prompt: string
  response_content: string
}

async function main() {
  const regex = buildRegex()
  console.log(`[rung-0] Regex built with ${TOKENS.length} tokens`)

  // Pull all production halluc-leak-salvatore calls since halluc-v3 wire-in.
  const rows = (await db`
    SELECT id, novel_id, chapter, beat_index, attempt, user_prompt, response_content
    FROM llm_calls
    WHERE agent = 'halluc-leak-salvatore'
      AND timestamp >= '2026-04-18'
      AND user_prompt IS NOT NULL
    ORDER BY id
  `) as unknown as Row[]
  console.log(`[rung-0] Loaded ${rows.length} halluc-leak-salvatore rows`)

  interface Verdict {
    adapter_fired: boolean
    regex_fired: boolean
    adapter_tokens: string[]
    regex_tokens: string[]
  }
  const verdicts: (Row & Verdict)[] = []

  for (const r of rows) {
    // Parse adapter output
    let adapter_fired = false
    let adapter_tokens: string[] = []
    try {
      const parsed = JSON.parse(r.response_content)
      adapter_fired = parsed.has_leak === true
      adapter_tokens = Array.isArray(parsed.leaks) ? parsed.leaks : []
    } catch { /* malformed JSON — count as non-fire */ }

    // Extract prose from user_prompt (format: "PROSE:\n<prose>")
    const prose = r.user_prompt.replace(/^PROSE:\s*\n?/, "").trim()

    // Run regex
    const matches = prose.match(regex) ?? []
    const regex_tokens = [...new Set(matches.map(m => m.trim()))]
    const regex_fired = regex_tokens.length > 0

    verdicts.push({ ...r, adapter_fired, regex_fired, adapter_tokens, regex_tokens })
  }

  // Cross-tab
  const both = verdicts.filter(v => v.adapter_fired && v.regex_fired)
  const adapterOnly = verdicts.filter(v => v.adapter_fired && !v.regex_fired)
  const regexOnly = verdicts.filter(v => !v.adapter_fired && v.regex_fired)
  const neither = verdicts.filter(v => !v.adapter_fired && !v.regex_fired)

  // Per-beat dedupe (multiple attempts per beat)
  function dedupeByBeat(v: (Row & Verdict)[]): Set<string> {
    return new Set(v.map(r => `${r.novel_id}|${r.chapter}|${r.beat_index}`))
  }

  const beatsBoth = dedupeByBeat(both)
  const beatsAdapterOnly = dedupeByBeat(adapterOnly)
  const beatsRegexOnly = dedupeByBeat(regexOnly)

  console.log(`
[rung-0] Cross-tab (per call):
  Both fired              : ${both.length}
  Adapter only            : ${adapterOnly.length}  (regex missed these)
  Regex only              : ${regexOnly.length}  (adapter missed these — potential recall gain)
  Neither                 : ${neither.length}
  Total                   : ${verdicts.length}

[rung-0] Per-beat (deduped across attempts):
  Beats with both         : ${beatsBoth.size}
  Beats adapter-only      : ${beatsAdapterOnly.size}
  Beats regex-only        : ${beatsRegexOnly.size}

[rung-0] Combined OR-gate recall (beats):
  Adapter alone           : ${beatsBoth.size + beatsAdapterOnly.size}
  OR-combined             : ${beatsBoth.size + beatsAdapterOnly.size + beatsRegexOnly.size}
  Δ recall if OR-combine  : +${beatsRegexOnly.size} beats
`)

  // Top regex-only tokens (what's the adapter missing?)
  const regexOnlyTokenCounts: Record<string, number> = {}
  for (const v of regexOnly) {
    for (const t of v.regex_tokens) {
      regexOnlyTokenCounts[t] = (regexOnlyTokenCounts[t] ?? 0) + 1
    }
  }
  const topRegexOnly = Object.entries(regexOnlyTokenCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
  console.log("[rung-0] Top tokens regex caught but adapter missed:")
  for (const [token, n] of topRegexOnly) console.log(`  ${token.padEnd(25)} ${n}`)

  // Top adapter-only tokens (what's regex missing?)
  const adapterOnlyTokenCounts: Record<string, number> = {}
  for (const v of adapterOnly) {
    for (const t of v.adapter_tokens) {
      adapterOnlyTokenCounts[t] = (adapterOnlyTokenCounts[t] ?? 0) + 1
    }
  }
  const topAdapterOnly = Object.entries(adapterOnlyTokenCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
  console.log("\n[rung-0] Top tokens adapter caught but regex missed (regex FN):")
  for (const [token, n] of topAdapterOnly) console.log(`  ${token.padEnd(25)} ${n}`)

  // Emit samples for downstream adjudication
  mkdirSync("/tmp/rung-0", { recursive: true })
  const regexOnlySample = regexOnly.slice(0, 15).map(v => ({
    id: v.id,
    novel_id: v.novel_id,
    chapter: v.chapter,
    beat_index: v.beat_index,
    regex_tokens: v.regex_tokens,
    prose: v.user_prompt.replace(/^PROSE:\s*\n?/, "").trim(),
  }))
  writeFileSync("/tmp/rung-0/regex-only-sample.json", JSON.stringify(regexOnlySample, null, 2))

  const adapterOnlySample = adapterOnly.slice(0, 15).map(v => ({
    id: v.id,
    novel_id: v.novel_id,
    chapter: v.chapter,
    beat_index: v.beat_index,
    adapter_tokens: v.adapter_tokens,
    prose: v.user_prompt.replace(/^PROSE:\s*\n?/, "").trim(),
  }))
  writeFileSync("/tmp/rung-0/adapter-only-sample.json", JSON.stringify(adapterOnlySample, null, 2))

  console.log(`\n[rung-0] Samples written to /tmp/rung-0/`)
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })

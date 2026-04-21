#!/usr/bin/env bun
/**
 * Arm-B preflight parity dry-run — mandatory preflight-to-the-preflight
 * per `docs/charters/arm-b-detector-preflight.md` §6.
 *
 * Binary question: can we recover the original `sections: string[]`
 * from the stored `llm_calls.user_prompt` column via header-prefix merge?
 *
 * Method:
 *  1. Pull N beat-writer rows from a candidate novel
 *  2. Parse user_prompt: split on "\n\n", then merge adjacent splits
 *     back into a single section whenever the second split does NOT
 *     start with a recognized section-header prefix.
 *  3. Verify byte-exact round-trip: sections.join("\n\n") === original
 *  4. Report per-beat yield + section composition + failures.
 *
 * Yield gate per charter §6: ≥70% recoverable → dry-run passes, write
 * the other three components. 10-30% failure on a post-sql/017 novel
 * = abort as schema-drift evidence. >30% failure = abort + re-select.
 *
 * Usage:
 *   bun scripts/evals/preflight-arm-b-parity-dryrun.ts \
 *     --novel novel-1776690960321 --n 10
 */

import db from "../../src/db/connection"

// Header prefixes that mark the start of a fresh section. The beat-spec
// section at index 0 has no header; everything before the first matched
// header is the beat-spec.
const SECTION_HEADER_PREFIXES = [
  "TRANSITION BRIDGE",
  "LANDING TARGET",
  "CHARACTERS:",
  "BACKGROUND:",
  "SETTING:",
  "Sensory:",
] as const

function startsWithSectionHeader(s: string): boolean {
  for (const prefix of SECTION_HEADER_PREFIXES) {
    if (s.startsWith(prefix)) return true
  }
  return false
}

/**
 * Split `user_prompt` on "\n\n" then merge back adjacent splits whose
 * second piece does NOT start with a recognized section header.
 *
 * This handles the CHARACTERS section's internal "\n\n" from
 * `snapshots.join("\n\n")` at beat-context.ts:195 (non-compact mode).
 */
function recoverSections(userPrompt: string): string[] {
  const raw = userPrompt.split("\n\n")
  const merged: string[] = []
  for (const chunk of raw) {
    if (merged.length === 0 || startsWithSectionHeader(chunk)) {
      merged.push(chunk)
    } else {
      // Glue to previous section
      merged[merged.length - 1] += "\n\n" + chunk
    }
  }
  return merged
}

function sectionHeader(section: string): string {
  for (const prefix of SECTION_HEADER_PREFIXES) {
    if (section.startsWith(prefix)) return prefix.replace(":", "")
  }
  return "(beat-spec)"
}

type BeatRow = {
  id: number
  novel_id: string
  chapter: number
  beat_index: number
  user_prompt: string
  system_prompt: string | null
}

async function main() {
  const argv = process.argv.slice(2)
  const arg = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const novelId = arg("--novel") ?? "novel-1776690960321"
  const n = parseInt(arg("--n") ?? "10", 10)

  console.log(`[dry-run] novel=${novelId} sample=${n}`)

  // Sample N beat-writer rows spread across chapters — one per chapter
  // until we have N, preferring mid-beats (not beat 0 of chapter 1 which
  // has no transition bridge, not last beat which has no landing target).
  const rows = await db<BeatRow[]>`
    SELECT id, novel_id, chapter, beat_index, user_prompt, system_prompt
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND agent = 'beat-writer'
      AND failed IS NOT TRUE
      AND user_prompt IS NOT NULL
      AND response_content IS NOT NULL
    ORDER BY chapter ASC, beat_index ASC
  `
  if (rows.length === 0) {
    console.error(`No beat-writer rows for novel ${novelId}`)
    process.exit(2)
  }
  // Stratified sample: one per chapter, mid-beat preferred, until N
  const byChapter = new Map<number, BeatRow[]>()
  for (const r of rows) {
    if (!byChapter.has(r.chapter)) byChapter.set(r.chapter, [])
    byChapter.get(r.chapter)!.push(r)
  }
  const sample: BeatRow[] = []
  const chapters = [...byChapter.keys()].sort((a, b) => a - b)
  let chIdx = 0
  while (sample.length < n) {
    const ch = chapters[chIdx % chapters.length]
    if (chIdx >= chapters.length * 5) break // safety
    const pool = byChapter.get(ch)!
    const midIdx = Math.floor(pool.length / 2) + (sample.length % 3) - 1
    const chosen = pool[Math.max(0, Math.min(pool.length - 1, midIdx))]
    if (!sample.find(s => s.id === chosen.id)) sample.push(chosen)
    chIdx++
  }

  console.log(`[dry-run] sampled ${sample.length} beats across ${chapters.length} chapters`)
  console.log("")

  let passed = 0
  let failed = 0
  const failures: Array<{ beat: string; reason: string; detail?: string }> = []
  const sectionComposition = new Map<string, number>()

  for (const r of sample) {
    const beatLabel = `ch${r.chapter}b${r.beat_index}`
    const original = r.user_prompt
    const sections = recoverSections(original)
    const rejoined = sections.join("\n\n")

    if (rejoined !== original) {
      failed++
      // Find first divergence
      let i = 0
      while (i < Math.min(rejoined.length, original.length) && rejoined[i] === original[i]) i++
      failures.push({
        beat: beatLabel,
        reason: "byte-mismatch on round-trip",
        detail: `len_original=${original.length} len_rejoined=${rejoined.length} first_div=${i} orig_ctx='${original.slice(Math.max(0, i - 20), i + 20).replace(/\n/g, "\\n")}' rejoined_ctx='${rejoined.slice(Math.max(0, i - 20), i + 20).replace(/\n/g, "\\n")}'`,
      })
      console.log(`  ${beatLabel}: FAIL — ${failures[failures.length - 1].detail}`)
      continue
    }

    passed++
    const headers = sections.map(sectionHeader)
    for (const h of headers) sectionComposition.set(h, (sectionComposition.get(h) ?? 0) + 1)
    console.log(`  ${beatLabel}: ok — ${sections.length} sections [${headers.join(" | ")}]`)
  }

  const yieldPct = (passed / sample.length) * 100
  console.log("")
  console.log(`[result] passed=${passed}/${sample.length} (${yieldPct.toFixed(1)}%)`)
  console.log(`[result] section composition across passed beats:`)
  for (const [h, count] of [...sectionComposition.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${h}: ${count} occurrences (${((count / passed) * 100).toFixed(0)}% of beats)`)
  }

  if (failures.length > 0) {
    console.log("")
    console.log(`[result] failures:`)
    for (const f of failures) {
      console.log(`  ${f.beat}: ${f.reason}`)
      if (f.detail) console.log(`    ${f.detail}`)
    }
  }

  // Verdict per charter §6
  console.log("")
  if (yieldPct >= 70) {
    console.log(`[verdict] PASS — yield ≥70%. Proceed to implement remaining preflight components.`)
    process.exit(0)
  } else if (yieldPct >= 70 - 30 /* 40% */) {
    console.log(`[verdict] SCHEMA-DRIFT ABORT — 40–70% yield on a post-sql/017 novel. Investigate schema drift before re-selecting.`)
    process.exit(1)
  } else {
    console.log(`[verdict] FAIL — yield <40%. Re-select source novel or redesign the parser.`)
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })

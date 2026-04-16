/**
 * Rebuild salvatore-1988-training-pairs-tagged.jsonl with paragraph breaks
 * restored in every `prose` field.
 *
 * Two passes:
 *   1. Lone `\n` → `\n\n` — Salvatore's PDF-extracted corpus already puts each
 *      dialogue turn on its own line. Just convert those single newlines into
 *      proper paragraph breaks.
 *   2. For beats with zero newlines of any kind (~32% of corpus, wall-of-text),
 *      inject `\n\n` before any quoted turn that follows a sentence terminator.
 *      Catches the silently-collapsed dialogue paragraphs without inventing
 *      breaks inside pure narration.
 *
 * Run: bun scripts/finetune/fix-paragraph-breaks.ts
 */

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const IN_PATH = resolve(import.meta.dir, "../../scripts/lora-data/salvatore-1988-training-pairs-tagged.jsonl")
const OUT_PATH = resolve(import.meta.dir, "../../scripts/lora-data/salvatore-1988-training-pairs-fixed.jsonl")

function fixParagraphs(prose: string): string {
  let t = prose.trim()

  // Pass 1: normalize whatever paragraph breaks exist — any run of newlines becomes \n\n.
  // Salvatore PDF extraction put each dialogue turn on its own line, so lone \n are real breaks.
  t = t.replace(/\n+/g, "\n\n")

  // Pass 2: only if ZERO breaks exist, attempt to split at quoted-turn boundaries.
  // Pattern: [.!?] + optional closing quote + space + opening quote for new dialogue turn.
  // Conservative — only fires on true wall-of-text beats.
  if (!t.includes("\n\n")) {
    t = t.replace(/([.!?]["']?)\s+(["'][A-Z])/g, "$1\n\n$2")
  }

  t = t.replace(/\n{3,}/g, "\n\n")
  return t.trim()
}

type Pair = { brief: { beat_id: string; [k: string]: any }; prose: string; style?: any }

function main() {
  const lines = readFileSync(IN_PATH, "utf-8").split("\n").filter(Boolean)
  const pairs = lines.map(l => JSON.parse(l) as Pair)

  let beforeStats = { zero: 0, someNL: 0, blankBreaks: 0 }
  let afterStats = { zero: 0, someNL: 0, blankBreaks: 0 }

  const out: Pair[] = []
  for (const p of pairs) {
    const beforeNL2 = (p.prose.match(/\n\n/g) || []).length
    const beforeNL = (p.prose.match(/\n/g) || []).length
    if (beforeNL2 > 0) beforeStats.blankBreaks++
    else if (beforeNL > 0) beforeStats.someNL++
    else beforeStats.zero++

    const fixed = fixParagraphs(p.prose)
    const afterNL2 = (fixed.match(/\n\n/g) || []).length
    const afterNL = (fixed.match(/\n/g) || []).length
    if (afterNL2 > 0) afterStats.blankBreaks++
    else if (afterNL > 0) afterStats.someNL++
    else afterStats.zero++

    out.push({ ...p, prose: fixed })
  }

  writeFileSync(OUT_PATH, out.map(p => JSON.stringify(p)).join("\n") + "\n")

  console.log(`Pairs: ${pairs.length}`)
  console.log(`Before: blank-breaks=${beforeStats.blankBreaks}  only-\\n=${beforeStats.someNL}  wall-of-text=${beforeStats.zero}`)
  console.log(`After:  blank-breaks=${afterStats.blankBreaks}  only-\\n=${afterStats.someNL}  wall-of-text=${afterStats.zero}`)
  console.log(`Output: ${OUT_PATH}`)
}

main()

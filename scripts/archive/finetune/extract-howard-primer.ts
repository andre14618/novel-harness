/**
 * Builds src/agents/writer/style-primer-howard.md from scripts/lora-data/howard-training.jsonl.
 *
 * Selects ~10K tokens of the richest, longest Howard prose passages and
 * wraps them with an instruction header for in-context voice conditioning
 * on DeepSeek V3.2 (prefix-cacheable). Sort-by-length selects the passages
 * with the most clause variety / metaphor density / interiority depth,
 * which is what we want the model to imitate.
 *
 * Run: bun scripts/finetune/extract-howard-primer.ts
 */

import { writeFileSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const CORPUS_PATH = resolve(import.meta.dir, "../../scripts/lora-data/howard-training.jsonl")
const OUT_PATH = resolve(import.meta.dir, "../../src/agents/writer/style-primer-howard.md")
const TARGET_TOKENS = 10_000
const CHARS_PER_TOKEN = 4 // rough OpenAI-family heuristic; undercounts slightly, which is safe

const HEADER = `# Style exemplars — match voice, NOT content

The passages below are exemplars of the target prose voice. Your task is to match the **voice properties** they share — clause rhythm, metaphor density, concreteness, interiority depth, register, sentence-length variation — in whatever scene you are asked to write.

**Do NOT:**
- Copy phrases, imagery, settings, characters, plots, or objects from these exemplars
- Imitate the specific genre (sword-and-sorcery) unless the beat calls for it
- Reuse distinctive idioms, oaths, or proper nouns

**DO:**
- Match the sentence-construction habits: long clause-piled sentences interleaved with blunt short ones
- Match the density of concrete sensory detail per paragraph
- Match the willingness to name emotional states via physical specifics (a hand tightening on a sword hilt, the color of breath in cold air) rather than abstractions
- Match the registered, slightly archaic-formal tone when appropriate to the scene's weight

Read them, absorb the voice, then write the scene you were given — in your own imagery, your own characters, your own plot.

---

## Exemplars

`

const FOOTER = `
---

End of exemplars. Now write the beat you were given, in the voice demonstrated above.
`

type Passage = { text: string; len: number }

const GUTENBERG_MARKERS = [
  "Project Gutenberg",
  "eBook",
  "copyright royalties",
  "trademark license",
  "U.S. copyright law",
  "Foundation (and you",
]

function isGutenbergBoilerplate(text: string): boolean {
  return GUTENBERG_MARKERS.some(m => text.includes(m))
}

function loadPassages(): Passage[] {
  const raw = readFileSync(CORPUS_PATH, "utf-8")
  const out: Passage[] = []
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue
    try {
      const obj = JSON.parse(line) as { text?: string }
      if (typeof obj.text !== "string") continue
      if (obj.text.length < 200) continue
      if (isGutenbergBoilerplate(obj.text)) continue
      out.push({ text: obj.text.trim(), len: obj.text.length })
    } catch {}
  }
  return out
}

function pickPassages(all: Passage[], targetChars: number): Passage[] {
  // Sort longest-first. Long passages show voice structure at scale (paragraph
  // transitions, clause pacing across beats) which short ones cannot.
  const sorted = [...all].sort((a, b) => b.len - a.len)
  const picked: Passage[] = []
  let total = 0
  for (const p of sorted) {
    if (total + p.len > targetChars) break
    picked.push(p)
    total += p.len
  }
  return picked
}

function main() {
  const all = loadPassages()
  if (all.length === 0) throw new Error(`No passages loaded from ${CORPUS_PATH}`)

  const picked = pickPassages(all, TARGET_TOKENS * CHARS_PER_TOKEN)
  const body = picked.map(p => p.text).join("\n\n---\n\n")
  const content = HEADER + body + FOOTER

  writeFileSync(OUT_PATH, content)

  const totalChars = content.length
  const approxTokens = Math.round(totalChars / CHARS_PER_TOKEN)
  console.log(`Wrote ${OUT_PATH}`)
  console.log(`  Passages selected: ${picked.length} / ${all.length}`)
  console.log(`  Total chars: ${totalChars}`)
  console.log(`  Approx tokens: ~${approxTokens}`)
  console.log(`  Target tokens: ${TARGET_TOKENS}`)
}

main()

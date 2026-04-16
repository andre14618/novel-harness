/**
 * Builds src/agents/writer/style-primer-salvatore.md from the tagged
 * Salvatore training pairs.
 *
 * Same shape as extract-howard-primer.ts: selects ~10K tokens of the
 * richest/longest Salvatore prose beats for in-context voice conditioning
 * on DeepSeek V3.2 (prefix-cacheable). This primer is the "ICL control"
 * cell in Phase C.2: DeepSeek + Salvatore primer vs LoRA — tells us
 * whether the LoRA's Phase C win is tuning or just in-context exemplars.
 *
 * Run: bun scripts/finetune/extract-salvatore-primer.ts
 */

import { writeFileSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const CORPUS_PATH = resolve(import.meta.dir, "../../scripts/lora-data/salvatore-1988-training-pairs-tagged.jsonl")
const OUT_PATH = resolve(import.meta.dir, "../../src/agents/writer/style-primer-salvatore.md")
const TARGET_TOKENS = 10_000
const CHARS_PER_TOKEN = 4

const HEADER = `# Style exemplars — match voice, NOT content

The passages below are exemplars of the target prose voice. Your task is to match the **voice properties** they share — clause rhythm, sentence-length variation, sensory restraint, dialogue-to-action balance, register — in whatever scene you are asked to write.

**Do NOT:**
- Copy phrases, imagery, settings, characters, plots, or objects from these exemplars
- Reuse distinctive proper nouns (Drizzt, Bruenor, Wulfgar, Regis, Icewind Dale, Ten-Towns, specific weapon names)
- Imitate the specific genre (fantasy adventure) unless the beat calls for it

**DO:**
- Match the sentence-construction habits: direct declarative lines varied with occasional long cascading sentences carrying subordinate clauses
- Match the restraint with sensory imagery — one or two concrete physical details per paragraph, not sensory overload
- Match the dialogue-tag economy: short tags, physical reactions rather than adverbs
- Match the action-pulp cadence: short punchy lines during combat or tension, longer lines in description or reflection
- Match the grounded physicality: cold, wind, firelight, steel, the weight of bodies moving through terrain

Read them, absorb the voice, then write the beat you were given — in your own imagery, your own characters, your own plot.

---

## Exemplars

`

const FOOTER = `
---

End of exemplars. Now write the beat you were given, in the voice demonstrated above.
`

type Passage = { text: string; len: number }

function loadPassages(): Passage[] {
  const raw = readFileSync(CORPUS_PATH, "utf-8")
  const out: Passage[] = []
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue
    try {
      const obj = JSON.parse(line) as { prose?: string }
      if (typeof obj.prose !== "string") continue
      if (obj.prose.length < 200) continue
      out.push({ text: obj.prose.trim(), len: obj.prose.length })
    } catch {}
  }
  return out
}

function pickPassages(all: Passage[], targetChars: number): Passage[] {
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

/**
 * Extract unique (beat, characters, prose) pairs from the V3 curated JSONL
 * for V4 re-labeling with the new events+attribution prompt.
 *
 * Source: lora-data/adherence-checker-v3-curated.jsonl (7,541 lines, 4 call types)
 * Output: /tmp/v4-relabeling-pairs.jsonl (~1,800-2,000 unique pairs)
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs"

const INPUT = "lora-data/adherence-checker-v3-curated.jsonl"
const OUTPUT = "/tmp/v4-relabeling-pairs.jsonl"
const BATCH_DIR = "/tmp/v4-batches"
const BATCH_SIZE = 130

const lines = readFileSync(INPUT, "utf-8").trim().split("\n")
const seen = new Set<string>()
const pairs: { id: number; beat: string; characters: string; prose: string }[] = []

for (const line of lines) {
  const d = JSON.parse(line)
  const userContent: string = d.messages[1].content

  // Extract BEAT line
  const beatMatch = userContent.match(/^BEAT:\s*(.+?)$/m)
  if (!beatMatch) continue
  const beat = beatMatch[1].trim()

  // Extract CHARACTERS EXPECTED (may not exist in setting/tangent prompts)
  const charsMatch = userContent.match(/^CHARACTERS EXPECTED:\s*(.+?)$/m)
  const characters = charsMatch ? charsMatch[1].trim() : ""

  // Extract PROSE block
  const proseMatch = userContent.match(/PROSE:\n---\n([\s\S]+?)\n---/)
  if (!proseMatch) continue
  const prose = proseMatch[1].trim()

  // Deduplicate by beat+prose hash (same prose appears 4x, once per old call type)
  const key = beat + "|||" + prose.slice(0, 200)
  if (seen.has(key)) continue
  seen.add(key)

  pairs.push({ id: pairs.length, beat, characters, prose })
}

writeFileSync(OUTPUT, pairs.map(p => JSON.stringify(p)).join("\n"))
console.log(`Extracted ${pairs.length} unique pairs from ${lines.length} training examples`)

// Split into batches for parallel labeling
mkdirSync(BATCH_DIR, { recursive: true })
const numBatches = Math.ceil(pairs.length / BATCH_SIZE)

for (let i = 0; i < numBatches; i++) {
  const batch = pairs.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
  writeFileSync(`${BATCH_DIR}/batch_${i}.json`, JSON.stringify(batch, null, 2))
}

console.log(`Split into ${numBatches} batches of ~${BATCH_SIZE} pairs each → ${BATCH_DIR}/`)
console.log(`Batch files: batch_0.json through batch_${numBatches - 1}.json`)

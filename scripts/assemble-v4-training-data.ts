/**
 * Assemble V4 adherence checker training data.
 *
 * Combines pairs from /tmp/v4-relabeling-pairs.jsonl with labels
 * from /tmp/v4-labels/labels_batch_*.json into OpenAI chat format
 * for W&B SFT submission.
 *
 * Output: lora-data/adherence-checker-v4-events-sonnet.jsonl
 */

import { readFileSync, writeFileSync, readdirSync } from "fs"

const PAIRS_FILE = "/tmp/v4-relabeling-pairs.jsonl"
const LABELS_DIR = "/tmp/v4-labels"
const OUTPUT = "lora-data/adherence-checker-v4-events-sonnet.jsonl"

const SYSTEM_PROMPT = `You verify whether the prose ENACTS the scene beat on-page.

Read the beat description carefully. Identify every distinct action or event it specifies — there may be one or several. Then check whether EACH is dramatized in the prose.

Rules:
- "Enacted" means the action happens IN SCENE during this prose — characters performing the action, dialogue, or narration of the action as it occurs. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- A reference to the action as having happened earlier (off-page, past-tense, summarized as backstory) does NOT count as enacted.
- Characters being merely present is NOT enough — the beat's specific actions must occur.
- If the beat specifies multiple actions, ALL must appear in the prose. A partially enacted beat is not fully enacted.
- Each action must be performed by the character the beat assigns it to. If the beat says Character A does something but the prose has Character B do it, the action is NOT correctly enacted.
- If ANY key action from the beat is missing, return events_present=false. Do NOT default to true.

Respond with ONLY valid JSON in this exact shape:
{
  "events_present": true | false,
  "evidence": "<short quoted passage from the prose, ~1-3 sentences>",
  "reasoning": "<one sentence>"
}`

// Load pairs
const pairs = readFileSync(PAIRS_FILE, "utf-8")
  .trim()
  .split("\n")
  .map(l => JSON.parse(l) as { id: number; beat: string; characters: string; prose: string })

console.log(`Loaded ${pairs.length} pairs`)

// Load all label files
const labelMap = new Map<number, { events_present: boolean; evidence: string; reasoning: string }>()

const labelFiles = readdirSync(LABELS_DIR)
  .filter(f => f.startsWith("labels_batch_") && f.endsWith(".json"))
  .sort()

let totalLabels = 0
for (const file of labelFiles) {
  const labels = JSON.parse(readFileSync(`${LABELS_DIR}/${file}`, "utf-8")) as Array<{
    id: number
    events_present: boolean
    evidence: string
    reasoning: string
  }>
  for (const label of labels) {
    labelMap.set(label.id, {
      events_present: label.events_present,
      evidence: label.evidence ?? "",
      reasoning: label.reasoning ?? "",
    })
  }
  totalLabels += labels.length
  console.log(`  ${file}: ${labels.length} labels`)
}

console.log(`Loaded ${totalLabels} labels from ${labelFiles.length} files`)

// Assemble training examples
const output: string[] = []
let missing = 0
let trueCount = 0
let falseCount = 0

for (const pair of pairs) {
  const label = labelMap.get(pair.id)
  if (!label) {
    console.warn(`  WARNING: no label for pair id=${pair.id}`)
    missing++
    continue
  }

  const userPrompt = `BEAT: ${pair.beat}\nCHARACTERS EXPECTED: ${pair.characters}\n\nPROSE:\n---\n${pair.prose}\n---`

  const assistantContent = JSON.stringify({
    events_present: label.events_present,
    evidence: label.evidence,
    reasoning: label.reasoning,
  })

  output.push(JSON.stringify({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
      { role: "assistant", content: assistantContent },
    ],
  }))

  if (label.events_present) trueCount++
  else falseCount++
}

writeFileSync(OUTPUT, output.join("\n"))

console.log(`\nWrote ${output.length} training examples to ${OUTPUT}`)
console.log(`  true: ${trueCount} (${Math.round(trueCount / output.length * 100)}%)`)
console.log(`  false: ${falseCount} (${Math.round(falseCount / output.length * 100)}%)`)
if (missing > 0) console.warn(`  MISSING labels: ${missing}`)

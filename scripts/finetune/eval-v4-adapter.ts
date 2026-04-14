/**
 * Evaluate V4 adherence adapter against Sonnet oracle on 30 ground-truth pairs.
 *
 * Runs each pair through:
 *   1. V4 adapter (adherence-checker-v4 on W&B Inference)
 *   2. Sonnet oracle (claude-sonnet-4-6 via OpenRouter, same prompt)
 *
 * Reports per-pair agreement and overall accuracy.
 *
 * Usage:
 *   EXPERIMENT_ID=161 bun scripts/eval-v4-adapter.ts
 */

import { readFileSync } from "fs"
import { getTransport } from "../../src/transport.ts"

const PAIRS_FILE = "/tmp/eval-pairs-30.json"

const V4_ADAPTER = {
  provider: "wandb" as const,
  model: "wandb-artifact:///andre14618-/novel-harness/adherence-checker-v4",
}

const CEREBRAS_ORACLE = {
  provider: "cerebras" as const,
  model: "qwen-3-235b-a22b-instruct-2507",
}

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

interface EvalPair {
  id: number
  label: string
  beatDescription: string
  beatCharacters: string[]
  setting: string
  prose: string
}

async function callModel(
  model: { provider: string; model: string },
  userPrompt: string,
): Promise<{ events_present: boolean; reasoning: string } | null> {
  const transport = getTransport()
  try {
    const result = await transport.execute({
      provider: model.provider as any,
      model: model.model,
      temperature: 0.1,
      maxTokens: 256,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
    })
    const text = result.content.trim()
    // Strip any trailing control characters
    const cleaned = text.replace(/[\x00-\x1F\x7F]+$/, "").trim()
    const jsonStart = cleaned.indexOf("{")
    const jsonEnd = cleaned.lastIndexOf("}") + 1
    if (jsonStart === -1) return null
    const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd))
    return { events_present: !!parsed.events_present, reasoning: parsed.reasoning ?? "" }
  } catch (err) {
    console.error(`  [ERROR] ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

const pairs: EvalPair[] = JSON.parse(readFileSync(PAIRS_FILE, "utf-8"))
console.log(`Evaluating ${pairs.length} pairs...\n`)

let agreements = 0
let total = 0
const mismatches: Array<{ id: number; label: string; v4: boolean; oracle: boolean; reasoning_v4: string; reasoning_oracle: string }> = []

for (const pair of pairs) {
  const userPrompt = `BEAT: ${pair.beatDescription}\nCHARACTERS EXPECTED: ${pair.beatCharacters.join(", ")}\n\nPROSE:\n---\n${pair.prose.slice(0, 2000)}\n---`

  // Run V4 and oracle in parallel
  const [v4Result, oracleResult] = await Promise.all([
    callModel(V4_ADAPTER, userPrompt),
    callModel(CEREBRAS_ORACLE, userPrompt),
  ])

  if (!v4Result || !oracleResult) {
    console.log(`  [${pair.label}] SKIP — parse error`)
    continue
  }

  const agree = v4Result.events_present === oracleResult.events_present
  if (agree) agreements++
  total++

  const mark = agree ? "✓" : "✗"
  console.log(`  ${mark} [${pair.label}] v4=${v4Result.events_present} oracle=${oracleResult.events_present}`)
  if (!agree) {
    console.log(`    V4:     ${v4Result.reasoning}`)
    console.log(`    Oracle: ${oracleResult.reasoning}`)
    mismatches.push({
      id: pair.id,
      label: pair.label,
      v4: v4Result.events_present,
      oracle: oracleResult.events_present,
      reasoning_v4: v4Result.reasoning,
      reasoning_oracle: oracleResult.reasoning,
    })
  }
}

const accuracy = Math.round(agreements / total * 100)
console.log(`\n━━━ Results ━━━`)
console.log(`Accuracy: ${agreements}/${total} (${accuracy}%)`)
console.log(`Mismatches: ${mismatches.length}`)

if (mismatches.length > 0) {
  console.log(`\nMismatch breakdown:`)
  const fp = mismatches.filter(m => m.v4 && !m.oracle).length
  const fn = mismatches.filter(m => !m.v4 && m.oracle).length
  console.log(`  False positives (V4=true, oracle=false): ${fp}`)
  console.log(`  False negatives (V4=false, oracle=true): ${fn}`)
}

console.log(`\nTarget: ≥93%`)
console.log(`Status: ${accuracy >= 93 ? "PASS ✓" : accuracy >= 85 ? "MARGINAL" : "FAIL ✗"}`)

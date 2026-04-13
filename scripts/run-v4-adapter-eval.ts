/**
 * Run the V4 adapter on the 30 eval pairs and write labels to /tmp/v4-adapter-labels.json.
 * Oracle labels come from Sonnet subagents separately.
 *
 * Usage: bun scripts/run-v4-adapter-eval.ts
 */

import { readFileSync, writeFileSync } from "fs"
import { getTransport } from "../src/transport.ts"

const PAIRS_FILE = "/tmp/eval-pairs-30.json"
const OUTPUT = "/tmp/v4-adapter-labels.json"

const V4_ADAPTER = {
  provider: "wandb" as const,
  model: "wandb-artifact:///andre14618-/novel-harness/adherence-checker-v4",
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

const pairs: EvalPair[] = JSON.parse(readFileSync(PAIRS_FILE, "utf-8"))
const transport = getTransport()
const results: Array<{ id: number; label: string; events_present: boolean; evidence: string; reasoning: string }> = []

console.log(`Running V4 adapter on ${pairs.length} pairs...`)

for (const pair of pairs) {
  const userPrompt = `BEAT: ${pair.beatDescription}\nCHARACTERS EXPECTED: ${pair.beatCharacters.join(", ")}\n\nPROSE:\n---\n${pair.prose.slice(0, 2000)}\n---`

  try {
    const result = await transport.execute({
      provider: V4_ADAPTER.provider,
      model: V4_ADAPTER.model,
      temperature: 0.1,
      maxTokens: 512,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
    })

    const text = result.content.trim().replace(/[\x00-\x1F\x7F]+$/, "").trim()
    const jsonStart = text.indexOf("{")
    const jsonEnd = text.lastIndexOf("}") + 1
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd))

    results.push({
      id: pair.id,
      label: pair.label,
      events_present: !!parsed.events_present,
      evidence: parsed.evidence ?? "",
      reasoning: parsed.reasoning ?? "",
    })
    console.log(`  [${pair.label}] ${parsed.events_present ? "true" : "false"} — ${(parsed.reasoning ?? "").slice(0, 70)}`)
  } catch (err) {
    console.error(`  [${pair.label}] ERROR: ${err instanceof Error ? err.message : String(err)}`)
    results.push({ id: pair.id, label: pair.label, events_present: false, evidence: "", reasoning: "ERROR" })
  }
}

writeFileSync(OUTPUT, JSON.stringify(results, null, 2))
console.log(`\nWrote ${results.length} labels to ${OUTPUT}`)

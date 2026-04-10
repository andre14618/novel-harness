/**
 * Score gpt-oss-120b on the decomposed adherence eval — same 160 pairs as exp #122.
 *
 * Runs ONLY gpt-oss (the other 3 models already have results in exp #122).
 * Outputs per-variant + per-slot breakdown in the same format for direct comparison.
 *
 * Usage: bun scripts/score-adherence-gptoss.ts
 *        bun scripts/score-adherence-gptoss.ts --sample 16  (smoke)
 */

import { readFileSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"
import type { ProviderName } from "../models/registry"

const PAIRS_PATH = join(import.meta.dir, "../lora-data/adherence-checker-pairs.jsonl")
const SAMPLE_ARG = process.argv.indexOf("--sample")
const SAMPLE_N = SAMPLE_ARG !== -1 ? parseInt(process.argv[SAMPLE_ARG + 1]) : null

interface Pair {
  messages: Array<{ role: string; content: string }>
  _meta: { scenario: string; variant: string }
}

interface ParsedPair {
  scenario: string
  variant: string
  beat: string
  setting: string
  characters: string[]
  prose: string
  expectedPass: boolean
}

function parsePair(p: Pair): ParsedPair {
  const user = p.messages[1].content
  const expected = JSON.parse(p.messages[2].content) as { pass: boolean }
  const beatMatch = user.match(/Beat:\s*"([^"]*)"/)
  const settingMatch = user.match(/Setting:\s*"([^"]*)"/)
  const charsMatch = user.match(/Characters expected:\s*([^\n]*)/)
  const proseMatch = user.match(/Prose:\n---\n([\s\S]*?)\n---/)
  return {
    scenario: p._meta.scenario,
    variant: p._meta.variant,
    beat: beatMatch?.[1] ?? "",
    setting: settingMatch?.[1] ?? "",
    characters: (charsMatch?.[1] ?? "").split(",").map(s => s.trim()).filter(Boolean),
    prose: proseMatch?.[1].trim() ?? "",
    expectedPass: expected.pass,
  }
}

// Same prompts as score-adherence-decomposed.ts and production adherence-checker.ts
const EVENTS_SYSTEM = `You verify whether the prose ENACTS a specific scene beat on-page.

Find the passage where the beat's action happens — characters performing the action, dialogue, narration of the action as it occurs in scene.

Rules:
- "Enacted" means the action happens IN SCENE during this prose. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- A reference to the action as having happened earlier (off-page, past-tense, summarized in narration as backstory) does NOT count as enacted.
- Characters being merely present in the scene is NOT enough — the beat's specific action must occur.
- If you cannot find a passage where the beat is enacted, return events_present=false. Do NOT default to true.

Respond with ONLY valid JSON in this exact shape:
{
  "events_present": true | false,
  "evidence": "<short quoted passage from the prose, ~1-3 sentences>",
  "reasoning": "<one sentence>"
}`

const SETTING_SYSTEM = `You verify whether the prose CONTRADICTS the expected setting for a scene beat.

The expected setting is a brief description (e.g., "a crowded tavern, evening, smoky torchlight"). This beat may be one of several in a chapter — the prose often inherits setting from earlier beats and does NOT re-establish it. That is normal craft and not a mismatch.

ONLY flag setting_matches=false when the prose places the scene in a CLEARLY DIFFERENT setting than expected. Examples of real contradictions:
- Different named location (tavern vs castle, kitchen vs garden)
- Different building or room when the beat names a specific one
- Outdoors vs indoors when the beat is explicit about which
- Different time of day when the beat is explicit (dawn vs midnight)
- Different city, region, or world

If the prose simply doesn't mention setting markers — it's continuing a scene from a prior beat, focused on dialogue, character interiority, or close action — return setting_matches=true. Absence of setting markers is NOT a mismatch. Only POSITIVE evidence of a different setting counts.

Respond with ONLY valid JSON in this exact shape:
{
  "setting_matches": true | false,
  "expected_setting": "<the expected setting, restated>",
  "actual_setting": "<the setting the prose establishes, or 'inherited from prior beat' if not re-established>",
  "reasoning": "<one sentence>"
}`

const TANGENT_SYSTEM = `You measure whether the prose has DRIFTED OFF the scene beat into unrelated content.

A "tangent" is the prose abandoning the beat to pursue something the beat does not call for: an unrelated subplot, scene drift to another character's storyline, lengthy unrelated backstory dump, or the prose pivoting away from the beat entirely.

The following are NOT tangents — they are normal prose craft and must NOT be flagged:
- Atmospheric description (weather, sensory details, environmental texture)
- Character interiority (POV character's thoughts, feelings, memories triggered by what's happening)
- Sensory grounding (what the character sees, hears, smells, touches)
- Emotional reactions to the beat's action
- Brief flashes of backstory the beat itself implies
- Dialogue that develops the beat's situation, even if it briefly digresses
- Pacing variation, internal monologue, descriptive flourishes

The threshold for is_tangent=true is HIGH: more than ~60% of the prose must be doing something completely unrelated to the beat. If the beat is happening anywhere in the prose — even surrounded by atmospheric and interior detail — is_tangent=false.

Estimate the off-spec fraction (0.0 = entirely on-spec, 1.0 = entirely off-spec). Only quote a passage if you are flagging is_tangent=true.

Respond with ONLY valid JSON in this exact shape:
{
  "off_spec_fraction": 0.0,
  "off_spec_quote": "<quoted passage, or empty string>",
  "is_tangent": true | false,
  "reasoning": "<one sentence>"
}`

const CHARACTER_SYSTEM = `You verify whether characters in the prose behave consistently with their roles in a scene beat.

A character "acts contrary to their role" when they do something the beat says they should NOT do, or when they take an action that reverses the beat's intended dynamic (e.g., the beat calls for the character to refuse but the prose has them immediately agree, or the beat calls for confrontation but the prose has them stay silent).

Do NOT flag normal creative interpretation: dialogue rewording, gesture additions, emotional shading, or pacing variation. Only flag clear contradictions.

Respond with ONLY valid JSON in this exact shape:
{
  "character_contradiction": true | false,
  "evidence": "<quoted passage where contradiction occurs, or empty string>",
  "reasoning": "<one sentence>"
}`

type Slot = "events" | "setting" | "tangent" | "character"
const SLOTS: Slot[] = ["events", "setting", "tangent", "character"]
const SYSTEMS: Record<Slot, string> = {
  events: EVENTS_SYSTEM, setting: SETTING_SYSTEM,
  tangent: TANGENT_SYSTEM, character: CHARACTER_SYSTEM,
}

function buildUser(slot: Slot, p: ParsedPair): string {
  const chars = p.characters.join(", ")
  switch (slot) {
    case "events":    return `BEAT: ${p.beat}\nCHARACTERS EXPECTED: ${chars}\n\nPROSE:\n---\n${p.prose}\n---`
    case "setting":   return `BEAT: ${p.beat}\nEXPECTED SETTING: ${p.setting}\n\nPROSE:\n---\n${p.prose}\n---`
    case "tangent":   return `BEAT: ${p.beat}\n\nPROSE:\n---\n${p.prose}\n---`
    case "character": return `BEAT: ${p.beat}\nCHARACTERS EXPECTED: ${chars}\n\nPROSE:\n---\n${p.prose}\n---`
  }
}

async function runSlot(slot: Slot, p: ParsedPair): Promise<{ flag: boolean | null; ms: number }> {
  const transport = getTransport()
  const t0 = performance.now()
  try {
    const result = await transport.execute({
      systemPrompt: SYSTEMS[slot],
      userPrompt: buildUser(slot, p),
      provider: "groq" as ProviderName,
      model: "openai/gpt-oss-120b",
      temperature: 0.1,
      maxTokens: 384,
      responseFormat: { type: "json_object" },
    })
    const ms = performance.now() - t0
    let content = result.content.trim()
    if (content.startsWith("```")) content = content.replace(/^```[a-z]*\n/, "").replace(/\n```$/, "")
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) content = jsonMatch[0]
    const parsed = JSON.parse(content)
    let flag: boolean
    if (slot === "events")        flag = parsed.events_present === false
    else if (slot === "setting")  flag = parsed.setting_matches === false
    else if (slot === "tangent")  flag = parsed.is_tangent === true
    else                          flag = parsed.character_contradiction === true
    return { flag, ms }
  } catch {
    return { flag: null, ms: performance.now() - t0 }
  }
}

const VARIANTS = ["PASS_CLEAN", "PASS_PARAPHRASE", "PASS_REORDER", "PASS_ATMOSPHERIC",
                  "FAIL_MISSING", "FAIL_CHAR", "FAIL_SETTING", "FAIL_TANGENT"]

async function main() {
  const lines = readFileSync(PAIRS_PATH, "utf8").trim().split("\n")
  let rawPairs: Pair[] = lines.map(l => JSON.parse(l))
  if (SAMPLE_N && SAMPLE_N < rawPairs.length) {
    rawPairs = [...rawPairs].sort(() => Math.random() - 0.5).slice(0, SAMPLE_N)
    console.log(`Sampling ${SAMPLE_N} of ${lines.length} pairs`)
  }
  const pairs = rawPairs.map(parsePair)
  console.log(`Pairs: ${pairs.length}  model: gpt-oss-120b (Groq)  slots: 4`)
  console.log(`LLM calls: ${pairs.length * 4}\n`)

  const expId = await createTuningExperiment(
    "decomposed-calls",
    `Adherence-checker decomposed: gpt-oss-120b ONLY on same ${pairs.length} pairs as exp #122 (adding missing model to the ladder)`,
    {
      pairs: pairs.length,
      model: { key: "gptoss120b", label: "gpt-oss-120b (Groq)", provider: "groq", model: "gpt-oss-120b" },
      temperature: 0.1,
      slots: SLOTS,
      relatedExperiments: [122],
      hypothesis: "235B oracle is only 85% on FAIL_MISSING (events). gpt-oss-120b is the best chapter-plan checker (90% in exp #119) and may be a stronger events judge. If gpt-oss events accuracy >= 95%, it becomes the events teacher for V3 training data.",
    },
    { target: "adherence-checker", dimension: "calibration" },
  )
  console.log(`Experiment: ${expId}\n`)

  // Stats
  const byVariant = new Map<string, { agree: number; total: number; fp: number; ff: number }>()
  const slotFires: Record<Slot, { fired: number; total: number; errors: number }> = {
    events: { fired: 0, total: 0, errors: 0 },
    setting: { fired: 0, total: 0, errors: 0 },
    tangent: { fired: 0, total: 0, errors: 0 },
    character: { fired: 0, total: 0, errors: 0 },
  }
  const byVariantSlotFires = new Map<string, Record<Slot, number>>()
  let totalAgree = 0, totalPairs = 0, totalFP = 0, totalFF = 0, totalErrors = 0
  const latencies: number[] = []

  const CONCURRENCY = 4
  for (let i = 0; i < pairs.length; i += CONCURRENCY) {
    const batch = pairs.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async (p, bi) => {
      const idx = i + bi
      const results = await Promise.all(SLOTS.map(slot => runSlot(slot, p)))
      let anyFlag = false, anyError = false
      if (!byVariantSlotFires.has(p.variant)) {
        byVariantSlotFires.set(p.variant, { events: 0, setting: 0, tangent: 0, character: 0 })
      }
      const vf = byVariantSlotFires.get(p.variant)!

      for (let si = 0; si < SLOTS.length; si++) {
        const slot = SLOTS[si]
        const r = results[si]
        if (r.flag === null) { slotFires[slot].errors++; anyError = true; continue }
        slotFires[slot].total++
        if (r.flag) { slotFires[slot].fired++; vf[slot]++; anyFlag = true }
        latencies.push(r.ms)
      }

      if (anyError && !anyFlag) { totalErrors++; return }

      const modelPass = !anyFlag
      const matches = modelPass === p.expectedPass
      if (!byVariant.has(p.variant)) byVariant.set(p.variant, { agree: 0, total: 0, fp: 0, ff: 0 })
      const v = byVariant.get(p.variant)!
      v.total++
      totalPairs++
      if (matches) { v.agree++; totalAgree++ }
      else if (p.expectedPass && !modelPass) { v.ff++; totalFF++ }  // false fail
      else { v.fp++; totalFP++ }  // false pass

      const tag = matches ? "OK" : "✗"
      console.log(`[${idx + 1}/${pairs.length}] ${p.scenario}/${p.variant} (${p.expectedPass ? "PASS" : "FAIL"}) → ${tag}`)
    }))
  }

  // Report
  console.log("\n" + "═".repeat(70))
  console.log("RESULTS — gpt-oss-120b decomposed adherence (compare with exp #122)")
  console.log("═".repeat(70) + "\n")

  console.log(`Overall: ${Math.round(totalAgree/totalPairs*100)}% (${totalAgree}/${totalPairs})  FP=${totalFP} FF=${totalFF} errors=${totalErrors}`)
  console.log(`Avg latency: ${Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length)}ms\n`)

  console.log("Per-variant:")
  for (const variant of VARIANTS) {
    const v = byVariant.get(variant)
    if (!v) { console.log(`  ${variant.padEnd(22)} —`); continue }
    console.log(`  ${variant.padEnd(22)} ${Math.round(v.agree/v.total*100)}% (${v.agree}/${v.total})  FP=${v.fp} FF=${v.ff}`)
  }

  console.log("\nPer-slot fire rates:")
  for (const slot of SLOTS) {
    const s = slotFires[slot]
    console.log(`  ${slot.padEnd(12)} fired ${s.fired}/${s.total} (${Math.round(s.fired/s.total*100)}%)  errors=${s.errors}`)
  }

  console.log("\nSlot fires per variant:")
  for (const variant of VARIANTS) {
    const vf = byVariantSlotFires.get(variant)
    const v = byVariant.get(variant)
    if (!vf || !v) continue
    console.log(`  ${variant.padEnd(22)} events=${vf.events}/${v.total} setting=${vf.setting}/${v.total} tangent=${vf.tangent}/${v.total} character=${vf.character}/${v.total}`)
  }

  // Compare with exp #122 (hardcoded reference)
  console.log("\n--- Exp #122 reference (same 160 pairs) ---")
  console.log("  llama8b:   76%  FAIL_MISSING=90%  FAIL_SETTING=100%  FAIL_TANGENT=100%  FAIL_CHAR=95%")
  console.log("  qwen14b:   91%  FAIL_MISSING=65%  FAIL_SETTING=100%  FAIL_TANGENT=90%   FAIL_CHAR=85%")
  console.log("  qwen235b:  97%  FAIL_MISSING=85%  FAIL_SETTING=100%  FAIL_TANGENT=100%  FAIL_CHAR=95%")

  await concludeExperiment(expId, JSON.stringify({
    pairs: pairs.length,
    model: "openai/gpt-oss-120b",
    overallPct: Math.round(totalAgree / totalPairs * 100),
    agree: totalAgree, total: totalPairs,
    falsePass: totalFP, falseFail: totalFF, errors: totalErrors,
    slots: slotFires,
    byVariant: Object.fromEntries([...byVariant].map(([k, v]) => [k, { ...v, pct: Math.round(v.agree / v.total * 100) }])),
    byVariantSlotFires: Object.fromEntries(byVariantSlotFires),
  }))
  console.log(`\nConcluded experiment ${expId}.`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })

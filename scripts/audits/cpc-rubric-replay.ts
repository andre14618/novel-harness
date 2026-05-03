#!/usr/bin/env bun
/**
 * Chapter-plan-checker rubric-modification replay.
 *
 * Loads the 25 captured (plan, prose) cases from the audit sample,
 * re-runs each through DeepSeek V4 Flash with TWO arms:
 *   - control: the production system prompt (re-run, measures stochasticity)
 *   - v2: production prompt + two rubric modifications targeting the
 *         implicit-vs-explicit-delivery FP class identified in the audit.
 *
 * No DB writes (novelId omitted in executeAndLog). Pays real DeepSeek tokens.
 *
 * Output: JSON to stdout with per-entry results from both arms, plus a summary
 * tallying what flipped relative to the audit's TP/FP/GRAY labels.
 */

import { getTransport } from "../src/transport"
import { chapterPlanCheckSchema } from "../src/agents/chapter-plan-checker/schema"
import { extractJSON } from "../src/llm"
import { PROVIDERS } from "../src/models/registry"

const SAMPLE_PATH = "/Users/andre/Desktop/personal_projects/novel-harness/chapter-plan-checker-fp-sample.json"

// Audit-doc-assigned labels (per checker-quality-audit-2026-05-03-chapter-plan-checker.md).
// Entry order matches the sample file order (most-recent first).
const LABELS: Array<"TP" | "FP" | "GRAY"> = [
  "GRAY", "TP", "TP", "FP", "GRAY", "TP", "TP", "TP", "TP", "TP",   // 0-9
  "TP",   "TP", "FP", "FP", "FP", "FP", "GRAY", "GRAY", "GRAY", "FP", // 10-19
  "FP",   "TP", "TP", "GRAY", "FP",                                  // 20-24
]

const PROD_PROMPT = `You verify that chapter prose captures the INTENT of a chapter plan. Beat descriptions are creative inspiration, NOT literal scripts.

Compare the CHAPTER PROSE against the CHAPTER PLAN and fill out a structured checklist. You MUST fill out every field before reaching a verdict. Do not skip any field.

For each check, write down what you actually observed in the prose. Then reach a verdict based on your own observations.

CHECKS TO FILL OUT:

1. **setting_match** — Compare the plan's setting to where the prose actually takes place.
   - planned: copy the setting field from the plan
   - observed: quote a phrase from the prose that establishes the location
   - matches: true if the observed location is the same place as planned (minor spatial variation is fine — different room in the same building is a match). false if the prose is set in a completely different location. If the prose transitions between locations across beats, matches=true as long as the primary setting appears.

2. **emotional_arc_correct** — Does the prose match the overall emotional direction of the plan's final beat? true if the ending emotion is in the same direction as planned (e.g., both resolve to anger, both resolve to relief). false ONLY if the direction is REVERSED (a tension-escalating beat resolved it instead, or vice versa).

3. **pass** — PASS unless:
   - setting_match is false, OR
   - emotional_arc_correct is false, OR
   - the prose introduces a major plot contradiction (e.g., a character dies when the plan has them alive later, a resolved conflict is re-opened without cause, a character knows something they shouldn't yet)

4. **deviations** — list every specific problem you identified. Empty list if pass=true.
   Each deviation MUST have:
   - \`description\` — the specific problem in plain English
   - \`beat_index\` — the 0-indexed beat number in the plan's beats[] array that the problem refers to. Use \`null\` ONLY when the problem is chapter-level and cannot be attributed to a specific beat (e.g. setting mismatch spanning the whole chapter, or an emotional arc that drifts across many beats).

DO NOT flag these as deviations — they are normal creative interpretation:
- Paraphrased dialogue
- Reordered details within a beat
- Added atmospheric details, props, or sensory descriptions
- Slightly different physical actions that serve the same narrative purpose
- Minor spatial variations (sitting vs standing, different part of the room)
- Missing individual beat events
- Characters absent from a single beat

Respond with ONLY valid JSON in this exact shape:
{
  "setting_match": { "planned": "...", "observed": "...", "matches": true },
  "emotional_arc_correct": true,
  "pass": true,
  "deviations": [
    { "description": "Taryn refuses the offer, but plan's beat 10 requires acceptance", "beat_index": 10 }
  ]
}`

// V2: adds the "demonstration as delivery" principle and two new DO-NOT-FLAG
// items targeting the implicit-vs-explicit FP class. Recall-preserving by
// construction (only ADDS items to DO-NOT-FLAG; never removes any TP-eligible
// criteria like setting/arc/major-contradiction).
const V2_PROMPT = `You verify that chapter prose captures the INTENT of a chapter plan. Beat descriptions are creative inspiration, NOT literal scripts.

Compare the CHAPTER PROSE against the CHAPTER PLAN and fill out a structured checklist. You MUST fill out every field before reaching a verdict. Do not skip any field.

For each check, write down what you actually observed in the prose. Then reach a verdict based on your own observations.

**TREAT DEMONSTRATION AS DELIVERY.** When the plan requires establishing a fact (e.g. an entry in established_facts, a knowledge_change, a character_state_change), the fact counts as established if EITHER (a) it is stated explicitly in dialogue, narration, or character thought, OR (b) it is *shown to be true* through the events of the scene — characters acting on it, consequences flowing from it, evidence presented for it. Do not require an explicit verbal declaration. Only flag a missing established fact when NEITHER statement nor demonstration is present in the prose.

CHECKS TO FILL OUT:

1. **setting_match** — Compare the plan's setting to where the prose actually takes place.
   - planned: copy the setting field from the plan
   - observed: quote a phrase from the prose that establishes the location
   - matches: true if the observed location is the same place as planned (minor spatial variation is fine — different room in the same building is a match). false if the prose is set in a completely different location. If the prose transitions between locations across beats, matches=true as long as the primary setting appears.

2. **emotional_arc_correct** — Does the prose match the overall emotional direction of the plan's final beat? true if the ending emotion is in the same direction as planned (e.g., both resolve to anger, both resolve to relief). false ONLY if the direction is REVERSED (a tension-escalating beat resolved it instead, or vice versa).

3. **pass** — PASS unless:
   - setting_match is false, OR
   - emotional_arc_correct is false, OR
   - the prose introduces a major plot contradiction (e.g., a character dies when the plan has them alive later, a resolved conflict is re-opened without cause, a character knows something they shouldn't yet)

4. **deviations** — list every specific problem you identified. Empty list if pass=true.
   Each deviation MUST have:
   - \`description\` — the specific problem in plain English
   - \`beat_index\` — the 0-indexed beat number in the plan's beats[] array that the problem refers to. Use \`null\` ONLY when the problem is chapter-level and cannot be attributed to a specific beat (e.g. setting mismatch spanning the whole chapter, or an emotional arc that drifts across many beats).

DO NOT flag these as deviations — they are normal creative interpretation:
- Paraphrased dialogue
- Reordered details within a beat
- Added atmospheric details, props, or sensory descriptions
- Slightly different physical actions that serve the same narrative purpose
- Minor spatial variations (sitting vs standing, different part of the room)
- Missing individual beat events
- Characters absent from a single beat
- Required facts that are demonstrated through scene events or consequences, even if not stated as exposition (the demonstration-as-delivery principle above)
- Established facts whose substance is shown with different surface phrasing than the plan used (e.g. "Lord Brennan" instead of "Lord Sorcerer Brennan", "focus on quota fulfillment" satisfying "supervisor prioritizes quota over investigation")

Respond with ONLY valid JSON in this exact shape:
{
  "setting_match": { "planned": "...", "observed": "...", "matches": true },
  "emotional_arc_correct": true,
  "pass": true,
  "deviations": [
    { "description": "Taryn refuses the offer, but plan's beat 10 requires acceptance", "beat_index": 10 }
  ]
}`

interface SampleEntry {
  id: number
  novel_id: string
  chapter: number
  user_prompt: string
  response_content: string
}

interface ArmResult {
  pass: boolean | null
  deviation_count: number
  setting_matches: boolean | null
  emotional_arc_correct: boolean | null
  deviations: Array<{ description: string; beat_index: number | null }>
  raw_error?: string
}

async function runOne(systemPrompt: string, userPrompt: string): Promise<ArmResult> {
  try {
    const resp = await getTransport().execute({
      systemPrompt,
      userPrompt,
      model: "deepseek-v4-flash",
      provider: "deepseek",
      temperature: 0.2,
      maxTokens: 4096,
      responseFormat: { type: "json_object" },
      extraBody: { thinking: { type: "enabled" } },
      callerId: "cpc-replay",
    })
    const cleaned = extractJSON(resp.content)
    const parsed = chapterPlanCheckSchema.parse(JSON.parse(cleaned))
    return {
      pass: parsed.pass,
      deviation_count: parsed.deviations.length,
      setting_matches: parsed.setting_match?.matches ?? null,
      emotional_arc_correct: parsed.emotional_arc_correct ?? null,
      deviations: parsed.deviations.map(d => ({ description: d.description, beat_index: d.beat_index })),
    }
  } catch (e: any) {
    return {
      pass: null,
      deviation_count: 0,
      setting_matches: null,
      emotional_arc_correct: null,
      deviations: [],
      raw_error: e?.message ?? String(e),
    }
  }
}

async function main() {
  const sample = await Bun.file(SAMPLE_PATH).json() as SampleEntry[]
  console.error(`Loaded ${sample.length} cases — running K=3 per arm × 2 arms = 6 calls per case`)

  const K = 3
  const results: any[] = []
  // 25 cases × 6 parallel calls per case = 150 total. Cases sequential to keep
  // log readable; calls within a case parallel since DeepSeek handles 6-way fine.
  for (let i = 0; i < sample.length; i++) {
    const entry = sample[i]!
    const label = LABELS[i] ?? "?"
    process.stderr.write(`[${i}/${sample.length}] id=${entry.id} label=${label}... `)
    const t0 = Date.now()
    const calls: Promise<ArmResult>[] = []
    for (let k = 0; k < K; k++) calls.push(runOne(PROD_PROMPT, entry.user_prompt))
    for (let k = 0; k < K; k++) calls.push(runOne(V2_PROMPT, entry.user_prompt))
    const settled = await Promise.all(calls)
    const control = settled.slice(0, K)
    const v2 = settled.slice(K)
    const ms = Date.now() - t0
    const fmt = (arm: ArmResult[]) => arm.map(a => a.pass === null ? "E" : (a.pass ? "p" : "F")).join("")
    process.stderr.write(`ctl=${fmt(control)} v2=${fmt(v2)} ${ms}ms\n`)
    results.push({
      idx: i,
      id: entry.id,
      novel_id: entry.novel_id,
      chapter: entry.chapter,
      audit_label: label,
      control,
      v2,
    })
  }

  // Aggregate verdicts at gate level. For an arm of K calls, define:
  //   K1   — first call only (single-shot baseline)
  //   AND  — fires (pass=false) iff ≥2 of K calls return pass=false
  //   OR   — fires (pass=false) iff ≥1 of K calls returns pass=false
  // Errored calls count as neither pass nor fail; AND/OR computed over non-errored.
  const verdict = (arm: ArmResult[], gate: "K1" | "AND" | "OR"): "fire" | "pass" | "errored" => {
    if (gate === "K1") {
      const r = arm[0]!
      return r.pass === null ? "errored" : (r.pass ? "pass" : "fire")
    }
    const valid = arm.filter(r => r.pass !== null)
    if (valid.length === 0) return "errored"
    const fires = valid.filter(r => r.pass === false).length
    if (gate === "AND") return fires >= 2 ? "fire" : "pass"
    return fires >= 1 ? "fire" : "pass"
  }

  const tallyGate = (filterFn: (r: any) => boolean, armKey: "control" | "v2", gate: "K1" | "AND" | "OR") => {
    const rs = results.filter(filterFn)
    const fires = rs.filter(r => verdict(r[armKey], gate) === "fire").length
    const passes = rs.filter(r => verdict(r[armKey], gate) === "pass").length
    const errs = rs.filter(r => verdict(r[armKey], gate) === "errored").length
    return { n: rs.length, fires, passes, errored: errs }
  }

  const summary: Record<string, any> = {}
  for (const lbl of ["TP", "FP", "GRAY"] as const) {
    summary[lbl] = {
      control_K1: tallyGate(r => r.audit_label === lbl, "control", "K1"),
      control_AND: tallyGate(r => r.audit_label === lbl, "control", "AND"),
      control_OR:  tallyGate(r => r.audit_label === lbl, "control", "OR"),
      v2_K1:       tallyGate(r => r.audit_label === lbl, "v2", "K1"),
      v2_AND:      tallyGate(r => r.audit_label === lbl, "v2", "AND"),
      v2_OR:       tallyGate(r => r.audit_label === lbl, "v2", "OR"),
    }
  }
  summary.overall = {
    control_K1: tallyGate(() => true, "control", "K1"),
    control_AND: tallyGate(() => true, "control", "AND"),
    control_OR:  tallyGate(() => true, "control", "OR"),
    v2_K1:       tallyGate(() => true, "v2", "K1"),
    v2_AND:      tallyGate(() => true, "v2", "AND"),
    v2_OR:       tallyGate(() => true, "v2", "OR"),
  }

  // Within-arm flake rate: of the cases where the arm fired at least once,
  // what fraction had unanimous (3/3) fires vs split (1/3 or 2/3)?
  const flake = (armKey: "control" | "v2") => {
    let unanimous = 0, split = 0, never = 0
    for (const r of results) {
      const valid = (r[armKey] as ArmResult[]).filter(a => a.pass !== null)
      const fires = valid.filter(a => a.pass === false).length
      if (fires === valid.length && fires > 0) unanimous++
      else if (fires === 0) never++
      else split++
    }
    return { unanimous, split, never }
  }
  summary.flake = { control: flake("control"), v2: flake("v2") }

  console.log(JSON.stringify({ summary, results }, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })

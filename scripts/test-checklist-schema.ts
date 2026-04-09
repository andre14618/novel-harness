/**
 * Limited test: does a structured-checklist output schema close the 14B gap
 * on chapter-plan-checker?
 *
 * Hypothesis: the current failure mode is inattention — base 14B rubber-stamps
 * chapters because it can skip checking each individual requirement and jump
 * straight to `{"pass": true}`. Forcing the output to include per-requirement
 * observations (setting, characters, beats) removes the option to skip.
 *
 * Test design:
 *   - 16 pairs total (2 per variant × 8 variants) from the existing 80-pair set
 *   - New prompt asking for structured checklist output + same old verdict
 *   - Run both providers (gpt-oss-120b and Qwen3-14B-Instruct) on the same 16
 *   - Compare against the flat-schema baseline from exp #107 on those same pairs
 *
 * What we're watching for:
 *   1. Does 120B's agreement with labels go UP with the checklist? (sanity check)
 *   2. Does 14B's direct agreement with 120B go UP? (the actual question)
 *   3. Is the 14B bias still 100% one-sided, or does it break symmetrically now?
 *
 * Decision:
 *   - If 14B ≥ 85% direct agreement → swap the prompt, no fine-tune needed
 *   - If 14B 70-85% → SFT on this structured format has a clear target
 *   - If 14B < 70% → structured output doesn't fix it, reasoning ceiling is real
 *
 * Usage:
 *   GROQ_API_KEY=... WANDB_API_KEY=... bun scripts/test-checklist-schema.ts
 */

import { readFileSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"

const PAIRS_PATH = join(import.meta.dir, "../lora-data/chapter-plan-checker-pairs.jsonl")

const CHECKLIST_PROMPT = `You verify that chapter prose captures the INTENT of a chapter plan. Beat descriptions are creative inspiration, NOT literal scripts.

Your job is to compare the CHAPTER PROSE against the CHAPTER PLAN and fill out a structured checklist. You MUST fill out every field in the checklist before reaching a verdict. Do not skip any field.

For each check, write down what you actually observed in the prose. Then reach a verdict based on your own observations.

CHECKS TO FILL OUT:

1. **setting_match** — Compare the plan's setting to where the prose actually takes place.
   - planned: copy the setting field from the plan
   - observed: quote a phrase from the prose that establishes the location
   - matches: true if the observed location is the same place as planned (minor spatial variation is fine — different room in the same building is a match). false if the prose is set in a completely different location.

2. **characters_present** — Check each character listed in the plan.
   - required: copy the character list from the plan
   - found: list every required character whose name appears or who is clearly referenced in the prose
   - missing: list every required character who never appears or is referenced

3. **beats_covered** — For each scene beat in the plan, check whether its core action appears somewhere in the prose.
   - For each beat: record the beat index, a brief description, and whether its core action (not exact wording) appears in the prose
   - A beat is covered if the central action and its narrative purpose happen, even if details are paraphrased, reordered, or given different atmospheric framing.
   - A beat is missing if its core action does NOT happen anywhere in the prose.

4. **emotional_arc_correct** — Does the prose match the overall emotional direction of the plan's final beat? true if the ending emotion is in the same direction as planned (e.g., both resolve to anger, both resolve to relief). false ONLY if the direction is REVERSED (a tension-escalating beat resolved it instead, or vice versa).

5. **pass** — PASS unless:
   - setting_match is false, OR
   - characters_present.missing is non-empty, OR
   - any beats_covered entry has found_in_prose=false, OR
   - emotional_arc_correct is false, OR
   - the prose introduces a major plot contradiction (e.g., a character dies when the plan has them alive later)

6. **deviations** — list every specific problem you identified. Empty list if pass=true.

DO NOT flag these as deviations — they are normal creative interpretation:
- Paraphrased dialogue (the writer doesn't need to use exact quotes from the beat)
- Reordered details within a beat
- Added atmospheric details, props, or sensory descriptions
- Slightly different physical actions that serve the same narrative purpose
- Minor spatial variations (sitting vs standing, different part of the room)

Respond with ONLY valid JSON in this exact shape:
{
  "setting_match": { "planned": "...", "observed": "...", "matches": true },
  "characters_present": { "required": ["..."], "found": ["..."], "missing": [] },
  "beats_covered": [
    { "beat_index": 1, "description": "...", "found_in_prose": true }
  ],
  "emotional_arc_correct": true,
  "pass": true,
  "deviations": []
}`

interface Pair {
  messages: Array<{ role: string; content: string }>
  _meta: { scenario: string; variant: string }
}

interface ChecklistResult {
  pass: boolean
  deviations: string[]
  raw: any
}

async function callChecker(
  provider: string,
  model: string,
  system: string,
  user: string,
): Promise<ChecklistResult | null> {
  const transport = getTransport()
  try {
    const result = await transport.execute({
      systemPrompt: system,
      userPrompt: user,
      provider: provider as any,
      model,
      temperature: 0.1,
      maxTokens: 3072,
      responseFormat: { type: "json_object" },
    })
    let content = result.content.trim()
    if (content.startsWith("```")) {
      content = content.replace(/^```[a-z]*\n/, "").replace(/\n```$/, "")
    }
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) content = jsonMatch[0]
    const parsed = JSON.parse(content)
    return {
      pass: Boolean(parsed.pass),
      deviations: Array.isArray(parsed.deviations) ? parsed.deviations : [],
      raw: parsed,
    }
  } catch (err) {
    return null
  }
}

async function main() {
  const lines = readFileSync(PAIRS_PATH, "utf8").trim().split("\n")
  const allPairs: Pair[] = lines.map(l => JSON.parse(l))

  const FULL = process.argv.includes("--full")
  const VARIANTS = [
    "PASS_CLEAN", "PASS_PARAPHRASE", "PASS_REORDER", "PASS_ATMOSPHERIC",
    "FAIL_MISSING_BEAT", "FAIL_MISSING_CHAR", "FAIL_REVERSED_ARC", "FAIL_WRONG_SETTING",
  ]

  let selected: Pair[]
  if (FULL) {
    selected = allPairs
    console.log(`Running FULL test: ${selected.length} pairs (all scenarios × all variants)\n`)
  } else {
    selected = []
    for (const v of VARIANTS) {
      const hits = allPairs.filter(p => p._meta.variant === v)
      if (hits.length >= 2) {
        selected.push(hits[0], hits[Math.floor(hits.length / 2)])
      }
    }
    console.log(`Selected ${selected.length} pairs (${VARIANTS.length} variants × 2)\n`)
  }

  const ORACLE = { provider: "groq", model: "openai/gpt-oss-120b", label: "120B" }
  const CANDIDATE = { provider: "wandb", model: "OpenPipe/Qwen3-14B-Instruct", label: "14B" }

  const expId = await createTuningExperiment(
    "data-validation",
    `Chapter-plan-checker checklist-schema test: 120B + 14B on 16 pairs (limited)`,
    { totalPairs: selected.length, oracle: ORACLE, candidate: CANDIDATE, schema: "structured-checklist" },
    { target: "chapter-plan-checker", dimension: "calibration" },
  )
  console.log(`Experiment: ${expId}\n`)

  type Row = {
    scenario: string
    variant: string
    label: boolean
    oraclePass: boolean | null
    candidatePass: boolean | null
    oracleRaw: any
    candidateRaw: any
  }

  const rows: Row[] = []

  for (let i = 0; i < selected.length; i++) {
    const pair = selected[i]
    // Swap the system prompt to our checklist prompt; keep the user payload identical
    const user = pair.messages[1].content
    const expected = JSON.parse(pair.messages[2].content)
    const label = Boolean(expected.pass)

    process.stdout.write(`[${i + 1}/${selected.length}] ${pair._meta.scenario}/${pair._meta.variant} ... `)

    const [oracleResult, candidateResult] = await Promise.all([
      callChecker(ORACLE.provider, ORACLE.model, CHECKLIST_PROMPT, user),
      callChecker(CANDIDATE.provider, CANDIDATE.model, CHECKLIST_PROMPT, user),
    ])

    const oraclePass = oracleResult?.pass ?? null
    const candidatePass = candidateResult?.pass ?? null

    rows.push({
      scenario: pair._meta.scenario,
      variant: pair._meta.variant,
      label,
      oraclePass,
      candidatePass,
      oracleRaw: oracleResult?.raw ?? null,
      candidateRaw: candidateResult?.raw ?? null,
    })

    const o = oraclePass === null ? "ERR" : oraclePass ? "PASS" : "FAIL"
    const c = candidatePass === null ? "ERR" : candidatePass ? "PASS" : "FAIL"
    const match = oraclePass !== null && candidatePass !== null && oraclePass === candidatePass
    process.stdout.write(`120B=${o} 14B=${c} ${match ? "✓" : "✗"} (label=${label ? "PASS" : "FAIL"})\n`)
  }

  // ── Report ──────────────────────────────────────────────────────────
  const valid = rows.filter(r => r.oraclePass !== null && r.candidatePass !== null)
  const oracleVsLabel = rows.filter(r => r.oraclePass === r.label).length
  const candidateVsLabel = rows.filter(r => r.candidatePass === r.label).length
  const directAgree = valid.filter(r => r.oraclePass === r.candidatePass).length

  console.log("\n════════════════════════════════════════")
  console.log(`CHECKLIST SCHEMA — ${selected.length} pair limited test`)
  console.log(`120B vs labels:           ${oracleVsLabel}/${selected.length} (${Math.round(oracleVsLabel / selected.length * 100)}%)`)
  console.log(`14B  vs labels:           ${candidateVsLabel}/${selected.length} (${Math.round(candidateVsLabel / selected.length * 100)}%)`)
  console.log(`14B vs 120B (direct):     ${directAgree}/${valid.length} (${Math.round(directAgree / valid.length * 100)}%)`)
  console.log("════════════════════════════════════════\n")

  // Bias pattern
  const disagreements = valid.filter(r => r.oraclePass !== r.candidatePass)
  const candidateStricter = disagreements.filter(d => d.oraclePass === true && d.candidatePass === false).length
  const oracleStricter = disagreements.filter(d => d.oraclePass === false && d.candidatePass === true).length
  console.log("Disagreement bias:")
  console.log(`  14B stricter:  ${candidateStricter}`)
  console.log(`  120B stricter: ${oracleStricter}`)

  console.log("\nBy variant (direct 14B↔120B):")
  const byVariant = new Map<string, { agree: number; total: number }>()
  for (const r of valid) {
    if (!byVariant.has(r.variant)) byVariant.set(r.variant, { agree: 0, total: 0 })
    const s = byVariant.get(r.variant)!
    s.total++
    if (r.oraclePass === r.candidatePass) s.agree++
  }
  for (const [v, s] of [...byVariant.entries()].sort()) {
    console.log(`  ${v.padEnd(22)} ${s.agree}/${s.total}`)
  }

  console.log("\nDisagreement detail:")
  for (const d of disagreements) {
    console.log(`  [${d.scenario}/${d.variant}] 120B=${d.oraclePass ? "PASS" : "FAIL"} 14B=${d.candidatePass ? "PASS" : "FAIL"} label=${d.label ? "PASS" : "FAIL"}`)
    if (d.candidateRaw?.setting_match?.matches === false) {
      console.log(`    14B setting observed: "${d.candidateRaw.setting_match.observed}"`)
    }
    if (d.candidateRaw?.characters_present?.missing?.length > 0) {
      console.log(`    14B said missing: ${JSON.stringify(d.candidateRaw.characters_present.missing)}`)
    }
  }

  // ── Baseline comparison vs exp #107 (flat schema) ─────────────────
  console.log("\n── Baseline from exp #107 (flat schema, full 80 pairs) ──")
  console.log("  120B vs labels: 85% | 14B vs labels: 53% | 14B↔120B direct: 58%")

  const conclusion = JSON.stringify({
    method: "structured-checklist schema, limited 16-pair test (2 per variant)",
    totalPairs: selected.length,
    oracleVsLabel: { agree: oracleVsLabel, pct: Math.round(oracleVsLabel / selected.length * 100) },
    candidateVsLabel: { agree: candidateVsLabel, pct: Math.round(candidateVsLabel / selected.length * 100) },
    directAgreement: { agree: directAgree, total: valid.length, pct: Math.round(directAgree / valid.length * 100) },
    bias: { candidateStricter, oracleStricter },
    byVariant: Object.fromEntries([...byVariant.entries()]),
    baseline_exp107_flat: { oracleVsLabel: 85, candidateVsLabel: 53, directAgreement: 58 },
    rows: rows.map(r => ({
      scenario: r.scenario,
      variant: r.variant,
      label: r.label,
      oraclePass: r.oraclePass,
      candidatePass: r.candidatePass,
    })),
  })
  await concludeExperiment(expId, conclusion)
  console.log(`\nExperiment ${expId} concluded.`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })

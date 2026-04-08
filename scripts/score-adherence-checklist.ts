/**
 * Adherence-checker checklist-schema benchmark.
 *
 * Companion to score-adherence-baseline.ts (exp #110, flat schema). Runs the
 * same 160-pair labeled set against the same 3 models, but swaps the system
 * prompt to a structured-checklist version that forces per-action observation
 * before the verdict. The hypothesis is that base Qwen3-14B's over-permissive
 * bias (33 false-pass / 1 false-fail in exp #110) is the same affirmative-
 * default-bias the chapter-plan-checker showed in exp #107, and that the same
 * mechanism that lifted chapter-plan-checker 14B from 58% → 75% (exp #109) will
 * transfer here. Concretely: forcing the model to write down each beat action
 * and quote where it appears (or doesn't) anchors the verdict on observed
 * tokens instead of streaming straight from prior.
 *
 * Reads the same lora-data/adherence-checker-pairs.jsonl. Strips the "Did the
 * prose execute the beat?" tail from the user prompt so the new system prompt's
 * instructions don't conflict with the old short-form ones, and replaces the
 * system message entirely.
 *
 * Usage:
 *   CEREBRAS_API_KEY=... GROQ_API_KEY=... WANDB_API_KEY=... \
 *     bun scripts/score-adherence-checklist.ts
 *   ... --sample 40
 */

import { readFileSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"
import type { ProviderName } from "../models/registry"

const PAIRS_PATH = join(import.meta.dir, "../lora-data/adherence-checker-pairs.jsonl")
const SAMPLE_ARG = process.argv.indexOf("--sample")
const SAMPLE_N = SAMPLE_ARG !== -1 ? parseInt(process.argv[SAMPLE_ARG + 1]) : null

// ── Checklist system prompt ────────────────────────────────────────────────
//
// Mirrors the chapter-plan-checker checklist (scripts/test-checklist-schema.ts)
// but adapted to a SINGLE beat. The decisive new field is `key_actions`: the
// model has to decompose the beat into its constituent actions, then quote
// where each action appears in the prose (or null if absent). FAIL_MISSING and
// FAIL_TANGENT — the two variants where 14B was rubber-stamping in exp #110 —
// become structurally hard to skip because the model literally has to write
// "quote: null, executed: false" rather than just emitting `pass: true`.

const CHECKLIST_SYSTEM = `You verify that prose executes a single scene beat. The beat is a brief description of what should happen; the prose is what actually happened. Your job is to fill out a checklist of observations BEFORE reaching a verdict.

You MUST fill out every field in the checklist. Do not skip fields. Reach the verdict based on what you actually wrote down, not on a first impression.

CHECKS TO FILL OUT:

1. **key_actions** — Decompose the beat into its constituent actions (typically 1-3 numbered clauses joined by ";" or "and"). For each action:
   - action: a short phrase naming the action (e.g., "Mira finds her purse in Donn's coat pocket")
   - quote: a phrase from the prose where this action occurs, OR null if the action does not occur anywhere
   - executed: true ONLY if quote is non-null AND the quoted prose shows the action actually happening; false if quote is null or the prose only alludes to / talks around the action without it occurring

2. **setting_match** — Compare the expected setting to where the prose actually takes place.
   - planned: copy the expected setting
   - observed: quote a phrase from the prose that establishes the location
   - matches: true if observed location matches planned (minor variation OK — different table in the same tavern is a match), false if a completely different location

3. **characters_present** — Check each expected character.
   - required: copy the expected character list
   - found: list characters whose name appears or who are clearly referenced in the prose
   - missing: list required characters who never appear

4. **character_behavior_consistent** — Does anything in the prose directly contradict a character's role as established by the beat? (e.g., the beat says X confronts Y but in the prose X is the one being confronted; the beat says X refuses but in the prose X agrees.)
   - violations: list each character whose behavior contradicts the beat, with a brief reason. Empty list if none.

5. **pass** — true ONLY if ALL of these are true:
   - every key_actions entry has executed=true, AND
   - setting_match.matches is true, AND
   - characters_present.missing is empty, AND
   - character_behavior_consistent.violations is empty

6. **deviations** — list each problem identified above. Empty if pass=true.

DO NOT flag these as deviations — they are normal creative interpretation:
- Paraphrased dialogue (the writer doesn't need to use exact quotes)
- Reordered events within the beat
- Added atmospheric / sensory description
- Slightly different physical staging that serves the same narrative purpose
- Minor spatial variation (different part of the same location)

Respond with ONLY valid JSON in this exact shape:
{
  "key_actions": [
    { "action": "...", "quote": "...", "executed": true }
  ],
  "setting_match": { "planned": "...", "observed": "...", "matches": true },
  "characters_present": { "required": ["..."], "found": ["..."], "missing": [] },
  "character_behavior_consistent": { "violations": [] },
  "pass": true,
  "deviations": []
}`

// ── Models ─────────────────────────────────────────────────────────────────

interface ModelTarget {
  key: string
  label: string
  provider: ProviderName
  model: string
}

const MODELS: ModelTarget[] = [
  { key: "llama8b",  label: "Llama 3.1 8B (Groq)",  provider: "groq",     model: "llama-3.1-8b-instant" },
  { key: "qwen14b",  label: "Qwen3-14B base (W&B)", provider: "wandb",    model: "OpenPipe/Qwen3-14B-Instruct" },
  { key: "qwen235b", label: "Qwen 235B (Cerebras)", provider: "cerebras", model: "qwen-3-235b-a22b-instruct-2507" },
]

// ── Helpers ────────────────────────────────────────────────────────────────

interface Pair {
  messages: Array<{ role: string; content: string }>
  _meta: { scenario: string; variant: string }
}

/** Strip the trailing "Did the prose execute the beat?" question from the
 *  original user prompt so the checklist system prompt is the only authority
 *  on what schema to emit. Keeps the beat/setting/characters/prose body. */
function stripUserTail(user: string): string {
  const idx = user.indexOf("Did the prose execute the beat?")
  return idx === -1 ? user.trim() : user.slice(0, idx).trim()
}

interface CallOutcome {
  ok: boolean
  pass?: boolean
  ms: number
  promptTokens?: number
  completionTokens?: number
  raw?: any
  error?: string
}

async function callModel(target: ModelTarget, system: string, user: string): Promise<CallOutcome> {
  const transport = getTransport()
  const t0 = performance.now()
  try {
    const result = await transport.execute({
      systemPrompt: system,
      userPrompt: user,
      provider: target.provider,
      model: target.model,
      temperature: 0.1,
      // Checklist output is ~5-10× larger than flat schema (~400-800 tokens
      // per call vs ~50). 1536 gives headroom; the production decision later
      // can tune this down once we know the real ceiling.
      maxTokens: 1536,
      responseFormat: { type: "json_object" },
    })
    const ms = performance.now() - t0
    let content = result.content.trim()
    if (content.startsWith("```")) {
      content = content.replace(/^```[a-z]*\n/, "").replace(/\n```$/, "")
    }
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) content = jsonMatch[0]
    const parsed = JSON.parse(content)
    return {
      ok: true,
      pass: Boolean(parsed.pass),
      ms,
      promptTokens: result.usage.prompt_tokens,
      completionTokens: result.usage.completion_tokens,
      raw: parsed,
    }
  } catch (e: any) {
    return { ok: false, ms: performance.now() - t0, error: e?.message ?? String(e) }
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────

interface VariantStats {
  agree: number; disagree: number; errors: number
  truePass: number; trueFail: number; falsePass: number; falseFail: number
}
function emptyStats(): VariantStats {
  return { agree: 0, disagree: 0, errors: 0, truePass: 0, trueFail: 0, falsePass: 0, falseFail: 0 }
}
interface ModelStats {
  byVariant: Map<string, VariantStats>
  overall: VariantStats
  latencies: number[]
  inTokens: number[]
  outTokens: number[]
}
function emptyModelStats(): ModelStats {
  return { byVariant: new Map(), overall: emptyStats(), latencies: [], inTokens: [], outTokens: [] }
}
function recordOutcome(stats: ModelStats, variant: string, expectedPass: boolean, outcome: CallOutcome) {
  if (!stats.byVariant.has(variant)) stats.byVariant.set(variant, emptyStats())
  const v = stats.byVariant.get(variant)!
  if (!outcome.ok || outcome.pass === undefined) {
    v.errors++; stats.overall.errors++; return
  }
  stats.latencies.push(outcome.ms)
  if (outcome.promptTokens) stats.inTokens.push(outcome.promptTokens)
  if (outcome.completionTokens) stats.outTokens.push(outcome.completionTokens)
  const matches = outcome.pass === expectedPass
  if (matches) { v.agree++; stats.overall.agree++ }
  else         { v.disagree++; stats.overall.disagree++ }
  if (expectedPass && outcome.pass)        { v.truePass++; stats.overall.truePass++ }
  else if (!expectedPass && !outcome.pass) { v.trueFail++; stats.overall.trueFail++ }
  else if (!expectedPass && outcome.pass)  { v.falsePass++; stats.overall.falsePass++ }
  else                                     { v.falseFail++; stats.overall.falseFail++ }
}
function pct(n: number, d: number): number { return d === 0 ? 0 : Math.round((n / d) * 100) }
function avg(arr: number[]): number { return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length }

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const lines = readFileSync(PAIRS_PATH, "utf8").trim().split("\n")
  let pairs: Pair[] = lines.map(l => JSON.parse(l))

  if (SAMPLE_N && SAMPLE_N < pairs.length) {
    pairs = [...pairs].sort(() => Math.random() - 0.5).slice(0, SAMPLE_N)
    console.log(`Sampling ${SAMPLE_N} of ${lines.length} pairs`)
  } else {
    console.log(`Scoring all ${pairs.length} pairs against ${MODELS.length} models = ${pairs.length * MODELS.length} calls`)
  }

  const expId = await createTuningExperiment(
    "baseline",
    `Adherence-checker checklist schema vs flat schema (exp #110): Llama 8B / Qwen3-14B / Qwen 235B (${pairs.length} pairs)`,
    {
      pairs: pairs.length,
      models: MODELS.map(m => ({ key: m.key, label: m.label, provider: m.provider, model: m.model })),
      schema: "structured-checklist",
      temperature: 0.1,
      maxTokens: 1536,
      pairsFile: "lora-data/adherence-checker-pairs.jsonl",
      hypothesis: "Forcing per-action observation (key_actions[].quote/executed) before the verdict closes the over-permissive bias 14B showed in exp #110, the same way the chapter-plan-checker checklist closed the gap in exp #109.",
      baselineExperiment: 110,
    },
    { target: "adherence-checker", dimension: "calibration" },
  )
  console.log(`Experiment: ${expId}\n`)

  const allStats = new Map<string, ModelStats>()
  for (const m of MODELS) allStats.set(m.key, emptyModelStats())

  const PAIR_CONCURRENCY = 3
  for (let i = 0; i < pairs.length; i += PAIR_CONCURRENCY) {
    const batch = pairs.slice(i, i + PAIR_CONCURRENCY)
    await Promise.all(batch.map(async (pair, batchIdx) => {
      const idx = i + batchIdx
      const variant = pair._meta.variant
      const userBody = stripUserTail(pair.messages[1].content)
      const expected = JSON.parse(pair.messages[2].content) as { pass: boolean }

      const outcomes = await Promise.all(MODELS.map(m => callModel(m, CHECKLIST_SYSTEM, userBody)))

      for (let mi = 0; mi < MODELS.length; mi++) {
        recordOutcome(allStats.get(MODELS[mi].key)!, variant, expected.pass, outcomes[mi])
      }

      const tags = MODELS.map((m, mi) => {
        const o = outcomes[mi]
        if (!o.ok || o.pass === undefined) return `${m.key}:ERR`
        return `${m.key}:${o.pass === expected.pass ? "OK" : "✗"}`
      }).join(" ")
      console.log(`[${idx + 1}/${pairs.length}] ${pair._meta.scenario}/${variant} (${expected.pass ? "PASS" : "FAIL"}) → ${tags}`)
    }))
  }

  // ── Report ──────────────────────────────────────────────────────────────

  console.log("\n" + "═".repeat(96))
  console.log("RESULTS — checklist schema, agreement vs deterministic labels")
  console.log("═".repeat(96) + "\n")

  const variants = ["PASS_CLEAN", "PASS_PARAPHRASE", "PASS_REORDER", "PASS_ATMOSPHERIC",
                    "FAIL_MISSING", "FAIL_CHAR", "FAIL_SETTING", "FAIL_TANGENT"]

  process.stdout.write("variant".padEnd(22))
  for (const m of MODELS) process.stdout.write(m.key.padStart(14))
  process.stdout.write("\n")
  console.log("─".repeat(22 + 14 * MODELS.length))

  for (const variant of variants) {
    process.stdout.write(variant.padEnd(22))
    for (const m of MODELS) {
      const s = allStats.get(m.key)!.byVariant.get(variant)
      if (!s) { process.stdout.write("—".padStart(14)); continue }
      const total = s.agree + s.disagree
      process.stdout.write(`${pct(s.agree, total)}% (${s.agree}/${total})`.padStart(14))
    }
    process.stdout.write("\n")
  }
  console.log("─".repeat(22 + 14 * MODELS.length))

  process.stdout.write("OVERALL".padEnd(22))
  for (const m of MODELS) {
    const o = allStats.get(m.key)!.overall
    const total = o.agree + o.disagree
    process.stdout.write(`${pct(o.agree, total)}% (${o.agree}/${total})`.padStart(14))
  }
  process.stdout.write("\n\n")

  console.log("Per-model confusion + latency:")
  for (const m of MODELS) {
    const s = allStats.get(m.key)!
    const o = s.overall
    console.log(`  ${m.label}`)
    console.log(`    truePass=${o.truePass} trueFail=${o.trueFail} falsePass=${o.falsePass} falseFail=${o.falseFail} errors=${o.errors}`)
    console.log(`    latency avg=${Math.round(avg(s.latencies))}ms  tokens in=${Math.round(avg(s.inTokens))}/out=${Math.round(avg(s.outTokens))}`)
  }

  // Persist conclusion
  const conclusion = JSON.stringify({
    schema: "structured-checklist",
    pairs: pairs.length,
    baselineExperiment: 110,
    models: MODELS.map(m => {
      const s = allStats.get(m.key)!
      const o = s.overall
      const total = o.agree + o.disagree
      const variantTable: Record<string, { agree: number; total: number; pct: number; falsePass: number; falseFail: number }> = {}
      for (const [v, st] of s.byVariant) {
        const t = st.agree + st.disagree
        variantTable[v] = { agree: st.agree, total: t, pct: pct(st.agree, t), falsePass: st.falsePass, falseFail: st.falseFail }
      }
      return {
        key: m.key, label: m.label, provider: m.provider, model: m.model,
        overallAgreementPct: pct(o.agree, total),
        agree: o.agree, total, errors: o.errors,
        truePass: o.truePass, trueFail: o.trueFail, falsePass: o.falsePass, falseFail: o.falseFail,
        avgLatencyMs: Math.round(avg(s.latencies)),
        avgInTokens: Math.round(avg(s.inTokens)),
        avgOutTokens: Math.round(avg(s.outTokens)),
        byVariant: variantTable,
      }
    }),
  })
  await concludeExperiment(expId, conclusion)
  console.log(`\nConcluded experiment ${expId}.`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })

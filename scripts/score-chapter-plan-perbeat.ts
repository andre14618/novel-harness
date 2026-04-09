/**
 * Chapter-plan-checker per-beat decomposition.
 *
 * exp #119 (score-chapter-plan-baseline.ts) found that all four models in the
 * ladder collapse on FAIL_MISSING_BEAT — best is gpt-oss-120b at 50%, Qwen 235B
 * at 10%. Spot-check via inspect-pair-variant.ts confirmed labels are mostly
 * correct: writers reproduce beat 1's action while just dropping the literal
 * "arrives soaked" framing, and the holistic checker rubber-stamps PASS because
 * "the chapter mentions Hal and Vira and the apothecary, looks fine."
 *
 * This script tests the alternative shape: instead of one call asking
 * "does the prose match the plan?", fire N parallel calls (one per beat)
 * asking "is this specific beat enacted on-page?" with positive-evidence
 * framing — the model has to QUOTE a passage where the beat happens, or return
 * present:false. Aggregate verdict = FAIL if any beat returns absent.
 *
 * Why this should work (independent of #111's structured-checklist negative
 * result on adherence-checker):
 *   - Per-beat is N independent checks, the shape that matched chapter-plan-checker
 *     in exp #109 (the one task where atomization HELPED).
 *   - Positive-evidence (quote it) inverts the negative-evidence reasoning trap.
 *   - "When in doubt, PASS" rubric bias is killed: no quote → FAIL by default.
 *   - Each call gets its own attention budget vs. the current "validate 4 beats
 *     + characters + facts + states in one call" overload.
 *
 * Reads:  lora-data/chapter-plan-checker-pairs.jsonl (80 pairs)
 * Writes: tuning_experiment row with per-pair, per-beat, per-variant breakdown.
 *
 * Usage:
 *   CEREBRAS_API_KEY=... GROQ_API_KEY=... WANDB_API_KEY=... \
 *     bun scripts/score-chapter-plan-perbeat.ts
 *   ... --sample 16   (smoke run, 2 per variant)
 */

import { readFileSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"
import type { ProviderName } from "../models/registry"

const PAIRS_PATH = join(import.meta.dir, "../lora-data/chapter-plan-checker-pairs.jsonl")
const SAMPLE_ARG = process.argv.indexOf("--sample")
const SAMPLE_N   = SAMPLE_ARG !== -1 ? parseInt(process.argv[SAMPLE_ARG + 1]) : null

interface Pair {
  messages: Array<{ role: string; content: string }>
  _meta: { scenario: string; variant: string }
}

interface ModelTarget {
  key: string
  label: string
  provider: ProviderName
  model: string
}

const MODELS: ModelTarget[] = [
  { key: "llama8b",   label: "Llama 3.1 8B (Groq)",      provider: "groq",     model: "llama-3.1-8b-instant" },
  { key: "qwen14b",   label: "Qwen3-14B base (W&B)",     provider: "wandb",    model: "OpenPipe/Qwen3-14B-Instruct" },
  { key: "gptoss120b",label: "gpt-oss-120b (Groq)",      provider: "groq",     model: "openai/gpt-oss-120b" },
  { key: "qwen235b",  label: "Qwen 235B (Cerebras)",     provider: "cerebras", model: "qwen-3-235b-a22b-instruct-2507" },
]

// ── Pair parsing ──────────────────────────────────────────────────────────

interface ParsedPair {
  scenario: string
  variant: string
  header: string                  // chapter context above SCENE BEATS
  beats: Array<{ num: number; description: string }>
  prose: string
  expectedPass: boolean
}

function parsePair(p: Pair): ParsedPair {
  const user = p.messages[1].content
  const expected = JSON.parse(p.messages[2].content) as { pass: boolean }

  const proseMarker = "CHAPTER PROSE:\n"
  const proseIdx = user.indexOf(proseMarker)
  const beforeProse = proseIdx === -1 ? user : user.slice(0, proseIdx)
  const prose = proseIdx === -1 ? "" : user.slice(proseIdx + proseMarker.length).trim()

  const beatsMarker = "SCENE BEATS:\n"
  const beatsIdx = beforeProse.indexOf(beatsMarker)
  const header = beatsIdx === -1 ? beforeProse.trim() : beforeProse.slice(0, beatsIdx).trim()
  const beatsBlock = beatsIdx === -1 ? "" : beforeProse.slice(beatsIdx + beatsMarker.length)

  // Lines like "  Beat 1: <description>"
  const beats: Array<{ num: number; description: string }> = []
  const beatRe = /^ {2}Beat (\d+): (.+)$/
  for (const line of beatsBlock.split("\n")) {
    const m = line.match(beatRe)
    if (m) beats.push({ num: parseInt(m[1]), description: m[2].trim() })
  }

  return {
    scenario: p._meta.scenario,
    variant: p._meta.variant,
    header,
    beats,
    prose,
    expectedPass: expected.pass,
  }
}

// ── Per-beat call ─────────────────────────────────────────────────────────

const BEAT_SYSTEM = `You verify whether a single scene beat from a chapter plan was enacted on the page.

Your job is to find a passage in the prose where the beat HAPPENS — characters performing the action, dialogue, narration of the action as it occurs in scene.

Rules:
- "Enacted" means the action happens IN SCENE during this chapter. The beat should be readable as it unfolds.
- The beat does NOT need to be word-for-word. Paraphrase, dialogue rewording, atmospheric expansion, and reordering with adjacent beats are all fine. What matters is whether a reader sees the beat happen as they read.
- A reference to the beat as having happened earlier (off-page, past-tense, "as he'd said before", "after the morning meeting", a flashback that summarizes rather than dramatizes) does NOT count as enacted.
- Characters being merely present in the chapter is NOT enough — the beat's specific action must occur.
- If you cannot find a passage where the beat is enacted, return present=false. Do NOT default to true.

Quote the strongest passage where the beat is enacted. If only off-page references exist, quote the closest reference and still return present=false.

Respond with ONLY valid JSON in this exact shape:
{
  "present": true | false,
  "evidence": "<short quoted passage from the prose, ~1-3 sentences>",
  "reasoning": "<one sentence explaining why this counts or doesn't>"
}`

function buildBeatUserPrompt(parsed: ParsedPair, beatNum: number, beatDesc: string): string {
  return `${parsed.header}

THE BEAT TO CHECK:
Beat ${beatNum}: ${beatDesc}

CHAPTER PROSE:
---
${parsed.prose}
---`
}

interface BeatOutcome {
  ok: boolean
  present?: boolean
  ms: number
  promptTokens?: number
  completionTokens?: number
  raw?: string
  error?: string
}

async function callBeat(target: ModelTarget, parsed: ParsedPair, beatNum: number, beatDesc: string): Promise<BeatOutcome> {
  const transport = getTransport()
  const t0 = performance.now()
  try {
    const result = await transport.execute({
      systemPrompt: BEAT_SYSTEM,
      userPrompt: buildBeatUserPrompt(parsed, beatNum, beatDesc),
      provider: target.provider,
      model: target.model,
      temperature: 0.1,
      maxTokens: 768,
      responseFormat: { type: "json_object" },
    })
    const ms = performance.now() - t0
    let content = result.content.trim()
    if (content.startsWith("```")) {
      content = content.replace(/^```[a-z]*\n/, "").replace(/\n```$/, "")
    }
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) content = jsonMatch[0]
    const parsedJson = JSON.parse(content)
    return {
      ok: true,
      present: Boolean(parsedJson.present),
      ms,
      promptTokens: result.usage.prompt_tokens,
      completionTokens: result.usage.completion_tokens,
    }
  } catch (e: any) {
    return { ok: false, ms: performance.now() - t0, error: e?.message ?? String(e) }
  }
}

// ── Stats accounting ──────────────────────────────────────────────────────

interface VariantStats {
  agree: number
  disagree: number
  errors: number
  truePass: number
  trueFail: number
  falsePass: number
  falseFail: number
}

function emptyStats(): VariantStats {
  return { agree: 0, disagree: 0, errors: 0, truePass: 0, trueFail: 0, falsePass: 0, falseFail: 0 }
}

interface ModelStats {
  byVariant: Map<string, VariantStats>
  overall: VariantStats
  latencies: number[]    // per-call (per-beat) latency
  pairLatencies: number[] // per-pair wall-clock (max across beats since they're parallel)
  inTokens: number[]
  outTokens: number[]
  beatsTotal: number     // total beat-level calls
  beatsAbsent: number    // beat-level "present:false" verdicts
}

function emptyModelStats(): ModelStats {
  return {
    byVariant: new Map<string, VariantStats>(),
    overall: emptyStats(),
    latencies: [],
    pairLatencies: [],
    inTokens: [],
    outTokens: [],
    beatsTotal: 0,
    beatsAbsent: 0,
  }
}

function recordPair(stats: ModelStats, variant: string, expectedPass: boolean, modelPass: boolean | null) {
  if (!stats.byVariant.has(variant)) stats.byVariant.set(variant, emptyStats())
  const v = stats.byVariant.get(variant)!

  if (modelPass === null) {
    v.errors++
    stats.overall.errors++
    return
  }

  const matches = modelPass === expectedPass
  if (matches) { v.agree++; stats.overall.agree++ }
  else         { v.disagree++; stats.overall.disagree++ }

  if (expectedPass && modelPass)        { v.truePass++; stats.overall.truePass++ }
  else if (!expectedPass && !modelPass) { v.trueFail++; stats.overall.trueFail++ }
  else if (!expectedPass && modelPass)  { v.falsePass++; stats.overall.falsePass++ }
  else                                  { v.falseFail++; stats.overall.falseFail++ }
}

function pct(num: number, den: number): number {
  return den === 0 ? 0 : Math.round((num / den) * 100)
}

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const lines = readFileSync(PAIRS_PATH, "utf8").trim().split("\n")
  let rawPairs: Pair[] = lines.map(l => JSON.parse(l))

  if (SAMPLE_N && SAMPLE_N < rawPairs.length) {
    rawPairs = [...rawPairs].sort(() => Math.random() - 0.5).slice(0, SAMPLE_N)
    console.log(`Sampling ${SAMPLE_N} of ${lines.length} pairs`)
  }

  const pairs = rawPairs.map(parsePair)
  const totalBeats = pairs.reduce((a, p) => a + p.beats.length, 0)
  console.log(`Pairs: ${pairs.length}  total beats: ${totalBeats}  models: ${MODELS.length}`)
  console.log(`Approx LLM calls: ${totalBeats * MODELS.length}\n`)

  const expId = await createTuningExperiment(
    "perbeat-decomposition",
    `Chapter-plan-checker per-beat decomposition: 4-model ladder fires N parallel calls per pair (one per beat) with positive-evidence quoting (${pairs.length} pairs)`,
    {
      pairs: pairs.length,
      totalBeats,
      models: MODELS.map(m => ({ key: m.key, label: m.label, provider: m.provider, model: m.model })),
      temperature: 0.1,
      maxTokens: 768,
      pairsFile: "lora-data/chapter-plan-checker-pairs.jsonl",
      hypothesis: "exp #119 found all four models collapse on FAIL_MISSING_BEAT (best gpt-oss-120b 50%, Qwen 235B 10%) because the holistic 'does the prose match the plan' prompt rubber-stamps PASS when characters and setting are present. Per-beat decomposition fires N parallel calls per pair, each asking 'is THIS specific beat enacted on-page?' with mandatory positive-evidence quoting. Hypothesis: this closes the FAIL_MISSING_BEAT gap by (a) inverting negative-evidence reasoning into positive-evidence (model has to QUOTE the beat happening), (b) killing the 'when in doubt, PASS' bias (no quote → FAIL by default), (c) giving each beat its own attention budget. Aggregate verdict = FAIL if any beat returns absent.",
      relatedExperiments: [107, 109, 119],
    },
    { target: "chapter-plan-checker", dimension: "calibration" },
  )
  console.log(`Experiment: ${expId}\n`)

  const allStats = new Map<string, ModelStats>()
  for (const m of MODELS) allStats.set(m.key, emptyModelStats())

  // Per-pair, all models × all beats fan out in parallel.
  // PAIR_CONCURRENCY=2 keeps in-flight bounded (~2 × 4 models × ~4 beats = ~32).
  const PAIR_CONCURRENCY = 2

  for (let i = 0; i < pairs.length; i += PAIR_CONCURRENCY) {
    const batch = pairs.slice(i, i + PAIR_CONCURRENCY)
    await Promise.all(batch.map(async (parsed, batchIdx) => {
      const idx = i + batchIdx

      // For each model: fire all beats in parallel.
      const perModel = await Promise.all(MODELS.map(async (m) => {
        const tPair0 = performance.now()
        const beatOutcomes = await Promise.all(
          parsed.beats.map(b => callBeat(m, parsed, b.num, b.description)),
        )
        const pairMs = performance.now() - tPair0

        let anyError = false
        let anyAbsent = false
        const stats = allStats.get(m.key)!
        for (const o of beatOutcomes) {
          stats.beatsTotal++
          if (!o.ok || o.present === undefined) { anyError = true; continue }
          if (!o.present) { anyAbsent = true; stats.beatsAbsent++ }
          stats.latencies.push(o.ms)
          if (o.promptTokens) stats.inTokens.push(o.promptTokens)
          if (o.completionTokens) stats.outTokens.push(o.completionTokens)
        }

        // Aggregate: PASS = every beat present (no errors, no absent).
        // If any beat errored AND nothing was absent, treat the pair as error
        // (we don't know whether all beats are present).
        let pairPass: boolean | null
        if (anyError && !anyAbsent) pairPass = null
        else pairPass = !anyAbsent

        stats.pairLatencies.push(pairMs)
        recordPair(stats, parsed.variant, parsed.expectedPass, pairPass)
        return { key: m.key, pairPass, anyError }
      }))

      const tags = perModel.map(r => {
        if (r.pairPass === null) return `${r.key}:ERR`
        const got = r.pairPass === parsed.expectedPass ? "OK" : "✗"
        return `${r.key}:${got}`
      }).join(" ")
      console.log(`[${idx + 1}/${pairs.length}] ${parsed.scenario}/${parsed.variant} (${parsed.expectedPass ? "PASS" : "FAIL"}) → ${tags}`)
    }))
  }

  // ── Report ──────────────────────────────────────────────────────────────

  console.log("\n" + "═".repeat(108))
  console.log("RESULTS — per-beat decomposition vs deterministic labels")
  console.log("═".repeat(108) + "\n")

  const variants = ["PASS_CLEAN", "PASS_PARAPHRASE", "PASS_REORDER", "PASS_ATMOSPHERIC",
                    "FAIL_MISSING_BEAT", "FAIL_MISSING_CHAR", "FAIL_REVERSED_ARC", "FAIL_WRONG_SETTING"]

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

  console.log("Per-model confusion + cost:")
  for (const m of MODELS) {
    const s = allStats.get(m.key)!
    const o = s.overall
    const beatLatAvg = Math.round(avg(s.latencies))
    const pairLatAvg = Math.round(avg(s.pairLatencies))
    const inAvg = Math.round(avg(s.inTokens))
    const outAvg = Math.round(avg(s.outTokens))
    console.log(`  ${m.label}`)
    console.log(`    truePass=${o.truePass} trueFail=${o.trueFail} falsePass=${o.falsePass} falseFail=${o.falseFail} errors=${o.errors}`)
    console.log(`    beats absent: ${s.beatsAbsent}/${s.beatsTotal} (${pct(s.beatsAbsent, s.beatsTotal)}%)`)
    console.log(`    latency per beat=${beatLatAvg}ms  per pair (parallel max)=${pairLatAvg}ms  tokens in=${inAvg}/out=${outAvg}`)
  }

  // Comparison with #119 baseline (hardcoded for at-a-glance):
  console.log("\n#119 baseline overall agreement (single-call):")
  console.log("  llama8b=23%  qwen14b=42%  gptoss120b=90%  qwen235b=81%")
  console.log("  FAIL_MISSING_BEAT specifically: llama8b=0%  qwen14b=10%  gptoss120b=50%  qwen235b=10%")

  // Persist
  const conclusion = JSON.stringify({
    pairs: pairs.length,
    totalBeats,
    shape: "per-beat decomposition with positive-evidence quoting",
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
        key: m.key,
        label: m.label,
        provider: m.provider,
        model: m.model,
        overallAgreementPct: pct(o.agree, total),
        agree: o.agree,
        total,
        errors: o.errors,
        truePass: o.truePass,
        trueFail: o.trueFail,
        falsePass: o.falsePass,
        falseFail: o.falseFail,
        beatsTotal: s.beatsTotal,
        beatsAbsent: s.beatsAbsent,
        avgBeatLatencyMs: Math.round(avg(s.latencies)),
        avgPairLatencyMs: Math.round(avg(s.pairLatencies)),
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

/**
 * Adherence-checker baseline: base 14B (W&B) vs Llama 8B (Groq) vs Qwen 235B (Cerebras).
 *
 * Replays the 160-pair synthetic adherence training set through three candidate
 * models and reports per-variant agreement against the deterministic labels.
 * The point is to measure where base Qwen3-14B sits between the cheap-fast
 * floor (Llama 8B) and the expensive-capable ceiling (Qwen 235B) on this exact
 * task — input data for the "is SFT worth it" decision.
 *
 * Reads:  lora-data/adherence-checker-pairs.jsonl
 * Writes: tuning_experiment row with full per-model + per-variant stats.
 *
 * Usage:
 *   CEREBRAS_API_KEY=... GROQ_API_KEY=... WANDB_API_KEY=... \
 *     bun scripts/score-adherence-baseline.ts
 *   ... --sample 40   (random sample for a quick smoke run)
 */

import { readFileSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"
import type { ProviderName } from "../models/registry"

const PAIRS_PATH = join(import.meta.dir, "../lora-data/adherence-checker-pairs.jsonl")
const SAMPLE_ARG = process.argv.indexOf("--sample")
const SAMPLE_N   = SAMPLE_ARG !== -1 ? parseInt(process.argv[SAMPLE_ARG + 1]) : null

interface Pair {
  messages: Array<{ role: string; content: string }>
  _meta: { scenario: string; variant: string }
}

interface ModelTarget {
  key: string                // short id used in stats
  label: string              // human label
  provider: ProviderName
  model: string
}

const MODELS: ModelTarget[] = [
  { key: "llama8b",  label: "Llama 3.1 8B (Groq)",      provider: "groq",     model: "llama-3.1-8b-instant" },
  { key: "qwen14b",  label: "Qwen3-14B base (W&B)",     provider: "wandb",    model: "OpenPipe/Qwen3-14B-Instruct" },
  { key: "qwen235b", label: "Qwen 235B (Cerebras)",     provider: "cerebras", model: "qwen-3-235b-a22b-instruct-2507" },
]

interface CallOutcome {
  ok: boolean
  pass?: boolean
  ms: number
  promptTokens?: number
  completionTokens?: number
  raw?: string
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
      maxTokens: 256,
      responseFormat: { type: "json_object" },
    })
    const ms = performance.now() - t0
    const parsed = JSON.parse(result.content)
    return {
      ok: true,
      pass: Boolean(parsed.pass),
      ms,
      promptTokens: result.usage.prompt_tokens,
      completionTokens: result.usage.completion_tokens,
    }
  } catch (e: any) {
    return { ok: false, ms: performance.now() - t0, error: e?.message ?? String(e) }
  }
}

interface VariantStats {
  agree: number
  disagree: number
  errors: number
  // Confusion against labels
  truePass: number    // label PASS, model PASS
  trueFail: number    // label FAIL, model FAIL
  falsePass: number   // label FAIL, model PASS  (over-strict miss → permissive)
  falseFail: number   // label PASS, model FAIL  (over-strict hit → too strict)
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
  return {
    byVariant: new Map<string, VariantStats>(),
    overall: emptyStats(),
    latencies: [],
    inTokens: [],
    outTokens: [],
  }
}

function recordOutcome(stats: ModelStats, variant: string, expectedPass: boolean, outcome: CallOutcome) {
  if (!stats.byVariant.has(variant)) stats.byVariant.set(variant, emptyStats())
  const v = stats.byVariant.get(variant)!

  if (!outcome.ok || outcome.pass === undefined) {
    v.errors++
    stats.overall.errors++
    return
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

function pct(num: number, den: number): number {
  return den === 0 ? 0 : Math.round((num / den) * 100)
}

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length
}

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
    `Adherence-checker base-model baseline: Llama 8B vs Qwen3-14B vs Qwen 235B (${pairs.length} pairs)`,
    {
      pairs: pairs.length,
      models: MODELS.map(m => ({ key: m.key, label: m.label, provider: m.provider, model: m.model })),
      temperature: 0.1,
      maxTokens: 256,
      pairsFile: "lora-data/adherence-checker-pairs.jsonl",
      hypothesis: "Base Qwen3-14B sits between Llama 8B and Qwen 235B on adherence-checker label agreement. Quantifies the gap that SFT would need to close to make 14B + adapter a viable replacement for 235B in this slot.",
    },
    { target: "adherence-checker", dimension: "calibration" },
  )
  console.log(`Experiment: ${expId}\n`)

  const allStats = new Map<string, ModelStats>()
  for (const m of MODELS) allStats.set(m.key, emptyModelStats())

  // Concurrency: 3 pairs in flight at a time, all 3 models per pair fired in parallel.
  // Net concurrency 9 — well under any provider rate limit, fast enough.
  const PAIR_CONCURRENCY = 3

  for (let i = 0; i < pairs.length; i += PAIR_CONCURRENCY) {
    const batch = pairs.slice(i, i + PAIR_CONCURRENCY)
    await Promise.all(batch.map(async (pair, batchIdx) => {
      const idx = i + batchIdx
      const variant = pair._meta.variant
      const system = pair.messages[0].content
      const user = pair.messages[1].content
      const expected = JSON.parse(pair.messages[2].content) as { pass: boolean }

      const outcomes = await Promise.all(MODELS.map(m => callModel(m, system, user)))

      for (let mi = 0; mi < MODELS.length; mi++) {
        const m = MODELS[mi]
        const o = outcomes[mi]
        recordOutcome(allStats.get(m.key)!, variant, expected.pass, o)
      }

      const tags = MODELS.map((m, mi) => {
        const o = outcomes[mi]
        if (!o.ok || o.pass === undefined) return `${m.key}:ERR`
        const got = o.pass === expected.pass ? "OK" : "✗"
        return `${m.key}:${got}`
      }).join(" ")
      console.log(`[${idx + 1}/${pairs.length}] ${pair._meta.scenario}/${variant} (${expected.pass ? "PASS" : "FAIL"}) → ${tags}`)
    }))
  }

  // ── Report ──────────────────────────────────────────────────────────────

  console.log("\n" + "═".repeat(96))
  console.log("RESULTS — agreement vs deterministic labels")
  console.log("═".repeat(96) + "\n")

  const variants = ["PASS_CLEAN", "PASS_PARAPHRASE", "PASS_REORDER", "PASS_ATMOSPHERIC",
                    "FAIL_MISSING", "FAIL_CHAR", "FAIL_SETTING", "FAIL_TANGENT"]

  // Header
  process.stdout.write("variant".padEnd(22))
  for (const m of MODELS) process.stdout.write(m.key.padStart(12))
  process.stdout.write("\n")
  console.log("─".repeat(22 + 12 * MODELS.length))

  for (const variant of variants) {
    process.stdout.write(variant.padEnd(22))
    for (const m of MODELS) {
      const s = allStats.get(m.key)!.byVariant.get(variant)
      if (!s) { process.stdout.write("—".padStart(12)); continue }
      const total = s.agree + s.disagree
      process.stdout.write(`${pct(s.agree, total)}% (${s.agree}/${total})`.padStart(12))
    }
    process.stdout.write("\n")
  }
  console.log("─".repeat(22 + 12 * MODELS.length))

  // Overall row
  process.stdout.write("OVERALL".padEnd(22))
  for (const m of MODELS) {
    const o = allStats.get(m.key)!.overall
    const total = o.agree + o.disagree
    process.stdout.write(`${pct(o.agree, total)}% (${o.agree}/${total})`.padStart(12))
  }
  process.stdout.write("\n\n")

  // Confusion + latency table
  console.log("Per-model confusion + latency:")
  for (const m of MODELS) {
    const s = allStats.get(m.key)!
    const o = s.overall
    const latAvg = Math.round(avg(s.latencies))
    const inAvg = Math.round(avg(s.inTokens))
    const outAvg = Math.round(avg(s.outTokens))
    console.log(`  ${m.label}`)
    console.log(`    truePass=${o.truePass} trueFail=${o.trueFail} falsePass=${o.falsePass} falseFail=${o.falseFail} errors=${o.errors}`)
    console.log(`    latency avg=${latAvg}ms  tokens in=${inAvg}/out=${outAvg}`)
  }

  // Persist conclusion
  const conclusion = JSON.stringify({
    pairs: pairs.length,
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

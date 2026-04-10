/**
 * Chapter-plan-checker teacher candidates: test Kimi K2 Instruct (Groq) and
 * GLM-5 (Zai) against the existing 80 synthetic pairs.
 *
 * gpt-oss-120b (90%) is the current production teacher from exp #119.
 * Qwen 235B (81%) is the runner-up. This script tests whether Kimi K2 or
 * GLM-5 can shore up weaknesses — especially FAIL_REVERSED_ARC (where
 * gpt-oss scored 50% and 14B scored 0%) and FAIL_MISSING_BEAT.
 *
 * Keeps gpt-oss-120b and Qwen 235B as baselines for direct comparison.
 *
 * Usage:
 *   bun scripts/score-chapter-plan-teachers.ts
 *   ... --sample 24   (3 per variant for a quick smoke)
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
  { key: "gptoss120b", label: "gpt-oss-120b (Groq)",           provider: "groq",     model: "openai/gpt-oss-120b" },
  { key: "qwen235b",   label: "Qwen 235B (Cerebras)",          provider: "cerebras", model: "qwen-3-235b-a22b-instruct-2507" },
  { key: "kimik2",     label: "Kimi K2 Instruct (Groq)",       provider: "groq",     model: "moonshotai/kimi-k2-instruct-0905" },
  { key: "glm5",       label: "GLM-5 (Zai)",                   provider: "zai",      model: "GLM-5" },
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
    const parsed = JSON.parse(content)
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
    `Chapter-plan-checker teacher candidates: Kimi K2 Instruct + GLM-5 vs baselines (${pairs.length} pairs)`,
    {
      pairs: pairs.length,
      models: MODELS.map(m => ({ key: m.key, label: m.label, provider: m.provider, model: m.model })),
      temperature: 0.1,
      maxTokens: 768,
      pairsFile: "lora-data/chapter-plan-checker-pairs.jsonl",
      hypothesis: "gpt-oss-120b is the proven chapter-plan-checker teacher (90% in exp #119). Kimi K2 Instruct (Groq) scored 95% on adherence events (exp #140) and may bring similar analytical strength to chapter-plan checking. GLM-5 (Zai) scored 100% on adherence character (exp #140) and may handle FAIL_REVERSED_ARC and FAIL_MISSING_CHAR better. Key gap to close: FAIL_REVERSED_ARC (gpt-oss 50%, 235B 10% in exp #119).",
      relatedExperiments: [107, 119, 140],
    },
    { target: "chapter-plan-checker", dimension: "calibration" },
  )
  console.log(`Experiment: ${expId}\n`)

  const allStats = new Map<string, ModelStats>()
  for (const m of MODELS) allStats.set(m.key, emptyModelStats())

  // Concurrency: 2 pairs in flight, 4 models per pair = net 8. Lower for Zai rate limits.
  const PAIR_CONCURRENCY = 2

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

  console.log("\n" + "═".repeat(22 + 14 * MODELS.length))
  console.log("RESULTS — agreement vs deterministic labels")
  console.log("═".repeat(22 + 14 * MODELS.length) + "\n")

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

  // ── Teacher ranking ──────────────────────────────────────────────────

  console.log("\nTEACHER RANKING:")
  const ranked = MODELS.map(m => {
    const o = allStats.get(m.key)!.overall
    const total = o.agree + o.disagree
    return { key: m.key, label: m.label, pct: pct(o.agree, total), total }
  }).sort((a, b) => b.pct - a.pct)
  for (const [i, r] of ranked.entries()) {
    console.log(`  ${i + 1}. ${r.label}: ${r.pct}% (${r.total} pairs)`)
  }

  // ── Variant-level head-to-head ──────────────────────────────────────

  console.log("\nPER-VARIANT HEAD-TO-HEAD (all models):")
  for (const variant of variants) {
    const scores = MODELS.map(m => {
      const s = allStats.get(m.key)!.byVariant.get(variant)
      if (!s) return `${m.key}:—`
      const total = s.agree + s.disagree
      return `${m.key}=${pct(s.agree, total)}%`
    }).join("  ")
    console.log(`  ${variant.padEnd(22)} ${scores}`)
  }

  // Persist conclusion
  const conclusion = JSON.stringify({
    pairs: pairs.length,
    ranking: ranked,
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

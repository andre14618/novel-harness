/**
 * Continuity-checker baseline ladder: Llama 8B vs Qwen3-14B vs Qwen 235B.
 *
 * Third rung of the structured-analytical-agent ladder, after
 * adherence-checker (exp #110/#111) and reference-resolver (exp #114/#115).
 * Continuity is the largest prompt-token cost in the pipeline (~7,300 in/call
 * on the production Cerebras Qwen 235B), so the SFT EV question is largest
 * here — replacing it with a small model is the highest-leverage swap.
 *
 * Reads:  lora-data/continuity-pairs.jsonl (built by
 *         scripts/generate-continuity-data.ts)
 * Writes: tuning_experiment row with per-model + per-variant stats.
 *
 * Scoring:
 *   - The "label" for each pair is the EXPECTED set of severities from the
 *     synthetic variant (e.g., {"blocker"} or {} or {"blocker","nit"}).
 *   - The model output is parsed for the SET of issue `severity` strings.
 *     Specific issue text and conflictsWith are NOT scored — those are
 *     judgment calls. The severity TYPE set is the unambiguous part.
 *   - Per-pair Jaccard = |intersection|/|union| on the severity sets.
 *   - Per-pair "exact" = (Jaccard == 1.0) — the binary ladder cell.
 *   - Per-pair recall = |intersection|/|expected|  (NaN if expected empty)
 *   - Per-pair precision = |intersection|/|model|  (NaN if model empty)
 *   - VAR_NONE / VAR_TRAP empty-expected: empty model → exact=1; non-empty
 *     model → exact=0 and "extras" count incremented (false positives).
 *
 * The ladder question: how does base Qwen3-14B sit between Llama 8B (cheap
 * fast floor) and Qwen 235B (the slow capable production ceiling) on the
 * highest-cost-per-call agent in the pipeline? Input data for SFT
 * prioritization.
 *
 * Usage:
 *   CEREBRAS_API_KEY=... GROQ_API_KEY=... WANDB_API_KEY=... \
 *     bun scripts/score-continuity-baseline.ts
 *   ... --sample 30   (random sample for a quick smoke run)
 */

import { readFileSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"
import type { ProviderName } from "../models/registry"

const PAIRS_PATH = join(import.meta.dir, "../lora-data/continuity-pairs.jsonl")
const SAMPLE_ARG = process.argv.indexOf("--sample")
const SAMPLE_N   = SAMPLE_ARG !== -1 ? parseInt(process.argv[SAMPLE_ARG + 1]) : null

interface Pair {
  messages: Array<{ role: string; content: string }>
  _meta: { scenario: string; variant: string; draft: string }
}

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

const VALID_SEVERITIES = new Set(["blocker", "warning", "nit"])

interface CallOutcome {
  ok: boolean
  severities?: Set<string>
  rawCount?: number   // raw issue count BEFORE severity filtering — diagnostic
  ms: number
  promptTokens?: number
  completionTokens?: number
  error?: string
}

function extractSeveritySet(parsed: any): { severities: Set<string>; rawCount: number } {
  const issues = Array.isArray(parsed?.issues) ? parsed.issues : []
  const severities = new Set<string>()
  for (const i of issues) {
    if (i && typeof i.severity === "string" && VALID_SEVERITIES.has(i.severity)) {
      severities.add(i.severity)
    }
  }
  return { severities, rawCount: issues.length }
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
    const { severities, rawCount } = extractSeveritySet(parsed)
    return {
      ok: true,
      severities,
      rawCount,
      ms,
      promptTokens: result.usage.prompt_tokens,
      completionTokens: result.usage.completion_tokens,
    }
  } catch (e: any) {
    return { ok: false, ms: performance.now() - t0, error: e?.message ?? String(e) }
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────

interface VariantStats {
  exactMatch: number      // pairs where Jaccard == 1.0
  total: number           // pairs scored (excluding errors)
  errors: number
  jaccardSum: number      // for mean Jaccard
  recallSum: number       // for mean recall (when expected non-empty)
  recallCount: number
  precisionSum: number    // for mean precision (when model non-empty)
  precisionCount: number
  extraSeverities: number // count of severities model added that weren't expected
  missedSeverities: number// count of severities model failed to include
  // Specifically for empty-expected variants (NONE, TRAP):
  // how often did the model emit ANY issue (false positives)?
  falsePositiveCalls: number
}
function emptyStats(): VariantStats {
  return {
    exactMatch: 0, total: 0, errors: 0,
    jaccardSum: 0, recallSum: 0, recallCount: 0,
    precisionSum: 0, precisionCount: 0,
    extraSeverities: 0, missedSeverities: 0,
    falsePositiveCalls: 0,
  }
}

interface ModelStats {
  byVariant: Map<string, VariantStats>
  overall: VariantStats
  latencies: number[]
  inTokens: number[]
  outTokens: number[]
  rawIssueCounts: number[]
}
function emptyModelStats(): ModelStats {
  return {
    byVariant: new Map(),
    overall: emptyStats(),
    latencies: [], inTokens: [], outTokens: [], rawIssueCounts: [],
  }
}

function recordOutcome(stats: ModelStats, variant: string, expectedSet: Set<string>, outcome: CallOutcome) {
  if (!stats.byVariant.has(variant)) stats.byVariant.set(variant, emptyStats())
  const v = stats.byVariant.get(variant)!

  if (!outcome.ok || !outcome.severities) {
    v.errors++; stats.overall.errors++
    return
  }

  stats.latencies.push(outcome.ms)
  if (outcome.promptTokens) stats.inTokens.push(outcome.promptTokens)
  if (outcome.completionTokens) stats.outTokens.push(outcome.completionTokens)
  if (outcome.rawCount !== undefined) stats.rawIssueCounts.push(outcome.rawCount)

  const expected = expectedSet
  const got = outcome.severities
  const intersection = [...expected].filter(t => got.has(t)).length
  const union = new Set([...expected, ...got]).size
  const jaccard = union === 0 ? 1 : intersection / union  // both empty → 1.0
  const exact = jaccard === 1

  v.total++; stats.overall.total++
  if (exact) { v.exactMatch++; stats.overall.exactMatch++ }
  v.jaccardSum += jaccard; stats.overall.jaccardSum += jaccard

  if (expected.size > 0) {
    const recall = intersection / expected.size
    v.recallSum += recall; v.recallCount++
    stats.overall.recallSum += recall; stats.overall.recallCount++
    v.missedSeverities += (expected.size - intersection)
    stats.overall.missedSeverities += (expected.size - intersection)
  }
  if (got.size > 0) {
    const precision = intersection / got.size
    v.precisionSum += precision; v.precisionCount++
    stats.overall.precisionSum += precision; stats.overall.precisionCount++
    v.extraSeverities += (got.size - intersection)
    stats.overall.extraSeverities += (got.size - intersection)
  }
  if (expected.size === 0 && got.size > 0) {
    v.falsePositiveCalls++; stats.overall.falsePositiveCalls++
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function pct(num: number, den: number): number {
  return den === 0 ? 0 : Math.round((num / den) * 100)
}
function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length
}

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
    `Continuity-checker base-model baseline: Llama 8B vs Qwen3-14B vs Qwen 235B (${pairs.length} pairs)`,
    {
      pairs: pairs.length,
      models: MODELS.map(m => ({ key: m.key, label: m.label, provider: m.provider, model: m.model })),
      schema: "flat (production prompt)",
      temperature: 0.1,
      maxTokens: 768,
      pairsFile: "lora-data/continuity-pairs.jsonl",
      metric: "severity-set Jaccard, exact-match (Jaccard==1) for the binary cell",
      hypothesis: "Base Qwen3-14B sits between Llama 8B and Qwen 235B on continuity-checker severity-set agreement against deterministic synthetic labels. Quantifies the gap that SFT would need to close to make 14B + adapter a viable replacement for the production 235B in this slot. Continuity is the highest-cost agent in the pipeline by prompt-token volume, so this is the highest-leverage SFT candidate. Companion to exp #110 (adherence-checker baseline) and exp #114 (reference-resolver baseline) — together these measure SFT EV across all three structured-analytical agents on the same labeled-set methodology.",
      relatedExperiments: [110, 111, 114, 115],
    },
    { target: "continuity", dimension: "calibration" },
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
      const system = pair.messages[0].content
      const user = pair.messages[1].content
      const expected = JSON.parse(pair.messages[2].content) as { expectedSeverities: string[] }
      const expectedSet = new Set(expected.expectedSeverities)

      const outcomes = await Promise.all(MODELS.map(m => callModel(m, system, user)))

      for (let mi = 0; mi < MODELS.length; mi++) {
        recordOutcome(allStats.get(MODELS[mi].key)!, variant, expectedSet, outcomes[mi])
      }

      const tags = MODELS.map((m, mi) => {
        const o = outcomes[mi]
        if (!o.ok || !o.severities) return `${m.key}:ERR`
        const got = o.severities
        const inter = [...expectedSet].filter(t => got.has(t)).length
        const union = new Set([...expectedSet, ...got]).size
        const j = union === 0 ? 1 : inter / union
        return `${m.key}:${j === 1 ? "OK" : `j${Math.round(j * 100)}`}`
      }).join(" ")
      const expStr = expectedSet.size === 0 ? "{}" : `{${[...expectedSet].join(",")}}`
      console.log(`[${idx + 1}/${pairs.length}] ${pair._meta.scenario}/${variant} ${expStr} → ${tags}`)
    }))
  }

  // ── Report ──────────────────────────────────────────────────────────────

  console.log("\n" + "═".repeat(96))
  console.log("RESULTS — severity-set agreement vs deterministic labels (exact match)")
  console.log("═".repeat(96) + "\n")

  const variants = ["VAR_NONE", "VAR_BLOCKER", "VAR_WARNING", "VAR_NIT", "VAR_TRAP", "VAR_MULTI"]

  process.stdout.write("variant".padEnd(22))
  for (const m of MODELS) process.stdout.write(m.key.padStart(14))
  process.stdout.write("\n")
  console.log("─".repeat(22 + 14 * MODELS.length))

  for (const variant of variants) {
    process.stdout.write(variant.padEnd(22))
    for (const m of MODELS) {
      const s = allStats.get(m.key)!.byVariant.get(variant)
      if (!s || s.total === 0) { process.stdout.write("—".padStart(14)); continue }
      process.stdout.write(`${pct(s.exactMatch, s.total)}% (${s.exactMatch}/${s.total})`.padStart(14))
    }
    process.stdout.write("\n")
  }
  console.log("─".repeat(22 + 14 * MODELS.length))

  process.stdout.write("OVERALL".padEnd(22))
  for (const m of MODELS) {
    const o = allStats.get(m.key)!.overall
    process.stdout.write(`${pct(o.exactMatch, o.total)}% (${o.exactMatch}/${o.total})`.padStart(14))
  }
  process.stdout.write("\n\n")

  console.log("Per-model recall / precision / Jaccard / FP / latency:")
  for (const m of MODELS) {
    const s = allStats.get(m.key)!
    const o = s.overall
    const meanJaccard = o.total === 0 ? 0 : o.jaccardSum / o.total
    const meanRecall = o.recallCount === 0 ? 0 : o.recallSum / o.recallCount
    const meanPrecision = o.precisionCount === 0 ? 0 : o.precisionSum / o.precisionCount
    const f1 = (meanRecall + meanPrecision) === 0 ? 0
              : (2 * meanRecall * meanPrecision) / (meanRecall + meanPrecision)
    console.log(`  ${m.label}`)
    console.log(`    exact-match=${pct(o.exactMatch, o.total)}% (${o.exactMatch}/${o.total}) jaccard=${meanJaccard.toFixed(3)} recall=${meanRecall.toFixed(3)} precision=${meanPrecision.toFixed(3)} f1=${f1.toFixed(3)}`)
    console.log(`    extras=${o.extraSeverities} (over-flagged severity-types) missed=${o.missedSeverities} (under-flagged) FP-calls=${o.falsePositiveCalls} (calls that emitted issues on empty-expected) errors=${o.errors}`)
    console.log(`    raw-issues avg=${avg(s.rawIssueCounts).toFixed(2)}  latency avg=${Math.round(avg(s.latencies))}ms  tokens in=${Math.round(avg(s.inTokens))}/out=${Math.round(avg(s.outTokens))}`)
  }

  // Persist conclusion
  const conclusion = JSON.stringify({
    pairs: pairs.length,
    schema: "flat",
    metric: "severity-set Jaccard, exact-match for variant table",
    models: MODELS.map(m => {
      const s = allStats.get(m.key)!
      const o = s.overall
      const meanJaccard = o.total === 0 ? 0 : o.jaccardSum / o.total
      const meanRecall = o.recallCount === 0 ? 0 : o.recallSum / o.recallCount
      const meanPrecision = o.precisionCount === 0 ? 0 : o.precisionSum / o.precisionCount
      const f1 = (meanRecall + meanPrecision) === 0 ? 0
                : (2 * meanRecall * meanPrecision) / (meanRecall + meanPrecision)
      const variantTable: Record<string, { exact: number; total: number; pct: number; extras: number; missed: number; fpCalls: number }> = {}
      for (const [v, st] of s.byVariant) {
        variantTable[v] = {
          exact: st.exactMatch, total: st.total, pct: pct(st.exactMatch, st.total),
          extras: st.extraSeverities, missed: st.missedSeverities, fpCalls: st.falsePositiveCalls,
        }
      }
      return {
        key: m.key, label: m.label, provider: m.provider, model: m.model,
        exactMatchPct: pct(o.exactMatch, o.total),
        exactMatch: o.exactMatch, total: o.total, errors: o.errors,
        meanJaccard: Number(meanJaccard.toFixed(3)),
        meanRecall: Number(meanRecall.toFixed(3)),
        meanPrecision: Number(meanPrecision.toFixed(3)),
        f1: Number(f1.toFixed(3)),
        extraSeverities: o.extraSeverities,
        missedSeverities: o.missedSeverities,
        falsePositiveCalls: o.falsePositiveCalls,
        avgRawIssues: Number(avg(s.rawIssueCounts).toFixed(2)),
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

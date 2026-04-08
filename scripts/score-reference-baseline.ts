/**
 * Reference-resolver baseline ladder: Llama 8B vs Qwen3-14B vs Qwen 235B.
 *
 * Companion to score-adherence-baseline.ts (exp #110). Same three-model ladder
 * shape, same prompt mirroring production exactly, but adapted for the
 * reference-resolver's set-output task.
 *
 * Reads:  lora-data/reference-resolver-pairs.jsonl (built by
 *         scripts/generate-reference-resolver-data.ts)
 * Writes: tuning_experiment row with per-model + per-variant stats.
 *
 * Scoring:
 *   - The "label" for each pair is the EXPECTED set of lookup TYPES from the
 *     synthetic variant (e.g., {relationship} or {recent_events, relationship}
 *     or the empty set for VAR_NONE).
 *   - The model output is parsed for the SET of lookup `type` strings (args
 *     ignored — args are judgment calls, type-set is the unambiguous part).
 *   - Per-pair Jaccard = |intersection|/|union| on the type sets.
 *   - Per-pair "exact" = (Jaccard == 1.0) — the binary ladder cell, mirrors
 *     adherence-checker's PASS/FAIL agreement.
 *   - Per-pair recall = |intersection|/|expected|  (NaN if expected empty)
 *   - Per-pair precision = |intersection|/|model|  (NaN if model empty)
 *   - VAR_NONE special-case: empty expected, empty model → exact=1.0,
 *     recall=1.0; empty expected, non-empty model → exact=0.0, recall=NaN,
 *     "extra-types" count incremented.
 *
 * The "ladder" question: how does base Qwen3-14B sit between Llama 8B (cheap
 * fast floor) and Qwen 235B (slow capable ceiling) on this set-output task?
 * Input data for the "is SFT worth it for reference-resolver" decision.
 *
 * Usage:
 *   CEREBRAS_API_KEY=... GROQ_API_KEY=... WANDB_API_KEY=... \
 *     bun scripts/score-reference-baseline.ts
 *   ... --sample 30   (random sample for a quick smoke run)
 */

import { readFileSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"
import type { ProviderName } from "../models/registry"

const PAIRS_PATH = join(import.meta.dir, "../lora-data/reference-resolver-pairs.jsonl")
const SAMPLE_ARG = process.argv.indexOf("--sample")
const SAMPLE_N   = SAMPLE_ARG !== -1 ? parseInt(process.argv[SAMPLE_ARG + 1]) : null

interface Pair {
  messages: Array<{ role: string; content: string }>
  _meta: { scenario: string; variant: string; beat: string }
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

const VALID_TYPES = new Set(["recent_events", "relationship", "location_events", "knowledge"])

interface CallOutcome {
  ok: boolean
  types?: Set<string>
  rawCount?: number   // raw lookup count BEFORE type filtering — diagnostic
  ms: number
  promptTokens?: number
  completionTokens?: number
  error?: string
}

function extractTypeSet(parsed: any): { types: Set<string>; rawCount: number } {
  const lookups = Array.isArray(parsed?.lookups) ? parsed.lookups : []
  const types = new Set<string>()
  for (const l of lookups) {
    if (l && typeof l.type === "string" && VALID_TYPES.has(l.type)) {
      types.add(l.type)
    }
  }
  return { types, rawCount: lookups.length }
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
      maxTokens: 384,
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
    const { types, rawCount } = extractTypeSet(parsed)
    return {
      ok: true,
      types,
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
  extraTypes: number      // count of types model added that weren't expected (sum across pairs)
  missedTypes: number     // count of types model failed to include (sum across pairs)
}
function emptyStats(): VariantStats {
  return {
    exactMatch: 0, total: 0, errors: 0,
    jaccardSum: 0, recallSum: 0, recallCount: 0,
    precisionSum: 0, precisionCount: 0,
    extraTypes: 0, missedTypes: 0,
  }
}

interface ModelStats {
  byVariant: Map<string, VariantStats>
  overall: VariantStats
  latencies: number[]
  inTokens: number[]
  outTokens: number[]
  rawLookupCounts: number[]   // raw lookup-list lengths for diagnostic
}
function emptyModelStats(): ModelStats {
  return {
    byVariant: new Map(),
    overall: emptyStats(),
    latencies: [], inTokens: [], outTokens: [], rawLookupCounts: [],
  }
}

function recordOutcome(stats: ModelStats, variant: string, expectedTypes: Set<string>, outcome: CallOutcome) {
  if (!stats.byVariant.has(variant)) stats.byVariant.set(variant, emptyStats())
  const v = stats.byVariant.get(variant)!

  if (!outcome.ok || !outcome.types) {
    v.errors++; stats.overall.errors++
    return
  }

  stats.latencies.push(outcome.ms)
  if (outcome.promptTokens) stats.inTokens.push(outcome.promptTokens)
  if (outcome.completionTokens) stats.outTokens.push(outcome.completionTokens)
  if (outcome.rawCount !== undefined) stats.rawLookupCounts.push(outcome.rawCount)

  const expected = expectedTypes
  const got = outcome.types
  const intersection = [...expected].filter(t => got.has(t)).length
  const union = new Set([...expected, ...got]).size
  const jaccard = union === 0 ? 1 : intersection / union  // both empty → 1.0
  const exact = jaccard === 1

  // Per-variant
  v.total++; stats.overall.total++
  if (exact) { v.exactMatch++; stats.overall.exactMatch++ }
  v.jaccardSum += jaccard; stats.overall.jaccardSum += jaccard

  if (expected.size > 0) {
    const recall = intersection / expected.size
    v.recallSum += recall; v.recallCount++
    stats.overall.recallSum += recall; stats.overall.recallCount++
    v.missedTypes += (expected.size - intersection)
    stats.overall.missedTypes += (expected.size - intersection)
  }
  if (got.size > 0) {
    const precision = intersection / got.size
    v.precisionSum += precision; v.precisionCount++
    stats.overall.precisionSum += precision; stats.overall.precisionCount++
    v.extraTypes += (got.size - intersection)
    stats.overall.extraTypes += (got.size - intersection)
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
    `Reference-resolver base-model baseline: Llama 8B vs Qwen3-14B vs Qwen 235B (${pairs.length} pairs)`,
    {
      pairs: pairs.length,
      models: MODELS.map(m => ({ key: m.key, label: m.label, provider: m.provider, model: m.model })),
      schema: "flat (production prompt)",
      temperature: 0.1,
      maxTokens: 384,
      pairsFile: "lora-data/reference-resolver-pairs.jsonl",
      metric: "type-set Jaccard, exact-match (Jaccard==1) for the binary cell",
      hypothesis: "Base Qwen3-14B sits between Llama 8B and Qwen 235B on reference-resolver TYPE-set agreement against deterministic synthetic labels. Quantifies the gap that SFT would need to close to make 14B + adapter a viable replacement for 235B in this slot. Companion to exp #110 (adherence-checker baseline) — together these measure SFT EV across the two structured-analytical agents on the same labeled-set methodology.",
      relatedExperiments: [110, 111],
    },
    { target: "reference-resolver", dimension: "calibration" },
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
      const expected = JSON.parse(pair.messages[2].content) as { expectedTypes: string[] }
      const expectedSet = new Set(expected.expectedTypes)

      const outcomes = await Promise.all(MODELS.map(m => callModel(m, system, user)))

      for (let mi = 0; mi < MODELS.length; mi++) {
        recordOutcome(allStats.get(MODELS[mi].key)!, variant, expectedSet, outcomes[mi])
      }

      const tags = MODELS.map((m, mi) => {
        const o = outcomes[mi]
        if (!o.ok || !o.types) return `${m.key}:ERR`
        const got = o.types
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
  console.log("RESULTS — type-set agreement vs deterministic labels (exact match)")
  console.log("═".repeat(96) + "\n")

  const variants = ["VAR_NONE", "VAR_REL", "VAR_EVENTS", "VAR_LOCATION", "VAR_KNOWLEDGE", "VAR_MULTI"]

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

  console.log("Per-model recall / precision / Jaccard / extras / latency:")
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
    console.log(`    extras=${o.extraTypes} (over-fetched types) missed=${o.missedTypes} (under-fetched types) errors=${o.errors}`)
    console.log(`    raw-lookups avg=${avg(s.rawLookupCounts).toFixed(2)}  latency avg=${Math.round(avg(s.latencies))}ms  tokens in=${Math.round(avg(s.inTokens))}/out=${Math.round(avg(s.outTokens))}`)
  }

  // Persist conclusion
  const conclusion = JSON.stringify({
    pairs: pairs.length,
    schema: "flat",
    metric: "type-set Jaccard, exact-match for variant table",
    models: MODELS.map(m => {
      const s = allStats.get(m.key)!
      const o = s.overall
      const meanJaccard = o.total === 0 ? 0 : o.jaccardSum / o.total
      const meanRecall = o.recallCount === 0 ? 0 : o.recallSum / o.recallCount
      const meanPrecision = o.precisionCount === 0 ? 0 : o.precisionSum / o.precisionCount
      const f1 = (meanRecall + meanPrecision) === 0 ? 0
                : (2 * meanRecall * meanPrecision) / (meanRecall + meanPrecision)
      const variantTable: Record<string, { exact: number; total: number; pct: number; extras: number; missed: number }> = {}
      for (const [v, st] of s.byVariant) {
        variantTable[v] = {
          exact: st.exactMatch, total: st.total, pct: pct(st.exactMatch, st.total),
          extras: st.extraTypes, missed: st.missedTypes,
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
        extraTypes: o.extraTypes,
        missedTypes: o.missedTypes,
        avgRawLookups: Number(avg(s.rawLookupCounts).toFixed(2)),
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

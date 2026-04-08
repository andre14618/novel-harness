/**
 * Reference-resolver checklist-schema benchmark.
 *
 * Companion to score-reference-baseline.ts (the reference-resolver baseline
 * ladder, mirroring exp #110→exp #111 on the adherence-checker side). Runs
 * the same labeled set against the same 3-model ladder, but swaps the system
 * prompt to a structured-checklist version that forces per-marker observation
 * before the lookup set is emitted.
 *
 * Hypothesis-and-falsification framing:
 *
 *   The chapter-plan-checker checklist (exp #109) closed a 17pp gap on 14B by
 *   forcing the model to write down per-requirement observations. On
 *   adherence-checker (exp #111) the same trick gave 14B only +4pp and made
 *   235B WORSE — schemas have model-direction-dependent shape-of-attention.
 *
 *   For reference-resolver, the failure mode in lessons-learned is different
 *   from both predecessors: Llama 8B is *noisy-and-exploratory*, not biased.
 *   It leaves recall on the table because it picks one valid lookup type per
 *   call instead of enumerating all of them. A checklist that forces the
 *   model to enumerate "for each implicit phrase in the beat, identify it,
 *   then state which lookup type covers it" should EXPAND the type set in
 *   exactly the way the variance-fix did under parallel-N (lessons-learned
 *   2026-04-07: best-of-N gave reference-resolver +23% relative recall).
 *
 *   The same checklist mechanism should NOT help 235B much, because 235B
 *   already enumerates well (low recall miss rate). And it might HURT 14B
 *   on VAR_NONE, because forcing the model to write down candidates can
 *   trigger over-fetching on beats that look implicit but aren't.
 *
 *   Net prediction: checklist lifts 8B and 14B on the multi-type variants
 *   (VAR_REL, VAR_EVENTS, VAR_LOCATION, VAR_KNOWLEDGE, VAR_MULTI) but
 *   regresses VAR_NONE due to over-fetching, with a roughly neutral effect
 *   on 235B. If true, checklist is a per-variant tradeoff, not a uniform
 *   lift; if false, the schema-shape-vs-task-shape lesson generalizes
 *   across two more agents and SFT remains the only path forward.
 *
 * Reads the same lora-data/reference-resolver-pairs.jsonl. Strips the trailing
 * "What specific background does the writer need?" tail from the user prompt
 * so the new system prompt is the only authority on output schema, and
 * replaces the system message entirely.
 *
 * Usage:
 *   CEREBRAS_API_KEY=... GROQ_API_KEY=... WANDB_API_KEY=... \
 *     bun scripts/score-reference-checklist.ts
 *   ... --sample 30
 */

import { readFileSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"
import type { ProviderName } from "../models/registry"

const PAIRS_PATH = join(import.meta.dir, "../lora-data/reference-resolver-pairs.jsonl")
const SAMPLE_ARG = process.argv.indexOf("--sample")
const SAMPLE_N = SAMPLE_ARG !== -1 ? parseInt(process.argv[SAMPLE_ARG + 1]) : null

// ── Checklist system prompt ────────────────────────────────────────────────
//
// The mechanism: force the model to (1) identify each implicit phrase in the
// beat, (2) classify what KIND of background each phrase points to, (3)
// derive the lookup TYPE from that classification, (4) emit the final list.
// This breaks the "pick one lookup and ship" failure mode by structurally
// requiring multi-phrase enumeration before the verdict.
//
// Critically the prompt also has an EXPLICIT NONE branch: if a phrase is
// purely ambient ("after the morning meal" with no specific event), the
// model must write `points_to_background: "ambient"` and emit no lookup for
// it. This is the over-fetch guardrail for VAR_NONE.

const CHECKLIST_SYSTEM = `You identify what background information a scene beat needs. Some beats reference specific prior events, relationships, or location history that the writer needs to look up; others use ambient phrasing that doesn't require any lookup.

Your job is to fill out a checklist BEFORE emitting the final lookup list. Do not skip fields. Do not jump straight to the final list.

CHECKS TO FILL OUT:

1. **implicit_phrases** — Find every phrase in the beat that COULD point to background (markers like "their last", "after the", "since the", "what she learned", "the letter", "the deal", "the truth about", "earlier", "before the", etc.). For each phrase:
   - phrase: quote the exact phrase from the beat
   - points_to_background: ONE of:
     - "specific_event" → the phrase points to a discrete prior event the writer needs details of
     - "relationship_dynamic" → the phrase points to the trust/tension/history between two characters
     - "location_history" → the phrase points to events that previously happened at this same place
     - "character_knowledge" → the phrase points to information one character previously LEARNED
     - "ambient" → the phrase is purely atmospheric framing ("after the morning meal" with no specific event behind it) and needs NO lookup
   - reasoning: one short sentence explaining the choice, especially the ambient case

2. **derived_lookups** — For each non-ambient phrase above, derive ONE lookup. Map points_to_background → lookup type:
   - "specific_event"        → recent_events
   - "relationship_dynamic"  → relationship
   - "location_history"      → location_events
   - "character_knowledge"   → knowledge
   For each lookup record:
   - source_phrase: the phrase from step 1 it came from
   - type: one of {recent_events, relationship, location_events, knowledge}
   - characters: the characters involved (from the beat — required for relationship and recent_events; optional for location_events and knowledge)
   - location: the place name (only for location_events; null otherwise)
   - topic: a short topic phrase (only for knowledge; null otherwise)

3. **lookups** — The FINAL list, deduplicated by type. This is what the writer reads. If every implicit_phrase was "ambient", emit an empty list.

DO NOT emit a lookup for ambient phrases. If the only implicit-marker phrase in the beat is purely framing ("after the morning meal", "earlier that day") with no specific event behind it, every implicit_phrase should be "ambient" and lookups should be empty.

Respond with ONLY valid JSON in this exact shape:
{
  "implicit_phrases": [
    { "phrase": "...", "points_to_background": "specific_event", "reasoning": "..." }
  ],
  "derived_lookups": [
    { "source_phrase": "...", "type": "recent_events", "characters": ["..."], "location": null, "topic": null }
  ],
  "lookups": [
    { "type": "recent_events", "characters": ["..."], "location": null, "topic": null }
  ]
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
  _meta: { scenario: string; variant: string; beat: string }
}

const VALID_TYPES = new Set(["recent_events", "relationship", "location_events", "knowledge"])

/** Strip the trailing "What specific background does the writer need? Return JSON…"
 *  block from the original user prompt so the checklist system prompt is the
 *  only authority on what schema to emit. Keeps the beat/characters/setting/
 *  chapter header. */
function stripUserTail(user: string): string {
  const idx = user.indexOf("What specific background")
  return idx === -1 ? user.trim() : user.slice(0, idx).trim()
}

interface CallOutcome {
  ok: boolean
  types?: Set<string>
  rawCount?: number
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
      // Checklist output is several times larger than flat (~600-1200
      // tokens vs ~80) — the implicit_phrases + derived_lookups blocks
      // each take a few hundred tokens. 2048 gives headroom.
      maxTokens: 2048,
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

// ── Stats (shape identical to score-reference-baseline.ts) ────────────────

interface VariantStats {
  exactMatch: number
  total: number
  errors: number
  jaccardSum: number
  recallSum: number
  recallCount: number
  precisionSum: number
  precisionCount: number
  extraTypes: number
  missedTypes: number
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
  rawLookupCounts: number[]
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
  const jaccard = union === 0 ? 1 : intersection / union
  const exact = jaccard === 1

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
    `Reference-resolver checklist schema vs flat schema: Llama 8B / Qwen3-14B / Qwen 235B (${pairs.length} pairs)`,
    {
      pairs: pairs.length,
      models: MODELS.map(m => ({ key: m.key, label: m.label, provider: m.provider, model: m.model })),
      schema: "structured-checklist (per-phrase enumeration with explicit ambient branch)",
      temperature: 0.1,
      maxTokens: 2048,
      pairsFile: "lora-data/reference-resolver-pairs.jsonl",
      metric: "type-set Jaccard, exact-match (Jaccard==1) for the binary cell",
      hypothesis: "Forcing per-phrase enumeration before the verdict expands type-set recall on multi-type variants (REL, EVENTS, LOCATION, KNOWLEDGE, MULTI), where Llama 8B leaves recall on the table by picking one valid lookup per call. The explicit 'ambient' branch should preserve VAR_NONE precision. Net: lifts 8B and 14B without hurting 235B. Falsification: same shape-of-attention pitfall as exp #111 — checklist helps the weaker models on enumeration but introduces over-fetching on VAR_NONE, mirroring 14B's over-strict shift on adherence-checker.",
      baselineExperiment: "score-reference-baseline (sibling experiment)",
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
      const userBody = stripUserTail(pair.messages[1].content)
      const expected = JSON.parse(pair.messages[2].content) as { expectedTypes: string[] }
      const expectedSet = new Set(expected.expectedTypes)

      const outcomes = await Promise.all(MODELS.map(m => callModel(m, CHECKLIST_SYSTEM, userBody)))

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
  console.log("RESULTS — checklist schema, type-set agreement vs deterministic labels")
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
    schema: "structured-checklist",
    pairs: pairs.length,
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

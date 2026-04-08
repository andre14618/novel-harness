/**
 * Continuity-checker checklist-schema benchmark.
 *
 * Companion to score-continuity-baseline.ts. Same labeled set, same 3-model
 * ladder, but swaps the system prompt for a structured checklist that forces
 * the model to enumerate per-fact and per-character-state observations BEFORE
 * emitting any issues. Mirrors the chapter-plan-checker (#107→#109),
 * adherence-checker (#110→#111), and reference-resolver (#114→#115)
 * baseline+checklist pattern.
 *
 * Hypothesis-and-falsification framing:
 *
 *   The cross-task pattern from the prior three checklist experiments:
 *
 *     - chapter-plan-checker: +17pp (closed most of the gap, didn't
 *       eliminate the need for SFT — both base 14B and 235B improved together)
 *     - adherence-checker: +4pp on best model, made some weaker (schema
 *       didn't help — task is "did it execute or not", attention shape
 *       was already correct)
 *     - reference-resolver: +43pp on best model, 14B BEAT 235B (over-fetch
 *       was the failure mode and the explicit "ambient" branch was the fix)
 *
 *   Continuity is structurally CLOSEST to chapter-plan-checker — both are
 *   "compare prose against a structured spec" tasks. The failure modes we
 *   expect to see on flat baseline: (1) over-flagging atmospheric prose as
 *   continuity errors (the trap variant), (2) under-flagging because the
 *   model doesn't bother cross-checking every fact before emitting its
 *   first issue, (3) severity miscalibration (calling nits blockers and
 *   vice versa).
 *
 *   The checklist forces the model to walk EACH established fact and EACH
 *   character state, mark whether the draft is consistent with it, and only
 *   then derive issues. The TRAP variant gets explicit handling via a
 *   "figurative_or_literal" classification step that mirrors the production
 *   prompt's false-positive guidance. This should:
 *     - Lift WARNING/NIT detection on the weaker models by forcing them to
 *       check every fact instead of stopping at the first plausible issue
 *     - Hold or improve TRAP precision by requiring an explicit
 *       figurative-vs-literal classification step
 *     - Possibly hurt VAR_NONE on weaker models because forcing them to
 *       enumerate facts can trigger over-flagging (same dynamic as
 *       reference-resolver under flat schema, before the ambient branch
 *       was added)
 *
 *   Expected falsification: if checklist gives the same shape as
 *   reference-resolver (huge lift on the weaker model), continuity is a
 *   PROMPT-ONLY fix and SFT is no longer the priority. If it gives the
 *   same shape as adherence-checker (small lift, possibly hurts), the
 *   schema is wrong-shape for this task and SFT remains the path. If it
 *   gives the chapter-plan-checker shape (partial lift), the picture is
 *   "prompt + SFT" rather than "either-or".
 *
 * Reads the same lora-data/continuity-pairs.jsonl. Strips the trailing
 * "Check this chapter draft for continuity issues..." sentence from the
 * user prompt so the new system prompt is the only authority on output
 * schema, and replaces the system message entirely.
 *
 * Usage:
 *   CEREBRAS_API_KEY=... GROQ_API_KEY=... WANDB_API_KEY=... \
 *     bun scripts/score-continuity-checklist.ts
 *   ... --sample 30
 */

import { readFileSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"
import type { ProviderName } from "../models/registry"

const PAIRS_PATH = join(import.meta.dir, "../lora-data/continuity-pairs.jsonl")
const SAMPLE_ARG = process.argv.indexOf("--sample")
const SAMPLE_N = SAMPLE_ARG !== -1 ? parseInt(process.argv[SAMPLE_ARG + 1]) : null

// ── Checklist system prompt ────────────────────────────────────────────────
//
// The mechanism: force the model to (1) walk every established fact and
// classify the draft as consistent / contradicted / not-applicable;
// (2) walk every character state and do the same; (3) for every potentially-
// continuity-flagging passage in the draft, classify it as figurative or
// literal BEFORE deriving any issues; (4) only then emit the final issues
// list with severities.
//
// Critically the prompt has explicit branches for the production prompt's
// false-positive guidance: figurative language, dramatic irony, character
// lying. These are the trap-variant guardrails.

const CHECKLIST_SYSTEM = `You are a continuity checker for fiction. Review a chapter draft against established facts and character states.

Your job is to fill out a checklist BEFORE emitting the final issues list. Do not skip fields. Do not jump straight to the issues.

CHECKS TO FILL OUT:

1. **fact_checks** — For EVERY established fact in the input, fill out one entry:
   - fact_id: shortened tag like "ch5_event" — use chapter + category
   - status: ONE of:
     - "consistent" → the draft is consistent with this fact (or the fact is not relevant to anything in the draft)
     - "contradicted" → the draft contains a passage that directly contradicts this fact
     - "ambiguous" → the draft hints at something that could contradict but is figurative or unclear
   - evidence: if status is "contradicted", quote the exact passage from the draft. If "consistent" or "ambiguous", write "n/a" or a brief note.

2. **state_checks** — For EVERY character state in the input, fill out one entry:
   - character: the character name
   - location_consistent: true / false / not_mentioned
   - knowledge_consistent: true / false / not_mentioned (does the character act on knowledge they should/shouldn't have?)
   - notes: one short sentence

3. **figurative_review** — Walk through the draft and find any passages that COULD look like a continuity violation but are actually figurative language, metaphor, dramatic irony, or character lies. For each such passage:
   - passage: quote from the draft
   - classification: ONE of:
     - "figurative" → metaphor or simile, not a literal event
     - "dramatic_irony" → reader knows something the character doesn't; not a continuity error
     - "character_lie" → a character is lying or being unreliable in dialogue
     - "literal" → this is a literal event that needs to be checked against facts
   - reasoning: one short sentence

4. **derived_issues** — From the checks above, derive the final issues list. Map:
   - any "contradicted" fact → issue with appropriate severity
     - dead character speaking, character in wrong location, knowledge violation, world-rule violation, impossible event → severity "blocker"
     - timeline mismatch, travel-time violation, characterization drift, emotional discontinuity → severity "warning"
     - description drift, name/title inconsistency, object drift → severity "nit"
   - any state_checks failure → issue with the matching severity
   - DO NOT emit any issue derived from a "figurative" / "dramatic_irony" / "character_lie" passage
   - DO NOT emit issues for "ambiguous" or "consistent" facts

5. **issues** — The FINAL issues list. Each entry: { severity, description, conflictsWith, suggestedFix }. If every fact_check is consistent and figurative_review classifies all flagged passages as non-literal, emit an empty list.

Respond with ONLY valid JSON in this exact shape:
{
  "fact_checks": [
    { "fact_id": "ch5_event", "status": "consistent", "evidence": "n/a" }
  ],
  "state_checks": [
    { "character": "Mira", "location_consistent": true, "knowledge_consistent": true, "notes": "..." }
  ],
  "figurative_review": [
    { "passage": "...", "classification": "figurative", "reasoning": "..." }
  ],
  "derived_issues": [
    { "from_check": "fact_checks.ch5_event", "severity": "blocker", "reasoning": "..." }
  ],
  "issues": [
    { "severity": "blocker", "description": "...", "conflictsWith": "...", "suggestedFix": "..." }
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
  _meta: { scenario: string; variant: string; draft: string }
}

const VALID_SEVERITIES = new Set(["blocker", "warning", "nit"])

/** Strip the trailing "Check this chapter draft..." sentence from the
 *  original user prompt so the checklist system prompt is the only authority
 *  on what schema to emit. Keeps the CHAPTER DRAFT / ESTABLISHED FACTS /
 *  CHARACTER STATES blocks. */
function stripUserTail(user: string): string {
  const idx = user.indexOf("Check this chapter draft")
  return idx === -1 ? user.trim() : user.slice(0, idx).trim()
}

interface CallOutcome {
  ok: boolean
  severities?: Set<string>
  rawCount?: number
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
      // Checklist output for this task is much larger than flat — every
      // fact gets a row, every state gets a row, plus figurative_review
      // and derived_issues blocks. 3072 gives headroom for ~6 facts × 3
      // states × figurative passes × final issues.
      maxTokens: 3072,
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

// ── Stats (shape identical to score-continuity-baseline.ts) ───────────────

interface VariantStats {
  exactMatch: number
  total: number
  errors: number
  jaccardSum: number
  recallSum: number
  recallCount: number
  precisionSum: number
  precisionCount: number
  extraSeverities: number
  missedSeverities: number
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
  const jaccard = union === 0 ? 1 : intersection / union
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
    `Continuity-checker checklist schema vs flat schema: Llama 8B / Qwen3-14B / Qwen 235B (${pairs.length} pairs)`,
    {
      pairs: pairs.length,
      models: MODELS.map(m => ({ key: m.key, label: m.label, provider: m.provider, model: m.model })),
      schema: "structured-checklist (per-fact and per-state walk + figurative_review + derived_issues)",
      temperature: 0.1,
      maxTokens: 3072,
      pairsFile: "lora-data/continuity-pairs.jsonl",
      metric: "severity-set Jaccard, exact-match (Jaccard==1) for the binary cell",
      hypothesis: "Forcing per-fact and per-state walk before issue derivation expands continuity-error recall on weaker models, while the explicit figurative_review step preserves precision on the TRAP variant. Net prediction: closer to the chapter-plan-checker pattern (+17pp on best model with both 14B and 235B improving) than to adherence-checker (+4pp, schema didn't help) — continuity is structurally a 'compare prose against structured spec' task like chapter-plan-checker. Falsification: if the lift matches reference-resolver (+43pp, 14B beats 235B), continuity is a prompt-only fix and SFT is OFF. If it matches adherence-checker (+4pp, no real change), the schema is wrong-shape and SFT remains the only path forward.",
      baselineExperiment: "score-continuity-baseline (sibling experiment)",
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
      const userBody = stripUserTail(pair.messages[1].content)
      const expected = JSON.parse(pair.messages[2].content) as { expectedSeverities: string[] }
      const expectedSet = new Set(expected.expectedSeverities)

      const outcomes = await Promise.all(MODELS.map(m => callModel(m, CHECKLIST_SYSTEM, userBody)))

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
  console.log("RESULTS — checklist schema, severity-set agreement vs deterministic labels")
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
    schema: "structured-checklist",
    pairs: pairs.length,
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

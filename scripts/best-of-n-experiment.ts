/**
 * Best-of-N inference experiment.
 *
 * Compares three variants for a structured analytical agent:
 *   1. Production single-shot (current model assignment)
 *   2. Oracle single-shot (a stronger reference model)
 *   3. Parallel-N on the production model with task-specific aggregation
 *
 * Mines real (input, expected_output_shape) pairs from the DB so the
 * comparison runs against actual harness workload, not synthetic data.
 *
 * Currently supports adherence-checker (boolean output, majority vote)
 * and reference-resolver (list output, set union). Each agent has its
 * own config block specifying schema, prompt, aggregator, and metric.
 *
 * Usage:
 *   bun scripts/best-of-n-experiment.ts --agent adherence-checker --samples 30 --n 3
 *   bun scripts/best-of-n-experiment.ts --agent reference-resolver --samples 30 --n 3
 */

import { z } from "zod"
import { callAgent, executeBestOfN } from "../src/llm"
import db from "../data/connection"
import { initNovelRun } from "../src/logger"
import { unionByKey, majorityValue } from "../src/aggregators"
import type { ChapterOutline, SceneBeat } from "../src/types"

// ── CLI args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function arg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`
  const found = args.find(a => a.startsWith(prefix))
  if (found) return found.slice(prefix.length)
  const flagIdx = args.indexOf(`--${name}`)
  if (flagIdx >= 0 && args[flagIdx + 1] && !args[flagIdx + 1].startsWith("--")) return args[flagIdx + 1]
  return fallback
}

const AGENT = arg("agent", "adherence-checker")!
const SAMPLES = parseInt(arg("samples", "20")!)
const N = parseInt(arg("n", "3")!)
const NOVELS_ARG = arg("novels")
const ORACLE_PROVIDER = arg("oracle-provider", "cerebras")!
const ORACLE_MODEL = arg("oracle-model", "qwen-3-235b-a22b-instruct-2507")!

// ── Test case mining ──────────────────────────────────────────────────────

interface TestCase {
  novelId: string
  chapterNumber: number
  beatIndex: number
  beat: SceneBeat
  outline: ChapterOutline
  prose: string
}

async function loadTestCases(maxCases: number): Promise<TestCase[]> {
  let novelIds: string[]
  if (NOVELS_ARG) {
    novelIds = NOVELS_ARG.split(",")
  } else {
    const rows = await db`
      SELECT cd.novel_id
      FROM chapter_drafts cd
      WHERE cd.status = 'approved'
      GROUP BY cd.novel_id
      HAVING COUNT(DISTINCT cd.chapter_number) >= 2
      ORDER BY MAX(cd.chapter_number) DESC
      LIMIT 8
    `
    novelIds = rows.map((r: any) => r.novel_id)
  }

  const cases: TestCase[] = []
  for (const novelId of novelIds) {
    if (cases.length >= maxCases) break
    const chapters = await db`
      SELECT chapter_number, prose
      FROM chapter_drafts
      WHERE novel_id = ${novelId} AND status = 'approved'
      ORDER BY chapter_number ASC
    `
    for (const ch of chapters) {
      if (cases.length >= maxCases) break
      const outlineRows = await db`
        SELECT outline_json
        FROM chapter_outlines
        WHERE novel_id = ${novelId} AND chapter_number = ${ch.chapter_number}
      `
      if (!outlineRows.length) continue
      const outline = outlineRows[0].outline_json as ChapterOutline
      if (!outline.scenes || outline.scenes.length === 0) continue

      const chunks = ch.prose.split(/\n\n+/).filter((c: string) => c.trim().length > 50)
      if (chunks.length === 0) continue

      for (let bi = 0; bi < outline.scenes.length && cases.length < maxCases; bi++) {
        const chunkIdx = Math.min(bi, chunks.length - 1)
        const proseChunk = chunks[chunkIdx]
        if (proseChunk.length < 100) continue
        cases.push({
          novelId,
          chapterNumber: ch.chapter_number,
          beatIndex: bi,
          beat: outline.scenes[bi],
          outline,
          prose: proseChunk.slice(0, 2000),
        })
      }
    }
  }
  return cases
}

// ── Per-agent config interface ────────────────────────────────────────────

interface AgentExperimentConfig<T> {
  agentName: string
  systemPrompt: string
  buildUserPrompt: (tc: TestCase) => string
  schema: z.ZodSchema<T>
  aggregator: (outputs: T[]) => T
  /** Compute an "agreement score" between two outputs (typically production vs oracle).
   *  For boolean outputs return 1 if equal else 0. For set outputs return Jaccard similarity. */
  agreementScore: (a: T, b: T) => number
  /** Short summary string for console logging — e.g. "T" / "F" for booleans, item count for sets. */
  summarize: (output: T) => string
}

// ── Agent: adherence-checker ─────────────────────────────────────────────

const adherenceSchema = z.object({
  pass: z.boolean(),
  deviations: z.array(z.string()).default([]),
})
type AdherenceOutput = z.infer<typeof adherenceSchema>

const ADHERENCE_CONFIG: AgentExperimentConfig<AdherenceOutput> = {
  agentName: "adherence-checker",
  systemPrompt: "You check if prose follows a scene beat specification. Be strict but fair.",
  buildUserPrompt: (tc) => `Beat: "${tc.beat.description}"
Setting: "${tc.outline.setting}"
Characters expected: ${tc.beat.characters.join(", ")}

Prose:
---
${tc.prose}
---

Did the prose execute the beat? Check:
1. Do the described events happen in the prose?
2. Is it set in the right place?
3. Do characters behave consistently with their roles?

Return JSON: { "pass": true/false, "deviations": ["specific issue 1", ...] }
Return pass:true with empty deviations if the beat is executed well.`,
  schema: adherenceSchema,
  aggregator: (outputs) => {
    const passed = majorityValue(outputs.map(o => o.pass))
    const dedupedDeviations = unionByKey([outputs.flatMap(o => o.deviations ?? [])], d => d)
    return { pass: passed, deviations: dedupedDeviations }
  },
  agreementScore: (a, b) => (a.pass === b.pass ? 1 : 0),
  summarize: (out) => out.pass ? "T" : "F",
}

// ── Agent: reference-resolver ────────────────────────────────────────────

const referenceSchema = z.object({
  lookups: z.array(z.object({
    type: z.string(),
    characters: z.array(z.string()).optional(),
    location: z.string().optional(),
    topic: z.string().optional(),
  })).default([]),
})
type ReferenceOutput = z.infer<typeof referenceSchema>

/** Coarse key for matching lookups across models. Drops the free-text `topic`
 *  field because the retrieval engine in src/agents/writer/reference-resolver.ts
 *  only uses topic for the `knowledge` lookup type (substring filter); for
 *  recent_events, relationship, and location_events the topic is unused at
 *  retrieval time. Including topic in the key produces near-zero exact matches
 *  even when the models semantically agree on what background to fetch. */
function lookupKey(l: ReferenceOutput["lookups"][number]): string {
  const chars = (l.characters ?? []).map(c => c.toLowerCase().trim()).sort().join(",")
  const loc = (l.location ?? "").toLowerCase().trim()
  // For knowledge lookups, include a short normalized topic prefix so distinct
  // topic intents on the same character don't all collapse to one key.
  const topicHint = l.type === "knowledge"
    ? "|" + (l.topic ?? "").toLowerCase().trim().split(/\s+/).slice(0, 3).join(" ")
    : ""
  return `${l.type}|${chars}|${loc}${topicHint}`
}

const REFERENCE_CONFIG: AgentExperimentConfig<ReferenceOutput> = {
  agentName: "reference-resolver",
  systemPrompt: "You identify what background information a scene beat needs. Return JSON with specific lookups.",
  buildUserPrompt: (tc) => `Beat: "${tc.beat.description}"
Characters: ${tc.beat.characters.join(", ")}
Setting: ${tc.outline.setting}
Chapter: ${tc.chapterNumber}

What specific background does the writer need? Return JSON:
{ "lookups": [{ "type": "recent_events"|"relationship"|"location_events"|"knowledge", "characters": ["name"], "location": "place", "topic": "subject" }] }

Only include lookups for things implicitly referenced. Return empty lookups array if the beat is self-contained.`,
  schema: referenceSchema,
  aggregator: (outputs) => {
    const merged = unionByKey(outputs.map(o => o.lookups ?? []), lookupKey)
    return { lookups: merged }
  },
  agreementScore: (a, b) => {
    const setA = new Set((a.lookups ?? []).map(lookupKey))
    const setB = new Set((b.lookups ?? []).map(lookupKey))
    if (setA.size === 0 && setB.size === 0) return 1
    const intersection = [...setA].filter(k => setB.has(k)).length
    const union = new Set([...setA, ...setB]).size
    return union === 0 ? 1 : intersection / union  // Jaccard similarity
  },
  summarize: (out) => `${out.lookups?.length ?? 0}`,
}

const AGENT_CONFIGS: Record<string, AgentExperimentConfig<any>> = {
  "adherence-checker": ADHERENCE_CONFIG,
  "reference-resolver": REFERENCE_CONFIG,
}

// ── Variant runners (generic over agent config) ───────────────────────────

interface VariantResult<T> {
  output: T
  latencyMs: number
  tokens: { prompt: number; completion: number }
  failed?: boolean
}

async function runProduction<T>(tc: TestCase, cfg: AgentExperimentConfig<T>): Promise<VariantResult<T>> {
  const t0 = performance.now()
  try {
    const r = await callAgent({
      agentName: cfg.agentName,
      systemPrompt: cfg.systemPrompt,
      userPrompt: cfg.buildUserPrompt(tc),
      schema: cfg.schema,
      novelId: tc.novelId,
    })
    return { output: r.output, latencyMs: performance.now() - t0, tokens: r.tokensUsed }
  } catch (e) {
    return { output: {} as T, latencyMs: performance.now() - t0, tokens: { prompt: 0, completion: 0 }, failed: true }
  }
}

async function runOracle<T>(tc: TestCase, cfg: AgentExperimentConfig<T>): Promise<VariantResult<T>> {
  const t0 = performance.now()
  try {
    const r = await callAgent({
      agentName: `${cfg.agentName}-oracle`,
      systemPrompt: cfg.systemPrompt,
      userPrompt: cfg.buildUserPrompt(tc),
      schema: cfg.schema,
      novelId: tc.novelId,
      provider: ORACLE_PROVIDER as any,
      model: ORACLE_MODEL,
    })
    return { output: r.output, latencyMs: performance.now() - t0, tokens: r.tokensUsed }
  } catch (e) {
    return { output: {} as T, latencyMs: performance.now() - t0, tokens: { prompt: 0, completion: 0 }, failed: true }
  }
}

async function runParallelN<T>(tc: TestCase, cfg: AgentExperimentConfig<T>): Promise<VariantResult<T>> {
  const t0 = performance.now()
  try {
    const r = await executeBestOfN<T>({
      agentName: cfg.agentName,
      systemPrompt: cfg.systemPrompt,
      userPrompt: cfg.buildUserPrompt(tc),
      schema: cfg.schema,
      novelId: tc.novelId,
    }, N, cfg.aggregator)
    return { output: r.output, latencyMs: performance.now() - t0, tokens: r.tokensUsed }
  } catch (e) {
    return { output: {} as T, latencyMs: performance.now() - t0, tokens: { prompt: 0, completion: 0 }, failed: true }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

interface CaseResult<T> {
  testCase: { novelId: string; chapter: number; beat: number; beatDescription: string }
  production: VariantResult<T>
  oracle: VariantResult<T>
  parallelN: VariantResult<T>
}

function avg(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length
}

async function main() {
  const cfg = AGENT_CONFIGS[AGENT]
  if (!cfg) {
    console.error(`Unknown agent: ${AGENT}. Supported: ${Object.keys(AGENT_CONFIGS).join(", ")}`)
    process.exit(1)
  }

  console.log(`agent=${AGENT} samples=${SAMPLES} n=${N} oracle=${ORACLE_PROVIDER}/${ORACLE_MODEL}`)
  await initNovelRun(`best-of-n-experiment-${Date.now()}`)

  console.log("\nLoading test cases from DB...")
  const cases = await loadTestCases(SAMPLES)
  console.log(`Loaded ${cases.length} test cases\n`)

  if (cases.length === 0) {
    console.error("No test cases found. Check that there are approved chapters with outlines.")
    process.exit(1)
  }

  const results: CaseResult<any>[] = []
  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i]
    process.stdout.write(`[${i + 1}/${cases.length}] ch${tc.chapterNumber} beat${tc.beatIndex}: `)

    const production = await runProduction(tc, cfg)
    process.stdout.write("P ")
    const oracle = await runOracle(tc, cfg)
    process.stdout.write("O ")
    const parallelN = await runParallelN(tc, cfg)
    process.stdout.write(`bo${N} `)

    const pSum = production.failed ? "ERR" : cfg.summarize(production.output)
    const oSum = oracle.failed ? "ERR" : cfg.summarize(oracle.output)
    const bSum = parallelN.failed ? "ERR" : cfg.summarize(parallelN.output)
    process.stdout.write(`| P=${pSum} O=${oSum} bo=${bSum}\n`)

    results.push({
      testCase: { novelId: tc.novelId, chapter: tc.chapterNumber, beat: tc.beatIndex, beatDescription: tc.beat.description.slice(0, 80) },
      production,
      oracle,
      parallelN,
    })
  }

  // ── Summary ────────────────────────────────────────────────────────────
  const valid = results.filter(r => !r.production.failed && !r.oracle.failed && !r.parallelN.failed)
  if (valid.length === 0) {
    console.error("\nAll cases failed. Check logs for errors.")
    process.exit(1)
  }

  const productionVsOracle = avg(valid.map(r => cfg.agreementScore(r.production.output, r.oracle.output)))
  const parallelVsOracle = avg(valid.map(r => cfg.agreementScore(r.parallelN.output, r.oracle.output)))
  const productionVsParallel = avg(valid.map(r => cfg.agreementScore(r.production.output, r.parallelN.output)))

  console.log(`\n${"═".repeat(72)}`)
  console.log(`RESULTS — ${AGENT}  (n=${valid.length} valid out of ${results.length})`)
  console.log("═".repeat(72))
  console.log()
  console.log("Variant".padEnd(28) + "Avg latency".padStart(14) + "  Total cost".padStart(14) + "  Vs oracle".padStart(13))
  console.log("─".repeat(72))

  const productionLatencies = valid.map(r => r.production.latencyMs)
  const oracleLatencies = valid.map(r => r.oracle.latencyMs)
  const parallelLatencies = valid.map(r => r.parallelN.latencyMs)

  // Cost is approximate — assumes Llama 8B Groq pricing for single-shot/parallel-N,
  // Cerebras Qwen 235B pricing for oracle. Update if testing other model assignments.
  const productionCostUsd = valid.reduce((s, r) =>
    s + r.production.tokens.prompt * 0.05 / 1e6 + r.production.tokens.completion * 0.08 / 1e6, 0)
  const oracleCostUsd = valid.reduce((s, r) =>
    s + r.oracle.tokens.prompt * 0.60 / 1e6 + r.oracle.tokens.completion * 1.20 / 1e6, 0)
  const parallelCostUsd = valid.reduce((s, r) =>
    s + r.parallelN.tokens.prompt * 0.05 / 1e6 + r.parallelN.tokens.completion * 0.08 / 1e6, 0)

  console.log(`production single`.padEnd(28) + `${Math.round(avg(productionLatencies))}ms`.padStart(14) + `  $${productionCostUsd.toFixed(5)}`.padStart(14) + `  ${(productionVsOracle * 100).toFixed(1)}%`.padStart(13))
  console.log(`oracle (${ORACLE_MODEL.slice(0, 16)})`.padEnd(28) + `${Math.round(avg(oracleLatencies))}ms`.padStart(14) + `  $${oracleCostUsd.toFixed(5)}`.padStart(14) + `  -`.padStart(13))
  console.log(`parallel-${N} (production)`.padEnd(28) + `${Math.round(avg(parallelLatencies))}ms`.padStart(14) + `  $${parallelCostUsd.toFixed(5)}`.padStart(14) + `  ${(parallelVsOracle * 100).toFixed(1)}%`.padStart(13))
  console.log("─".repeat(72))
  console.log()
  console.log(`Production vs parallel-${N} similarity:        ${(productionVsParallel * 100).toFixed(1)}%`)
  console.log(`(For boolean outputs this is 0 or 1; for set outputs it's Jaccard similarity.)`)
  console.log()
  const headlineDelta = parallelVsOracle - productionVsOracle
  console.log(`Headline: parallel-${N} ${headlineDelta > 0.005 ? "BEATS" : headlineDelta < -0.005 ? "LOSES TO" : "MATCHES"} single-shot for agreement-with-oracle`)
  console.log(`  parallel-${N}: ${(parallelVsOracle * 100).toFixed(1)}%   single-shot: ${(productionVsOracle * 100).toFixed(1)}%   delta: ${(headlineDelta * 100).toFixed(1)}pp`)

  const outPath = `/tmp/best-of-n-${AGENT}-${Date.now()}.json`
  await Bun.write(outPath, JSON.stringify({ agent: AGENT, n: N, samples: results.length, oracleProvider: ORACLE_PROVIDER, oracleModel: ORACLE_MODEL, results }, null, 2))
  console.log(`\nFull results saved to ${outPath}`)

  process.exit(0)
}

main().catch(e => {
  console.error("Fatal:", e)
  process.exit(1)
})

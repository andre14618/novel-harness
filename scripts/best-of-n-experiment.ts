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
 * Currently supports the adherence-checker agent. Others (reference-resolver,
 * fact-extractor, chapter-plan-checker) follow the same pattern — add an
 * agent-specific block when extending.
 *
 * Usage:
 *   bun scripts/best-of-n-experiment.ts --agent adherence-checker --samples 30 --n 3
 *   bun scripts/best-of-n-experiment.ts --agent adherence-checker --samples 10 --n 5 --novels novel-X,novel-Y
 *
 * Output:
 *   - Console table with per-variant metrics
 *   - JSON dump to /tmp/best-of-n-<agent>-<timestamp>.json for later analysis
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

console.log(`agent=${AGENT} samples=${SAMPLES} n=${N} oracle=${ORACLE_PROVIDER}/${ORACLE_MODEL}`)

// ── Data mining ───────────────────────────────────────────────────────────

interface TestCase {
  novelId: string
  chapterNumber: number
  beatIndex: number
  beat: SceneBeat
  outline: ChapterOutline
  prose: string
}

async function loadTestCases(maxCases: number): Promise<TestCase[]> {
  // Pick novels: explicit list, or auto-select novels with >=2 approved chapters
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
    // Get all approved chapter prose for this novel
    const chapters = await db`
      SELECT chapter_number, prose
      FROM chapter_drafts
      WHERE novel_id = ${novelId} AND status = 'approved'
      ORDER BY chapter_number ASC
    `
    for (const ch of chapters) {
      if (cases.length >= maxCases) break
      // Get the outline for this chapter
      const outlineRows = await db`
        SELECT outline_json
        FROM chapter_outlines
        WHERE novel_id = ${novelId} AND chapter_number = ${ch.chapter_number}
      `
      if (!outlineRows.length) continue
      const outline = outlineRows[0].outline_json as ChapterOutline
      if (!outline.scenes || outline.scenes.length === 0) continue

      // Split prose into beat-sized chunks. Use the planner's beat count as the target
      // segmentation. Beats joined with \n\n in the beat-writer path.
      const chunks = ch.prose.split(/\n\n+/).filter((c: string) => c.trim().length > 50)
      if (chunks.length === 0) continue

      // Pair each beat with a prose chunk. If counts mismatch, use the closest mapping
      // (clamp the chunk index). Imperfect but acceptable for benchmark inputs.
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

// ── Agent: adherence-checker ─────────────────────────────────────────────

const adherenceSchema = z.object({
  pass: z.boolean(),
  deviations: z.array(z.string()).default([]),
})
type AdherenceOutput = z.infer<typeof adherenceSchema>

function buildAdherenceUserPrompt(tc: TestCase): string {
  return `Beat: "${tc.beat.description}"
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
Return pass:true with empty deviations if the beat is executed well.`
}

const ADHERENCE_SYSTEM = "You check if prose follows a scene beat specification. Be strict but fair."

function aggregateAdherenceMajority(outputs: AdherenceOutput[]): AdherenceOutput {
  const passVotes = outputs.map(o => o.pass)
  const passed = majorityValue(passVotes)
  // Union all deviations across calls; dedup by string
  const allDeviations = outputs.flatMap(o => o.deviations ?? [])
  const dedupedDeviations = unionByKey([allDeviations], d => d)
  return { pass: passed, deviations: dedupedDeviations }
}

// ── Variant runners ───────────────────────────────────────────────────────

interface VariantResult {
  output: AdherenceOutput
  latencyMs: number
  tokens: { prompt: number; completion: number }
  failed?: boolean
}

async function runProduction(tc: TestCase): Promise<VariantResult> {
  const t0 = performance.now()
  try {
    const r = await callAgent({
      agentName: "adherence-checker",
      systemPrompt: ADHERENCE_SYSTEM,
      userPrompt: buildAdherenceUserPrompt(tc),
      schema: adherenceSchema,
      novelId: tc.novelId,
    })
    return { output: r.output, latencyMs: performance.now() - t0, tokens: r.tokensUsed }
  } catch (e) {
    return { output: { pass: false, deviations: [`production failed: ${e instanceof Error ? e.message : e}`] }, latencyMs: performance.now() - t0, tokens: { prompt: 0, completion: 0 }, failed: true }
  }
}

async function runOracle(tc: TestCase): Promise<VariantResult> {
  const t0 = performance.now()
  try {
    const r = await callAgent({
      agentName: "adherence-checker-oracle",
      systemPrompt: ADHERENCE_SYSTEM,
      userPrompt: buildAdherenceUserPrompt(tc),
      schema: adherenceSchema,
      novelId: tc.novelId,
      provider: ORACLE_PROVIDER as any,
      model: ORACLE_MODEL,
    })
    return { output: r.output, latencyMs: performance.now() - t0, tokens: r.tokensUsed }
  } catch (e) {
    return { output: { pass: false, deviations: [`oracle failed: ${e instanceof Error ? e.message : e}`] }, latencyMs: performance.now() - t0, tokens: { prompt: 0, completion: 0 }, failed: true }
  }
}

async function runParallelN(tc: TestCase): Promise<VariantResult> {
  const t0 = performance.now()
  try {
    const r = await executeBestOfN<AdherenceOutput>({
      agentName: "adherence-checker",
      systemPrompt: ADHERENCE_SYSTEM,
      userPrompt: buildAdherenceUserPrompt(tc),
      schema: adherenceSchema,
      novelId: tc.novelId,
    }, N, aggregateAdherenceMajority)
    return { output: r.output, latencyMs: performance.now() - t0, tokens: r.tokensUsed }
  } catch (e) {
    return { output: { pass: false, deviations: [`parallel-N failed: ${e instanceof Error ? e.message : e}`] }, latencyMs: performance.now() - t0, tokens: { prompt: 0, completion: 0 }, failed: true }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

interface CaseResult {
  testCase: { novelId: string; chapter: number; beat: number; beatDescription: string }
  production: VariantResult
  oracle: VariantResult
  parallelN: VariantResult
}

function avg(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length
}

async function main() {
  if (AGENT !== "adherence-checker") {
    console.error(`Only adherence-checker is supported in v1; got: ${AGENT}`)
    process.exit(1)
  }

  await initNovelRun(`best-of-n-experiment-${Date.now()}`)

  console.log("\nLoading test cases from DB...")
  const cases = await loadTestCases(SAMPLES)
  console.log(`Loaded ${cases.length} test cases\n`)

  if (cases.length === 0) {
    console.error("No test cases found. Check that there are approved chapters with outlines.")
    process.exit(1)
  }

  const results: CaseResult[] = []
  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i]
    process.stdout.write(`[${i + 1}/${cases.length}] ch${tc.chapterNumber} beat${tc.beatIndex}: `)

    const production = await runProduction(tc)
    process.stdout.write("P ")
    const oracle = await runOracle(tc)
    process.stdout.write("O ")
    const parallelN = await runParallelN(tc)
    process.stdout.write(`bo${N} `)

    process.stdout.write(`| P=${production.output.pass ? "T" : "F"} O=${oracle.output.pass ? "T" : "F"} bo=${parallelN.output.pass ? "T" : "F"}\n`)

    results.push({
      testCase: { novelId: tc.novelId, chapter: tc.chapterNumber, beat: tc.beatIndex, beatDescription: tc.beat.description.slice(0, 80) },
      production,
      oracle,
      parallelN,
    })
  }

  // ── Summary ────────────────────────────────────────────────────────────
  const valid = results.filter(r => !r.production.failed && !r.oracle.failed && !r.parallelN.failed)
  const productionAgreement = valid.filter(r => r.production.output.pass === r.oracle.output.pass).length / valid.length
  const parallelAgreement = valid.filter(r => r.parallelN.output.pass === r.oracle.output.pass).length / valid.length
  const productionVsParallel = valid.filter(r => r.production.output.pass === r.parallelN.output.pass).length / valid.length

  // Self-disagreement: where production and parallel-N differ on the same input
  const productionParallelDisagree = valid.filter(r => r.production.output.pass !== r.parallelN.output.pass).length

  console.log(`\n${"═".repeat(70)}`)
  console.log(`RESULTS  (n=${valid.length} valid cases out of ${results.length} total)`)
  console.log("═".repeat(70))
  console.log()
  console.log("Variant".padEnd(28) + "Avg latency".padStart(14) + "  Total cost".padStart(14) + "  Vs oracle".padStart(13))
  console.log("─".repeat(70))

  const productionLatencies = valid.map(r => r.production.latencyMs)
  const oracleLatencies = valid.map(r => r.oracle.latencyMs)
  const parallelLatencies = valid.map(r => r.parallelN.latencyMs)

  const productionTokens = valid.reduce((s, r) => s + r.production.tokens.prompt + r.production.tokens.completion, 0)
  const oracleTokens = valid.reduce((s, r) => s + r.oracle.tokens.prompt + r.oracle.tokens.completion, 0)
  const parallelTokens = valid.reduce((s, r) => s + r.parallelN.tokens.prompt + r.parallelN.tokens.completion, 0)

  // Rough cost (use $/M from registry for typical models)
  // Llama 8B Groq: $0.05/$0.08 per M
  // Cerebras Qwen 235B: $0.60/$1.20 per M
  // We'll just sum prompt+completion at the in-rate as a back-of-envelope
  const productionCostUsd = (valid.reduce((s, r) => s + r.production.tokens.prompt * 0.05 / 1e6 + r.production.tokens.completion * 0.08 / 1e6, 0))
  const oracleCostUsd = (valid.reduce((s, r) => s + r.oracle.tokens.prompt * 0.60 / 1e6 + r.oracle.tokens.completion * 1.20 / 1e6, 0))
  const parallelCostUsd = (valid.reduce((s, r) => s + r.parallelN.tokens.prompt * 0.05 / 1e6 + r.parallelN.tokens.completion * 0.08 / 1e6, 0))

  console.log(`production single`.padEnd(28) + `${Math.round(avg(productionLatencies))}ms`.padStart(14) + `  $${productionCostUsd.toFixed(5)}`.padStart(14) + `  ${(productionAgreement * 100).toFixed(1)}%`.padStart(13))
  console.log(`oracle (${ORACLE_MODEL.slice(0, 16)})`.padEnd(28) + `${Math.round(avg(oracleLatencies))}ms`.padStart(14) + `  $${oracleCostUsd.toFixed(5)}`.padStart(14) + `  -`.padStart(13))
  console.log(`parallel-${N} (production)`.padEnd(28) + `${Math.round(avg(parallelLatencies))}ms`.padStart(14) + `  $${parallelCostUsd.toFixed(5)}`.padStart(14) + `  ${(parallelAgreement * 100).toFixed(1)}%`.padStart(13))
  console.log("─".repeat(70))
  console.log()
  console.log(`Production vs parallel-${N} agree on:           ${(productionVsParallel * 100).toFixed(1)}%`)
  console.log(`Production vs parallel-${N} disagree on:        ${productionParallelDisagree} cases`)
  console.log()
  console.log(`Headline: parallel-${N} ${parallelAgreement > productionAgreement ? "BEATS" : parallelAgreement < productionAgreement ? "LOSES TO" : "MATCHES"} single-shot for agreement-with-oracle`)
  console.log(`  (parallel-${N}: ${(parallelAgreement * 100).toFixed(1)}%, single-shot: ${(productionAgreement * 100).toFixed(1)}%)`)

  // Save full results to JSON for later analysis
  const outPath = `/tmp/best-of-n-${AGENT}-${Date.now()}.json`
  await Bun.write(outPath, JSON.stringify({ agent: AGENT, n: N, samples: results.length, oracleProvider: ORACLE_PROVIDER, oracleModel: ORACLE_MODEL, results }, null, 2))
  console.log(`\nFull results saved to ${outPath}`)

  process.exit(0)
}

main().catch(e => {
  console.error("Fatal:", e)
  process.exit(1)
})

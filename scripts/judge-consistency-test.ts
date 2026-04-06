/**
 * Judge consistency test.
 *
 * Pulls N prose samples from the DB (already judged by DeepSeek V3),
 * re-judges each K times with the current benchmark-judge config,
 * and compares variance.
 *
 * Usage:
 *   BENCHMARK_JUDGES=qwen bun scripts/judge-consistency-test.ts
 *   bun scripts/judge-consistency-test.ts  # uses default benchmark-judge
 */

import { judgeDimension } from "../benchmark/prose/shared"
import { getJudges } from "../benchmark/config"
import { getCentralDB, createRun } from "../data/db"

const SAMPLE_COUNT = parseInt(process.env.SAMPLES ?? "5")
const REJUDGE_RUNS = parseInt(process.env.REJUDGE_RUNS ?? "3")
const DIMENSION = "telling" as const

async function main() {
  const db = getCentralDB()
  const judge = getJudges()[0]

  console.log(`Judge: ${judge.label} (${judge.provider}/${judge.model})`)
  console.log(`Samples: ${SAMPLE_COUNT}, Re-judge runs: ${REJUDGE_RUNS}`)
  console.log(`Dimension: ${DIMENSION}\n`)

  // Create a throwaway run so llm_calls FK is satisfied
  const dummyRunId = await createRun("judge-consistency-test", `${judge.label}-consistency`, {})

  // Pull distinct prose samples that have existing DeepSeek telling scores
  const samples = await db`
    SELECT DISTINCT ON (g.id) g.id, g.run_id, g.prose, g.word_count, s.score as original_score
    FROM generations g
    JOIN scores s ON s.generation_id = g.id
    WHERE s.dimension = ${DIMENSION}
      AND g.prose IS NOT NULL
      AND g.word_count > 500
    ORDER BY g.id DESC
    LIMIT ${SAMPLE_COUNT}
  `

  if (samples.length === 0) {
    console.log("No samples found with telling scores")
    process.exit(1)
  }

  console.log(`Found ${samples.length} samples\n`)

  const results: Array<{
    genId: number
    wordCount: number
    originalScore: number
    newScores: number[]
  }> = []

  for (const sample of samples) {
    const newScores: number[] = []

    process.stdout.write(`Gen ${sample.id} (${sample.word_count}w, orig: ${sample.original_score}):`)

    for (let r = 0; r < REJUDGE_RUNS; r++) {
      const result = await judgeDimension(judge, DIMENSION, sample.prose, dummyRunId, "consistency-test")
      if (result) {
        newScores.push(result.count)
        process.stdout.write(` ${result.count}`)
      } else {
        process.stdout.write(` FAIL`)
      }
    }

    console.log()
    results.push({
      genId: sample.id,
      wordCount: sample.word_count,
      originalScore: sample.original_score,
      newScores,
    })
  }

  // Summary
  console.log("\n" + "=".repeat(60))
  console.log("  JUDGE CONSISTENCY RESULTS")
  console.log("=".repeat(60))

  console.log(`\n  Judge: ${judge.label}`)
  console.log(`  Dimension: ${DIMENSION}\n`)

  console.log("  Gen ID  | Words | Orig  | New scores       | Range | StdDev")
  console.log("  --------|-------|-------|------------------|-------|-------")

  let totalNewVariance = 0

  for (const r of results) {
    const range = r.newScores.length > 0
      ? Math.max(...r.newScores) - Math.min(...r.newScores)
      : 0
    const mean = r.newScores.reduce((a, b) => a + b, 0) / r.newScores.length
    const stddev = Math.sqrt(r.newScores.reduce((a, b) => a + (b - mean) ** 2, 0) / r.newScores.length)
    totalNewVariance += stddev

    console.log(
      `  ${String(r.genId).padStart(7)} | ${String(r.wordCount).padStart(5)} | ${String(r.originalScore).padStart(5)} | ${r.newScores.map(s => String(s).padStart(3)).join(",")} | ${String(range).padStart(5)} | ${stddev.toFixed(1).padStart(5)}`
    )
  }

  const avgStdDev = totalNewVariance / results.length
  console.log(`\n  Average StdDev across samples: ${avgStdDev.toFixed(2)}`)
  console.log(`  (Lower = more consistent judge)\n`)

  // Clean up
  await db`DELETE FROM llm_calls WHERE run_id = ${dummyRunId}`
  await db`DELETE FROM runs WHERE id = ${dummyRunId}`
  console.log("  Cleaned up test data.\n")

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })

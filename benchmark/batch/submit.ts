/**
 * Submit judge calls for a benchmark run as a batch.
 *
 * Usage:
 *   bun benchmark/batch/submit.ts --run 43 --provider openai --model gpt-5.4-mini
 *   bun benchmark/batch/submit.ts --run 43  # defaults: openai, gpt-5.4-mini
 *
 * Reads all passed generations for the run, builds judge requests for each
 * dimension, and submits them via the provider's batch API.
 */

import { parseArgs } from "node:util"
import {
  getCentralDB, createBatch, addBatchRequest, updateBatchSubmitted,
} from "../../data/db"
import { DIMENSIONS, DIMENSION_LABELS } from "../prose/judges/schema"
import { JUDGE_RUBRICS } from "../prose/shared"
import { getBatchProvider } from "./providers"
import { MODELS } from "../../models/registry"
import type { BatchRequest } from "./types"

const { values } = parseArgs({
  options: {
    run: { type: "string" },
    provider: { type: "string", default: "openai" },
    model: { type: "string", default: "gpt-5.4-mini" },
  },
})

if (!values.run) {
  console.error("Usage: bun benchmark/batch/submit.ts --run <run_id> [--provider openai] [--model gpt-5.4-mini]")
  process.exit(1)
}

const runId = parseInt(values.run)
const providerName = values.provider!
const model = values.model!

async function main() {
  const db = getCentralDB()

  // Get all passed generations for this run
  const generations = db.query<any, [number]>(
    "SELECT id, seed, prose FROM generations WHERE run_id = ? AND passed = 1 AND prose IS NOT NULL ORDER BY seed, attempt"
  ).all(runId)

  if (generations.length === 0) {
    console.error(`No passed generations found for run ${runId}`)
    process.exit(1)
  }

  // Check for existing scores (don't re-judge what's already scored)
  const existingScores = new Set(
    db.query<any, [number]>(
      "SELECT generation_id || '-' || dimension as key FROM scores WHERE generation_id IN (SELECT id FROM generations WHERE run_id = ?)"
    ).all(runId).map((r: any) => r.key)
  )

  // Resolve model config for useMaxCompletionTokens
  const modelDef = MODELS.find(m => m.id === model)
  const useMaxCompletionTokens = modelDef?.useMaxCompletionTokens ?? false

  // Build batch requests
  const batchId = createBatch(runId, providerName, model)
  const requests: BatchRequest[] = []

  for (const gen of generations) {
    for (const dim of DIMENSIONS) {
      const key = `${gen.id}-${dim}`
      if (existingScores.has(key)) continue

      const customId = `gen-${gen.id}-${dim}`
      const rubric = JUDGE_RUBRICS[dim]

      addBatchRequest(batchId, customId, gen.id, dim)

      requests.push({
        customId,
        model,
        messages: [
          { role: "system", content: `Here is a prose passage:\n\n${gen.prose}\n\n---\n\n${rubric}` },
          { role: "user", content: "Evaluate the prose above according to the rubric. Return the JSON result." },
        ],
        temperature: 0.1,
        maxTokens: 4096,
        useMaxCompletionTokens,
        responseFormat: { type: "json_object" },
      })
    }
  }

  if (requests.length === 0) {
    console.log(`All ${generations.length} generations already scored for run ${runId}. Nothing to submit.`)
    process.exit(0)
  }

  console.log(`\nBatch Submit`)
  console.log(`  Run: ${runId}`)
  console.log(`  Provider: ${providerName}`)
  console.log(`  Model: ${model}`)
  console.log(`  Generations: ${generations.length}`)
  console.log(`  Dimensions: ${DIMENSIONS.map(d => DIMENSION_LABELS[d]).join(", ")}`)
  console.log(`  Total requests: ${requests.length}`)
  console.log(`  Skipped (already scored): ${existingScores.size}`)
  console.log()

  // Submit
  const provider = getBatchProvider(providerName)
  const providerBatchId = await provider.submit(requests, `run-${runId} judge batch`)

  updateBatchSubmitted(batchId, providerBatchId, `data/batches/input-*.jsonl`, requests.length)

  console.log(`  Submitted! Batch ID: ${providerBatchId}`)
  console.log(`  Local batch: #${batchId}`)
  console.log(`  Check status: bun benchmark/batch/status.ts`)
  console.log(`  Collect results: bun benchmark/batch/collect.ts`)
}

main().catch(err => {
  console.error("Submit failed:", err.message)
  process.exit(1)
})

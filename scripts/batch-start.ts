/**
 * Submit a benchmark batch AND register it with the Proxmox orchestrator.
 *
 * Wraps the existing batch submission flow (benchmark/batch/submit.ts logic)
 * and additionally writes to the orchestrator's Postgres so the LXC service
 * knows to poll for results.
 *
 * Usage:
 *   bun scripts/batch-start.ts --run 43
 *   bun scripts/batch-start.ts --run 43 --provider openai --model gpt-5.4-mini
 */

import { parseArgs } from "node:util"
import { SQL } from "bun"
import {
  getCentralDB, createBatch, addBatchRequest, updateBatchSubmitted,
} from "../data/db"
import { DIMENSIONS, DIMENSION_LABELS } from "../benchmark/prose/judges/schema"
import { JUDGE_RUBRICS } from "../benchmark/prose/shared"
import { getBatchProvider } from "../benchmark/batch/providers"
import { MODELS } from "../models/registry"
import type { BatchRequest } from "../benchmark/batch/types"

const { values } = parseArgs({
  options: {
    run: { type: "string" },
    provider: { type: "string", default: "openai" },
    model: { type: "string", default: "gpt-5.4-mini" },
  },
})

if (!values.run) {
  console.error("Usage: bun scripts/batch-start.ts --run <run_id> [--provider openai] [--model gpt-5.4-mini]")
  process.exit(1)
}

const runId = parseInt(values.run)
const providerName = values.provider!
const model = values.model!

// Orchestrator Postgres connection (over Tailscale)
const ORCH_DB_URL = process.env.ORCHESTRATOR_DB_URL
let orchDb: InstanceType<typeof SQL> | null = null
if (ORCH_DB_URL) {
  orchDb = new SQL(ORCH_DB_URL)
} else {
  console.log("  Note: ORCHESTRATOR_DB_URL not set — results won't be tracked by orchestrator")
}

async function main() {
  const db = getCentralDB()

  // Get all passed generations for this run
  const generations = db.query<any, [number]>(
    "SELECT id, seed, prose FROM generations WHERE run_id = ? AND passed = true AND prose IS NOT NULL ORDER BY seed, attempt"
  ).all(runId)

  if (generations.length === 0) {
    console.error(`No passed generations found for run ${runId}`)
    process.exit(1)
  }

  // Check for existing scores
  const existingScores = new Set(
    db.query<any, [number]>(
      "SELECT generation_id || '-' || dimension as key FROM scores WHERE generation_id IN (SELECT id FROM generations WHERE run_id = ?)"
    ).all(runId).map((r: any) => r.key)
  )

  const modelDef = MODELS.find(m => m.id === model)
  const useMaxCompletionTokens = modelDef?.useMaxCompletionTokens ?? false

  // Build batch requests
  const localBatchId = await createBatch(runId, providerName, model)
  const requests: BatchRequest[] = []
  const requestMeta: Array<{ customId: string; generationId: number; dimension: string }> = []

  for (const gen of generations) {
    for (const dim of DIMENSIONS) {
      const key = `${gen.id}-${dim}`
      if (existingScores.has(key)) continue

      const customId = `gen-${gen.id}-${dim}`
      const rubric = JUDGE_RUBRICS[dim]

      await addBatchRequest(localBatchId, customId, gen.id, dim)
      requestMeta.push({ customId, generationId: gen.id, dimension: dim })

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

  console.log(`\nBatch Submit + Orchestrator Registration`)
  console.log(`  Run: ${runId}`)
  console.log(`  Provider: ${providerName}`)
  console.log(`  Model: ${model}`)
  console.log(`  Generations: ${generations.length}`)
  console.log(`  Dimensions: ${DIMENSIONS.map(d => DIMENSION_LABELS[d]).join(", ")}`)
  console.log(`  Total requests: ${requests.length}`)
  console.log(`  Skipped (already scored): ${existingScores.size}`)
  console.log()

  // Submit to provider
  const provider = getBatchProvider(providerName)
  const providerBatchId = await provider.submit(requests, `run-${runId} judge batch`)

  // Update local DB
  await updateBatchSubmitted(localBatchId, providerBatchId, `data/batches/input-*.jsonl`, requests.length)

  console.log(`  Submitted to ${providerName}! Batch ID: ${providerBatchId}`)
  console.log(`  Local batch: #${localBatchId}`)

  // Register with orchestrator Postgres
  if (orchDb) {
    const rows = await orchDb`
      INSERT INTO orchestrator_batches
        (provider_batch_id, provider, judge_model, request_count, local_run_id, local_batch_id, description)
      VALUES
        (${providerBatchId}, ${providerName}, ${model}, ${requests.length}, ${runId}, ${localBatchId}, ${`run-${runId} judge batch`})
      RETURNING id
    `
    const orchBatchId = (rows[0] as any).id

    for (const meta of requestMeta) {
      await orchDb`
        INSERT INTO orchestrator_requests (batch_id, custom_id, generation_id, dimension)
        VALUES (${orchBatchId}, ${meta.customId}, ${meta.generationId}, ${meta.dimension})
      `
    }

    console.log(`  Orchestrator batch: #${orchBatchId}`)
    console.log(`  Orchestrator will poll and collect automatically.`)
  }

  console.log(`\n  Import results later: bun scripts/batch-import.ts`)
  console.log(`  Check status: bun scripts/batch-status.ts`)
}

main().catch(err => {
  console.error("Batch start failed:", err.message)
  process.exit(1)
})

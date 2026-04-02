/**
 * Collect results from completed batches and import scores to DB.
 *
 * Usage: bun benchmark/batch/collect.ts
 *        bun benchmark/batch/collect.ts --batch 5   # collect specific batch
 */

import { parseArgs } from "node:util"
import { extractJSON } from "../../src/llm"
import { penaltySchema, DIMENSION_LABELS, type Dimension } from "../prose/judges/schema"
import {
  getCentralDB, getPendingBatches, getBatchRequests,
  updateBatchStatus, updateBatchOutput,
  completeBatchRequest, failBatchRequest,
  saveScore,
} from "../../data/db"
import { getBatchProvider } from "./providers"

const { values } = parseArgs({
  options: {
    batch: { type: "string" },
  },
})

async function collectBatch(batchId: number, providerBatchId: string, provider: string, judgeModel: string) {
  const batchProvider = getBatchProvider(provider)

  // Check status first
  const status = await batchProvider.checkStatus(providerBatchId)
  if (status.status !== "completed") {
    console.log(`  Batch #${batchId}: not ready (${status.status}, ${status.completedCount}/${status.requestCount})`)
    return false
  }

  // Collect results
  console.log(`  Collecting batch #${batchId} (${status.requestCount} requests)...`)
  const results = await batchProvider.collectResults(providerBatchId)

  // Get our batch requests to map results to generations
  const requests = getBatchRequests(batchId)
  const requestMap = new Map(requests.map(r => [r.customId, r]))

  let imported = 0, failed = 0

  for (const result of results) {
    const request = requestMap.get(result.customId)
    if (!request) {
      console.log(`    ! Unknown custom_id: ${result.customId}`)
      continue
    }

    if (!result.success || !result.content) {
      failBatchRequest(result.customId)
      failed++
      continue
    }

    // Parse the judge response (same logic as judgeDimension in shared.ts)
    try {
      const jsonStr = extractJSON(result.content)
      const parsed = JSON.parse(jsonStr)
      const zodResult = penaltySchema.safeParse(parsed)

      if (!zodResult.success) {
        console.log(`    ! ${result.customId} [zod] ${zodResult.error.issues.map(i => i.message).join("; ").slice(0, 100)}`)
        failBatchRequest(result.customId)
        failed++
        continue
      }

      const count = zodResult.data.issues.length
      const issuesJson = JSON.stringify(zodResult.data.issues)

      // Save to scores table
      saveScore(request.generationId, judgeModel, request.dimension as Dimension, count, issuesJson)

      // Update batch request
      completeBatchRequest(result.customId, count, issuesJson)
      imported++
    } catch (err) {
      console.log(`    ! ${result.customId} [parse] ${err instanceof Error ? err.message : err}`)
      failBatchRequest(result.customId)
      failed++
    }
  }

  updateBatchStatus(batchId, "completed")
  console.log(`    Imported: ${imported} scores, Failed: ${failed}`)

  return true
}

async function main() {
  getCentralDB()

  if (values.batch) {
    // Collect specific batch
    const db = getCentralDB()
    const batch = db.query<any, [number]>(
      "SELECT id, provider_batch_id as providerBatchId, provider, judge_model as judgeModel FROM batches WHERE id = ?"
    ).get(parseInt(values.batch))

    if (!batch) {
      console.error(`Batch #${values.batch} not found`)
      process.exit(1)
    }

    await collectBatch(batch.id, batch.providerBatchId, batch.provider, batch.judgeModel)
    return
  }

  // Collect all completed batches
  const pending = getPendingBatches()
  if (pending.length === 0) {
    console.log("No pending batches to collect.")
    return
  }

  console.log(`Checking ${pending.length} batch(es) for collection...\n`)

  let collected = 0
  for (const batch of pending) {
    const success = await collectBatch(batch.id, batch.providerBatchId, batch.provider, batch.judgeModel)
    if (success) collected++
  }

  console.log(`\nCollected: ${collected}/${pending.length} batches`)
}

main().catch(err => {
  console.error("Collection failed:", err.message)
  process.exit(1)
})

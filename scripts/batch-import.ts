/**
 * Import completed batch results from orchestrator Postgres into local SQLite.
 *
 * Usage:
 *   bun scripts/batch-import.ts              # all completed, unimported
 *   bun scripts/batch-import.ts --batch 5    # specific orchestrator batch
 */

import { parseArgs } from "node:util"
import { SQL } from "bun"
import { extractJSON } from "../src/llm"
import { penaltySchema } from "../benchmark/prose/judges/schema"
import {
  getCentralDB, saveScore, completeBatchRequest, failBatchRequest,
} from "../data/db"

const DB_URL = process.env.ORCHESTRATOR_DB_URL
if (!DB_URL) {
  console.error("ORCHESTRATOR_DB_URL not set in .env")
  process.exit(1)
}

const orchDb = new SQL(DB_URL)

const { values } = parseArgs({
  options: {
    batch: { type: "string" },
  },
})

async function importBatch(orchBatchId: number) {
  // Get batch info
  const batchRows = await orchDb`SELECT * FROM orchestrator_batches WHERE id = ${orchBatchId}`
  if (batchRows.length === 0) {
    console.log(`  Orchestrator batch #${orchBatchId} not found`)
    return { imported: 0, failed: 0, skipped: 0 }
  }
  const batch = batchRows[0] as any

  if (batch.status !== "completed") {
    console.log(`  Batch #${orchBatchId} is ${batch.status}, not completed — skipping`)
    return { imported: 0, failed: 0, skipped: 1 }
  }

  const judgeModel = batch.judge_model ?? "unknown"

  // Get completed requests
  const requests = await orchDb`
    SELECT * FROM orchestrator_requests
    WHERE batch_id = ${orchBatchId} AND status = 'completed' AND content IS NOT NULL
    ORDER BY id
  `

  if (requests.length === 0) {
    console.log(`  Batch #${orchBatchId}: no completed requests to import`)
    return { imported: 0, failed: 0, skipped: 0 }
  }

  // Ensure local DB is ready
  getCentralDB()

  let imported = 0
  let failed = 0

  for (const req of requests as any[]) {
    try {
      const jsonStr = extractJSON(req.content)
      const parsed = JSON.parse(jsonStr)
      const result = penaltySchema.safeParse(parsed)

      if (!result.success) {
        console.log(`    ${req.custom_id}: zod validation failed — ${result.error.issues.map((i: any) => i.message).join(", ").slice(0, 100)}`)
        failBatchRequest(req.custom_id)
        failed++
        continue
      }

      const count = result.data.issues.length
      const issuesJson = JSON.stringify(result.data.issues)

      // Parse custom_id to get generation_id and dimension
      const match = req.custom_id.match(/^gen-(\d+)-(.+)$/)
      if (!match) {
        console.log(`    ${req.custom_id}: can't parse custom_id`)
        failed++
        continue
      }

      const generationId = parseInt(match[1])
      const dimension = match[2]

      saveScore(generationId, judgeModel, dimension, count, issuesJson)
      completeBatchRequest(req.custom_id, count, issuesJson)
      imported++
    } catch (err) {
      console.log(`    ${req.custom_id}: ${err instanceof Error ? err.message : err}`)
      failBatchRequest(req.custom_id)
      failed++
    }
  }

  // Mark imported in orchestrator Postgres
  await orchDb`UPDATE orchestrator_batches SET imported_at = now() WHERE id = ${orchBatchId}`

  console.log(`  Batch #${orchBatchId}: imported ${imported}, failed ${failed}`)
  return { imported, failed, skipped: 0 }
}

async function main() {
  let batches: any[]

  if (values.batch) {
    batches = [{ id: parseInt(values.batch) }]
  } else {
    batches = await orchDb`
      SELECT id FROM orchestrator_batches
      WHERE status = 'completed' AND imported_at IS NULL
      ORDER BY completed_at ASC
    ` as any[]
  }

  if (batches.length === 0) {
    console.log("No completed unimported batches found.")
    return
  }

  console.log(`\nImporting ${batches.length} batch(es)...\n`)

  let totalImported = 0
  let totalFailed = 0

  for (const batch of batches) {
    const result = await importBatch(batch.id)
    totalImported += result.imported
    totalFailed += result.failed
  }

  console.log(`\nDone. Imported ${totalImported} scores, ${totalFailed} failures.`)
}

main().catch(err => {
  console.error("Import failed:", err.message)
  process.exit(1)
})

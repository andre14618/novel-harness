/**
 * Check status of all pending batches.
 *
 * Usage: bun benchmark/batch/status.ts
 */

import { getCentralDB, getPendingBatches, updateBatchStatus } from "../../data/db"
import { getBatchProvider } from "./providers"

async function main() {
  getCentralDB()

  const pending = await getPendingBatches()
  if (pending.length === 0) {
    console.log("No pending batches.")

    // Also show recent completed/failed
    const db = getCentralDB()
    const recent = await db`
      SELECT id, run_id, provider, judge_model, status, request_count, submitted_at, completed_at
      FROM batches ORDER BY id DESC LIMIT 5
    ` as any[]

    if (recent.length > 0) {
      console.log("\nRecent batches:")
      for (const b of recent) {
        console.log(`  #${b.id} run=${b.run_id} ${b.provider}/${b.judge_model} ${b.status} (${b.request_count} requests) ${b.submitted_at ?? ""}`)
      }
    }
    return
  }

  console.log(`Checking ${pending.length} pending batch(es)...\n`)

  for (const batch of pending) {
    try {
      const provider = getBatchProvider(batch.provider)
      const status = await provider.checkStatus(batch.providerBatchId)

      // Update local status
      if (status.status !== batch.status) {
        const dbStatus = status.status === "in_progress" ? "processing" : status.status
        await updateBatchStatus(batch.id, dbStatus)
      }

      const pct = status.requestCount > 0
        ? Math.round((status.completedCount / status.requestCount) * 100)
        : 0

      console.log(`  Batch #${batch.id} (run ${batch.runId})`)
      console.log(`    Provider: ${batch.provider} / ${batch.judgeModel}`)
      console.log(`    Status: ${status.status}`)
      console.log(`    Progress: ${status.completedCount}/${status.requestCount} (${pct}%)`)
      if (status.failedCount > 0) {
        console.log(`    Failed: ${status.failedCount}`)
      }

      if (status.status === "completed") {
        console.log(`    → Ready to collect: bun benchmark/batch/collect.ts`)
      }
      console.log()
    } catch (err) {
      console.log(`  Batch #${batch.id}: ERROR — ${err instanceof Error ? err.message : err}`)
    }
  }
}

main().catch(err => {
  console.error("Status check failed:", err.message)
  process.exit(1)
})

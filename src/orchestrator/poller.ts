/**
 * Batch API polling logic.
 *
 * Checks active batches in Postgres, polls provider APIs for status,
 * collects completed results, notifies on completion.
 */

import { getActiveBatches, updateBatchStatus, saveRequestResult, updateState } from "./db"
import { getBatchProvider } from "../../benchmark/batch/providers"
import { handleBatchComplete } from "./daemon-loop"

export async function pollOnce(): Promise<{ polled: number; collected: number; errors: number }> {
  const batches = await getActiveBatches()
  if (batches.length === 0) {
    await updateState(0)
    return { polled: 0, collected: 0, errors: 0 }
  }

  console.log(`[poll] Checking ${batches.length} active batch(es)...`)
  let totalCollected = 0
  let errors = 0

  for (const batch of batches) {
    if (!batch.provider_batch_id) continue

    try {
      const provider = getBatchProvider(batch.provider)
      const status = await provider.checkStatus(batch.provider_batch_id)

      const dbStatus = status.status === "in_progress" ? "processing" : status.status
      console.log(`  Batch #${batch.id} [${batch.provider}] (${batch.provider_batch_id.slice(0, 16)}...): ${dbStatus} ${status.completedCount}/${status.requestCount}`)

      await updateBatchStatus(batch.id, dbStatus, status.completedCount, status.failedCount)

      if (status.status === "completed") {
        const results = await provider.collectResults(batch.provider_batch_id)
        let batchCollected = 0

        for (const result of results) {
          try {
            if (result.success) {
              await saveRequestResult(
                result.customId, "completed", result.content, undefined,
                result.usage?.promptTokens, result.usage?.completionTokens,
              )
              batchCollected++
            } else {
              await saveRequestResult(result.customId, "failed", undefined, result.error)
            }
          } catch (err) {
            console.error(`    Error saving result ${result.customId}:`, err)
            errors++
          }
        }

        console.log(`  Collected ${batchCollected} results for batch #${batch.id}`)
        totalCollected += batchCollected

        // Notify improvement daemon loop (in-process)
        handleBatchComplete(batch.id).catch(err =>
          console.error("[daemon] batch-complete error:", err)
        )
      } else if (["failed", "expired", "cancelled"].includes(dbStatus)) {
        console.log(`  Batch #${batch.id} ${dbStatus}`)
      }
    } catch (err) {
      console.error(`  Error polling batch #${batch.id}:`, err instanceof Error ? err.message : err)
      errors++
    }
  }

  await updateState(totalCollected)
  console.log(`[poll] Done. Polled ${batches.length}, collected ${totalCollected}, errors ${errors}`)
  return { polled: batches.length, collected: totalCollected, errors }
}

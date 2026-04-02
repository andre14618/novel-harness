/**
 * Batch API polling logic.
 *
 * Checks active batches in Postgres, polls provider APIs for status,
 * collects completed results, notifies on completion.
 */

import { getActiveBatches, updateBatchStatus, saveRequestResult, updateState, type OrchestratorBatch } from "./db"
import { getBatchProvider } from "../../benchmark/batch/providers"
import { handleBatchComplete } from "./daemon-loop"

const NOTIFY_URL = process.env.NOTIFY_URL ?? "http://localhost:2586"
const NOTIFY_TOPIC = process.env.NOTIFY_TOPIC ?? "novel-harness-batch"
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL

async function notify(title: string, body: string) {
  try {
    const headers: Record<string, string> = { "Title": title }
    if (NOTIFY_EMAIL) headers["Email"] = NOTIFY_EMAIL
    await fetch(`${NOTIFY_URL}/${NOTIFY_TOPIC}`, { method: "POST", headers, body })
  } catch (err) {
    console.error("[notify] Failed:", err instanceof Error ? err.message : err)
  }
}

async function notifyBatchComplete(batch: OrchestratorBatch, collected: number, failed: number) {
  const status = failed > 0 ? `${collected} collected, ${failed} failed` : `${collected} collected`
  await notify(`Batch #${batch.id} complete`, `Run ${batch.local_run_id} — ${batch.judge_model} via ${batch.provider}\n${status}`)
}

async function notifyBatchFailed(batch: OrchestratorBatch, error: string) {
  await notify(`Batch #${batch.id} failed`, `Run ${batch.local_run_id} — ${batch.judge_model} via ${batch.provider}\nError: ${error}`)
}

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

        const batchFailed = results.filter(r => !r.success).length
        await notifyBatchComplete(batch, batchCollected, batchFailed)

        // Notify improvement daemon loop (in-process)
        handleBatchComplete(batch.id).catch(err =>
          console.error("[daemon] batch-complete error:", err)
        )
      } else if (["failed", "expired", "cancelled"].includes(dbStatus)) {
        await notifyBatchFailed(batch, `Status: ${dbStatus}`)
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

/**
 * Check batch status from the orchestrator's Postgres.
 *
 * Usage:
 *   bun scripts/batch-status.ts
 *   bun scripts/batch-status.ts --batch 5
 */

import { parseArgs } from "node:util"
import { SQL } from "bun"

const DB_URL = process.env.ORCHESTRATOR_DB_URL
if (!DB_URL) {
  console.error("ORCHESTRATOR_DB_URL not set in .env")
  process.exit(1)
}

const db = new SQL(DB_URL)

const { values } = parseArgs({
  options: {
    batch: { type: "string" },
  },
})

async function main() {
  if (values.batch) {
    const id = parseInt(values.batch)
    const rows = await db`SELECT * FROM orchestrator_batches WHERE id = ${id}`
    if (rows.length === 0) {
      console.log(`Batch #${id} not found`)
      return
    }
    const b = rows[0] as any
    console.log(`\nBatch #${b.id}`)
    console.log(`  Provider: ${b.provider}`)
    console.log(`  Model: ${b.judge_model}`)
    console.log(`  Status: ${b.status}`)
    console.log(`  Progress: ${b.completed_count}/${b.request_count} (${b.failed_count} failed)`)
    console.log(`  Submitted: ${b.submitted_at}`)
    console.log(`  Completed: ${b.completed_at ?? "—"}`)
    console.log(`  Imported: ${b.imported_at ?? "—"}`)
    console.log(`  Last polled: ${b.last_polled_at ?? "—"}`)
    console.log(`  Local run: ${b.local_run_id}, batch: ${b.local_batch_id}`)
    if (b.error) console.log(`  Error: ${b.error}`)
    return
  }

  // List all recent batches
  const batches = await db`SELECT * FROM orchestrator_batches ORDER BY submitted_at DESC LIMIT 20`

  if (batches.length === 0) {
    console.log("No batches found.")
    return
  }

  console.log(`\n  ${"ID".padStart(4)}  ${"Status".padEnd(12)}  ${"Progress".padEnd(12)}  ${"Provider".padEnd(10)}  ${"Model".padEnd(20)}  ${"Run".padStart(4)}  Submitted`)
  console.log("  " + "-".repeat(90))

  for (const b of batches as any[]) {
    const progress = `${b.completed_count}/${b.request_count}`
    const submitted = new Date(b.submitted_at).toLocaleString()
    const imported = b.imported_at ? " [imported]" : ""
    console.log(`  ${String(b.id).padStart(4)}  ${(b.status + imported).padEnd(12)}  ${progress.padEnd(12)}  ${b.provider.padEnd(10)}  ${(b.judge_model ?? "").padEnd(20)}  ${String(b.local_run_id ?? "").padStart(4)}  ${submitted}`)
  }

  // Stats
  const state = await db`SELECT * FROM orchestrator_state WHERE id = 1`
  if (state.length > 0) {
    const s = state[0] as any
    console.log(`\n  Orchestrator: ${s.total_polls} polls, ${s.total_collected} collected, last poll ${s.last_poll_at ?? "never"}`)
  }
}

main().catch(err => {
  console.error("Status check failed:", err.message)
  process.exit(1)
})

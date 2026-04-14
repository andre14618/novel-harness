/**
 * Query the orchestrator Postgres for improvement cycle details.
 *
 * Usage:
 *   bun scripts/improvement-report.ts                # latest cycle
 *   bun scripts/improvement-report.ts --cycle 3      # specific cycle
 */

import { parseArgs } from "node:util"
import { SQL } from "bun"

const DB_URL = process.env.ORCHESTRATOR_DB_URL
if (!DB_URL) { console.error("ORCHESTRATOR_DB_URL not set"); process.exit(1) }
const db = new SQL(DB_URL)

const { values } = parseArgs({
  options: { cycle: { type: "string" } },
})

async function main() {
  let cycleId: number

  if (values.cycle) {
    cycleId = parseInt(values.cycle)
  } else {
    const rows = await db`SELECT id FROM improvement_cycles ORDER BY id DESC LIMIT 1`
    if (rows.length === 0) { console.log("No improvement cycles found."); return }
    cycleId = (rows[0] as any).id
  }

  const cycleRows = await db`SELECT * FROM improvement_cycles WHERE id = ${cycleId}`
  if (cycleRows.length === 0) { console.log(`Cycle #${cycleId} not found.`); return }
  const cycle = cycleRows[0] as any

  console.log(`\nImprovement Cycle #${cycle.id}`)
  console.log("=".repeat(50))
  console.log(`  Status: ${cycle.status}`)
  console.log(`  Trigger: ${cycle.trigger_type}`)
  console.log(`  Started: ${cycle.started_at}`)
  console.log(`  Finished: ${cycle.finished_at ?? "—"}`)
  console.log(`  Iterations: ${cycle.total_iterations} (${cycle.kept_count} kept)`)
  console.log(`  Cost: $${parseFloat(cycle.total_cost_usd).toFixed(4)}`)
  if (cycle.summary) console.log(`  Summary: ${cycle.summary}`)

  const iterations = await db`
    SELECT * FROM improvement_iterations WHERE cycle_id = ${cycleId} ORDER BY iteration_num
  `

  if (iterations.length > 0) {
    console.log(`\n  ${"#".padStart(3)}  ${"Target".padEnd(12)}  ${"Dimension".padEnd(20)}  ${"Before".padStart(7)}  ${"After".padStart(7)}  ${"Delta".padStart(7)}  ${"Result".padEnd(10)}  Agent`)
    console.log("  " + "-".repeat(90))

    for (const iter of iterations as any[]) {
      const before = iter.baseline_score !== null ? parseFloat(iter.baseline_score).toFixed(1) : "—"
      const after = iter.new_score !== null ? parseFloat(iter.new_score).toFixed(1) : "—"
      const delta = iter.delta !== null ? `${parseFloat(iter.delta) >= 0 ? "+" : ""}${parseFloat(iter.delta).toFixed(1)}` : "—"
      console.log(`  ${String(iter.iteration_num).padStart(3)}  ${iter.target.padEnd(12)}  ${iter.dimension.padEnd(20)}  ${before.padStart(7)}  ${after.padStart(7)}  ${delta.padStart(7)}  ${(iter.result ?? iter.phase).padEnd(10)}  ${iter.agent_name ?? "—"}`)
      if (iter.proposal_explanation) {
        console.log(`       ${iter.proposal_explanation.slice(0, 80)}`)
      }
    }
  }

  // Budget
  const budget = await db`SELECT * FROM budget_tracker WHERE period_date = CURRENT_DATE`
  if (budget.length > 0) {
    const b = budget[0] as any
    console.log(`\n  Today's budget: $${parseFloat(b.spent_usd).toFixed(4)} / $${parseFloat(b.budget_usd).toFixed(2)} (${b.iteration_count} iterations)`)
  }

  console.log(`\n  Sync improvements: bash scripts/sync-improvements.sh`)
}

main().catch(err => { console.error("Report failed:", err.message); process.exit(1) })

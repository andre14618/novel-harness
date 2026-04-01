import {
  getCentralDB, getCallSummary, getModelStats, getAgentStats, getPhaseStats, getRecentRuns,
} from "../data/db"

const arg = process.argv[2]

if (arg === "--global") {
  globalSummary()
} else if (arg === "--runs") {
  listRuns(process.argv[3])
} else {
  runSummary(arg)
}

function globalSummary() {
  const db = getCentralDB()

  console.log("=== GLOBAL MODEL STATS ===\n")
  const models = getModelStats()
  if (models.length === 0) { console.log("No LLM calls recorded yet."); return }

  const header = "Provider/Model                          Calls    Cost    Avg TPS  Avg ms"
  console.log(header)
  console.log("-".repeat(header.length))
  for (const m of models) {
    console.log(`${`${m.provider}/${m.model}`.padEnd(40)} ${`${m.totalCalls}`.padStart(5)}  $${m.totalCost.toFixed(3).padStart(7)}  ${`${m.avgTps ?? "—"}`.padStart(8)}  ${`${m.avgLatencyMs ?? "—"}`.padStart(6)}`)
  }

  console.log("\n=== PER-AGENT STATS ===\n")
  const agents = getAgentStats()
  for (const a of agents) {
    console.log(`${a.agent.padEnd(28)} ${`${a.totalCalls}`.padStart(5)} calls  $${a.totalCost.toFixed(3).padStart(7)}  ${a.avgTps ? `${a.avgTps} tok/s` : "—"}`)
  }

  console.log("\n=== PER-PHASE STATS ===\n")
  const phases = getPhaseStats()
  for (const p of phases) {
    console.log(`${p.phase.padEnd(24)} ${`${p.totalCalls}`.padStart(5)} calls  $${p.totalCost.toFixed(3).padStart(7)}  ${p.avgTps ? `${p.avgTps} tok/s` : "—"}`)
  }
}

function listRuns(runType?: string) {
  const type = runType ?? "novel"
  const runs = getRecentRuns(type, 20)
  if (runs.length === 0) { console.log(`No ${type} runs found.`); return }

  console.log(`\nRecent ${type} runs:\n`)
  for (const r of runs) {
    const label = r.label ? ` (${r.label})` : ""
    const ref = r.runRef ? ` [${r.runRef}]` : ""
    console.log(`  #${r.id}  ${r.timestamp}${ref}${label}  avg: ${r.mean}`)
  }
}

function runSummary(runIdStr?: string) {
  const db = getCentralDB()

  let runId: number
  if (runIdStr && /^\d+$/.test(runIdStr)) {
    runId = parseInt(runIdStr)
  } else {
    // Find most recent novel run, or most recent run of any type
    const novelRef = runIdStr  // could be a novel-id like "novel-123456"
    let row: { id: number } | null = null
    if (novelRef) {
      row = db.query<{ id: number }, [string]>("SELECT id FROM runs WHERE run_ref = ? ORDER BY timestamp DESC LIMIT 1").get(novelRef)
    }
    if (!row) {
      row = db.query<{ id: number }, []>("SELECT id FROM runs ORDER BY timestamp DESC LIMIT 1").get()
    }
    if (!row) { console.error("No runs found in central DB."); process.exit(1) }
    runId = row.id
  }

  const run = db.query<{ run_type: string; run_ref: string | null; label: string | null; timestamp: string }, [number]>(
    "SELECT run_type, run_ref, label, timestamp FROM runs WHERE id = ?",
  ).get(runId)

  if (!run) { console.error(`Run #${runId} not found.`); process.exit(1) }

  console.log(`\nRun #${runId}: ${run.run_type}${run.run_ref ? ` [${run.run_ref}]` : ""}${run.label ? ` (${run.label})` : ""}`)
  console.log(`Timestamp: ${run.timestamp}\n`)

  const summary = getCallSummary(runId)
  if (summary.length === 0) { console.log("No LLM calls for this run."); return }

  const header = "Agent                     Model                         Calls    Cost    TPS    Tokens"
  console.log(header)
  console.log("-".repeat(header.length))

  let totalCost = 0, totalCalls = 0, totalTokens = 0
  for (const c of summary) {
    totalCost += c.totalCost
    totalCalls += c.calls
    const tokens = c.totalPrompt + c.totalCompletion
    totalTokens += tokens
    const tps = c.avgTps ? `${c.avgTps}` : "—"
    console.log(`${c.agent.padEnd(25)} ${c.model.padEnd(30)} ${`${c.calls}`.padStart(5)}  $${c.totalCost.toFixed(3).padStart(7)}  ${tps.padStart(5)}  ${`${tokens}`.padStart(8)}`)
  }
  console.log("-".repeat(header.length))
  console.log(`${"TOTAL".padEnd(56)} ${`${totalCalls}`.padStart(5)}  $${totalCost.toFixed(3).padStart(7)}         ${`${totalTokens}`.padStart(8)}`)
  console.log(`\nTotal cost: $${totalCost.toFixed(4)}`)
}

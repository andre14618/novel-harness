import {
  getCentralDB, getCallSummary, getModelStats, getAgentStats, getPhaseStats, getRecentRuns,
} from "../data/db"

const arg = process.argv[2]

if (arg === "--global") {
  await globalSummary()
} else if (arg === "--runs") {
  await listRuns(process.argv[3])
} else {
  await runSummary(arg)
}

async function globalSummary() {
  console.log("=== GLOBAL MODEL STATS ===\n")
  const models = await getModelStats()
  if (models.length === 0) { console.log("No LLM calls recorded yet."); return }

  const header = "Provider/Model                          Calls    Cost    Avg TPS  Avg ms"
  console.log(header)
  console.log("-".repeat(header.length))
  for (const m of models) {
    console.log(`${`${m.provider}/${m.model}`.padEnd(40)} ${`${m.totalCalls}`.padStart(5)}  $${m.totalCost.toFixed(3).padStart(7)}  ${`${m.avgTps ?? "—"}`.padStart(8)}  ${`${m.avgLatencyMs ?? "—"}`.padStart(6)}`)
  }

  console.log("\n=== PER-AGENT STATS ===\n")
  const agents = await getAgentStats()
  for (const a of agents) {
    console.log(`${a.agent.padEnd(28)} ${`${a.totalCalls}`.padStart(5)} calls  $${a.totalCost.toFixed(3).padStart(7)}  ${a.avgTps ? `${a.avgTps} tok/s` : "—"}`)
  }

  console.log("\n=== PER-PHASE STATS ===\n")
  const phases = await getPhaseStats()
  for (const p of phases) {
    console.log(`${p.phase.padEnd(24)} ${`${p.totalCalls}`.padStart(5)} calls  $${p.totalCost.toFixed(3).padStart(7)}  ${p.avgTps ? `${p.avgTps} tok/s` : "—"}`)
  }
}

async function listRuns(runType?: string) {
  const type = runType ?? "novel"
  const runs = await getRecentRuns(type, 20)
  if (runs.length === 0) { console.log(`No ${type} runs found.`); return }

  console.log(`\nRecent ${type} runs:\n`)
  for (const r of runs) {
    const label = r.label ? ` (${r.label})` : ""
    const ref = r.runRef ? ` [${r.runRef}]` : ""
    console.log(`  #${r.id}  ${r.timestamp}${ref}${label}  avg: ${r.mean}`)
  }
}

async function runSummary(runIdStr?: string) {
  const db = getCentralDB()

  let runId: number
  if (runIdStr && /^\d+$/.test(runIdStr)) {
    runId = parseInt(runIdStr)
  } else {
    const novelRef = runIdStr
    let rows: any[]
    if (novelRef) {
      rows = await db`SELECT id FROM runs WHERE run_ref = ${novelRef} ORDER BY timestamp DESC LIMIT 1`
    } else {
      rows = []
    }
    if (rows.length === 0) {
      rows = await db`SELECT id FROM runs ORDER BY timestamp DESC LIMIT 1`
    }
    if (rows.length === 0) { console.error("No runs found in central DB."); process.exit(1) }
    runId = (rows[0] as any).id
  }

  const runRows = await db`
    SELECT run_type, run_ref, label, timestamp FROM runs WHERE id = ${runId}
  ` as any[]

  if (runRows.length === 0) { console.error(`Run #${runId} not found.`); process.exit(1) }
  const run = runRows[0]

  console.log(`\nRun #${runId}: ${run.run_type}${run.run_ref ? ` [${run.run_ref}]` : ""}${run.label ? ` (${run.label})` : ""}`)
  console.log(`Timestamp: ${run.timestamp}\n`)

  const summary = await getCallSummary(runId)
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

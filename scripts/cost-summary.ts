import { Database } from "bun:sqlite"
import { existsSync, readdirSync } from "node:fs"
import { getTokenCost } from "../models/registry"

const novelId = process.argv[2]
if (!novelId) {
  const dirs = readdirSync("output").filter((d: string) => d.startsWith("novel-")).sort().reverse()
  if (dirs.length === 0) { console.error("No novel runs found in output/"); process.exit(1) }
  console.log(`Using most recent: ${dirs[0]}\n`)
  run(dirs[0])
} else {
  run(novelId)
}

function run(id: string) {
  const dbPath = `output/${id}/novel.db`
  if (!existsSync(dbPath)) {
    console.error(`No database found at ${dbPath}`)
    process.exit(1)
  }

  const db = new Database(dbPath, { readonly: true })

  // Check if llm_calls table exists (older novels won't have it)
  const tableExists = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='llm_calls'").get()
  if (!tableExists) {
    console.error("No llm_calls table in this novel's database.")
    console.error("This novel was created before LLM call logging moved to SQLite.")
    process.exit(1)
  }

  const entries = db.query<{
    agent: string; model: string; provider: string;
    prompt_tokens: number; completion_tokens: number;
    total_latency_ms: number; zod_validation_success: number; json_extraction_success: number;
  }, []>(`
    SELECT agent, model, provider, prompt_tokens, completion_tokens,
           total_latency_ms, zod_validation_success, json_extraction_success
    FROM llm_calls WHERE novel_id = ?
  `).all(id)

  if (entries.length === 0) {
    console.error("No LLM calls logged for this novel.")
    process.exit(1)
  }

  // Per-agent summary
  const byAgent: Record<string, { calls: number; prompt: number; completion: number; cost: number; latency: number; failures: number }> = {}

  for (const e of entries) {
    if (!byAgent[e.agent]) byAgent[e.agent] = { calls: 0, prompt: 0, completion: 0, cost: 0, latency: 0, failures: 0 }
    const a = byAgent[e.agent]
    a.calls++
    a.prompt += e.prompt_tokens
    a.completion += e.completion_tokens
    a.cost += getTokenCost(e.provider as any, e.model, e.prompt_tokens, e.completion_tokens)
    a.latency += e.total_latency_ms
    if (!e.zod_validation_success || !e.json_extraction_success) a.failures++
  }

  let totalPrompt = 0, totalCompletion = 0, totalCost = 0, totalLatency = 0, totalCalls = 0, totalFailures = 0

  console.log(`Novel: ${id}`)
  console.log(`Calls: ${entries.length}`)
  console.log()

  const header = "Agent                     Calls  Prompt   Compl    Cost   Avg ms  Fail"
  console.log(header)
  console.log("-".repeat(header.length))

  const sorted = Object.entries(byAgent).sort((a, b) => b[1].cost - a[1].cost)
  for (const [agent, a] of sorted) {
    totalCalls += a.calls
    totalPrompt += a.prompt
    totalCompletion += a.completion
    totalCost += a.cost
    totalLatency += a.latency
    totalFailures += a.failures

    const avgMs = Math.round(a.latency / a.calls)
    console.log(
      `${agent.padEnd(25)} ${`${a.calls}`.padStart(5)}  ${`${a.prompt}`.padStart(6)}  ${`${a.completion}`.padStart(6)}  $${a.cost.toFixed(3).padStart(6)}  ${`${avgMs}`.padStart(6)}  ${a.failures > 0 ? `${a.failures}` : "-"}`
    )
  }

  console.log("-".repeat(header.length))
  console.log(
    `${"TOTAL".padEnd(25)} ${`${totalCalls}`.padStart(5)}  ${`${totalPrompt}`.padStart(6)}  ${`${totalCompletion}`.padStart(6)}  $${totalCost.toFixed(3).padStart(6)}  ${`${Math.round(totalLatency / totalCalls)}`.padStart(6)}  ${totalFailures > 0 ? `${totalFailures}` : "-"}`
  )

  console.log(`\nTotal cost: $${totalCost.toFixed(4)}`)
  console.log(`Total tokens: ${totalPrompt + totalCompletion} (${totalPrompt} prompt + ${totalCompletion} completion)`)

  // Per-phase breakdown
  const phases: Record<string, string[]> = {
    "Concept": ["world-builder", "character-agent", "plotter"],
    "Planning": ["planning-plotter"],
    "Drafting": ["writer", "continuity", "summary-extractor", "fact-extractor", "character-state"],
    "Validation": ["cross-chapter-continuity", "prose-quality", "rewriter"],
  }

  console.log("\nPer-phase cost:")
  for (const [phase, agents] of Object.entries(phases)) {
    let phaseCost = 0
    for (const agent of agents) {
      if (byAgent[agent]) phaseCost += byAgent[agent].cost
    }
    if (phaseCost > 0) console.log(`  ${phase.padEnd(12)} $${phaseCost.toFixed(4)}`)
  }

  // Per-provider breakdown
  const byProvider: Record<string, { tokens: number; cost: number }> = {}
  for (const e of entries) {
    const key = `${e.provider}/${e.model}`
    if (!byProvider[key]) byProvider[key] = { tokens: 0, cost: 0 }
    byProvider[key].tokens += e.prompt_tokens + e.completion_tokens
    byProvider[key].cost += getTokenCost(e.provider as any, e.model, e.prompt_tokens, e.completion_tokens)
  }

  console.log("\nPer-provider cost:")
  for (const [key, p] of Object.entries(byProvider)) {
    console.log(`  ${key.padEnd(40)} ${p.tokens} tokens  $${p.cost.toFixed(4)}`)
  }

  // TPS summary per agent
  const tpsData = db.query<{ agent: string; avg_tps: number; min_tps: number; max_tps: number }, []>(`
    SELECT agent,
           ROUND(AVG(tokens_per_sec)) as avg_tps,
           MIN(tokens_per_sec) as min_tps,
           MAX(tokens_per_sec) as max_tps
    FROM llm_calls
    WHERE novel_id = ? AND tokens_per_sec > 0
    GROUP BY agent
    ORDER BY avg_tps DESC
  `).all(id)

  if (tpsData.length > 0) {
    console.log("\nTPS per agent:")
    for (const t of tpsData) {
      console.log(`  ${t.agent.padEnd(25)} avg: ${t.avg_tps}  min: ${t.min_tps}  max: ${t.max_tps}`)
    }
  }

  db.close()
}

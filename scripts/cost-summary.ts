import { readFileSync, existsSync } from "node:fs"
import { getTokenCost, PRICING } from "../src/config/pricing"
import type { LLMCallLogEntry } from "../src/logger"

const novelId = process.argv[2]
if (!novelId) {
  // If no novel ID given, find the most recent
  const { readdirSync } = require("node:fs")
  const dirs = readdirSync("output").filter((d: string) => d.startsWith("novel-")).sort().reverse()
  if (dirs.length === 0) { console.error("No novel runs found in output/"); process.exit(1) }
  console.log(`Using most recent: ${dirs[0]}\n`)
  run(dirs[0])
} else {
  run(novelId)
}

function run(id: string) {
  const logPath = `output/${id}/llm-calls.jsonl`
  if (!existsSync(logPath)) {
    console.error(`No JSONL log found at ${logPath}`)
    console.error("Run the harness with the current code to generate structured logs.")
    process.exit(1)
  }

  const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean)
  const entries: LLMCallLogEntry[] = lines.map(l => JSON.parse(l))

  // Per-agent summary
  const byAgent: Record<string, { calls: number; prompt: number; completion: number; cost: number; latency: number; failures: number }> = {}

  for (const e of entries) {
    if (!byAgent[e.agent]) byAgent[e.agent] = { calls: 0, prompt: 0, completion: 0, cost: 0, latency: 0, failures: 0 }
    const a = byAgent[e.agent]
    a.calls++
    a.prompt += e.promptTokens
    a.completion += e.completionTokens
    a.cost += getTokenCost(e.provider, e.model, e.promptTokens, e.completionTokens)
    a.latency += e.totalLatencyMs
    if (!e.zodValidationSuccess || !e.jsonExtractionSuccess) a.failures++
  }

  // Totals
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
    "Concept": ["world-builder", "character-agent", "plotter", "world-builder-retry", "character-agent-retry", "plotter-retry"],
    "Planning": ["planning-plotter", "planning-plotter-retry"],
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

  // Provider breakdown
  const byProvider: Record<string, { tokens: number; cost: number }> = {}
  for (const e of entries) {
    const key = `${e.provider}/${e.model}`
    if (!byProvider[key]) byProvider[key] = { tokens: 0, cost: 0 }
    byProvider[key].tokens += e.promptTokens + e.completionTokens
    byProvider[key].cost += getTokenCost(e.provider, e.model, e.promptTokens, e.completionTokens)
  }

  console.log("\nPer-provider cost:")
  for (const [key, p] of Object.entries(byProvider)) {
    console.log(`  ${key.padEnd(40)} ${p.tokens} tokens  $${p.cost.toFixed(4)}`)
  }
}

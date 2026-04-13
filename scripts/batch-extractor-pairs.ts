/**
 * Split extractor training pairs into batches for Sonnet subagent review.
 *
 * Reads:  lora-data/{agent}-pairs.jsonl (Phase 1 + Phase 2 combined)
 * Writes: /tmp/extractor-label/{agent}/batch_N.json
 *
 * Each batch file is a JSON array of pair objects with _index for join-back.
 * Subagents read one batch and write results to /tmp/extractor-label/{agent}/results_N.jsonl.
 *
 * Usage:
 *   bun scripts/batch-extractor-pairs.ts                         # all 4 agents
 *   bun scripts/batch-extractor-pairs.ts --agent fact-extractor  # single agent
 *   BATCH_SIZE=30 bun scripts/batch-extractor-pairs.ts           # custom size
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"

const LORA_DATA = join(import.meta.dir, "../lora-data")
const BASE_DIR = "/tmp/extractor-label"
const BATCH_SIZE = process.env.BATCH_SIZE ? parseInt(process.env.BATCH_SIZE) : 30

const AGENTS = ["fact-extractor", "summary-extractor", "character-state", "relationship-timeline"]

const AGENT_ARG = process.argv.indexOf("--agent")
const AGENT_FILTER = AGENT_ARG !== -1 ? process.argv[AGENT_ARG + 1] : null
const targets = AGENT_FILTER ? [AGENT_FILTER] : AGENTS

console.log(`\n${"=".repeat(70)}`)
console.log(`  Extractor Pair Batcher — Phase 3 Prep`)
console.log(`  Agents: ${targets.join(", ")}`)
console.log(`  Batch size: ${BATCH_SIZE}`)
console.log(`${"=".repeat(70)}\n`)

for (const agent of targets) {
  const pairsPath = join(LORA_DATA, `${agent}-pairs.jsonl`)

  let lines: string[]
  try {
    lines = readFileSync(pairsPath, "utf8").trim().split("\n")
  } catch {
    console.log(`--- ${agent} ---`)
    console.log(`  ERROR: ${pairsPath} not found`)
    console.log()
    continue
  }

  interface Pair {
    messages: Array<{ role: string; content: string }>
    _meta: Record<string, unknown>
  }

  const pairs: Array<Pair & { _index: number }> = lines.map((l, i) => ({
    ...JSON.parse(l),
    _index: i,
  }))

  const agentDir = join(BASE_DIR, agent)
  mkdirSync(agentDir, { recursive: true })

  const numBatches = Math.ceil(pairs.length / BATCH_SIZE)

  for (let i = 0; i < numBatches; i++) {
    const batch = pairs.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
    const batchPath = join(agentDir, `batch_${i}.json`)
    writeFileSync(batchPath, JSON.stringify(batch, null, 2))
  }

  // Source distribution
  const sourceCounts: Record<string, number> = {}
  for (const p of pairs) {
    const source = (p._meta?.source as string) ?? "unknown"
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1
  }

  console.log(`--- ${agent} ---`)
  console.log(`  Total pairs: ${pairs.length}`)
  console.log(`  Batches: ${numBatches} (${BATCH_SIZE} per batch)`)
  console.log(`  Output: ${agentDir}/batch_0.json through batch_${numBatches - 1}.json`)
  console.log(`  Source distribution:`)
  for (const [src, count] of Object.entries(sourceCounts)) {
    console.log(`    ${src}: ${count}`)
  }
  console.log()
}

console.log(`Next: spawn Sonnet subagents per scripts/extractor-sonnet-labeling-instructions.md`)

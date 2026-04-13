/**
 * Assemble Sonnet-reviewed extractor training data into W&B-ready JSONL.
 *
 * For each extractor agent:
 * 1. Reads original pairs from lora-data/{agent}-pairs.jsonl
 * 2. Reads Sonnet review results from /tmp/extractor-label/{agent}/results_*.jsonl
 * 3. Replaces the assistant turn with Sonnet-corrected output
 * 4. Writes final training JSONL to lora-data/{agent}-sonnet.jsonl
 *
 * Usage:
 *   bun scripts/assemble-extractor-training-data.ts
 *   bun scripts/assemble-extractor-training-data.ts --agent fact-extractor
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"

const LORA_DATA = join(import.meta.dir, "../lora-data")
const BASE_DIR = "/tmp/extractor-label"

const AGENTS = ["fact-extractor", "summary-extractor", "character-state", "relationship-timeline"]
const AGENT_ARG = process.argv.indexOf("--agent")
const AGENT_FILTER = AGENT_ARG !== -1 ? process.argv[AGENT_ARG + 1] : null
const targets = AGENT_FILTER ? [AGENT_FILTER] : AGENTS

console.log(`\n${"=".repeat(70)}`)
console.log(`  Extractor Training Data Assembly — Phase 3 → 4`)
console.log(`  Agents: ${targets.join(", ")}`)
console.log(`${"=".repeat(70)}\n`)

// Map agent name to the key in the Sonnet result that holds the corrected output
const OUTPUT_KEY: Record<string, string> = {
  "fact-extractor": "facts",
  "summary-extractor": "output",
  "character-state": "characters",
  "relationship-timeline": "output",
}

const expId = await createTuningExperiment(
  "data-generation",
  `Extractor SFT data assembly — Sonnet-reviewed training JSONL for ${targets.join(", ")}`,
  { agents: targets, source: "Sonnet subagent review of 235B/mimo extraction pairs" },
  { target: "extractors", dimension: "data-assembly" },
)

const allStats: Record<string, { total: number; approved: number; corrected: number; missing: number }> = {}

for (const agent of targets) {
  const pairsPath = join(LORA_DATA, `${agent}-pairs.jsonl`)
  const resultsDir = join(BASE_DIR, agent)

  if (!existsSync(pairsPath)) {
    console.log(`--- ${agent} ---`)
    console.log(`  ERROR: ${pairsPath} not found`)
    console.log()
    continue
  }

  if (!existsSync(resultsDir)) {
    console.log(`--- ${agent} ---`)
    console.log(`  ERROR: ${resultsDir} not found — run labeling first`)
    console.log()
    continue
  }

  // Load original pairs
  const pairLines = readFileSync(pairsPath, "utf8").trim().split("\n")
  const pairs = pairLines.map((l, i) => ({ ...JSON.parse(l), _index: i }))

  // Load all result files
  const resultFiles = readdirSync(resultsDir)
    .filter(f => f.startsWith("results_") && f.endsWith(".jsonl"))
    .sort()

  const resultMap = new Map<number, any>()
  let totalResults = 0

  for (const file of resultFiles) {
    const lines = readFileSync(join(resultsDir, file), "utf8").trim().split("\n")
    for (const line of lines) {
      try {
        const result = JSON.parse(line)
        resultMap.set(result._index, result)
        totalResults++
      } catch (e) {
        console.warn(`  WARNING: Failed to parse line in ${file}: ${(e as Error).message}`)
      }
    }
  }

  // Assemble training data
  const outputKey = OUTPUT_KEY[agent]
  const output: string[] = []
  let approved = 0
  let corrected = 0
  let missing = 0

  for (const pair of pairs) {
    const result = resultMap.get(pair._index)
    if (!result) {
      missing++
      continue
    }

    // Get the corrected output
    let assistantContent: string
    if (result.status === "approved") {
      // Keep original assistant content
      assistantContent = pair.messages[2].content
      approved++
    } else {
      // Use Sonnet-corrected output
      const correctedData = result[outputKey]
      if (!correctedData) {
        console.warn(`  WARNING: Corrected result for _index=${pair._index} missing '${outputKey}' key`)
        missing++
        continue
      }

      // For fact-extractor, wrap in {facts: [...]}
      if (agent === "fact-extractor") {
        assistantContent = JSON.stringify({ facts: correctedData })
      } else if (agent === "character-state") {
        assistantContent = JSON.stringify({ characters: correctedData })
      } else {
        // summary-extractor and relationship-timeline use the output object directly
        assistantContent = JSON.stringify(correctedData)
      }
      corrected++
    }

    // Build final training pair (no _meta — clean for training)
    output.push(JSON.stringify({
      messages: [
        { role: "system", content: pair.messages[0].content },
        { role: "user", content: pair.messages[1].content },
        { role: "assistant", content: assistantContent },
      ],
    }))
  }

  const outPath = join(LORA_DATA, `${agent}-sonnet.jsonl`)
  writeFileSync(outPath, output.join("\n") + "\n")

  allStats[agent] = { total: output.length, approved, corrected, missing }

  console.log(`--- ${agent} ---`)
  console.log(`  Original pairs: ${pairs.length}`)
  console.log(`  Sonnet results: ${totalResults} from ${resultFiles.length} files`)
  console.log(`  Assembled:      ${output.length} training examples`)
  console.log(`    Approved:     ${approved} (${Math.round(approved / output.length * 100)}%)`)
  console.log(`    Corrected:    ${corrected} (${Math.round(corrected / output.length * 100)}%)`)
  if (missing > 0) {
    console.log(`    Missing:      ${missing}`)
  }
  console.log(`  Written to:     lora-data/${agent}-sonnet.jsonl`)
  console.log()
}

// Summary
const totalPairs = Object.values(allStats).reduce((s, a) => s + a.total, 0)
const totalApproved = Object.values(allStats).reduce((s, a) => s + a.approved, 0)
const totalCorrected = Object.values(allStats).reduce((s, a) => s + a.corrected, 0)

console.log(`${"=".repeat(70)}`)
console.log(`  Total: ${totalPairs} training examples`)
console.log(`  Approved: ${totalApproved} (${Math.round(totalApproved / totalPairs * 100)}%)`)
console.log(`  Corrected: ${totalCorrected} (${Math.round(totalCorrected / totalPairs * 100)}%)`)
console.log(`${"=".repeat(70)}`)

await concludeExperiment(
  expId!,
  `Assembled ${totalPairs} Sonnet-reviewed training examples across ${targets.length} extractors. ` +
  `Approved: ${totalApproved} (${Math.round(totalApproved / totalPairs * 100)}%), ` +
  `Corrected: ${totalCorrected} (${Math.round(totalCorrected / totalPairs * 100)}%).`,
)

console.log(`\nExperiment ${expId} concluded.`)
console.log(`\nNext: train on W&B:`)
for (const agent of targets) {
  console.log(`  python3 scripts/train-lora.py --data lora-data/${agent}-sonnet.jsonl --name ${agent}-v1 --base OpenPipe/Qwen3-14B-Instruct --project novel-harness`)
}

process.exit(0)

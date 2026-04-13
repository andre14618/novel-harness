/**
 * Generate eval batches for Sonnet-as-judge content accuracy evaluation.
 *
 * For each extractor adapter, samples N pairs from training JSONL,
 * runs the adapter on each, and saves both ground truth + adapter output
 * to batch files for subagent judging.
 *
 * Usage:
 *   bun scripts/prep-extractor-eval-batches.ts                          # all 4, 25 samples each
 *   bun scripts/prep-extractor-eval-batches.ts --agent fact-extractor   # single agent
 *   bun scripts/prep-extractor-eval-batches.ts --samples 40             # more samples
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { getTransport } from "../src/transport"

const LORA_DATA = join(import.meta.dir, "../lora-data")
const OUT_DIR = "/tmp/extractor-eval"

const AGENT_ARG = process.argv.indexOf("--agent")
const AGENT_FILTER = AGENT_ARG !== -1 ? process.argv[AGENT_ARG + 1] : null
const SAMPLES_ARG = process.argv.indexOf("--samples")
const NUM_SAMPLES = SAMPLES_ARG !== -1 ? parseInt(process.argv[SAMPLES_ARG + 1]) : 25

const AGENTS = ["fact-extractor", "summary-extractor", "character-state", "relationship-timeline"] as const
type AgentName = typeof AGENTS[number]
const targets = AGENT_FILTER ? [AGENT_FILTER as AgentName] : [...AGENTS]

const ADAPTER_URIS: Record<AgentName, string> = {
  "fact-extractor": "wandb-artifact:///andre14618-/novel-harness/fact-extractor-v1:v1",
  "summary-extractor": "wandb-artifact:///andre14618-/novel-harness/summary-extractor-v1:v1",
  "character-state": "wandb-artifact:///andre14618-/novel-harness/character-state-v1:v1",
  "relationship-timeline": "wandb-artifact:///andre14618-/novel-harness/relationship-timeline-v1:v1",
}

mkdirSync(OUT_DIR, { recursive: true })

console.log(`\n${"=".repeat(70)}`)
console.log(`  Prep Eval Batches — Adapter Output vs Sonnet Ground Truth`)
console.log(`  Agents: ${targets.join(", ")}`)
console.log(`  Samples per agent: ${NUM_SAMPLES}`)
console.log(`  Output: ${OUT_DIR}/{agent}-eval.json`)
console.log(`${"=".repeat(70)}\n`)

const transport = getTransport()

for (const agent of targets) {
  const dataPath = join(LORA_DATA, `${agent}-sonnet.jsonl`)
  const lines = readFileSync(dataPath, "utf8").trim().split("\n")
  const allRows = lines.map(l => JSON.parse(l))

  // Sample evenly
  const step = Math.max(1, Math.floor(allRows.length / NUM_SAMPLES))
  const sampleIndices = Array.from({ length: allRows.length }, (_, i) => i)
    .filter((_, i) => i % step === 0)
    .slice(0, NUM_SAMPLES)

  console.log(`--- ${agent} (${sampleIndices.length} samples) ---`)

  const evalPairs: any[] = []
  let errors = 0

  // Process in batches of 5
  const BATCH = 5
  for (let i = 0; i < sampleIndices.length; i += BATCH) {
    const batchIndices = sampleIndices.slice(i, i + BATCH)

    const results = await Promise.allSettled(
      batchIndices.map(async (idx) => {
        const row = allRows[idx]
        const systemPrompt = row.messages[0].content
        const userPrompt = row.messages[1].content
        const groundTruth = JSON.parse(row.messages[2].content)

        const resp = await transport.execute({
          provider: "wandb" as any,
          model: ADAPTER_URIS[agent],
          systemPrompt,
          userPrompt,
          temperature: 0.1,
          maxTokens: 4096,
          responseFormat: { type: "json_object" },
        })

        let adapterOutput: any
        try {
          adapterOutput = JSON.parse(resp.content)
        } catch {
          return { idx, error: "JSON parse failed", groundTruth, adapterOutput: null, prose: userPrompt }
        }

        return {
          idx,
          groundTruth,
          adapterOutput,
          // Include first 3000 chars of prose for context (judge needs to verify against source)
          prose: userPrompt.slice(0, 3000),
          latencyMs: resp.latencyMs,
        }
      })
    )

    for (const r of results) {
      if (r.status === "rejected") {
        errors++
        continue
      }
      evalPairs.push(r.value)
    }

    process.stdout.write(`  Progress: ${Math.min(i + BATCH, sampleIndices.length)}/${sampleIndices.length}\n`)
  }

  const outPath = join(OUT_DIR, `${agent}-eval.json`)
  writeFileSync(outPath, JSON.stringify(evalPairs, null, 2))
  console.log(`  Written: ${outPath} (${evalPairs.length} pairs, ${errors} errors)`)
  console.log()
}

console.log("Done. Next: spawn Sonnet subagents per scripts/extractor-eval-judging-instructions.md")
process.exit(0)

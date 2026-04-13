/**
 * Evaluate extractor LoRA adapters against Sonnet-reviewed ground truth.
 *
 * For each extractor:
 *   1. Samples N pairs from the training JSONL (ground truth = Sonnet-reviewed output)
 *   2. Sends the same system + user prompt to the W&B adapter
 *   3. Parses adapter output, compares structurally against ground truth
 *   4. Reports per-field accuracy metrics
 *
 * Usage:
 *   bun scripts/eval-extractor-adapters.ts                          # all 4, 20 samples each
 *   bun scripts/eval-extractor-adapters.ts --agent fact-extractor   # single agent
 *   bun scripts/eval-extractor-adapters.ts --samples 50             # more samples
 */

import { readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { getTransport } from "../src/transport"
import type { LLMResponse } from "../src/transport"

const LORA_DATA = join(import.meta.dir, "../lora-data")

const AGENT_ARG = process.argv.indexOf("--agent")
const AGENT_FILTER = AGENT_ARG !== -1 ? process.argv[AGENT_ARG + 1] : null
const SAMPLES_ARG = process.argv.indexOf("--samples")
const NUM_SAMPLES = SAMPLES_ARG !== -1 ? parseInt(process.argv[SAMPLES_ARG + 1]) : 20

const AGENTS = ["fact-extractor", "summary-extractor", "character-state", "relationship-timeline"] as const
type AgentName = typeof AGENTS[number]
const targets = AGENT_FILTER ? [AGENT_FILTER as AgentName] : [...AGENTS]

const ADAPTER_URIS: Record<AgentName, string> = {
  "fact-extractor": "wandb-artifact:///andre14618-/novel-harness/fact-extractor-v1:v1",
  "summary-extractor": "wandb-artifact:///andre14618-/novel-harness/summary-extractor-v1:v1",
  "character-state": "wandb-artifact:///andre14618-/novel-harness/character-state-v1:v1",
  "relationship-timeline": "wandb-artifact:///andre14618-/novel-harness/relationship-timeline-v1:v1",
}

interface EvalRow {
  messages: Array<{ role: string; content: string }>
}

interface CallResult {
  output: any
  latencyMs: number
  raw: string
  error?: string
}

async function callAdapter(
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<CallResult> {
  const transport = getTransport()
  const start = Date.now()
  try {
    const resp: LLMResponse = await transport.execute({
      provider: "wandb" as any,
      model,
      systemPrompt,
      userPrompt,
      temperature: 0.1,
      maxTokens: 4096,
      responseFormat: { type: "json_object" },
    })
    const latencyMs = resp.latencyMs || (Date.now() - start)
    try {
      const parsed = JSON.parse(resp.content)
      return { output: parsed, latencyMs, raw: resp.content }
    } catch {
      return { output: null, latencyMs, raw: resp.content, error: "JSON parse failed" }
    }
  } catch (e: any) {
    return { output: null, latencyMs: Date.now() - start, raw: "", error: e.message }
  }
}

// ── Structural comparison functions per agent ──

function compareFactExtractor(ground: any, predicted: any): { metrics: Record<string, number>; details: string[] } {
  const details: string[] = []
  const gFacts = ground?.facts || []
  const pFacts = predicted?.facts || []

  // Category accuracy — check if predicted facts use valid categories
  const validCategories = new Set(["physical", "rule", "relationship", "knowledge", "identity", "temporal"])
  const validCatCount = pFacts.filter((f: any) => validCategories.has(f?.category)).length

  // Count overlap — fuzzy match on fact text (>50% word overlap)
  let matched = 0
  for (const gf of gFacts) {
    const gWords = new Set((gf.fact || "").toLowerCase().split(/\s+/))
    for (const pf of pFacts) {
      const pWords = new Set((pf.fact || "").toLowerCase().split(/\s+/))
      const overlap = [...gWords].filter(w => pWords.has(w)).length
      if (overlap / Math.max(gWords.size, 1) > 0.5) { matched++; break }
    }
  }

  const precision = pFacts.length > 0 ? matched / pFacts.length : 0
  const recall = gFacts.length > 0 ? matched / gFacts.length : 0
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0

  return {
    metrics: {
      ground_facts: gFacts.length,
      predicted_facts: pFacts.length,
      matched_facts: matched,
      precision: Math.round(precision * 100),
      recall: Math.round(recall * 100),
      f1: Math.round(f1 * 100),
      valid_categories_pct: pFacts.length > 0 ? Math.round(validCatCount / pFacts.length * 100) : 0,
    },
    details,
  }
}

function compareSummaryExtractor(ground: any, predicted: any): { metrics: Record<string, number>; details: string[] } {
  const details: string[] = []

  const hasSummary = typeof predicted?.summary === "string" && predicted.summary.length > 50
  const hasKeyEvents = Array.isArray(predicted?.keyEvents) && predicted.keyEvents.length > 0
  const hasEmotional = typeof predicted?.emotionalState === "string" && predicted.emotionalState.length > 5
  const hasOpenThreads = Array.isArray(predicted?.openThreads) && predicted.openThreads.length > 0

  const summaryWords = (predicted?.summary || "").split(/\s+/).length
  const groundWords = (ground?.summary || "").split(/\s+/).length
  const wordRatio = groundWords > 0 ? Math.min(summaryWords / groundWords, 1.5) : 0

  const gEvents = ground?.keyEvents?.length || 0
  const pEvents = predicted?.keyEvents?.length || 0

  return {
    metrics: {
      has_summary: hasSummary ? 1 : 0,
      has_key_events: hasKeyEvents ? 1 : 0,
      has_emotional_state: hasEmotional ? 1 : 0,
      has_open_threads: hasOpenThreads ? 1 : 0,
      schema_completeness: [hasSummary, hasKeyEvents, hasEmotional, hasOpenThreads].filter(Boolean).length * 25,
      summary_word_count: summaryWords,
      ground_word_count: groundWords,
      word_ratio_pct: Math.round(wordRatio * 100),
      key_events_count: pEvents,
      ground_events_count: gEvents,
    },
    details,
  }
}

function compareCharacterState(ground: any, predicted: any): { metrics: Record<string, number>; details: string[] } {
  const details: string[] = []
  const gChars = ground?.characters || []
  const pChars = predicted?.characters || []

  const gNames = new Set(gChars.map((c: any) => (c.name || "").toLowerCase()))
  const pNames = new Set(pChars.map((c: any) => (c.name || "").toLowerCase()))

  const nameOverlap = [...gNames].filter(n => pNames.has(n)).length
  const namePrecision = pNames.size > 0 ? nameOverlap / pNames.size : 0
  const nameRecall = gNames.size > 0 ? nameOverlap / gNames.size : 0

  // Check schema completeness for predicted chars
  let schemaComplete = 0
  for (const pc of pChars) {
    const hasLoc = typeof pc.location === "string" && pc.location.length > 0
    const hasEmo = typeof pc.emotionalState === "string" && pc.emotionalState.length > 0
    const hasKnows = Array.isArray(pc.knows)
    const hasDoesntKnow = Array.isArray(pc.doesNotKnow)
    if (hasLoc && hasEmo && hasKnows && hasDoesntKnow) schemaComplete++
  }

  return {
    metrics: {
      ground_characters: gChars.length,
      predicted_characters: pChars.length,
      name_overlap: nameOverlap,
      name_precision: Math.round(namePrecision * 100),
      name_recall: Math.round(nameRecall * 100),
      schema_complete_pct: pChars.length > 0 ? Math.round(schemaComplete / pChars.length * 100) : 0,
    },
    details,
  }
}

function compareRelationshipTimeline(ground: any, predicted: any): { metrics: Record<string, number>; details: string[] } {
  const details: string[] = []

  const sections = ["relationshipChanges", "timelineEvents", "knowledgeGains", "awarenessChanges"] as const
  const metrics: Record<string, number> = {}

  for (const section of sections) {
    const gArr = Array.isArray(ground?.[section]) ? ground[section] : []
    const pArr = Array.isArray(predicted?.[section]) ? predicted[section] : []
    metrics[`${section}_ground`] = gArr.length
    metrics[`${section}_predicted`] = pArr.length
    metrics[`${section}_present`] = pArr.length > 0 || gArr.length === 0 ? 1 : 0
  }

  const validTrust = new Set(["deep_trust", "trust", "cautious", "neutral", "wary", "suspicious", "hostile"])
  const relChanges = predicted?.relationshipChanges || []
  const validTrustCount = relChanges.filter((r: any) => validTrust.has(r?.trustLevel)).length
  metrics.valid_trust_levels = relChanges.length > 0 ? Math.round(validTrustCount / relChanges.length * 100) : 100

  const validSources = new Set(["witnessed", "told", "overheard", "deduced", "read", "discovered"])
  const kGains = predicted?.knowledgeGains || []
  const validSourceCount = kGains.filter((k: any) => validSources.has(k?.source)).length
  metrics.valid_knowledge_sources = kGains.length > 0 ? Math.round(validSourceCount / kGains.length * 100) : 100

  const sectionsPresent = sections.filter(s => {
    const pArr = Array.isArray(predicted?.[s]) ? predicted[s] : null
    return pArr !== null
  }).length
  metrics.schema_completeness = Math.round(sectionsPresent / 4 * 100)

  return { metrics, details }
}

const COMPARE_FN: Record<AgentName, (g: any, p: any) => { metrics: Record<string, number>; details: string[] }> = {
  "fact-extractor": compareFactExtractor,
  "summary-extractor": compareSummaryExtractor,
  "character-state": compareCharacterState,
  "relationship-timeline": compareRelationshipTimeline,
}

// ── Main ──

console.log(`\n${"=".repeat(70)}`)
console.log(`  Extractor Adapter Eval — W&B LoRA vs Sonnet Ground Truth`)
console.log(`  Agents: ${targets.join(", ")}`)
console.log(`  Samples per agent: ${NUM_SAMPLES}`)
console.log(`  LLM calls: ${NUM_SAMPLES * targets.length} (adapter only, no Cerebras)`)
console.log(`${"=".repeat(70)}\n`)

const allResults: Record<string, any> = {}

for (const agent of targets) {
  const dataPath = join(LORA_DATA, `${agent}-sonnet.jsonl`)
  const lines = readFileSync(dataPath, "utf8").trim().split("\n")
  const allRows: EvalRow[] = lines.map(l => JSON.parse(l))

  // Sample evenly across the dataset
  const step = Math.max(1, Math.floor(allRows.length / NUM_SAMPLES))
  const samples = allRows.filter((_, i) => i % step === 0).slice(0, NUM_SAMPLES)

  console.log(`\n--- ${agent} (${samples.length} samples) ---`)

  const adapterUri = ADAPTER_URIS[agent]
  const compareFn = COMPARE_FN[agent]
  const metrics: Record<string, number[]> = {}
  const latencies: number[] = []
  let errors = 0
  let jsonParseErrors = 0

  // Process in batches of 5
  const BATCH = 5
  for (let i = 0; i < samples.length; i += BATCH) {
    const batch = samples.slice(i, i + BATCH)

    const promises = batch.map(async (row) => {
      const systemPrompt = row.messages[0].content
      const userPrompt = row.messages[1].content
      const groundTruth = JSON.parse(row.messages[2].content)

      const result = await callAdapter(adapterUri, systemPrompt, userPrompt)
      return { groundTruth, result }
    })

    const results = await Promise.allSettled(promises)

    for (const r of results) {
      if (r.status === "rejected") { errors++; continue }
      const { groundTruth, result } = r.value

      if (result.error === "JSON parse failed") {
        jsonParseErrors++
        errors++
        continue
      }
      if (result.error || !result.output) {
        errors++
        process.stdout.write(`  ERROR: ${result.error}\n`)
        continue
      }

      const comparison = compareFn(groundTruth, result.output)
      for (const [k, v] of Object.entries(comparison.metrics)) {
        if (!metrics[k]) metrics[k] = []
        metrics[k].push(v)
      }
      latencies.push(result.latencyMs)
    }

    const progress = Math.min(i + BATCH, samples.length)
    process.stdout.write(`  Progress: ${progress}/${samples.length}\n`)
  }

  // Report
  const avgLatency = latencies.length > 0
    ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
    : null

  console.log(`\n  === ${agent} — Adapter vs Sonnet Ground Truth ===`)
  console.log(`  Errors: ${errors}/${samples.length} (${jsonParseErrors} JSON parse failures)`)
  if (avgLatency) console.log(`  Avg latency: ${avgLatency}ms`)

  console.log(`\n  Metrics (averaged across ${samples.length - errors} successful calls):`)
  const avgMetrics: Record<string, number> = {}
  for (const [k, vals] of Object.entries(metrics)) {
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length
    avgMetrics[k] = Math.round(avg * 10) / 10
    console.log(`    ${k}: ${avgMetrics[k]}`)
  }

  allResults[agent] = {
    samples: samples.length,
    errors,
    jsonParseErrors,
    avgLatencyMs: avgLatency,
    metrics: avgMetrics,
  }
}

// Summary table
console.log(`\n${"=".repeat(70)}`)
console.log(`  SUMMARY`)
console.log(`${"=".repeat(70)}`)
for (const [agent, data] of Object.entries(allResults)) {
  const successRate = Math.round((data.samples - data.errors) / data.samples * 100)
  console.log(`\n  ${agent}:`)
  console.log(`    Success rate: ${successRate}% (${data.samples - data.errors}/${data.samples})`)
  console.log(`    Latency: ${data.avgLatencyMs}ms`)
  if (agent === "fact-extractor") {
    console.log(`    Fact F1: ${data.metrics.f1}%`)
    console.log(`    Valid categories: ${data.metrics.valid_categories_pct}%`)
  } else if (agent === "summary-extractor") {
    console.log(`    Schema completeness: ${data.metrics.schema_completeness}%`)
    console.log(`    Word ratio: ${data.metrics.word_ratio_pct}%`)
  } else if (agent === "character-state") {
    console.log(`    Name recall: ${data.metrics.name_recall}%`)
    console.log(`    Schema complete: ${data.metrics.schema_complete_pct}%`)
  } else if (agent === "relationship-timeline") {
    console.log(`    Schema completeness: ${data.metrics.schema_completeness}%`)
    console.log(`    Valid trust levels: ${data.metrics.valid_trust_levels}%`)
  }
}

// Write results
const outPath = "/tmp/extractor-eval-results.json"
writeFileSync(outPath, JSON.stringify(allResults, null, 2))
console.log(`\n\nResults written to ${outPath}`)

process.exit(0)

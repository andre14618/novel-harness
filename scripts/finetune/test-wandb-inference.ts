/**
 * W&B Inference latency probe — gating decision for the multi-task LoRA plan.
 *
 * Background: docs/todo.md "Fine-Tuning serving infrastructure" specifies a
 * 50-call latency probe against W&B Inference to decide whether it's a
 * viable serverless LoRA host for the harness. Decision criterion: if the
 * average per-call latency on the writer-shaped probe is within 2-3× of
 * Cerebras Qwen 235B's baseline, W&B becomes the default home for fine-
 * tuned slots.
 *
 * Tests three workload shapes against four candidate models:
 *   shapes:  reference-resolver (~80 in / 40 out)
 *            adherence-checker  (~360 in / 140 out)
 *            beat-writer        (~850 in / 400 out)
 *   models:  OpenPipe/Qwen3-14B-Instruct        (W&B, $0.05/$0.22)
 *            Qwen/Qwen3-30B-A3B-Instruct-2507    (W&B, $0.10/$0.30)
 *            openai/gpt-oss-120b                 (W&B, $0.15/$0.60)
 *            qwen-3-235b-a22b-instruct-2507      (Cerebras, baseline)
 *
 * Saves results as a tuning_experiment per the standing rule.
 *
 * Usage:
 *   bun scripts/test-wandb-inference.ts
 */

import { createTuningExperiment, concludeExperiment } from "../../src/db/ops"

const WANDB_KEY = process.env.WANDB_API_KEY
const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY
if (!WANDB_KEY) throw new Error("WANDB_API_KEY missing")
if (!CEREBRAS_KEY) throw new Error("CEREBRAS_API_KEY missing")

interface Shape {
  name: string
  system: string
  user: string
  expectedInTokens: number
  expectedOutTokens: number
  maxTokens: number
}

const SHAPES: Shape[] = [
  {
    name: "reference-resolver",
    system: "You identify what background information a scene beat needs. Return JSON with specific lookups.",
    user: `Beat: "Elena confronts Marcus about the betrayal in the manor library."
Characters: Elena, Marcus
Setting: Ashveil Manor
Chapter: 5

What specific background does the writer need? Return JSON:
{ "lookups": [{ "type": "recent_events"|"relationship"|"location_events"|"knowledge", "characters": ["name"], "topic": "subject" }] }`,
    expectedInTokens: 80,
    expectedOutTokens: 40,
    maxTokens: 256,
  },
  {
    name: "adherence-checker",
    system: "You check if prose follows a scene beat specification. Be strict but fair.",
    user: `Beat: "Elena confronts Marcus about the betrayal in the manor library. The conversation escalates from cold civility to open accusation. Marcus tries to deflect by mentioning their shared history; Elena cuts him off and demands the truth about the missing letters."
Setting: "Ashveil Manor library"
Characters expected: Elena, Marcus

Prose:
---
The library was silent except for the rasp of Elena's breath. She stood at the edge of the carpet, her arms crossed tight enough to bruise.

"You knew," she said. The words came out flat, without inflection.

Marcus turned from the window. The lamplight caught the silver at his temples. "Elena—"

"You knew about the letters. You read them. You burned them."

"It's complicated."

"Don't." Her voice cracked. "Don't tell me about the years we worked together, or the favors you've called in. I want to know what you did with the letters."
---

Did the prose execute the beat? Return JSON: { "pass": true/false, "deviations": ["specific issue 1", ...] }`,
    expectedInTokens: 360,
    expectedOutTokens: 140,
    maxTokens: 512,
  },
  {
    name: "beat-writer",
    system: "You are writing a scene beat for a novel. Match the beat description exactly. Write only the prose, no preamble or commentary.",
    user: `Setting: Ashveil Manor — a decaying country estate at the edge of the moors. Late autumn. The library is on the second floor; tall windows face the overgrown garden. Lamplight only; no electricity.

Chapter 5: "The Burning"
POV: Elena Verre, a former physician turned reluctant detective. Methodical, slow to anger, but her composure has cracks Marcus knows how to find.

Beat: Elena confronts Marcus about the betrayal in the manor library. The conversation escalates from cold civility to open accusation. Marcus tries to deflect by mentioning their shared history — the case in Riverbend, the letter Elena's brother wrote — and Elena cuts him off and demands the truth about the missing letters. By the end she has named the specific deception and Marcus has stopped pretending.

Characters present: Elena Verre, Marcus Halliday

Other context to honor:
- Elena is exhausted and has not slept properly in three days
- Marcus is older than Elena and has been her mentor
- The library has a fireplace that is currently lit; the firelight matters
- The "missing letters" refers to correspondence between Elena's brother and Marcus that Elena has only just learned existed

Write approximately 400 words of prose for this beat. Stay in third-person past tense. Output prose only — no preamble, no commentary, no headers.`,
    expectedInTokens: 850,
    expectedOutTokens: 400,
    maxTokens: 1500,
  },
]

interface ModelTarget {
  name: string
  provider: "wandb" | "cerebras"
  modelId: string
  inputCostPerM: number
  outputCostPerM: number
}

const MODELS: ModelTarget[] = [
  { name: "Qwen3-14B (OpenPipe)",     provider: "wandb",    modelId: "OpenPipe/Qwen3-14B-Instruct",      inputCostPerM: 0.05, outputCostPerM: 0.22 },
  { name: "Qwen3-30B-A3B-Instruct",   provider: "wandb",    modelId: "Qwen/Qwen3-30B-A3B-Instruct-2507", inputCostPerM: 0.10, outputCostPerM: 0.30 },
  { name: "gpt-oss-120b",             provider: "wandb",    modelId: "openai/gpt-oss-120b",              inputCostPerM: 0.15, outputCostPerM: 0.60 },
  { name: "Qwen3-235B (Cerebras)",    provider: "cerebras", modelId: "qwen-3-235b-a22b-instruct-2507",   inputCostPerM: 0.60, outputCostPerM: 1.20 },
]

interface CallResult {
  ok: boolean
  ms: number
  promptTokens?: number
  completionTokens?: number
  error?: string
}

async function callOnce(model: ModelTarget, shape: Shape): Promise<CallResult> {
  const isWandb = model.provider === "wandb"
  const url = isWandb
    ? "https://api.inference.wandb.ai/v1/chat/completions"
    : "https://api.cerebras.ai/v1/chat/completions"
  const key = isWandb ? WANDB_KEY : CEREBRAS_KEY

  const t0 = performance.now()
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.modelId,
        messages: [
          { role: "system", content: shape.system },
          { role: "user", content: shape.user },
        ],
        temperature: 0.3,
        max_tokens: shape.maxTokens,
      }),
    })
    const ms = performance.now() - t0
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, ms, error: `${res.status} ${text.slice(0, 200)}` }
    }
    const json: any = await res.json()
    return {
      ok: true,
      ms,
      promptTokens: json.usage?.prompt_tokens,
      completionTokens: json.usage?.completion_tokens,
    }
  } catch (e: any) {
    return { ok: false, ms: performance.now() - t0, error: e.message ?? String(e) }
  }
}

interface CellSummary {
  model: string
  provider: string
  shape: string
  n: number
  okCount: number
  failCount: number
  avgMs: number
  minMs: number
  maxMs: number
  p50Ms: number
  p95Ms: number
  avgInTokens: number
  avgOutTokens: number
  decodeTps: number
  costUsd: number
  errors: string[]
}

async function runCell(model: ModelTarget, shape: Shape, n: number): Promise<CellSummary> {
  process.stdout.write(`  ${model.name.padEnd(32)} × ${shape.name.padEnd(20)}: `)
  const results: CallResult[] = []
  const errors: string[] = []
  // Concurrent batches: 5 calls in flight at a time. Sequential would take too
  // long for the beat-writer shape (~1-2 min/call serial × 50 calls × 4 models
  // = 4+ hours). Concurrency 5 cuts wall time ~5× while still capturing
  // independent latency samples — each call gets its own connection and the
  // server doesn't batch them.
  const CONCURRENCY = 5
  const startCell = performance.now()
  for (let i = 0; i < n; i += CONCURRENCY) {
    const batch = Array.from({ length: Math.min(CONCURRENCY, n - i) }, () => callOnce(model, shape))
    const batchResults = await Promise.all(batch)
    for (const r of batchResults) {
      results.push(r)
      if (!r.ok && r.error && !errors.includes(r.error)) errors.push(r.error)
    }
    process.stdout.write(".")
  }
  const cellWallMs = Math.round(performance.now() - startCell)
  process.stdout.write(` ${cellWallMs}ms wall\n`)

  const ok = results.filter(r => r.ok)
  const latencies = ok.map(r => r.ms).sort((a, b) => a - b)
  const sum = (arr: number[]) => arr.reduce((s, x) => s + x, 0)
  const pct = (arr: number[], p: number) => arr.length === 0 ? 0 : arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]
  const avgMs = ok.length === 0 ? 0 : sum(latencies) / ok.length
  const avgInTok = ok.length === 0 ? 0 : sum(ok.map(r => r.promptTokens ?? 0)) / ok.length
  const avgOutTok = ok.length === 0 ? 0 : sum(ok.map(r => r.completionTokens ?? 0)) / ok.length
  const totalIn = sum(ok.map(r => r.promptTokens ?? 0))
  const totalOut = sum(ok.map(r => r.completionTokens ?? 0))
  const costUsd = (totalIn / 1e6) * model.inputCostPerM + (totalOut / 1e6) * model.outputCostPerM
  const decodeTps = avgOutTok > 0 && avgMs > 0 ? avgOutTok / (avgMs / 1000) : 0

  return {
    model: model.name, provider: model.provider, shape: shape.name,
    n, okCount: ok.length, failCount: results.length - ok.length,
    avgMs, minMs: latencies[0] ?? 0, maxMs: latencies[latencies.length - 1] ?? 0,
    p50Ms: pct(latencies, 0.5), p95Ms: pct(latencies, 0.95),
    avgInTokens: avgInTok, avgOutTokens: avgOutTok,
    decodeTps, costUsd, errors: errors.slice(0, 3),
  }
}

const N_PER_CELL = 25

async function main() {
  console.log(`W&B Inference latency probe — ${MODELS.length} models × ${SHAPES.length} shapes × ${N_PER_CELL} calls = ${MODELS.length * SHAPES.length * N_PER_CELL} total calls\n`)

  const expId = await createTuningExperiment(
    "infra",
    `W&B Inference latency probe — ${MODELS.length} models × ${SHAPES.length} shapes × ${N_PER_CELL} calls`,
    {
      models: MODELS.map(m => ({ name: m.name, provider: m.provider, modelId: m.modelId })),
      shapes: SHAPES.map(s => ({ name: s.name, expectedIn: s.expectedInTokens, expectedOut: s.expectedOutTokens })),
      callsPerCell: N_PER_CELL,
    },
    { target: "wandb-inference", dimension: "latency" },
  )
  console.log(`Created tuning_experiment id=${expId}\n`)

  const cells: CellSummary[] = []
  for (const shape of SHAPES) {
    console.log(`\n── Shape: ${shape.name} (~${shape.expectedInTokens} in / ~${shape.expectedOutTokens} out) ──`)
    for (const model of MODELS) {
      const cell = await runCell(model, shape, N_PER_CELL)
      cells.push(cell)
    }
  }

  console.log(`\n${"═".repeat(112)}`)
  console.log(`RESULTS — ${N_PER_CELL} calls per cell`)
  console.log("═".repeat(112))
  console.log()
  console.log(
    "model".padEnd(33) +
    "shape".padEnd(22) +
    "ok".padStart(7) +
    "avg ms".padStart(9) +
    "p50".padStart(8) +
    "p95".padStart(8) +
    "tps".padStart(8) +
    "in/out".padStart(14) +
    "cost".padStart(11),
  )
  console.log("─".repeat(112))
  for (const c of cells) {
    console.log(
      c.model.slice(0, 32).padEnd(33) +
      c.shape.slice(0, 21).padEnd(22) +
      `${c.okCount}/${c.n}`.padStart(7) +
      `${Math.round(c.avgMs)}`.padStart(9) +
      `${Math.round(c.p50Ms)}`.padStart(8) +
      `${Math.round(c.p95Ms)}`.padStart(8) +
      `${c.decodeTps.toFixed(0)}`.padStart(8) +
      `${Math.round(c.avgInTokens)}/${Math.round(c.avgOutTokens)}`.padStart(14) +
      `$${c.costUsd.toFixed(4)}`.padStart(11),
    )
    for (const err of c.errors) console.log(`    ! ${err}`)
  }
  console.log()

  const baseline = cells.find(c => c.provider === "cerebras" && c.shape === "beat-writer")
  if (baseline && baseline.okCount > 0) {
    console.log(`Baseline (beat-writer shape): Cerebras Qwen 235B at ${Math.round(baseline.avgMs)}ms avg`)
    console.log(`Decision criterion: W&B model is "viable" if its beat-writer-shape avg is within 2-3× baseline (≤${Math.round(baseline.avgMs * 3)}ms).\n`)
    for (const c of cells.filter(c => c.provider === "wandb" && c.shape === "beat-writer")) {
      if (c.okCount === 0) { console.log(`  ${c.model.padEnd(32)}: ALL CALLS FAILED`); continue }
      const ratio = c.avgMs / baseline.avgMs
      const verdict = ratio <= 3 ? "VIABLE" : ratio <= 5 ? "MARGINAL" : "TOO SLOW"
      console.log(`  ${c.model.padEnd(32)}: ${Math.round(c.avgMs)}ms avg = ${ratio.toFixed(1)}x baseline   ${verdict}`)
    }
  }

  const conclusionLines: string[] = []
  conclusionLines.push(`W&B Inference latency probe across ${MODELS.length} models x ${SHAPES.length} shapes x ${N_PER_CELL} calls.`)
  if (baseline && baseline.okCount > 0) {
    conclusionLines.push(`Baseline: Cerebras Qwen 235B ${Math.round(baseline.avgMs)}ms avg on beat-writer shape.`)
    for (const c of cells.filter(c => c.provider === "wandb" && c.shape === "beat-writer")) {
      if (c.okCount === 0) {
        conclusionLines.push(`${c.model}: ALL FAILED`)
      } else {
        const ratio = (c.avgMs / baseline.avgMs).toFixed(1)
        conclusionLines.push(`${c.model}: ${Math.round(c.avgMs)}ms avg = ${ratio}x baseline (decode ${c.decodeTps.toFixed(0)} tps)`)
      }
    }
  }
  conclusionLines.push(`Cells: ${JSON.stringify(cells)}`)
  await concludeExperiment(expId, conclusionLines.join("\n"))
  console.log(`\nConcluded tuning_experiment id=${expId}`)

  process.exit(0)
}

main().catch(e => {
  console.error("Fatal:", e)
  process.exit(1)
})

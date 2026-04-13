/**
 * Together AI vs W&B adapter head-to-head evaluation.
 *
 * Runs all 3 checker adapters (adherence, chapter-plan, continuity) through
 * both W&B 14B and Together 9B, comparing outputs against Sonnet ground-truth
 * labels from training data.
 *
 * For each adapter:
 *   1. Sample N pairs from training JSONL
 *   2. Call W&B adapter + Together adapter with the same system/user prompt
 *   3. Compare both outputs to the ground-truth label
 *   4. Report: W&B accuracy, Together accuracy, W&B-Together agreement
 *
 * Persists results to tuning_experiment table.
 *
 * Usage:
 *   bun scripts/eval-together-vs-wandb.ts                  # all 3 checkers, 50 samples each
 *   bun scripts/eval-together-vs-wandb.ts --sample 20      # smaller sample
 *   bun scripts/eval-together-vs-wandb.ts --adapter adherence  # single adapter
 */

import { readFileSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"

const TOGETHER_KEY = process.env.TOGETHER_API_KEY
const WANDB_KEY = process.env.WANDB_API_KEY

if (!TOGETHER_KEY) throw new Error("TOGETHER_API_KEY not set")
if (!WANDB_KEY) throw new Error("WANDB_API_KEY not set")

const SAMPLE_ARG = process.argv.indexOf("--sample")
const SAMPLE_N = SAMPLE_ARG !== -1 ? parseInt(process.argv[SAMPLE_ARG + 1]) : 50
const ADAPTER_ARG = process.argv.indexOf("--adapter")
const ADAPTER_FILTER = ADAPTER_ARG !== -1 ? process.argv[ADAPTER_ARG + 1] : null

const LORA_DATA = join(import.meta.dir, "../lora-data")

// ── Adapter definitions ──────────────────────────────────────────────────────

interface AdapterDef {
  key: string
  label: string
  dataFile: string
  wandb: { model: string }
  together: { baseModel: string; lora: string }
  extractVerdict: (content: string) => { pass: boolean } | null
  extractLabel: (assistantContent: string) => { pass: boolean } | null
}

const ADAPTERS: AdapterDef[] = [
  {
    key: "adherence",
    label: "Adherence Checker V4",
    dataFile: "adherence-checker-v4-events-sonnet.jsonl",
    wandb: { model: "wandb-artifact:///andre14618-/novel-harness/adherence-checker-v4" },
    together: {
      baseModel: "Qwen/Qwen3.5-9B",
      lora: "andre14618_2c8c/Qwen3.5-9B-adherence-checker-v4-together-v2-039374fe",
    },
    extractVerdict(content: string) {
      try {
        const json = JSON.parse(extractJson(content))
        return { pass: !!json.events_present }
      } catch { return null }
    },
    extractLabel(content: string) {
      try {
        const json = JSON.parse(extractJson(content))
        return { pass: !!json.events_present }
      } catch { return null }
    },
  },
  {
    key: "chapter-plan",
    label: "Chapter Plan Checker V2",
    dataFile: "chapter-plan-checker-pairs-sonnet-v2.jsonl",
    wandb: { model: "wandb-artifact:///andre14618-/novel-harness/chapter-plan-checker-v2:v1" },
    together: {
      baseModel: "Qwen/Qwen3.5-9B",
      lora: "andre14618_2c8c/Qwen3.5-9B-chapter-plan-checker-v2-together-v2-0998ed94",
    },
    extractVerdict(content: string) {
      try {
        const json = JSON.parse(extractJson(content))
        return { pass: !!json.pass }
      } catch { return null }
    },
    extractLabel(content: string) {
      try {
        const json = JSON.parse(extractJson(content))
        return { pass: !!json.pass }
      } catch { return null }
    },
  },
  {
    key: "continuity",
    label: "Continuity V2",
    dataFile: "continuity-pairs-sonnet-labeled.jsonl",
    wandb: { model: "wandb-artifact:///andre14618-/novel-harness/continuity-v2:v1" },
    together: {
      baseModel: "Qwen/Qwen3.5-9B",
      lora: "andre14618_2c8c/Qwen3.5-9B-continuity-v2-together-v2-6804af40",
    },
    extractVerdict(content: string) {
      try {
        const json = JSON.parse(extractJson(content))
        const issues = Array.isArray(json.issues) ? json.issues : []
        const severities = new Set(issues.map((i: any) => i.severity).filter((s: any) => typeof s === "string"))
        return { pass: severities.size === 0 }  // no issues = pass
      } catch { return null }
    },
    extractLabel(content: string) {
      try {
        const json = JSON.parse(extractJson(content))
        // Labels use expectedSeverities or issues array
        if (json.expectedSeverities) {
          return { pass: json.expectedSeverities.length === 0 }
        }
        const issues = Array.isArray(json.issues) ? json.issues : []
        const severities = new Set(issues.map((i: any) => i.severity).filter((s: any) => typeof s === "string"))
        return { pass: severities.size === 0 }
      } catch { return null }
    },
  },
]

// ── API callers ──────────────────────────────────────────────────────────────

function extractJson(text: string): string {
  const cleaned = text.replace(/```[a-z]*\n?/g, "").replace(/```$/g, "").trim()
  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}") + 1
  if (start === -1 || end === 0) return "{}"
  return cleaned.slice(start, end)
}

interface CallResult {
  ok: boolean
  content: string
  ms: number
  promptTokens?: number
  completionTokens?: number
  error?: string
}

async function callWandb(model: string, system: string, user: string): Promise<CallResult> {
  const t0 = performance.now()
  try {
    const res = await fetch("https://api.inference.wandb.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WANDB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        max_tokens: 2048,
        response_format: { type: "json_object" },
      }),
    })
    const ms = performance.now() - t0
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, content: "", ms, error: `${res.status}: ${text.slice(0, 200)}` }
    }
    const json: any = await res.json()
    return {
      ok: true,
      content: json.choices?.[0]?.message?.content ?? "",
      ms,
      promptTokens: json.usage?.prompt_tokens,
      completionTokens: json.usage?.completion_tokens,
    }
  } catch (e: any) {
    return { ok: false, content: "", ms: performance.now() - t0, error: e.message }
  }
}

async function callTogether(baseModel: string, lora: string, system: string, user: string): Promise<CallResult> {
  const t0 = performance.now()
  try {
    const res = await fetch("https://api.together.xyz/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOGETHER_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": "novel-harness/1.0",
      },
      body: JSON.stringify({
        model: baseModel,
        lora,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        max_tokens: 2048,
        response_format: { type: "json_object" },
        chat_template_kwargs: { enable_thinking: false },
      }),
    })
    const ms = performance.now() - t0
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, content: "", ms, error: `${res.status}: ${text.slice(0, 200)}` }
    }
    const json: any = await res.json()
    return {
      ok: true,
      content: json.choices?.[0]?.message?.content ?? "",
      ms,
      promptTokens: json.usage?.prompt_tokens,
      completionTokens: json.usage?.completion_tokens,
    }
  } catch (e: any) {
    return { ok: false, content: "", ms: performance.now() - t0, error: e.message }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface PairResult {
  idx: number
  meta?: { scenario?: string; variant?: string }
  label: boolean | null
  wandbPass: boolean | null
  togetherPass: boolean | null
  wandbMs: number
  togetherMs: number
  wandbMatchesLabel: boolean
  togetherMatchesLabel: boolean
  directAgree: boolean
  wandbError?: string
  togetherError?: string
}

async function evalAdapter(adapter: AdapterDef, sampleN: number): Promise<{
  adapter: string
  results: PairResult[]
  wandbAccuracy: number
  togetherAccuracy: number
  directAgreement: number
  wandbAvgMs: number
  togetherAvgMs: number
}> {
  const dataPath = join(LORA_DATA, adapter.dataFile)
  const lines = readFileSync(dataPath, "utf8").trim().split("\n")
  let pairs = lines.map(l => JSON.parse(l))

  // Remove _meta before processing (but save for reporting)
  const metas = pairs.map((p: any) => p._meta)

  // Sample
  if (sampleN < pairs.length) {
    const indices = [...Array(pairs.length).keys()]
    // Deterministic shuffle for reproducibility
    indices.sort((a, b) => {
      const ha = ((a * 2654435761) >>> 0) / 4294967296
      const hb = ((b * 2654435761) >>> 0) / 4294967296
      return ha - hb
    })
    const selected = indices.slice(0, sampleN)
    pairs = selected.map(i => pairs[i])
    // Re-map metas too
    const selectedMetas = selected.map(i => metas[i])
    metas.length = 0
    metas.push(...selectedMetas)
  }

  console.log(`\n${"=".repeat(70)}`)
  console.log(`  ${adapter.label}: ${pairs.length} pairs (W&B 14B vs Together 9B)`)
  console.log(`${"=".repeat(70)}\n`)

  const results: PairResult[] = []
  let wandbCorrect = 0, togetherCorrect = 0, directAgree = 0, scored = 0

  const CONCURRENCY = 5
  for (let i = 0; i < pairs.length; i += CONCURRENCY) {
    const batch = pairs.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(batch.map(async (pair: any, bi: number) => {
      const idx = i + bi
      const messages = pair.messages
      if (!messages || messages.length < 3) return null

      const system = messages[0].content
      const user = messages[1].content
      const labelContent = messages[2].content

      const label = adapter.extractLabel(labelContent)

      // Call both in parallel
      const [wandbResult, togetherResult] = await Promise.all([
        callWandb(adapter.wandb.model, system, user),
        callTogether(adapter.together.baseModel, adapter.together.lora, system, user),
      ])

      const wandbVerdict = wandbResult.ok ? adapter.extractVerdict(wandbResult.content) : null
      const togetherVerdict = togetherResult.ok ? adapter.extractVerdict(togetherResult.content) : null

      const wandbPass = wandbVerdict?.pass ?? null
      const togetherPass = togetherVerdict?.pass ?? null
      const labelPass = label?.pass ?? null

      const wandbMatchesLabel = wandbPass !== null && labelPass !== null && wandbPass === labelPass
      const togetherMatchesLabel = togetherPass !== null && labelPass !== null && togetherPass === labelPass
      const agree = wandbPass !== null && togetherPass !== null && wandbPass === togetherPass

      return {
        idx,
        meta: metas[idx],
        label: labelPass,
        wandbPass,
        togetherPass,
        wandbMs: wandbResult.ms,
        togetherMs: togetherResult.ms,
        wandbMatchesLabel,
        togetherMatchesLabel,
        directAgree: agree,
        wandbError: wandbResult.ok ? undefined : wandbResult.error,
        togetherError: togetherResult.ok ? undefined : togetherResult.error,
      } as PairResult
    }))

    for (const r of batchResults) {
      if (!r) continue
      results.push(r)

      if (r.wandbPass !== null && r.togetherPass !== null && r.label !== null) {
        scored++
        if (r.wandbMatchesLabel) wandbCorrect++
        if (r.togetherMatchesLabel) togetherCorrect++
        if (r.directAgree) directAgree++
      }

      const wMark = r.wandbMatchesLabel ? "OK" : r.wandbPass === null ? "ERR" : "MISS"
      const tMark = r.togetherMatchesLabel ? "OK" : r.togetherPass === null ? "ERR" : "MISS"
      const agree = r.directAgree ? "=" : "!"
      const scenario = r.meta?.scenario ?? ""
      const variant = r.meta?.variant ?? ""
      const tag = scenario ? `${scenario}/${variant}` : `pair-${r.idx}`
      process.stdout.write(`  [${String(results.length).padStart(3)}] ${tag.padEnd(35).slice(0, 35)} W&B:${wMark.padEnd(4)} Tgt:${tMark.padEnd(4)} ${agree}  (${Math.round(r.wandbMs)}/${Math.round(r.togetherMs)}ms)\n`)
    }
  }

  const wandbAccuracy = scored > 0 ? Math.round(wandbCorrect / scored * 100) : 0
  const togetherAccuracy = scored > 0 ? Math.round(togetherCorrect / scored * 100) : 0
  const directPct = scored > 0 ? Math.round(directAgree / scored * 100) : 0
  const wandbAvgMs = results.length > 0 ? Math.round(results.reduce((s, r) => s + r.wandbMs, 0) / results.length) : 0
  const togetherAvgMs = results.length > 0 ? Math.round(results.reduce((s, r) => s + r.togetherMs, 0) / results.length) : 0

  console.log(`\n  ────────────────────────────────────────`)
  console.log(`  ${adapter.label} Results:`)
  console.log(`    W&B 14B accuracy:      ${wandbCorrect}/${scored} (${wandbAccuracy}%)`)
  console.log(`    Together 9B accuracy:  ${togetherCorrect}/${scored} (${togetherAccuracy}%)`)
  console.log(`    Direct agreement:      ${directAgree}/${scored} (${directPct}%)`)
  console.log(`    W&B avg latency:       ${wandbAvgMs}ms`)
  console.log(`    Together avg latency:  ${togetherAvgMs}ms`)

  // Disagreement analysis
  const disagreements = results.filter(r => r.wandbPass !== null && r.togetherPass !== null && !r.directAgree)
  if (disagreements.length > 0) {
    const wandbStricter = disagreements.filter(d => !d.wandbPass && d.togetherPass).length
    const togetherStricter = disagreements.filter(d => d.wandbPass && !d.togetherPass).length
    console.log(`    Disagreements: ${disagreements.length}`)
    console.log(`      W&B stricter:     ${wandbStricter}`)
    console.log(`      Together stricter: ${togetherStricter}`)
  }

  return { adapter: adapter.key, results, wandbAccuracy, togetherAccuracy, directAgreement: directPct, wandbAvgMs, togetherAvgMs }
}

async function main() {
  const targets = ADAPTER_FILTER
    ? ADAPTERS.filter(a => a.key === ADAPTER_FILTER)
    : ADAPTERS

  if (targets.length === 0) {
    console.error(`Unknown adapter: ${ADAPTER_FILTER}`)
    process.exit(1)
  }

  const expId = await createTuningExperiment(
    "data-validation",
    `Together AI 9B vs W&B 14B adapter A/B comparison (${targets.map(t => t.key).join(", ")}, ${SAMPLE_N} pairs each)`,
    {
      adapters: targets.map(t => t.key),
      sampleSize: SAMPLE_N,
      wandbBase: "OpenPipe/Qwen3-14B-Instruct",
      togetherBase: "Qwen/Qwen3.5-9B",
      togetherLoraParams: "r=16, alpha=32, dropout=0.05",
    },
    { target: "adapter-comparison", dimension: "calibration" },
  )
  console.log(`Experiment: ${expId}`)

  const allResults: Record<string, any> = {}

  for (const adapter of targets) {
    const result = await evalAdapter(adapter, SAMPLE_N)
    allResults[adapter.key] = result
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log(`\n${"=".repeat(70)}`)
  console.log(`  SUMMARY: Together 9B vs W&B 14B`)
  console.log(`${"=".repeat(70)}\n`)

  console.log(`  ${"Adapter".padEnd(25)} ${"W&B 14B".padStart(10)} ${"Tgt 9B".padStart(10)} ${"Agree".padStart(10)} ${"W&B ms".padStart(10)} ${"Tgt ms".padStart(10)}`)
  console.log(`  ${"─".repeat(75)}`)

  for (const adapter of targets) {
    const r = allResults[adapter.key]
    if (!r) continue
    console.log(`  ${adapter.label.padEnd(25)} ${(r.wandbAccuracy + "%").padStart(10)} ${(r.togetherAccuracy + "%").padStart(10)} ${(r.directAgreement + "%").padStart(10)} ${(r.wandbAvgMs + "ms").padStart(10)} ${(r.togetherAvgMs + "ms").padStart(10)}`)
  }

  console.log()

  // Verdict
  for (const adapter of targets) {
    const r = allResults[adapter.key]
    if (!r) continue
    const gap = r.wandbAccuracy - r.togetherAccuracy
    let verdict: string
    if (Math.abs(gap) <= 3) {
      verdict = `EQUIVALENT: ${adapter.label} — Together 9B matches W&B 14B within noise (${gap > 0 ? "-" : "+"}${Math.abs(gap)}pp).`
    } else if (gap > 3 && gap <= 10) {
      verdict = `DEGRADED: ${adapter.label} — Together 9B is ${gap}pp below W&B 14B. Usable as fallback, not production replacement.`
    } else if (gap > 10) {
      verdict = `SIGNIFICANT GAP: ${adapter.label} — Together 9B is ${gap}pp below W&B 14B. Not a viable substitute.`
    } else {
      verdict = `TOGETHER WINS: ${adapter.label} — Together 9B is ${Math.abs(gap)}pp above W&B 14B (unexpected).`
    }
    console.log(`  ${verdict}`)
  }

  const conclusion = JSON.stringify({
    sampleSize: SAMPLE_N,
    adapters: allResults,
  })
  await concludeExperiment(expId, conclusion)
  console.log(`\nExperiment ${expId} concluded.`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })

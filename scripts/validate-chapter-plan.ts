/**
 * Validate chapter-plan-checker training pairs against a target model.
 *
 * Replays every pair through a chosen provider/model using the exact
 * system+user prompt from the training data. Compares output to the
 * deterministic label. Reports agreement rate by variant type and flags
 * every disagreement with detail.
 *
 * Two standard modes:
 *   oracle     — gpt-oss-120b on Groq (current production model)
 *   base-14b   — Qwen3-14B-Instruct on W&B Inference (swap candidate)
 *
 * Decision criteria (same as adherence-checker): ≥90% overall, ≥85% per variant.
 *
 * Usage:
 *   GROQ_API_KEY=...   bun scripts/validate-chapter-plan.ts --mode oracle
 *   WANDB_API_KEY=...  bun scripts/validate-chapter-plan.ts --mode base-14b
 *   bun scripts/validate-chapter-plan.ts --provider groq --model openai/gpt-oss-120b
 *   bun scripts/validate-chapter-plan.ts --mode oracle --sample 20
 */

import { readFileSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"

const PAIRS_PATH = join(import.meta.dir, "../lora-data/chapter-plan-checker-pairs.jsonl")

// ── Arg parsing ──────────────────────────────────────────────────────────

function getArg(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null
}

const MODE = getArg("--mode")
const SAMPLE_N = getArg("--sample") ? parseInt(getArg("--sample")!) : null

let provider: string
let model: string
let modeLabel: string

if (MODE === "oracle") {
  provider = "groq"
  model = "openai/gpt-oss-120b"
  modeLabel = "oracle (gpt-oss-120b)"
} else if (MODE === "base-14b") {
  provider = "wandb"
  model = "OpenPipe/Qwen3-14B-Instruct"
  modeLabel = "base Qwen3-14B on W&B"
} else {
  const pArg = getArg("--provider")
  const mArg = getArg("--model")
  if (!pArg || !mArg) {
    console.error("Usage: bun scripts/validate-chapter-plan.ts --mode oracle|base-14b")
    console.error("   or: bun scripts/validate-chapter-plan.ts --provider <p> --model <m>")
    process.exit(1)
  }
  provider = pArg
  model = mArg
  modeLabel = `${provider}/${model}`
}

// ── Types ────────────────────────────────────────────────────────────────

interface Pair {
  messages: Array<{ role: string; content: string }>
  _meta: { scenario: string; variant: string }
}

interface CheckerResult {
  pass: boolean
  deviations: string[]
}

async function callTarget(system: string, user: string): Promise<CheckerResult | null> {
  const transport = getTransport()
  try {
    const result = await transport.execute({
      systemPrompt: system,
      userPrompt: user,
      provider: provider as any,
      model,
      temperature: 0.1,
      maxTokens: 2048,
      responseFormat: { type: "json_object" },
    })
    // Extract JSON — models sometimes return prose around it
    let content = result.content.trim()
    if (content.startsWith("```")) {
      content = content.replace(/^```[a-z]*\n/, "").replace(/\n```$/, "")
    }
    // Find the first {...} block if there's wrapper text
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) content = jsonMatch[0]
    const parsed = JSON.parse(content)
    return {
      pass: Boolean(parsed.pass),
      deviations: Array.isArray(parsed.deviations) ? parsed.deviations : [],
    }
  } catch (err) {
    return null
  }
}

async function main() {
  const lines = readFileSync(PAIRS_PATH, "utf8").trim().split("\n")
  let pairs: Pair[] = lines.map(l => JSON.parse(l))

  if (SAMPLE_N && SAMPLE_N < pairs.length) {
    const shuffled = [...pairs].sort(() => Math.random() - 0.5)
    pairs = shuffled.slice(0, SAMPLE_N)
    console.log(`Sampling ${SAMPLE_N} of ${lines.length} pairs`)
  } else {
    console.log(`Validating all ${pairs.length} pairs`)
  }
  console.log(`Target: ${modeLabel}\n`)

  const expId = await createTuningExperiment(
    "data-validation",
    `Chapter-plan-checker validation on ${modeLabel} (${pairs.length} pairs)`,
    { totalPairs: pairs.length, provider, model, temperature: 0.1 },
    { target: "chapter-plan-checker", dimension: "calibration" },
  )
  console.log(`Experiment: ${expId}\n`)

  type VariantStats = { agree: number; disagree: number; errors: number }
  const byVariant = new Map<string, VariantStats>()
  const disagreements: Array<{
    scenario: string; variant: string
    expectedPass: boolean; gotPass: boolean
    gotDeviations: string[]
  }> = []

  let agree = 0, disagree = 0, errors = 0
  let passExpected = 0, passGot = 0  // directional bias tracking

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]
    const variant = pair._meta.variant
    if (!byVariant.has(variant)) byVariant.set(variant, { agree: 0, disagree: 0, errors: 0 })
    const stats = byVariant.get(variant)!

    const system = pair.messages[0].content
    const user = pair.messages[1].content
    const expected = JSON.parse(pair.messages[2].content) as CheckerResult
    if (expected.pass) passExpected++

    process.stdout.write(`[${i + 1}/${pairs.length}] ${pair._meta.scenario}/${variant} ... `)

    const got = await callTarget(system, user)
    if (!got) {
      process.stdout.write("ERROR\n")
      errors++; stats.errors++
      continue
    }
    if (got.pass) passGot++

    const matches = got.pass === expected.pass
    process.stdout.write(matches
      ? `OK (${expected.pass ? "PASS" : "FAIL"})\n`
      : `MISMATCH — expected ${expected.pass ? "PASS" : "FAIL"}, got ${got.pass ? "PASS" : "FAIL"}\n`
    )

    if (matches) {
      agree++; stats.agree++
    } else {
      disagree++; stats.disagree++
      disagreements.push({
        scenario: pair._meta.scenario,
        variant,
        expectedPass: expected.pass,
        gotPass: got.pass,
        gotDeviations: got.deviations,
      })
    }
  }

  // ── Report ───────────────────────────────────────────────────────────

  const total = agree + disagree
  const overallPct = total > 0 ? Math.round(agree / total * 100) : 0

  console.log("\n════════════════════════════════════════")
  console.log(`TARGET:  ${modeLabel}`)
  console.log(`OVERALL: ${agree}/${total} agree (${overallPct}%) · ${errors} errors`)
  console.log(`BIAS:    expected ${passExpected} PASS / got ${passGot} PASS (diff ${passGot - passExpected})`)
  console.log("════════════════════════════════════════\n")

  console.log("By variant:")
  for (const [v, s] of [...byVariant.entries()].sort()) {
    const vTotal = s.agree + s.disagree
    const vPct = vTotal > 0 ? Math.round(s.agree / vTotal * 100) : 0
    const flag = vPct < 85 ? " ⚠" : ""
    console.log(`  ${v.padEnd(22)} ${s.agree}/${vTotal} (${vPct}%)${flag}`)
  }

  if (disagreements.length > 0) {
    console.log(`\n── ${disagreements.length} disagreements ──`)
    for (const d of disagreements.slice(0, 15)) {
      console.log(`  [${d.scenario}/${d.variant}] expected ${d.expectedPass ? "PASS" : "FAIL"}, got ${d.gotPass ? "PASS" : "FAIL"}`)
      if (d.gotDeviations.length > 0) {
        console.log(`    deviations: ${d.gotDeviations.slice(0, 2).map(s => s.slice(0, 120)).join(" | ")}`)
      }
    }
    if (disagreements.length > 15) console.log(`    ... and ${disagreements.length - 15} more`)
  }

  const ready = overallPct >= 90 && [...byVariant.values()].every(s => {
    const t = s.agree + s.disagree
    return t === 0 || (s.agree / t) >= 0.85
  })

  const conclusion = JSON.stringify({
    target: modeLabel,
    provider,
    model,
    total: pairs.length,
    agree,
    disagree,
    errors,
    agreementPct: overallPct,
    bias: { passExpected, passGot, diff: passGot - passExpected },
    ready,
    byVariant: Object.fromEntries([...byVariant.entries()].map(([v, s]) => {
      const t = s.agree + s.disagree
      return [v, { agree: s.agree, total: t, pct: t > 0 ? Math.round(s.agree / t * 100) : 0 }]
    })),
    disagreements: disagreements.map(d => ({
      scenario: d.scenario, variant: d.variant,
      expectedPass: d.expectedPass, gotPass: d.gotPass,
    })),
    verdict: ready
      ? `${modeLabel} ready: ${overallPct}% agreement with deterministic labels.`
      : `${modeLabel} needs review: ${overallPct}% agreement — below 90% threshold.`,
  })

  await concludeExperiment(expId, conclusion)
  console.log(`\nVerdict: ${ready ? "✓ READY" : "✗ NEEDS REVIEW"}`)
  console.log(`Experiment ${expId} concluded.`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })

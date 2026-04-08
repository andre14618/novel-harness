/**
 * Oracle validation for adherence-checker training pairs.
 *
 * Replays every pair through Cerebras Qwen 235B (the current oracle) using
 * the exact system+user prompt from the training data. Compares oracle output
 * to the deterministic label. Reports agreement rate by variant type and flags
 * every disagreement with detail.
 *
 * Decision criterion: ≥90% agreement overall, ≥85% per variant type.
 * Below that threshold the training data needs review before submission.
 *
 * Usage:
 *   CEREBRAS_API_KEY=... bun scripts/validate-adherence-data.ts
 *   CEREBRAS_API_KEY=... bun scripts/validate-adherence-data.ts --sample 40
 */

import { readFileSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"

const PAIRS_PATH = join(import.meta.dir, "../lora-data/adherence-checker-pairs.jsonl")
const SAMPLE_ARG = process.argv.indexOf("--sample")
const SAMPLE_N   = SAMPLE_ARG !== -1 ? parseInt(process.argv[SAMPLE_ARG + 1]) : null

interface Pair {
  messages: Array<{ role: string; content: string }>
  _meta: { scenario: string; variant: string }
}

interface OracleResult {
  pass: boolean
  deviations: string[]
}

async function callOracle(system: string, user: string): Promise<OracleResult | null> {
  const transport = getTransport()
  try {
    const result = await transport.execute({
      systemPrompt: system,
      userPrompt: user,
      provider: "cerebras",
      model: "qwen-3-235b-a22b-instruct-2507",
      temperature: 0.1,   // low temp for deterministic classification
      maxTokens: 256,
      responseFormat: { type: "json_object" },
    })
    const parsed = JSON.parse(result.content)
    return {
      pass: Boolean(parsed.pass),
      deviations: Array.isArray(parsed.deviations) ? parsed.deviations : [],
    }
  } catch {
    return null
  }
}

async function main() {
  const lines = readFileSync(PAIRS_PATH, "utf8").trim().split("\n")
  let pairs: Pair[] = lines.map(l => JSON.parse(l))

  // Optional random sample
  if (SAMPLE_N && SAMPLE_N < pairs.length) {
    const shuffled = [...pairs].sort(() => Math.random() - 0.5)
    pairs = shuffled.slice(0, SAMPLE_N)
    console.log(`Sampling ${SAMPLE_N} of ${lines.length} pairs`)
  } else {
    console.log(`Validating all ${pairs.length} pairs`)
  }

  const expId = await createTuningExperiment(
    "data-validation",
    `Adherence-checker training data oracle validation (${pairs.length} pairs)`,
    { totalPairs: pairs.length, oracleModel: "qwen-3-235b-a22b-instruct-2507", temperature: 0.1 },
    { target: "adherence-checker", dimension: "calibration" },
  )
  console.log(`Experiment: ${expId}\n`)

  // Track results
  type VariantStats = { agree: number; disagree: number; errors: number }
  const byVariant = new Map<string, VariantStats>()
  const disagreements: Array<{
    scenario: string; variant: string
    expectedPass: boolean; oraclePass: boolean
    beat: string; prose: string; oracleDeviations: string[]
  }> = []

  let agree = 0, disagree = 0, errors = 0

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]
    const variant = pair._meta.variant
    if (!byVariant.has(variant)) byVariant.set(variant, { agree: 0, disagree: 0, errors: 0 })
    const stats = byVariant.get(variant)!

    const system    = pair.messages[0].content
    const user      = pair.messages[1].content
    const expected  = JSON.parse(pair.messages[2].content) as OracleResult

    process.stdout.write(`[${i + 1}/${pairs.length}] ${pair._meta.scenario}/${variant} ... `)

    const oracle = await callOracle(system, user)
    if (!oracle) {
      process.stdout.write("ERROR\n")
      errors++; stats.errors++
      continue
    }

    const matches = oracle.pass === expected.pass
    process.stdout.write(matches
      ? `OK (${expected.pass ? "PASS" : "FAIL"})\n`
      : `MISMATCH — expected ${expected.pass ? "PASS" : "FAIL"}, oracle says ${oracle.pass ? "PASS" : "FAIL"}\n`
    )

    if (matches) {
      agree++; stats.agree++
    } else {
      disagree++; stats.disagree++
      // Extract beat and prose snippet for the report
      const beatLine = user.split("\n").find(l => l.startsWith("Beat:")) ?? ""
      const proseBlock = user.split("---")[1]?.trim().slice(0, 200) ?? ""
      disagreements.push({
        scenario: pair._meta.scenario,
        variant,
        expectedPass: expected.pass,
        oraclePass: oracle.pass,
        beat: beatLine,
        prose: proseBlock,
        oracleDeviations: oracle.deviations,
      })
    }
  }

  // ── Report ─────────────────────────────────────────────────────────────────

  const total = agree + disagree
  const pct = (n: number) => `${Math.round(n / total * 100)}%`

  console.log("\n════════════════════════════════════════")
  console.log(`OVERALL: ${agree}/${total} agree (${pct(agree)}) · ${errors} errors`)
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
    for (const d of disagreements) {
      console.log(`\n[${d.scenario} / ${d.variant}]`)
      console.log(`  ${d.beat}`)
      console.log(`  Expected: ${d.expectedPass ? "PASS" : "FAIL"} | Oracle: ${d.oraclePass ? "PASS" : "FAIL"}`)
      console.log(`  Prose: ${d.prose}...`)
      if (d.oracleDeviations.length)
        console.log(`  Oracle deviations: ${d.oracleDeviations.join("; ")}`)
    }
  }

  const overallPct = Math.round(agree / total * 100)
  const ready = overallPct >= 90 && [...byVariant.values()].every(s => {
    const t = s.agree + s.disagree
    return t === 0 || (s.agree / t) >= 0.85
  })

  const conclusion = JSON.stringify({
    total: pairs.length,
    agree,
    disagree,
    errors,
    agreementPct: overallPct,
    ready,
    byVariant: Object.fromEntries([...byVariant.entries()].map(([v, s]) => {
      const t = s.agree + s.disagree
      return [v, { agree: s.agree, total: t, pct: t > 0 ? Math.round(s.agree / t * 100) : 0 }]
    })),
    disagreements: disagreements.map(d => ({
      scenario: d.scenario, variant: d.variant,
      expectedPass: d.expectedPass, oraclePass: d.oraclePass,
    })),
    verdict: ready
      ? `Data ready for training. ${overallPct}% oracle agreement.`
      : `Data needs review. ${overallPct}% agreement — below 90% threshold.`,
  })

  await concludeExperiment(expId, conclusion)
  console.log(`\nVerdict: ${ready ? "✓ READY FOR TRAINING" : "✗ NEEDS REVIEW"}`)
  console.log(`Experiment ${expId} concluded.`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })

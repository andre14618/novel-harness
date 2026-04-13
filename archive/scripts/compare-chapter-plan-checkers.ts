/**
 * Direct A/B comparison: base Qwen3-14B (W&B) vs gpt-oss-120b (Groq) on
 * chapter-plan-checker pairs. Measures 14B↔120B agreement directly, rather
 * than routing through noisy deterministic labels.
 *
 * Why this exists: the synthetic labels for FAIL_MISSING_BEAT and
 * FAIL_REVERSED_ARC turned out noisy — the generator couldn't reliably
 * omit/invert the instructed element, so the "gold" FAIL is sometimes
 * really a PASS. That made label-agreement a lower bound on oracle quality.
 * The real question for the production swap is: does 14B reach the same
 * verdict as the current oracle (120B)?
 *
 * Method:
 *   1. For every pair, call both providers with the exact same prompts.
 *   2. Compare pass-bit directly (14B == 120B).
 *   3. Also compare each to the label for reference.
 *   4. Create a tuning_experiment with full pairwise results.
 *
 * Decision:
 *   - ≥90% direct agreement → 14B effectively replicates the oracle → SWAP
 *   - 85-90% → fine-tune justified (distill 120B onto 14B)
 *   - <85% → 14B reasoning ceiling, keep 120B
 *
 * Usage:
 *   GROQ_API_KEY=... WANDB_API_KEY=... bun scripts/compare-chapter-plan-checkers.ts
 */

import { readFileSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"

const PAIRS_PATH = join(import.meta.dir, "../lora-data/chapter-plan-checker-pairs.jsonl")

interface Pair {
  messages: Array<{ role: string; content: string }>
  _meta: { scenario: string; variant: string }
}

interface CheckerResult {
  pass: boolean
  deviations: string[]
}

async function callChecker(
  provider: string,
  model: string,
  system: string,
  user: string,
): Promise<CheckerResult | null> {
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
    let content = result.content.trim()
    if (content.startsWith("```")) {
      content = content.replace(/^```[a-z]*\n/, "").replace(/\n```$/, "")
    }
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
  const pairs: Pair[] = lines.map(l => JSON.parse(l))

  const ORACLE = { provider: "groq", model: "openai/gpt-oss-120b", label: "120B" }
  const CANDIDATE = { provider: "wandb", model: "wandb-artifact:///andre14618-/novel-harness/chapter-plan-checker-v2:v1", label: "v2" }

  console.log(`A/B comparison: ${CANDIDATE.label} vs ${ORACLE.label} on ${pairs.length} pairs\n`)

  const expId = await createTuningExperiment(
    "data-validation",
    `Chapter-plan-checker A/B: chapter-plan-checker-v2 SFT adapter vs gpt-oss-120b (direct agreement)`,
    { totalPairs: pairs.length, oracle: ORACLE, candidate: CANDIDATE },
    { target: "chapter-plan-checker", dimension: "calibration" },
  )
  console.log(`Experiment: ${expId}\n`)

  type Row = {
    scenario: string
    variant: string
    label: boolean
    oraclePass: boolean | null
    candidatePass: boolean | null
    oracleMatchesLabel: boolean
    candidateMatchesLabel: boolean
    directAgree: boolean
  }

  const rows: Row[] = []
  let directAgree = 0, directDisagree = 0
  let oracleVsLabel = 0, candidateVsLabel = 0
  let oracleErrors = 0, candidateErrors = 0

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]
    const system = pair.messages[0].content
    const user = pair.messages[1].content
    const expected = JSON.parse(pair.messages[2].content) as CheckerResult
    const label = expected.pass

    process.stdout.write(`[${i + 1}/${pairs.length}] ${pair._meta.scenario}/${pair._meta.variant} ... `)

    // Call both in parallel to speed up
    const [oracleResult, candidateResult] = await Promise.all([
      callChecker(ORACLE.provider, ORACLE.model, system, user),
      callChecker(CANDIDATE.provider, CANDIDATE.model, system, user),
    ])

    const oraclePass = oracleResult?.pass ?? null
    const candidatePass = candidateResult?.pass ?? null
    if (oracleResult === null) oracleErrors++
    if (candidateResult === null) candidateErrors++

    const oracleMatchesLabel = oraclePass === label
    const candidateMatchesLabel = candidatePass === label
    const direct = oraclePass !== null && candidatePass !== null && oraclePass === candidatePass

    if (oraclePass !== null && candidatePass !== null) {
      if (direct) directAgree++; else directDisagree++
    }
    if (oracleMatchesLabel) oracleVsLabel++
    if (candidateMatchesLabel) candidateVsLabel++

    rows.push({
      scenario: pair._meta.scenario,
      variant: pair._meta.variant,
      label,
      oraclePass,
      candidatePass,
      oracleMatchesLabel,
      candidateMatchesLabel,
      directAgree: direct,
    })

    const o = oraclePass === null ? "ERR" : oraclePass ? "PASS" : "FAIL"
    const c = candidatePass === null ? "ERR" : candidatePass ? "PASS" : "FAIL"
    const mark = oraclePass !== null && candidatePass !== null
      ? (direct ? "✓" : "✗")
      : "·"
    process.stdout.write(`120B=${o} v2=${c} ${mark}\n`)
  }

  // ── Report ──────────────────────────────────────────────────────────
  const directTotal = directAgree + directDisagree
  const directPct = directTotal > 0 ? Math.round(directAgree / directTotal * 100) : 0
  const oracleVsLabelPct = Math.round(oracleVsLabel / pairs.length * 100)
  const candidateVsLabelPct = Math.round(candidateVsLabel / pairs.length * 100)

  console.log("\n════════════════════════════════════════")
  console.log(`DIRECT AGREEMENT (v2 vs 120B):   ${directAgree}/${directTotal} (${directPct}%)`)
  console.log(`120B vs labels:                  ${oracleVsLabel}/${pairs.length} (${oracleVsLabelPct}%)`)
  console.log(`v2   vs labels:                  ${candidateVsLabel}/${pairs.length} (${candidateVsLabelPct}%)`)
  console.log(`Errors: 120B=${oracleErrors}, 14B=${candidateErrors}`)
  console.log("════════════════════════════════════════\n")

  // Per-variant direct agreement
  const byVariant = new Map<string, { agree: number; disagree: number }>()
  for (const r of rows) {
    if (r.oraclePass === null || r.candidatePass === null) continue
    if (!byVariant.has(r.variant)) byVariant.set(r.variant, { agree: 0, disagree: 0 })
    const s = byVariant.get(r.variant)!
    if (r.directAgree) s.agree++; else s.disagree++
  }

  console.log("Direct agreement by variant:")
  for (const [v, s] of [...byVariant.entries()].sort()) {
    const t = s.agree + s.disagree
    const pct = t > 0 ? Math.round(s.agree / t * 100) : 0
    const flag = pct < 85 ? " ⚠" : ""
    console.log(`  ${v.padEnd(22)} ${s.agree}/${t} (${pct}%)${flag}`)
  }

  // Disagreement analysis
  const disagreements = rows.filter(r =>
    r.oraclePass !== null && r.candidatePass !== null && !r.directAgree
  )
  if (disagreements.length > 0) {
    console.log(`\n── ${disagreements.length} disagreements ──`)
    // Directional bias: who is stricter?
    const candidateStricter = disagreements.filter(d => d.oraclePass === true && d.candidatePass === false).length
    const oracleStricter = disagreements.filter(d => d.oraclePass === false && d.candidatePass === true).length
    console.log(`  v2 stricter  (v2=FAIL,  120B=PASS): ${candidateStricter}`)
    console.log(`  120B stricter (v2=PASS, 120B=FAIL): ${oracleStricter}`)
    console.log()
    for (const d of disagreements.slice(0, 20)) {
      console.log(`  [${d.scenario}/${d.variant}] 120B=${d.oraclePass ? "PASS" : "FAIL"} v2=${d.candidatePass ? "PASS" : "FAIL"} (label=${d.label ? "PASS" : "FAIL"})`)
    }
  }

  // Decision
  let verdict: string
  if (directPct >= 90) {
    verdict = `SWAP SAFE: ${directPct}% direct agreement with oracle → swap to v2 adapter.`
  } else if (directPct >= 85) {
    verdict = `CLOSE: ${directPct}% direct agreement. Consider more data or another training round.`
  } else {
    verdict = `KEEP ORACLE: ${directPct}% direct agreement — v2 adapter doesn't replicate 120B on this task.`
  }
  console.log(`\nVerdict: ${verdict}`)

  const conclusion = JSON.stringify({
    method: "direct A/B — v2 SFT adapter vs 120B side-by-side, same prompts",
    totalPairs: pairs.length,
    directAgreement: { agree: directAgree, disagree: directDisagree, pct: directPct },
    oracleVsLabel: { agree: oracleVsLabel, pct: oracleVsLabelPct },
    candidateVsLabel: { agree: candidateVsLabel, pct: candidateVsLabelPct },
    errors: { oracle: oracleErrors, candidate: candidateErrors },
    byVariant: Object.fromEntries([...byVariant.entries()].map(([v, s]) => {
      const t = s.agree + s.disagree
      return [v, { agree: s.agree, total: t, pct: t > 0 ? Math.round(s.agree / t * 100) : 0 }]
    })),
    disagreementPattern: {
      candidateStricter: disagreements.filter(d => d.oraclePass === true && d.candidatePass === false).length,
      oracleStricter: disagreements.filter(d => d.oraclePass === false && d.candidatePass === true).length,
    },
    disagreements: disagreements.map(d => ({
      scenario: d.scenario, variant: d.variant,
      label: d.label, oracle: d.oraclePass, candidate: d.candidatePass,
    })),
    verdict,
  })

  await concludeExperiment(expId, conclusion)
  console.log(`\nExperiment ${expId} concluded.`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })

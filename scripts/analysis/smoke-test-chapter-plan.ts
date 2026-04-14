/**
 * Smoke test for base Qwen3-14B on W&B via the live callAgent path.
 *
 * Picks 5 PASS_CLEAN + 5 FAIL_MISSING_BEAT pairs from the synthetic data
 * (clearest possible PASS and FAIL cases) and runs them through the full
 * callAgent stack to exercise model assignment, transport, JSON parsing,
 * and zod validation for chapter-plan-checker.
 *
 * Pass criterion: ≥9/10 correct, 0 parse errors, <5s/call.
 *
 * Usage:
 *   WANDB_API_KEY=... bun scripts/smoke-test-chapter-plan.ts
 *
 * IMPORTANT: this relies on chapter-plan-checker being assigned to the
 * base 14B model in models/roles.ts. Confirm that before running.
 */

import { readFileSync } from "fs"
import { join } from "path"
import { callAgent } from "../../src/llm"
import { chapterPlanCheckSchema } from "../../src/agents/chapter-plan-checker"

const PAIRS_PATH = join(import.meta.dir, "../lora-data/chapter-plan-checker-pairs.jsonl")

async function main() {
  const lines = readFileSync(PAIRS_PATH, "utf8").trim().split("\n")
  const pairs = lines.map(l => JSON.parse(l))

  const passClean = pairs.filter(p => p._meta.variant === "PASS_CLEAN").slice(0, 5)
  const failMissing = pairs.filter(p => p._meta.variant === "FAIL_MISSING_BEAT").slice(0, 5)
  const samples = [...passClean, ...failMissing]

  console.log(`Smoke test: chapter-plan-checker (${samples.length} pairs — 5 PASS_CLEAN + 5 FAIL_MISSING_BEAT)\n`)

  let correct = 0
  let errors = 0
  const latencies: number[] = []

  for (let i = 0; i < samples.length; i++) {
    const pair = samples[i]
    const expected = JSON.parse(pair.messages[2].content)
    const system = pair.messages[0].content
    const user = pair.messages[1].content
    const label = `${pair._meta.scenario}/${pair._meta.variant}`

    process.stdout.write(`[${i + 1}/10] ${label} (expect ${expected.pass ? "PASS" : "FAIL"}) ... `)

    const t0 = Date.now()
    try {
      const result = await callAgent({
        agentName: "chapter-plan-checker",
        systemPrompt: system,
        userPrompt: user,
        schema: chapterPlanCheckSchema,
      })
      const latency = Date.now() - t0
      latencies.push(latency)

      const got = result.output.pass
      const ok = got === expected.pass
      if (ok) correct++

      process.stdout.write(`${ok ? "OK" : "WRONG"} → ${got ? "PASS" : "FAIL"} (${latency}ms)\n`)
      if (!ok && result.output.deviations.length > 0) {
        console.log(`    deviation: ${String(result.output.deviations[0]).slice(0, 140)}`)
      }
    } catch (err) {
      errors++
      process.stdout.write(`ERROR: ${String(err).slice(0, 140)}\n`)
    }
  }

  const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b) / latencies.length) : 0
  const pct = Math.round(correct / samples.length * 100)
  const passed = correct >= 9 && errors === 0

  console.log(`\n════════════════════════════`)
  console.log(`Result: ${correct}/10 correct (${pct}%)`)
  console.log(`Errors: ${errors}`)
  console.log(`Avg latency: ${avgLatency}ms`)
  console.log(`Verdict: ${passed ? "✓ SMOKE TEST PASSED" : "✗ SMOKE TEST FAILED"}`)

  process.exit(passed ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })

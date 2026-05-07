/**
 * Smoke test for the adherence-checker model assignment.
 *
 * Takes 5 PASS_CLEAN + 5 FAIL_SETTING pairs from the synthetic training data
 * (both types hit 100% oracle agreement — no edge cases) and runs them through
 * the live callAgent path so the full model assignment, transport, and JSON
 * parsing stack is exercised.
 *
 * Pass criterion: ≥9/10 correct, 0 parse errors, response time <3s/call.
 *
 * Usage:
 *   DEEPSEEK_API_KEY=... bun scripts/smoke-test-adherence.ts
 */

import { readFileSync } from "fs"
import { join } from "path"
import { callAgent } from "../../src/llm"
import { z } from "zod"

const PAIRS_PATH = join(import.meta.dir, "../lora-data/adherence-checker-pairs.jsonl")

const adherenceSchema = z.object({
  pass: z.boolean(),
  deviations: z.array(z.string()),
})

async function main() {
  const lines = readFileSync(PAIRS_PATH, "utf8").trim().split("\n")
  const pairs = lines.map(l => JSON.parse(l))

  // Pick 5 PASS_CLEAN and 5 FAIL_SETTING — clearest possible cases
  const passClean   = pairs.filter(p => p._meta.variant === "PASS_CLEAN").slice(0, 5)
  const failSetting = pairs.filter(p => p._meta.variant === "FAIL_SETTING").slice(0, 5)
  const samples = [...passClean, ...failSetting]

  console.log(`Smoke test: adherence-checker (${samples.length} pairs — 5 PASS_CLEAN + 5 FAIL_SETTING)\n`)

  let correct = 0
  let errors = 0
  const latencies: number[] = []

  for (let i = 0; i < samples.length; i++) {
    const pair = samples[i]
    const expected = JSON.parse(pair.messages[2].content)
    const system = pair.messages[0].content
    const user   = pair.messages[1].content
    const label  = `${pair._meta.scenario}/${pair._meta.variant}`

    process.stdout.write(`[${i + 1}/10] ${label} (expect ${expected.pass ? "PASS" : "FAIL"}) ... `)

    const t0 = Date.now()
    try {
      const result = await callAgent({
        agentName: "adherence-checker",
        systemPrompt: system,
        userPrompt: user,
        schema: adherenceSchema,
      })
      const latency = Date.now() - t0
      latencies.push(latency)

      const got = result.output.pass
      const ok  = got === expected.pass
      if (ok) correct++

      process.stdout.write(`${ok ? "OK" : "WRONG"} → ${got ? "PASS" : "FAIL"} (${latency}ms)\n`)
      if (!ok && result.output.deviations.length) {
        console.log(`   deviations: ${result.output.deviations[0]}`)
      }
    } catch (err) {
      errors++
      process.stdout.write(`ERROR: ${err}\n`)
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

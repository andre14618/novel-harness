/**
 * Quick latency ping — Qwen3-30B-A3B on W&B Inference.
 * 10 calls on adherence-checker shape to check if cold-start improved since exp #94.
 * Usage: bun scripts/test-30b-a3b-ping.ts
 */

const WANDB_KEY = process.env.WANDB_API_KEY
if (!WANDB_KEY) throw new Error("WANDB_API_KEY missing")

const MODEL = "Qwen/Qwen3-30B-A3B-Instruct-2507"
const URL = "https://api.inference.wandb.ai/v1/chat/completions"
const N = 10
const CONCURRENCY = 5

const SYSTEM = "You check if prose follows a scene beat specification. Be strict but fair."
const USER = `Beat: "Elena confronts Marcus about the betrayal in the manor library. The conversation escalates from cold civility to open accusation. Marcus tries to deflect by mentioning their shared history; Elena cuts him off and demands the truth about the missing letters."
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

Did the prose execute the beat? Return JSON: { "pass": true/false, "deviations": ["specific issue 1", ...] }`

async function ping(i: number): Promise<number | null> {
  const t0 = performance.now()
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${WANDB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: USER }],
        temperature: 0.3,
        max_tokens: 256,
      }),
    })
    const ms = Math.round(performance.now() - t0)
    if (!res.ok) {
      const text = await res.text()
      console.log(`call ${i}: FAIL ${res.status} ${text.slice(0, 120)} (${ms}ms)`)
      return null
    }
    const j: any = await res.json()
    const preview = j.choices?.[0]?.message?.content?.slice(0, 60) ?? "(no content)"
    console.log(`call ${i}: OK ${ms}ms | in=${j.usage?.prompt_tokens} out=${j.usage?.completion_tokens} | ${preview}...`)
    return ms
  } catch (e: any) {
    const ms = Math.round(performance.now() - t0)
    console.log(`call ${i}: ERR ${e.message} (${ms}ms)`)
    return null
  }
}

console.log(`Pinging ${MODEL}`)
console.log(`${N} calls, concurrency ${CONCURRENCY}, adherence-checker shape (~360 in / 140 out)\n`)

const latencies: number[] = []
for (let i = 0; i < N; i += CONCURRENCY) {
  const batch = await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, N - i) }, (_, k) => ping(i + k + 1))
  )
  latencies.push(...batch.filter((x): x is number => x !== null))
}

if (latencies.length === 0) {
  console.log("\nAll calls failed.")
  process.exit(1)
}

const sorted = [...latencies].sort((a, b) => a - b)
const avg = Math.round(latencies.reduce((s, x) => s + x, 0) / latencies.length)
const p50 = sorted[Math.floor(sorted.length * 0.5)]
const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]

console.log(`\n${latencies.length}/${N} ok`)
console.log(`avg=${avg}ms  p50=${p50}ms  p95=${p95}ms  min=${sorted[0]}ms  max=${sorted[sorted.length - 1]}ms`)

// Compare against exp #94 baseline
console.log(`\nexp #94 baseline: avg=7172ms  p95=33000ms`)
const improved = avg < 2000
console.log(improved
  ? `=> IMPROVED — worth running full probe (scripts/test-wandb-inference.ts)`
  : `=> STILL SLOW — cold-start not resolved`)

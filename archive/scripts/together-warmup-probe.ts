/**
 * Together AI warm-up probe — does TTFT improve with sustained sequential calls?
 *
 * Runs 20 sequential calls to Qwen 3.5 9B on Together AI standard tier.
 * Reports per-call latency to reveal whether the model "warms up" after
 * initial cold-start hits.
 *
 * Usage: bun scripts/together-warmup-probe.ts
 */

const TOGETHER_KEY = process.env.TOGETHER_API_KEY
if (!TOGETHER_KEY) throw new Error("TOGETHER_API_KEY missing")

const SYSTEM = "You are a careful reference resolver. Reply in JSON only."

// Two workload shapes: short (checker-like) and medium (continuity-like)
const PROMPTS = {
  short: `Resolve the following reference from a fantasy novel. Return JSON: { "name": string, "type": "character" | "place" | "item", "description": string }.
Reference: "the old wizard's tower on the cliffs above Stormhold"`,

  medium: `You are checking continuity. Given the following world state facts, identify any contradictions in the prose excerpt.

World state:
- Kael is a blacksmith in Thornwall, age 34
- The bridge over the Ash River collapsed three years ago
- Queen Maren abdicated after the Siege of Pale Harbor
- The northern garrison has 200 soldiers
- Elira is Kael's apprentice, arrived 6 months ago

Prose excerpt:
"Kael crossed the old stone bridge over the Ash River, its arches groaning under the weight of the supply cart. He'd made this journey weekly since Elira first arrived two years past, hauling ingots from the northern garrison's forge. The garrison commander — loyal to Queen Maren still — had given him favorable terms."

Return JSON: { "issues": [{ "type": "BLOCKER" | "WARNING", "description": string, "evidence": string }] }`,
}

interface CallResult {
  callNum: number
  ok: boolean
  ms: number
  promptTokens?: number
  completionTokens?: number
  error?: string
}

async function callTogether(prompt: string): Promise<Omit<CallResult, "callNum">> {
  const t0 = performance.now()
  try {
    const res = await fetch("https://api.together.xyz/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOGETHER_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "Qwen/Qwen3.5-9B",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 512,
        chat_template_kwargs: { enable_thinking: false },
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

const N = 20

for (const [shape, prompt] of Object.entries(PROMPTS)) {
  console.log(`\n${"=".repeat(60)}`)
  console.log(`  Together AI / Qwen 3.5 9B — ${shape} shape — ${N} sequential calls`)
  console.log(`${"=".repeat(60)}\n`)

  const results: CallResult[] = []

  for (let i = 0; i < N; i++) {
    process.stdout.write(`  [${String(i + 1).padStart(2)}/${N}] `)
    const r = await callTogether(prompt)
    const result = { ...r, callNum: i + 1 }
    results.push(result)

    if (r.ok) {
      const bar = "#".repeat(Math.min(60, Math.round(r.ms / 500)))
      console.log(`${r.ms.toFixed(0).padStart(7)} ms  ${bar}`)
    } else {
      console.log(`   FAIL: ${r.error}`)
    }
  }

  // Summary
  const ok = results.filter(r => r.ok)
  if (ok.length === 0) {
    console.log("\n  All calls failed.")
    continue
  }

  const times = ok.map(r => r.ms)
  const avg = times.reduce((s, t) => s + t, 0) / times.length
  const first3 = times.slice(0, 3)
  const last3 = times.slice(-3)
  const first3Avg = first3.reduce((s, t) => s + t, 0) / first3.length
  const last3Avg = last3.reduce((s, t) => s + t, 0) / last3.length

  console.log(`\n  Summary (${shape}):`)
  console.log(`    Total calls: ${ok.length}/${results.length} ok`)
  console.log(`    Overall avg: ${avg.toFixed(0)} ms`)
  console.log(`    Min:         ${Math.min(...times).toFixed(0)} ms`)
  console.log(`    Max:         ${Math.max(...times).toFixed(0)} ms`)
  console.log(`    First 3 avg: ${first3Avg.toFixed(0)} ms`)
  console.log(`    Last 3 avg:  ${last3Avg.toFixed(0)} ms`)
  console.log(`    Warm-up:     ${first3Avg > last3Avg ? `${(first3Avg / last3Avg).toFixed(1)}x slower at start` : "no warm-up effect detected"}`)

  // Check for trend
  const firstHalf = times.slice(0, Math.floor(times.length / 2))
  const secondHalf = times.slice(Math.floor(times.length / 2))
  const firstHalfAvg = firstHalf.reduce((s, t) => s + t, 0) / firstHalf.length
  const secondHalfAvg = secondHalf.reduce((s, t) => s + t, 0) / secondHalf.length
  console.log(`    1st half avg: ${firstHalfAvg.toFixed(0)} ms`)
  console.log(`    2nd half avg: ${secondHalfAvg.toFixed(0)} ms`)
}

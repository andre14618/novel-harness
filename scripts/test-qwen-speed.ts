/**
 * Re-test Qwen 3.5 9B (Together AI) raw call latency vs Llama 3.1 8B (Groq).
 * Also compares Together base model vs the howard-tonal-v3 LoRA adapter to see
 * if adapter serving adds overhead on top of the standard tier.
 *
 * Background: on 2026-04-07 we measured Together standard tier at ~13-30s per call
 * for a 9B model — ~50-100x slower than Groq fast tier on the same parameter class.
 * This script re-runs the same kind of small reference-resolver-shaped call to
 * see if the gap has changed, and adds a LoRA variant to check adapter overhead.
 *
 * Usage: bun scripts/test-qwen-speed.ts
 */

const TOGETHER_KEY = process.env.TOGETHER_API_KEY
const GROQ_KEY = process.env.GROQ_API_KEY
if (!TOGETHER_KEY) throw new Error("TOGETHER_API_KEY missing")
if (!GROQ_KEY) throw new Error("GROQ_API_KEY missing")

const SYSTEM = "You are a careful reference resolver. Reply in JSON only."
const USER = `Resolve the following reference from a fantasy novel. Return JSON: { "name": string, "type": "character" | "place" | "item", "description": string }.

Reference: "the old wizard's tower on the cliffs above Stormhold"
`

interface CallResult {
  ok: boolean
  ms: number
  promptTokens?: number
  completionTokens?: number
  contentPreview?: string
  error?: string
}

async function callTogetherQwen9b(): Promise<CallResult> {
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
          { role: "user", content: USER },
        ],
        temperature: 0.3,
        max_tokens: 256,
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
      contentPreview: (json.choices?.[0]?.message?.content ?? "").slice(0, 80),
    }
  } catch (e: any) {
    return { ok: false, ms: performance.now() - t0, error: e.message ?? String(e) }
  }
}

async function callTogetherLoRA(): Promise<CallResult> {
  const t0 = performance.now()
  try {
    const res = await fetch("https://api.together.xyz/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOGETHER_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "andre14618_2c8c/Qwen3.5-9B-howard-tonal-v3-5d040ad5",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: USER },
        ],
        temperature: 0.3,
        max_tokens: 256,
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
      contentPreview: (json.choices?.[0]?.message?.content ?? "").slice(0, 80),
    }
  } catch (e: any) {
    return { ok: false, ms: performance.now() - t0, error: e.message ?? String(e) }
  }
}

async function callGroqLlama8b(): Promise<CallResult> {
  const t0 = performance.now()
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: USER },
        ],
        temperature: 0.3,
        max_tokens: 256,
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
      contentPreview: (json.choices?.[0]?.message?.content ?? "").slice(0, 80),
    }
  } catch (e: any) {
    return { ok: false, ms: performance.now() - t0, error: e.message ?? String(e) }
  }
}

function summarize(label: string, results: CallResult[]) {
  const ok = results.filter((r) => r.ok)
  const avg = ok.length ? ok.reduce((s, r) => s + r.ms, 0) / ok.length : 0
  const min = ok.length ? Math.min(...ok.map((r) => r.ms)) : 0
  const max = ok.length ? Math.max(...ok.map((r) => r.ms)) : 0
  const completions = ok.map((r) => r.completionTokens ?? 0)
  const avgCompletion = completions.length
    ? completions.reduce((s, t) => s + t, 0) / completions.length
    : 0
  const tps = avgCompletion > 0 && avg > 0 ? (avgCompletion / (avg / 1000)).toFixed(1) : "n/a"
  console.log(`\n${label}`)
  console.log(`  ok:      ${ok.length}/${results.length}`)
  console.log(`  avg ms:  ${avg.toFixed(0)}`)
  console.log(`  range:   ${min.toFixed(0)} - ${max.toFixed(0)}`)
  console.log(`  out tok: avg ${avgCompletion.toFixed(0)}`)
  console.log(`  out tps: ${tps}`)
  for (const [i, r] of results.entries()) {
    if (r.ok) {
      console.log(
        `   [${i + 1}] ${r.ms.toFixed(0).padStart(6)} ms | in ${r.promptTokens} out ${r.completionTokens} | ${r.contentPreview}`,
      )
    } else {
      console.log(`   [${i + 1}] FAIL ${r.ms.toFixed(0)} ms | ${r.error}`)
    }
  }
}

const N = 3

console.log(`Running ${N} calls per provider, sequentially...`)

console.log("\n--- Together AI / Qwen 3.5 9B (base) ---")
const togetherResults: CallResult[] = []
for (let i = 0; i < N; i++) {
  process.stdout.write(`  call ${i + 1}/${N}... `)
  const r = await callTogetherQwen9b()
  console.log(r.ok ? `${r.ms.toFixed(0)} ms` : `FAIL ${r.error}`)
  togetherResults.push(r)
}

console.log("\n--- Together AI / howard-tonal-v3 LoRA ---")
const loraResults: CallResult[] = []
for (let i = 0; i < N; i++) {
  process.stdout.write(`  call ${i + 1}/${N}... `)
  const r = await callTogetherLoRA()
  console.log(r.ok ? `${r.ms.toFixed(0)} ms` : `FAIL ${r.error}`)
  loraResults.push(r)
}

console.log("\n--- Groq / Llama 3.1 8B Instant ---")
const groqResults: CallResult[] = []
for (let i = 0; i < N; i++) {
  process.stdout.write(`  call ${i + 1}/${N}... `)
  const r = await callGroqLlama8b()
  console.log(r.ok ? `${r.ms.toFixed(0)} ms` : `FAIL ${r.error}`)
  groqResults.push(r)
}

summarize("Together AI / Qwen 3.5 9B (base)", togetherResults)
summarize("Together AI / howard-tonal-v3 LoRA", loraResults)
summarize("Groq / Llama 3.1 8B Instant", groqResults)

const avg = (results: CallResult[]) =>
  results.filter((r) => r.ok).reduce((s, r) => s + r.ms, 0) /
  Math.max(1, results.filter((r) => r.ok).length)

const tAvg = avg(togetherResults)
const lAvg = avg(loraResults)
const gAvg = avg(groqResults)

if (tAvg > 0 && lAvg > 0)
  console.log(`\nLoRA vs base (Together): ${(lAvg / tAvg).toFixed(2)}x  (${lAvg > tAvg ? "LoRA slower" : "LoRA faster"})`)
if (tAvg > 0 && gAvg > 0)
  console.log(`Together base / Groq = ${(tAvg / gAvg).toFixed(1)}x slower`)

/**
 * Test whether Qwen3-30B-A3B-Instruct-2507 is running in thinking mode by default on W&B,
 * and whether /no_think reduces latency meaningfully.
 * Usage: bun scripts/test-30b-thinking.ts
 */

const KEY = process.env.WANDB_API_KEY
if (!KEY) throw new Error("WANDB_API_KEY missing")

const URL = "https://api.inference.wandb.ai/v1/chat/completions"
const MODEL = "Qwen/Qwen3-30B-A3B-Instruct-2507"

const SYSTEM = "You check if prose follows a scene beat specification. Be strict but fair."
const USER_BASE = `Beat: "Elena confronts Marcus about the betrayal in the manor library. The conversation escalates."
Setting: "Ashveil Manor library"
Characters expected: Elena, Marcus
Prose:
---
The library was silent. Elena stood at the edge of the carpet.
"You knew," she said. Marcus turned from the window. "Elena—"
"You knew about the letters. You burned them." Her voice cracked.
---
Did the prose execute the beat? Return JSON: { "pass": true/false, "deviations": [] }`

async function call(label: string, userMsg: string) {
  const t0 = performance.now()
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userMsg }],
      temperature: 0.3,
      max_tokens: 512,
    }),
  })
  const ms = Math.round(performance.now() - t0)
  const j: any = await res.json()
  const content: string = j.choices?.[0]?.message?.content ?? ""
  const hasThink = content.includes("<think>")
  console.log(`[${label}] ${ms}ms | in=${j.usage?.prompt_tokens} out=${j.usage?.completion_tokens} | hasThink=${hasThink}`)
  console.log(`  ${content.slice(0, 200).replace(/\n/g, " ")}`)
}

console.log(`Model: ${MODEL}`)
console.log(`3 rounds: think vs no_think (sequential so we can compare cleanly)\n`)

for (let i = 1; i <= 3; i++) {
  console.log(`--- round ${i} ---`)
  await call("think   ", USER_BASE)
  await call("no_think", USER_BASE + " /no_think")
}

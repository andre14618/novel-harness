/**
 * Three-way generation on held-out val set.
 *   A — 14B LoRA (W&B Inference, archetype-poc-v1 artifact)
 *   B — DeepSeek V3.2 with the same profile prompt
 *   C — Claude Sonnet 4.6 via OpenRouter (same prompt)
 *
 * Input:  sft-val.jsonl (100 held-out rows)
 * Output: generations.jsonl — { id, char, user_prompt, reference, A, B, C }
 */

import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

const HERE = new URL(".", import.meta.url).pathname
const IN   = join(HERE, "sft-val.jsonl")
const OUT  = join(HERE, "generations.jsonl")

const LORA_MODEL = "wandb-artifact:///andre14618-/novel-harness/archetype-poc-v1"
const CONCURRENCY = 8

interface ChatMsg { role: string; content: string }
interface SftRow { messages: ChatMsg[] }

async function callOpenAICompat(url: string, apiKey: string, model: string, system: string, user: string, temperature = 0.7, maxTokens = 200): Promise<string> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature,
      max_tokens: maxTokens,
    }),
  })
  if (!resp.ok) throw new Error(`${model} ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
  const json = await resp.json() as any
  return (json.choices?.[0]?.message?.content ?? "").trim().replace(/^["']|["']$/g, "").trim()
}

async function runOneRow(row: SftRow, idx: number) {
  const system = row.messages[0].content
  const user   = row.messages[1].content
  const ref    = row.messages[2].content

  const charMatch = user.match(/CHARACTER:\s*(\S+)/)
  const char = charMatch ? charMatch[1] : "?"

  const WANDB_KEY = process.env.WANDB_API_KEY!
  const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY!
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!

  const [A, B, C] = await Promise.all([
    callOpenAICompat("https://api.inference.wandb.ai/v1/chat/completions", WANDB_KEY, LORA_MODEL, system, user).catch(e => `ERROR: ${e.message}`),
    callOpenAICompat("https://api.deepseek.com/v1/chat/completions", DEEPSEEK_KEY, "deepseek-chat", system, user).catch(e => `ERROR: ${e.message}`),
    callOpenAICompat("https://openrouter.ai/api/v1/chat/completions", OPENROUTER_KEY, "anthropic/claude-sonnet-4.6", system, user).catch(e => `ERROR: ${e.message}`),
  ])

  return { id: idx, char, user_prompt: user, reference: ref, A, B, C }
}

async function runWithConcurrency<T, R>(items: T[], worker: (t: T, i: number) => Promise<R>, n: number): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  async function runner() {
    while (next < items.length) {
      const i = next++
      out[i] = await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: n }, runner))
  return out
}

async function main() {
  const rows: SftRow[] = readFileSync(IN, "utf8").trim().split("\n").map(l => JSON.parse(l))
  console.log(`${rows.length} held-out val pairs — running A=LoRA, B=DeepSeek, C=Sonnet (concurrency=${CONCURRENCY})`)

  const started = Date.now()
  let done = 0
  const results = await runWithConcurrency(rows, async (r, i) => {
    const res = await runOneRow(r, i)
    done++
    if (done % 10 === 0) console.log(`  ${done}/${rows.length}`)
    return res
  }, CONCURRENCY)

  writeFileSync(OUT, results.map(r => JSON.stringify(r)).join("\n") + "\n")

  const errA = results.filter(r => (r.A as string).startsWith("ERROR")).length
  const errB = results.filter(r => (r.B as string).startsWith("ERROR")).length
  const errC = results.filter(r => (r.C as string).startsWith("ERROR")).length
  const elapsed = Math.round((Date.now() - started) / 1000)
  console.log(`\n✓ ${results.length} rows in ${elapsed}s. Errors — A:${errA} B:${errB} C:${errC}`)
  console.log(`Output → ${OUT}`)

  console.log(`\nSample row 0 (${results[0].char}):`)
  console.log(`  reference: ${results[0].reference}`)
  console.log(`  A (LoRA) : ${(results[0].A as string).slice(0, 120)}`)
  console.log(`  B (DS)   : ${(results[0].B as string).slice(0, 120)}`)
  console.log(`  C (Son)  : ${(results[0].C as string).slice(0, 120)}`)
}

main()

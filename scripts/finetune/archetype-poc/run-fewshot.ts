/**
 * Few-shot generation comparison on held-out val subset.
 *   A — archetype-poc-v1 LoRA, profile only (baseline from POC)
 *   B — DeepSeek V3.2 + profile + 5 few-shot example lines
 *   D — archetype-poc-v1 LoRA + profile + 5 few-shot example lines
 *
 * Answers the reframed question: is there a cheap config that lands
 * voice well enough without Sonnet?
 */

import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

const HERE = new URL(".", import.meta.url).pathname
const VAL  = join(HERE, "sft-val.jsonl")
const FEW  = join(HERE, "fewshot-examples.json")
const OUT  = join(HERE, "generations-fewshot.jsonl")

const LORA_MODEL = "wandb-artifact:///andre14618-/novel-harness/archetype-poc-v1"
const VAL_SUBSET = 30
const CONCURRENCY = 8

interface ChatMsg { role: string; content: string }
interface SftRow { messages: ChatMsg[] }

async function call(url: string, apiKey: string, model: string, system: string, user: string, temperature = 0.7, maxTokens = 200): Promise<string> {
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

function buildFewShotUser(baseUser: string, char: string, examples: string[]): string {
  const charKey = char === "DRIZZT" ? "Drizzt"
                : char === "BRUENOR" ? "Bruenor"
                : char === "WULFGAR" ? "Wulfgar"
                : char === "REGIS" ? "Regis"
                : char === "CATTI-BRIE" ? "Catti-brie"
                : char
  const exampleBlock = examples.slice(0, 5).map((e, i) => `  ${i + 1}. ${e}`).join("\n")

  // Inject examples right before "FLAT DIALOGUE LINE:" section
  return baseUser.replace(
    "FLAT DIALOGUE LINE:",
    `EXAMPLE VOICED LINES FROM ${charKey.toUpperCase()}:\n${exampleBlock}\n\nFLAT DIALOGUE LINE:`
  )
}

async function runRow(row: SftRow, idx: number, fewshot: Record<string, string[]>) {
  const system = row.messages[0].content
  const user   = row.messages[1].content
  const ref    = row.messages[2].content

  const m = user.match(/CHARACTER:\s*(\S+)/)
  const charTag = m ? m[1] : "?"
  const charKey = charTag === "DRIZZT" ? "Drizzt"
                : charTag === "BRUENOR" ? "Bruenor"
                : charTag === "WULFGAR" ? "Wulfgar"
                : charTag === "REGIS" ? "Regis"
                : charTag === "CATTI-BRIE" ? "Catti-brie"
                : charTag
  const examples = fewshot[charKey] ?? []
  const userFewShot = buildFewShotUser(user, charTag, examples)

  const WANDB_KEY = process.env.WANDB_API_KEY!
  const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY!

  const [A, B, D] = await Promise.all([
    call("https://api.inference.wandb.ai/v1/chat/completions", WANDB_KEY, LORA_MODEL, system, user).catch(e => `ERROR: ${e.message}`),
    call("https://api.deepseek.com/v1/chat/completions", DEEPSEEK_KEY, "deepseek-chat", system, userFewShot).catch(e => `ERROR: ${e.message}`),
    call("https://api.inference.wandb.ai/v1/chat/completions", WANDB_KEY, LORA_MODEL, system, userFewShot).catch(e => `ERROR: ${e.message}`),
  ])

  return { id: idx, char: charTag, user_prompt: user, user_fewshot: userFewShot, reference: ref, A, B, D }
}

async function main() {
  const allVal: SftRow[] = readFileSync(VAL, "utf8").trim().split("\n").map(l => JSON.parse(l))
  const fewshot = JSON.parse(readFileSync(FEW, "utf8")) as Record<string, string[]>

  // Deterministic subset: first N rows (stratified would be nicer but the val set is already stratified)
  const rows = allVal.slice(0, VAL_SUBSET)
  console.log(`${rows.length} val rows — A=LoRA profile-only, B=DS+fewshot, D=LoRA+fewshot (concurrency=${CONCURRENCY})`)

  const started = Date.now()
  const results: any[] = new Array(rows.length)
  let next = 0, done = 0
  async function runner() {
    while (next < rows.length) {
      const i = next++
      results[i] = await runRow(rows[i], i, fewshot)
      done++
      if (done % 5 === 0) console.log(`  ${done}/${rows.length}`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, runner))

  writeFileSync(OUT, results.map(r => JSON.stringify(r)).join("\n") + "\n")

  const errA = results.filter(r => r.A.startsWith("ERROR")).length
  const errB = results.filter(r => r.B.startsWith("ERROR")).length
  const errD = results.filter(r => r.D.startsWith("ERROR")).length
  const elapsed = Math.round((Date.now() - started) / 1000)
  console.log(`\n✓ ${results.length} rows in ${elapsed}s. Errors — A:${errA} B:${errB} D:${errD}`)
  console.log(`Output → ${OUT}`)

  console.log(`\nSample row 0 (${results[0].char}):`)
  console.log(`  reference: ${results[0].reference}`)
  console.log(`  A LoRA    : ${results[0].A}`)
  console.log(`  B DS+few  : ${results[0].B}`)
  console.log(`  D LoRA+few: ${results[0].D}`)
}

main()

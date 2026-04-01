/**
 * Generate side-by-side prose samples from two models for human comparison.
 * Writes output to benchmark/prose/comparison-output.md
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { extractJSON } from "../../src/llm"
import { MODELS, PROVIDERS, getApiKey } from "../../models/registry"

const WRITER_PROMPT = readFileSync(new URL("../../src/agents/writer/prompt.md", import.meta.url).pathname, "utf-8")
const SEEDS_DIR = new URL("../../src/seeds", import.meta.url).pathname

function loadSeed(name: string) {
  const seed = JSON.parse(readFileSync(`${SEEDS_DIR}/${name}.json`, "utf-8"))
  return `CHAPTER 1: "Opening"
POV Character: ${seed.characters[0].name}
Setting: The primary location
Purpose: Establish the protagonist, introduce the world, hint at the central conflict
Target: ~1000 words

SCENE BEATS (follow in order):
1. The protagonist is shown in their current situation, revealing their state through action and environment.
   Characters: ${seed.characters[0].name}
   Emotional shift: stasis -> unease

2. An interruption forces the protagonist to engage with the outside world. New information arrives.
   Characters: ${seed.characters.map((c: any) => c.name).slice(0, 2).join(", ")}
   Emotional shift: suspicion -> dread

3. The protagonist processes the new information alone. The central tension is established.
   Characters: ${seed.characters[0].name}
   Emotional shift: disbelief -> resolve

CHARACTER PROFILES:
${seed.characters.map((c: any) => `${c.name} (${c.role}): ${c.description}`).join("\n")}

Genre: ${seed.genre}
Premise: ${seed.premise}`
}

function resolveModel(id: string, provider: string) {
  const m = MODELS.find(m => m.id === id && m.provider === provider)!
  const p = PROVIDERS[m.provider]
  return { label: m.label, id: m.id, apiUrl: p.apiUrl, apiKey: getApiKey(m.provider), extraBody: p.extraBody?.(), needsNothink: m.needsNothink }
}

async function generate(model: ReturnType<typeof resolveModel>, prompt: string): Promise<string | null> {
  const userMsg = model.needsNothink ? `/nothink\n${prompt}` : prompt
  const res = await fetch(model.apiUrl, {
    method: "POST",
    headers: { "Authorization": `Bearer ${model.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model.id,
      messages: [{ role: "system", content: WRITER_PROMPT }, { role: "user", content: userMsg }],
      temperature: 0.8, max_tokens: 16384,
      response_format: { type: "json_object" },
      ...model.extraBody,
    }),
  })
  if (!res.ok) return null
  const data = await res.json() as any
  const content = data.choices?.[0]?.message?.content
  if (!content) return null
  try { return JSON.parse(extractJSON(content)).prose } catch { return null }
}

async function main() {
  const qwen = resolveModel("qwen/qwen3-32b", "groq")
  const kimi = resolveModel("moonshotai/kimi-k2-instruct-0905", "groq")

  const seeds = ["dark-fantasy", "romance-drama"]
  let output = "# Prose Comparison: Qwen3 32B vs Kimi K2\n\n"

  for (const seedName of seeds) {
    const prompt = loadSeed(seedName)
    console.log(`Generating ${seedName}...`)

    const [qwenProse, kimiProse] = await Promise.all([
      generate(qwen, prompt),
      generate(kimi, prompt),
    ])

    output += `## ${seedName}\n\n`
    output += `### Qwen3 32B\n\n${qwenProse?.replace(/\\n/g, "\n") ?? "FAIL"}\n\n`
    output += `### Kimi K2\n\n${kimiProse?.replace(/\\n/g, "\n") ?? "FAIL"}\n\n`
    output += "---\n\n"
  }

  writeFileSync(new URL("./comparison-output.md", import.meta.url).pathname, output)
  console.log("Written to benchmark/prose/comparison-output.md")
}

main()

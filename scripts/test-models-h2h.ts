import { z } from "zod"
import { worldBibleSchema, characterProfilesSchema, chapterDraftSchema } from "../src/types"
import { WORLD_BUILDER_PROMPT, CHARACTER_AGENT_PROMPT, WRITER_AGENT_PROMPT } from "../src/prompts"
import { extractJSON } from "../src/llm"

const API_URL = "https://openrouter.ai/api/v1/chat/completions"
const API_KEY = process.env.OPENROUTER_API_KEY
if (!API_KEY) { console.error("OPENROUTER_API_KEY not set"); process.exit(1) }

const MODELS = [
  { id: "qwen/qwen3-32b", label: "Qwen3 32B", provider: "Groq" },
  { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout", provider: "Groq" },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B", provider: "Groq" },
]

interface Result {
  model: string
  label: string
  test: string
  passed: boolean
  totalTime: number
  promptTokens: number
  completionTokens: number
  tokensPerSec: number
  jsonValid: boolean
  zodValid: boolean
  prose?: string
  error?: string
}

async function callModel(
  modelId: string,
  provider: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
): Promise<{ content: string; usage: { prompt_tokens: number; completion_tokens: number }; totalTime: number }> {
  const start = performance.now()
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      provider: { order: [provider], allow_fallbacks: false },
    }),
  })
  const totalTime = performance.now() - start

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  }

  const data = await res.json() as any
  if (data.error) throw new Error(`API: ${JSON.stringify(data.error).slice(0, 300)}`)

  return {
    content: data.choices[0].message.content,
    usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0 },
    totalTime,
  }
}

async function runTest(
  model: typeof MODELS[0],
  testName: string,
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodSchema,
  temp: number,
  maxTokens: number,
): Promise<Result> {
  try {
    const { content, usage, totalTime } = await callModel(model.id, model.provider, systemPrompt, userPrompt, temp, maxTokens)
    const tps = usage.completion_tokens > 0 ? Math.round(usage.completion_tokens / (totalTime / 1000)) : 0

    let jsonStr: string
    let jsonValid = false
    try { jsonStr = extractJSON(content); jsonValid = true } catch {
      return { model: model.id, label: model.label, test: testName, passed: false, totalTime, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, tokensPerSec: tps, jsonValid: false, zodValid: false, error: `JSON extraction failed: ${content.slice(0, 100)}` }
    }

    const parsed = JSON.parse(jsonStr)
    const zodResult = schema.safeParse(parsed)
    const prose = parsed.prose as string | undefined

    return {
      model: model.id, label: model.label, test: testName,
      passed: zodResult.success, totalTime,
      promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens,
      tokensPerSec: tps, jsonValid: true, zodValid: zodResult.success,
      prose,
      error: zodResult.success ? undefined : `Zod: ${zodResult.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    }
  } catch (err) {
    return { model: model.id, label: model.label, test: testName, passed: false, totalTime: 0, promptTokens: 0, completionTokens: 0, tokensPerSec: 0, jsonValid: false, zodValid: false, error: `${err instanceof Error ? err.message : err}`.slice(0, 200) }
  }
}

// ── Prompts ─────────────────────────────────────────────────────────────────

const SEED_PROMPT = `Genre: epic fantasy

Premise: In a crumbling desert city, a disgraced general discovers the empire she served is built on a lie. Now she must choose between exposing the truth — which could collapse the empire — or burying it to protect the people she still loves.

Characters:
- Kael (protagonist): Disgraced general, sharp mind, bitter tongue. Exiled to the frontier after questioning the emperor's orders.
- Rina (antagonist): The empire's spymaster who knows the founding lie and will kill to keep it hidden. Former comrade of Kael.
- Davan (supporting): A young archivist who accidentally uncovered the documents that started everything. Idealistic, terrified, in over his head.

Create a detailed world bible for this story. Make the world feel specific and lived-in.`

const CHAR_PROMPT = SEED_PROMPT.replace("Create a detailed world bible", "Develop these character sketches into full profiles. Ensure each character has a unique voice and clear motivations. Create relationships between them.")

const PROSE_PROMPT = `CHAPTER 1: "The Weight of Sand"
POV Character: Kael
Setting: The Frontier Outpost
Purpose: Establish Kael's exile, introduce the world, hint at the central mystery
Target: ~1500 words

SCENE BEATS (follow in order):
1. Kael patrols the crumbling walls of the frontier outpost at dawn, observing the corrosive desert and reflecting on her fall from grace.
   Characters: Kael
   Emotional shift: resignation → unease

2. A young soldier reports an incoming rider — unexpected, since supply runs aren't due for weeks. Kael recognizes the seal on the messenger's satchel as belonging to the Imperial Archive.
   Characters: Kael, Soldier, Messenger
   Emotional shift: suspicion → dread

3. Kael reads the message alone: Davan, a name she doesn't recognize, claims to have found documents that prove the empire's founding myth is fabricated. He's coming to the frontier. He's being hunted.
   Characters: Kael
   Emotional shift: disbelief → old loyalty stirring

CHARACTER PROFILES:
Kael (protagonist):
  Speech pattern: Clipped military cadence, dry humor masking pain, avoids emotional language, speaks in declaratives
  Traits: strategic thinker, bitter, loyal despite herself, haunted by the siege of Vashar
  Goals: survive exile, find meaning after disgrace
  Fears: that her sacrifice at Vashar was for nothing, that the empire she bled for deserves to fall

WORLD RULES:
- The empire controls water distribution through the Aqueduct Authority as political leverage
- Military rank is permanently branded on the forearm — Kael's brand marks her as a former Commander
- The desert storms carry corrosive sand that eats stone over decades — architecture must be constantly maintained
- The frontier outpost sits at the empire's edge, a posting reserved for the disgraced and forgotten

SETTING DETAILS:
The Frontier Outpost: A crumbling stone fort on the empire's eastern edge. Walls pitted by decades of corrosive sand. Skeleton garrison of 30 soldiers, most of them disciplinary cases. Water rations are deliberately kept low — a reminder of the capital's control.`

const tests = [
  { name: "world-bible", system: WORLD_BUILDER_PROMPT, user: SEED_PROMPT, schema: worldBibleSchema, temp: 0.7, maxTokens: 4096 },
  { name: "characters", system: CHARACTER_AGENT_PROMPT, user: CHAR_PROMPT, schema: characterProfilesSchema, temp: 0.7, maxTokens: 4096 },
  { name: "prose", system: WRITER_AGENT_PROMPT, user: PROSE_PROMPT, schema: chapterDraftSchema, temp: 0.8, maxTokens: 8192 },
]

// ── Prose quality heuristics ────────────────────────────────────────────────

function analyzeProseQuality(prose: string): Record<string, string | number> {
  const words = prose.split(/\s+/).filter(Boolean)
  const wordCount = words.length
  const paragraphs = prose.split(/\n\s*\n/).filter(p => p.trim().length > 0)
  const dialogueLines = prose.split("\n").filter(l => /"/.test(l))
  const sensoryWords = prose.match(/\b(smell|taste|sound|feel|touch|hear|see|saw|felt|warm|cold|rough|smooth|bitter|bright|dim|shadow|echo|whisper|roar|sting|ache)\b/gi) ?? []
  const sentences = prose.split(/[.!?]+/).filter(s => s.trim().length > 5)
  const avgSentenceLen = sentences.length > 0 ? Math.round(words.length / sentences.length) : 0

  // Named character mentions
  const kaelMentions = (prose.match(/\bKael\b/g) ?? []).length
  const rinaMentions = (prose.match(/\bRina\b/g) ?? []).length
  const davanMentions = (prose.match(/\bDavan\b/g) ?? []).length

  return {
    wordCount,
    paragraphs: paragraphs.length,
    dialogueLines: dialogueLines.length,
    sensoryWords: sensoryWords.length,
    avgSentenceLen,
    kaelMentions,
    rinaMentions,
    davanMentions,
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────

async function main() {
  const results: Result[] = []

  for (const model of MODELS) {
    console.log(`\n${"═".repeat(70)}`)
    console.log(`  ${model.label}  (${model.id} via ${model.provider})`)
    console.log("═".repeat(70))

    for (const t of tests) {
      process.stdout.write(`  ${t.name}... `)
      const r = await runTest(model, t.name, t.system, t.user, t.schema, t.temp, t.maxTokens)
      results.push(r)

      const status = r.passed ? "PASS" : "FAIL"
      console.log(`${status}  ${(r.totalTime / 1000).toFixed(1)}s  ${r.tokensPerSec} tok/s  json=${r.jsonValid} zod=${r.zodValid}${r.error ? `  err=${r.error.slice(0, 60)}` : ""}`)
    }
  }

  // ── Speed comparison ────────────────────────────────────────────────────

  console.log(`\n${"═".repeat(70)}`)
  console.log("  SPEED COMPARISON")
  console.log("═".repeat(70))

  const header = "Model               world-bible     characters      prose           avg tok/s"
  console.log(`\n${header}`)
  console.log("─".repeat(header.length))

  for (const model of MODELS) {
    const mr = results.filter(r => r.label === model.label)
    const wb = mr.find(r => r.test === "world-bible")
    const ch = mr.find(r => r.test === "characters")
    const pr = mr.find(r => r.test === "prose")
    const avgTps = Math.round(mr.reduce((s, r) => s + r.tokensPerSec, 0) / mr.length)

    const fmt = (r: Result | undefined) => r ? `${(r.totalTime / 1000).toFixed(1)}s ${r.tokensPerSec}t/s` : "FAIL"
    console.log(`${model.label.padEnd(20)} ${fmt(wb).padEnd(16)} ${fmt(ch).padEnd(16)} ${fmt(pr).padEnd(16)} ${avgTps}`)
  }

  // ── Prose quality comparison ────────────────────────────────────────────

  console.log(`\n${"═".repeat(70)}`)
  console.log("  PROSE QUALITY ANALYSIS")
  console.log("═".repeat(70))

  const proseResults = results.filter(r => r.test === "prose" && r.prose)

  for (const r of proseResults) {
    const q = analyzeProseQuality(r.prose!)
    console.log(`\n  ${r.label}:`)
    console.log(`    Words: ${q.wordCount}  Paragraphs: ${q.paragraphs}  Dialogue lines: ${q.dialogueLines}`)
    console.log(`    Sensory words: ${q.sensoryWords}  Avg sentence length: ${q.avgSentenceLen} words`)
    console.log(`    Character mentions — Kael: ${q.kaelMentions}  Rina: ${q.rinaMentions}  Davan: ${q.davanMentions}`)
  }

  // ── Save prose samples for manual review ────────────────────────────────

  const outDir = "output/model-comparison"
  await Bun.write(`${outDir}/.gitkeep`, "")

  for (const r of proseResults) {
    const slug = r.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    const q = analyzeProseQuality(r.prose!)
    const header = `# ${r.label} — Prose Sample
# ${r.tokensPerSec} tok/s | ${(r.totalTime / 1000).toFixed(1)}s | ${q.wordCount} words
# JSON: ${r.jsonValid} | Zod: ${r.zodValid}
# Sensory words: ${q.sensoryWords} | Dialogue lines: ${q.dialogueLines} | Avg sentence: ${q.avgSentenceLen}w

`
    await Bun.write(`${outDir}/${slug}-prose.md`, header + r.prose!)
    console.log(`\n  Saved: ${outDir}/${slug}-prose.md`)
  }

  // ── Verdict ─────────────────────────────────────────────────────────────

  console.log(`\n${"═".repeat(70)}`)
  console.log("  VERDICT")
  console.log("═".repeat(70))

  const allPassed = results.filter(r => r.passed)
  const allFailed = results.filter(r => !r.passed)

  for (const model of MODELS) {
    const mr = results.filter(r => r.label === model.label)
    const passed = mr.filter(r => r.passed).length
    const avgTps = Math.round(mr.reduce((s, r) => s + r.tokensPerSec, 0) / mr.length)
    const avgTime = (mr.reduce((s, r) => s + r.totalTime, 0) / mr.length / 1000).toFixed(1)
    const proseR = mr.find(r => r.test === "prose")
    const proseWords = proseR?.prose ? proseR.prose.split(/\s+/).length : 0
    console.log(`\n  ${model.label}: ${passed}/3 passed | avg ${avgTps} tok/s | avg ${avgTime}s | prose: ${proseWords} words`)
  }

  console.log(`\n  Review prose samples in ${outDir}/ to compare writing quality.`)
}

main()

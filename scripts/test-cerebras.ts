import { z } from "zod"
import { worldBibleSchema, characterProfilesSchema, chapterDraftSchema } from "../src/types"
import { WORLD_BUILDER_PROMPT, CHARACTER_AGENT_PROMPT, WRITER_AGENT_PROMPT } from "../src/prompts"
import { extractJSON } from "../src/llm"

const CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions"
const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY
const GROQ_API_URL = "https://openrouter.ai/api/v1/chat/completions"
const GROQ_KEY = process.env.OPENROUTER_API_KEY

if (!CEREBRAS_KEY) { console.error("CEREBRAS_API_KEY not set. Get one at console.cerebras.ai"); process.exit(1) }
if (!GROQ_KEY) { console.error("OPENROUTER_API_KEY not set"); process.exit(1) }

interface ModelConfig {
  label: string
  apiUrl: string
  apiKey: string
  model: string
  extraBody?: Record<string, any>
}

const MODELS: ModelConfig[] = [
  {
    label: "Qwen3 32B (Groq)",
    apiUrl: GROQ_API_URL,
    apiKey: GROQ_KEY,
    model: "qwen/qwen3-32b",
    extraBody: { provider: { order: ["Groq"], allow_fallbacks: false } },
  },
  {
    label: "Qwen3 235B-A22B (Cerebras)",
    apiUrl: CEREBRAS_API_URL,
    apiKey: CEREBRAS_KEY,
    model: "qwen-3-235b-a22b-instruct-2507",
  },
]

interface Result {
  label: string
  test: string
  passed: boolean
  totalTime: number
  tokensPerSec: number
  completionTokens: number
  jsonValid: boolean
  zodValid: boolean
  prose?: string
  error?: string
}

const PROSE_PROMPT = `CHAPTER 1: "The Weight of Sand"
POV Character: Kael
Setting: The Frontier Outpost
Purpose: Establish Kael's exile, introduce the world, hint at the central mystery
Target: ~1000 words

SCENE BEATS (follow in order):
1. Kael patrols the crumbling walls of the frontier outpost at dawn, observing the corrosive desert and reflecting on her fall from grace.
   Characters: Kael
   Emotional shift: resignation -> unease

2. A young soldier reports an incoming rider -- unexpected, since supply runs are not due for weeks. Kael recognizes the seal on the messenger satchel as belonging to the Imperial Archive.
   Characters: Kael, Soldier, Messenger
   Emotional shift: suspicion -> dread

3. Kael reads the message alone: Davan, a name she does not recognize, claims to have found documents that prove the empire founding myth is fabricated. He is coming to the frontier. He is being hunted.
   Characters: Kael
   Emotional shift: disbelief -> old loyalty stirring

CHARACTER PROFILES:
Kael (protagonist):
  Speech pattern: Clipped military cadence, dry humor masking pain, avoids emotional language, speaks in declaratives
  Traits: strategic thinker, bitter, loyal despite herself, haunted by the siege of Vashar
  Goals: survive exile, find meaning after disgrace
  Fears: that her sacrifice at Vashar was for nothing, that the empire she bled for deserves to fall

WORLD RULES:
- The empire controls water distribution through the Aqueduct Authority as political leverage
- Military rank is permanently branded on the forearm -- Kael brand marks her as a former Commander
- The desert storms carry corrosive sand that eats stone over decades
- The frontier outpost sits at the empire edge, a posting reserved for the disgraced and forgotten

SETTING DETAILS:
The Frontier Outpost: A crumbling stone fort on the empire eastern edge. Walls pitted by decades of corrosive sand. Skeleton garrison of 30 soldiers, most of them disciplinary cases. Water rations are deliberately kept low -- a reminder of the capital control.`

const SEED = `Genre: epic fantasy

Premise: In a crumbling desert city, a disgraced general discovers the empire she served is built on a lie.

Characters:
- Kael (protagonist): Disgraced general, sharp mind, bitter tongue
- Rina (antagonist): Empire spymaster, former comrade
- Davan (supporting): Young archivist, idealistic, terrified`

const tests = [
  { name: "world-bible", system: WORLD_BUILDER_PROMPT, user: SEED + "\n\nCreate a detailed world bible for this story.", schema: worldBibleSchema, temp: 0.7, max: 8192 },
  { name: "characters", system: CHARACTER_AGENT_PROMPT, user: SEED + "\n\nDevelop these character sketches into full profiles.", schema: characterProfilesSchema, temp: 0.7, max: 8192 },
  { name: "prose", system: WRITER_AGENT_PROMPT, user: PROSE_PROMPT, schema: chapterDraftSchema, temp: 0.8, max: 16384 },
]

async function runTest(cfg: ModelConfig, testName: string, systemPrompt: string, userPrompt: string, schema: z.ZodSchema, temp: number, maxTokens: number): Promise<Result> {
  const start = performance.now()
  try {
    // Prepend /nothink for Groq Qwen3 (Cerebras model doesn't support thinking anyway)
    const finalUserPrompt = cfg.label.includes("Groq") ? `/nothink\n${userPrompt}` : userPrompt

    const body: any = {
      model: cfg.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: finalUserPrompt },
      ],
      temperature: temp,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      ...cfg.extraBody,
    }

    const res = await fetch(cfg.apiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    const elapsed = performance.now() - start
    if (!res.ok) {
      const text = await res.text()
      return { label: cfg.label, test: testName, passed: false, totalTime: elapsed, tokensPerSec: 0, completionTokens: 0, jsonValid: false, zodValid: false, error: `HTTP ${res.status}: ${text.slice(0, 150)}` }
    }

    const data = await res.json() as any
    if (data.error) {
      return { label: cfg.label, test: testName, passed: false, totalTime: elapsed, tokensPerSec: 0, completionTokens: 0, jsonValid: false, zodValid: false, error: `API: ${JSON.stringify(data.error).slice(0, 150)}` }
    }

    const content = data.choices[0].message.content
    const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 }
    const tps = Math.round(usage.completion_tokens / (elapsed / 1000))

    let jsonStr: string
    try { jsonStr = extractJSON(content) } catch {
      return { label: cfg.label, test: testName, passed: false, totalTime: elapsed, tokensPerSec: tps, completionTokens: usage.completion_tokens, jsonValid: false, zodValid: false, error: `JSON extract failed: ${content.slice(0, 80)}` }
    }

    const parsed = JSON.parse(jsonStr)
    const zodResult = schema.safeParse(parsed)

    return {
      label: cfg.label, test: testName,
      passed: zodResult.success, totalTime: elapsed,
      tokensPerSec: tps, completionTokens: usage.completion_tokens,
      jsonValid: true, zodValid: zodResult.success,
      prose: parsed.prose,
      error: zodResult.success ? undefined : `Zod: ${zodResult.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 100)}`,
    }
  } catch (err) {
    return { label: cfg.label, test: testName, passed: false, totalTime: performance.now() - start, tokensPerSec: 0, completionTokens: 0, jsonValid: false, zodValid: false, error: `${err instanceof Error ? err.message : err}`.slice(0, 150) }
  }
}

function analyzeProseQuality(prose: string): Record<string, number> {
  const words = prose.split(/\s+/).filter(Boolean)
  const sentences = prose.split(/[.!?]+/).filter(s => s.trim().length > 5)
  const dialogueLines = prose.split("\n").filter(l => /"/.test(l))
  const sensory = (prose.match(/\b(smell|taste|sound|feel|touch|hear|see|saw|felt|warm|cold|rough|smooth|bitter|bright|dim|shadow|echo|whisper|roar|sting|ache|grit|dust|heat|wind)\b/gi) ?? [])
  const firstPersonOutsideDialogue = (prose.replace(/"[^"]*"/g, "").match(/\bI\b/g) ?? [])

  return {
    wordCount: words.length,
    paragraphs: prose.split(/\n\s*\n/).filter(p => p.trim()).length,
    dialogueLines: dialogueLines.length,
    sensoryWords: sensory.length,
    avgSentenceLen: sentences.length > 0 ? Math.round(words.length / sentences.length) : 0,
    firstPersonViolations: firstPersonOutsideDialogue.length,
  }
}

async function main() {
  const results: Result[] = []

  for (const model of MODELS) {
    console.log(`\n${"=".repeat(70)}`)
    console.log(`  ${model.label}`)
    console.log("=".repeat(70))

    for (const t of tests) {
      process.stdout.write(`  ${t.name}... `)
      const r = await runTest(model, t.name, t.system, t.user, t.schema, t.temp, t.max)
      results.push(r)
      const status = r.passed ? "PASS" : "FAIL"
      console.log(`${status}  ${(r.totalTime / 1000).toFixed(1)}s  ${r.tokensPerSec} tok/s  ${r.completionTokens} tokens${r.error ? `  err=${r.error.slice(0, 60)}` : ""}`)
    }
  }

  // Speed comparison
  console.log(`\n${"=".repeat(70)}`)
  console.log("  SPEED COMPARISON")
  console.log("=".repeat(70))

  for (const model of MODELS) {
    const mr = results.filter(r => r.label === model.label)
    const avgTps = Math.round(mr.filter(r => r.tokensPerSec > 0).reduce((s, r) => s + r.tokensPerSec, 0) / Math.max(1, mr.filter(r => r.tokensPerSec > 0).length))
    const avgTime = (mr.reduce((s, r) => s + r.totalTime, 0) / mr.length / 1000).toFixed(1)
    const passed = mr.filter(r => r.passed).length
    console.log(`\n  ${model.label}: ${passed}/${mr.length} passed | avg ${avgTps} tok/s | avg ${avgTime}s`)
  }

  // Prose comparison
  console.log(`\n${"=".repeat(70)}`)
  console.log("  PROSE QUALITY")
  console.log("=".repeat(70))

  const proseResults = results.filter(r => r.test === "prose" && r.prose)
  for (const r of proseResults) {
    const q = analyzeProseQuality(r.prose!)
    console.log(`\n  ${r.label}:`)
    console.log(`    Words: ${q.wordCount} | Paragraphs: ${q.paragraphs} | Dialogue: ${q.dialogueLines} lines`)
    console.log(`    Sensory words: ${q.sensoryWords} | Avg sentence: ${q.avgSentenceLen}w | 1st-person violations: ${q.firstPersonViolations}`)

    const slug = r.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    await Bun.write(`output/model-comparison/${slug}-prose.md`, `# ${r.label} — Prose Sample\n# ${r.tokensPerSec} tok/s | ${(r.totalTime / 1000).toFixed(1)}s | ${q.wordCount} words\n\n${r.prose}`)
    console.log(`    Saved: output/model-comparison/${slug}-prose.md`)
  }
}

main()

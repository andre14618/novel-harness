import { z } from "zod"
import { worldBibleSchema, characterProfilesSchema, chapterDraftSchema } from "../src/types"
import { WORLD_BUILDER_PROMPT, WRITER_AGENT_PROMPT } from "../src/prompts"
import { extractJSON } from "../src/llm"

const API_URL = "https://openrouter.ai/api/v1/chat/completions"
const CURRENT_MODEL = process.env.MODEL ?? "stepfun/step-3.5-flash:free"
const TEST_MODEL = "qwen/qwen3-32b"
const TEST_PROVIDER = "Groq"  // route through Groq for fast inference

const API_KEY = process.env.OPENROUTER_API_KEY
if (!API_KEY) {
  console.error("OPENROUTER_API_KEY not set")
  process.exit(1)
}

interface TestResult {
  model: string
  test: string
  passed: boolean
  ttfb: number        // time to first byte (ms)
  totalTime: number   // total request time (ms)
  promptTokens: number
  completionTokens: number
  tokensPerSec: number
  jsonValid: boolean
  zodValid: boolean
  error?: string
}

async function runTest(
  model: string,
  testName: string,
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodSchema,
  temperature: number,
  maxTokens: number,
  provider?: string,
): Promise<TestResult> {
  const startTime = performance.now()
  let ttfb = 0

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        ...(provider ? { provider: { order: [provider], allow_fallbacks: false } } : {}),
      }),
    })

    ttfb = performance.now() - startTime

    if (!res.ok) {
      const text = await res.text()
      return {
        model, test: testName, passed: false,
        ttfb, totalTime: performance.now() - startTime,
        promptTokens: 0, completionTokens: 0, tokensPerSec: 0,
        jsonValid: false, zodValid: false,
        error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
      }
    }

    const data = await res.json() as any
    const totalTime = performance.now() - startTime

    if (data.error) {
      return {
        model, test: testName, passed: false,
        ttfb, totalTime,
        promptTokens: 0, completionTokens: 0, tokensPerSec: 0,
        jsonValid: false, zodValid: false,
        error: `API error: ${JSON.stringify(data.error).slice(0, 200)}`,
      }
    }

    const content = data.choices?.[0]?.message?.content ?? ""
    const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 }
    const completionTokens = usage.completion_tokens
    const elapsedSec = totalTime / 1000
    const tokensPerSec = completionTokens > 0 ? Math.round(completionTokens / elapsedSec) : 0

    // Test 1: Can we extract valid JSON?
    let jsonStr: string
    let jsonValid = false
    try {
      jsonStr = extractJSON(content)
      JSON.parse(jsonStr) // double-check
      jsonValid = true
    } catch {
      return {
        model, test: testName, passed: false,
        ttfb, totalTime,
        promptTokens: usage.prompt_tokens, completionTokens, tokensPerSec,
        jsonValid: false, zodValid: false,
        error: `JSON extraction failed. Raw start: ${content.slice(0, 150)}`,
      }
    }

    // Test 2: Does it pass Zod validation?
    const parsed = JSON.parse(jsonStr)
    const zodResult = schema.safeParse(parsed)

    return {
      model, test: testName,
      passed: zodResult.success,
      ttfb, totalTime,
      promptTokens: usage.prompt_tokens,
      completionTokens,
      tokensPerSec,
      jsonValid: true,
      zodValid: zodResult.success,
      error: zodResult.success ? undefined : `Zod: ${zodResult.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    }
  } catch (err) {
    return {
      model, test: testName, passed: false,
      ttfb, totalTime: performance.now() - startTime,
      promptTokens: 0, completionTokens: 0, tokensPerSec: 0,
      jsonValid: false, zodValid: false,
      error: `Exception: ${err instanceof Error ? err.message : err}`,
    }
  }
}

// ── Test definitions ────────────────────────────────────────────────────────

const SEED_PROMPT = `Genre: epic fantasy

Premise: In a crumbling desert city, a disgraced general discovers the empire she served is built on a lie.

Characters:
- Kael (protagonist): Disgraced general, sharp mind, bitter tongue
- Rina (antagonist): Empire's spymaster, former comrade
- Davan (supporting): Young archivist, idealistic, terrified

Create a detailed world bible for this story. Make the world feel specific and lived-in.`

const PROSE_PROMPT = `CHAPTER 1: "The Weight of Sand"
POV Character: Kael
Setting: The Frontier Outpost
Purpose: Establish Kael's exile, introduce the world, seed the central mystery
Target: ~500 words

SCENE BEATS (follow in order):
1. Kael patrols the crumbling walls of the outpost at dawn
   Characters: Kael
   Emotional shift: resignation → unease

2. A messenger arrives with a sealed archive cylinder from the capital
   Characters: Kael, Messenger
   Emotional shift: suspicion → dread

CHARACTER PROFILES:
Kael (protagonist):
  Speech pattern: Clipped military cadence, dry humor, avoids emotional words
  Traits: strategic thinker, bitter, loyal despite herself
  Goals: survive exile, find meaning
  Fears: that her sacrifice was for nothing

WORLD RULES:
- The empire controls water distribution as political leverage
- Military rank is permanently branded on the forearm
- The desert storms carry corrosive sand that eats stone`

const tests: Array<{
  name: string
  systemPrompt: string
  userPrompt: string
  schema: z.ZodSchema
  temp: number
  maxTokens: number
}> = [
  {
    name: "world-bible",
    systemPrompt: WORLD_BUILDER_PROMPT,
    userPrompt: SEED_PROMPT,
    schema: worldBibleSchema,
    temp: 0.7,
    maxTokens: 4096,
  },
  {
    name: "character-profiles",
    systemPrompt: `You are a character development specialist. Respond with ONLY valid JSON: {"characters": [{"id": "char_name", "name": "Name", "role": "protagonist", "backstory": "...", "traits": ["t1","t2"], "speechPattern": "...", "goals": "...", "fears": "...", "relationships": [{"characterName": "Other", "nature": "..."}]}]}`,
    userPrompt: SEED_PROMPT.replace("Create a detailed world bible", "Develop these character sketches into full profiles"),
    schema: characterProfilesSchema,
    temp: 0.7,
    maxTokens: 4096,
  },
  {
    name: "prose-draft",
    systemPrompt: WRITER_AGENT_PROMPT,
    userPrompt: PROSE_PROMPT,
    schema: chapterDraftSchema,
    temp: 0.8,
    maxTokens: 4096,
  },
]

// ── Run ─────────────────────────────────────────────────────────────────────

async function main() {
  const models = [CURRENT_MODEL, TEST_MODEL]
  const results: TestResult[] = []

  for (const model of models) {
    console.log(`\n${"═".repeat(60)}`)
    console.log(`  MODEL: ${model}`)
    console.log("═".repeat(60))

    for (const t of tests) {
      process.stdout.write(`  ${t.name}... `)
      const provider = model === TEST_MODEL ? TEST_PROVIDER : undefined
      const result = await runTest(model, t.name, t.systemPrompt, t.userPrompt, t.schema, t.temp, t.maxTokens, provider)
      results.push(result)

      const status = result.passed ? "PASS" : "FAIL"
      console.log(`${status}  ${result.totalTime.toFixed(0)}ms  ${result.tokensPerSec} tok/s  json=${result.jsonValid} zod=${result.zodValid}${result.error ? `  err=${result.error.slice(0, 80)}` : ""}`)
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log(`\n${"═".repeat(60)}`)
  console.log("  COMPARISON SUMMARY")
  console.log("═".repeat(60))
  console.log()

  const header = "Test             Model                              Time     Tok/s  JSON  Zod   Status"
  console.log(header)
  console.log("─".repeat(header.length))

  for (const r of results) {
    const test = r.test.padEnd(16)
    const model = r.model.padEnd(34)
    const time = `${(r.totalTime / 1000).toFixed(1)}s`.padStart(6)
    const tps = `${r.tokensPerSec}`.padStart(6)
    const json = r.jsonValid ? "  Y " : "  N "
    const zod = r.zodValid ? "  Y " : "  N "
    const status = r.passed ? " PASS" : " FAIL"
    console.log(`${test} ${model} ${time} ${tps} ${json} ${zod} ${status}`)
  }

  // Speed comparison
  const currentResults = results.filter(r => r.model === CURRENT_MODEL)
  const testResults = results.filter(r => r.model === TEST_MODEL)

  if (currentResults.length > 0 && testResults.length > 0) {
    const avgCurrentTps = currentResults.reduce((s, r) => s + r.tokensPerSec, 0) / currentResults.length
    const avgTestTps = testResults.reduce((s, r) => s + r.tokensPerSec, 0) / testResults.length
    const avgCurrentTime = currentResults.reduce((s, r) => s + r.totalTime, 0) / currentResults.length
    const avgTestTime = testResults.reduce((s, r) => s + r.totalTime, 0) / testResults.length
    const speedup = avgCurrentTime / avgTestTime

    console.log()
    console.log(`  ${CURRENT_MODEL}:  avg ${avgCurrentTps.toFixed(0)} tok/s  ${(avgCurrentTime / 1000).toFixed(1)}s`)
    console.log(`  ${TEST_MODEL}:  avg ${avgTestTps.toFixed(0)} tok/s  ${(avgTestTime / 1000).toFixed(1)}s`)
    console.log(`  Speedup: ${speedup.toFixed(1)}x ${speedup > 1 ? "faster" : "slower"}`)
  }

  // Exit code based on test model results
  const testPassed = testResults.every(r => r.passed)
  if (!testPassed) {
    console.log(`\n  ⚠ ${TEST_MODEL} failed one or more tests`)
    process.exit(1)
  } else {
    console.log(`\n  ${TEST_MODEL} passed all tests`)
  }
}

main()

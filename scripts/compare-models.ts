import { z } from "zod"
import { worldBibleSchema, characterProfilesSchema, chapterDraftSchema } from "../src/types"
import { WORLD_BUILDER_PROMPT, CHARACTER_AGENT_PROMPT, WRITER_AGENT_PROMPT } from "../src/prompts"
import { extractJSON } from "../src/llm"

// ── Types ─────────────────────────────────────────────────────────────────

interface ModelConfig {
  label: string
  apiUrl: string
  apiKey: string
  model: string
  extraBody?: Record<string, any>
  needsNothink?: boolean
}

interface TestScenario {
  name: string
  systemPrompt: string
  userPrompt: string
  schema: z.ZodSchema
  temperature: number
  maxTokens: number
}

interface TestResult {
  label: string
  scenario: string
  passed: boolean
  totalLatencyMs: number
  tokensPerSec: number
  promptTokens: number
  completionTokens: number
  jsonValid: boolean
  zodValid: boolean
  zodErrors: string[]
  httpAttempts: number
  prose?: string
  error?: string
}

interface ProseMetrics {
  wordCount: number
  paragraphs: number
  dialogueLines: number
  sensoryWords: number
  avgSentenceLen: number
  firstPersonOutsideDialogue: number
  kaelMentions: number
}

interface JudgeVerdict {
  judge: string
  modelA: string
  modelB: string
  scores: {
    A: Record<string, number>
    B: Record<string, number>
  }
  reasoning: string
  winner: string
}

// ── Model Registry ────────────────────────────────────────────────────────

function buildModelRegistry(): ModelConfig[] {
  const models: ModelConfig[] = []

  if (process.env.CEREBRAS_API_KEY) {
    models.push({
      label: "Cerebras Qwen3 235B-A22B",
      apiUrl: "https://api.cerebras.ai/v1/chat/completions",
      apiKey: process.env.CEREBRAS_API_KEY,
      model: "qwen-3-235b-a22b-instruct-2507",
    })
  }

  if (process.env.GROQ_API_KEY) {
    models.push({
      label: "Groq Qwen3 32B",
      apiUrl: "https://api.groq.com/openai/v1/chat/completions",
      apiKey: process.env.GROQ_API_KEY,
      model: "qwen/qwen3-32b",
      needsNothink: true,
    })
  }

  if (process.env.OPENROUTER_API_KEY) {
    models.push({
      label: "OpenRouter Qwen3 32B (Groq)",
      apiUrl: "https://openrouter.ai/api/v1/chat/completions",
      apiKey: process.env.OPENROUTER_API_KEY,
      model: "qwen/qwen3-32b",
      extraBody: { provider: { order: ["Groq"], allow_fallbacks: false } },
      needsNothink: true,
    })
  }

  return models
}

// ── Test Scenarios ────────────────────────────────────────────────────────

const SEED_PROMPT = `Genre: epic fantasy

Premise: In a crumbling desert city, a disgraced general discovers the empire she served is built on a lie. Now she must choose between exposing the truth or burying it to protect the people she still loves.

Characters:
- Kael (protagonist): Disgraced general, sharp mind, bitter tongue. Exiled to the frontier after questioning the emperor's orders.
- Rina (antagonist): The empire's spymaster who knows the founding lie and will kill to keep it hidden. Former comrade of Kael.
- Davan (supporting): A young archivist who accidentally uncovered the documents that started everything. Idealistic, terrified, in over his head.`

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

const SCENARIOS: TestScenario[] = [
  {
    name: "world-bible",
    systemPrompt: WORLD_BUILDER_PROMPT,
    userPrompt: SEED_PROMPT + "\n\nCreate a detailed world bible for this story. Make the world feel specific and lived-in.",
    schema: worldBibleSchema,
    temperature: 0.7,
    maxTokens: 8192,
  },
  {
    name: "characters",
    systemPrompt: CHARACTER_AGENT_PROMPT,
    userPrompt: SEED_PROMPT + "\n\nDevelop these character sketches into full profiles. Ensure each character has a unique voice and clear motivations. Create relationships between them.",
    schema: characterProfilesSchema,
    temperature: 0.7,
    maxTokens: 8192,
  },
  {
    name: "prose",
    systemPrompt: WRITER_AGENT_PROMPT,
    userPrompt: PROSE_PROMPT,
    schema: chapterDraftSchema,
    temperature: 0.8,
    maxTokens: 16384,
  },
]

// ── Test Runner ───────────────────────────────────────────────────────────

async function runScenario(model: ModelConfig, scenario: TestScenario): Promise<TestResult> {
  const start = performance.now()
  let httpAttempts = 0

  const userPrompt = model.needsNothink ? `/nothink\n${scenario.userPrompt}` : scenario.userPrompt

  try {
    // Single attempt with one retry on 429
    for (let attempt = 0; attempt <= 1; attempt++) {
      httpAttempts++
      const res = await fetch(model.apiUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${model.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.model,
          messages: [
            { role: "system", content: scenario.systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: scenario.temperature,
          max_tokens: scenario.maxTokens,
          response_format: { type: "json_object" },
          ...model.extraBody,
        }),
      })

      if (res.status === 429 && attempt === 0) {
        console.log(`    429 — waiting 10s...`)
        await Bun.sleep(10000)
        continue
      }

      if (!res.ok) {
        const text = await res.text()
        return fail(`HTTP ${res.status}: ${text.slice(0, 120)}`)
      }

      const data = await res.json() as any
      if (data.error) return fail(`API: ${JSON.stringify(data.error).slice(0, 120)}`)

      const content = data.choices[0].message.content
      const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 }
      const elapsed = performance.now() - start
      const tps = Math.round(usage.completion_tokens / (elapsed / 1000))

      // JSON extraction
      let jsonStr: string
      try {
        jsonStr = extractJSON(content)
      } catch {
        return fail(`JSON extraction failed. Preview: ${content.slice(0, 80)}`, usage, elapsed)
      }

      // Zod validation
      const parsed = JSON.parse(jsonStr)
      const zodResult = scenario.schema.safeParse(parsed)
      const zodErrors = zodResult.success ? [] : zodResult.error.issues.map(i => `${i.path.join(".")}: ${i.message}`)

      return {
        label: model.label,
        scenario: scenario.name,
        passed: zodResult.success,
        totalLatencyMs: Math.round(elapsed),
        tokensPerSec: tps,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        jsonValid: true,
        zodValid: zodResult.success,
        zodErrors,
        httpAttempts,
        prose: parsed.prose,
        error: zodResult.success ? undefined : `Zod: ${zodErrors.slice(0, 2).join("; ")}`,
      }
    }
    return fail("Max retries exceeded")
  } catch (err) {
    return fail(`${err instanceof Error ? err.message : err}`.slice(0, 150))
  }

  function fail(error: string, usage?: any, elapsed?: number): TestResult {
    return {
      label: model.label, scenario: scenario.name, passed: false,
      totalLatencyMs: Math.round(elapsed ?? performance.now() - start),
      tokensPerSec: 0, promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      jsonValid: false, zodValid: false, zodErrors: [], httpAttempts, error,
    }
  }
}

// ── Prose Quality Heuristics ──────────────────────────────────────────────

function analyzeProseQuality(prose: string): ProseMetrics {
  const words = prose.split(/\s+/).filter(Boolean)
  const sentences = prose.split(/[.!?]+/).filter(s => s.trim().length > 5)
  const paragraphs = prose.split(/\n\s*\n/).filter(p => p.trim().length > 0)

  // Dialogue: count quoted speech instances (not lines, since prose may lack newlines)
  const dialogueMatches = prose.match(/"[^"]{2,}"/g) ?? []
  const dialogueLines = dialogueMatches.length
  // Fallback: also check for single-quoted dialogue
  const singleQuoteDialogue = prose.match(/'[^']{10,}'/g) ?? []

  const sensoryPattern = /\b(smell|taste|sound|feel|touch|hear|see|saw|felt|warm|cold|rough|smooth|bitter|bright|dim|shadow|echo|whisper|roar|sting|ache|grit|dust|heat|wind|crunch|hiss|crack|rust|salt|dry|damp)\b/gi
  const sensoryWords = (prose.match(sensoryPattern) ?? [])

  // First-person outside dialogue
  const nonDialogue = prose.replace(/"[^"]*"/g, "").replace(/\*[^*]*\*/g, "")
  const firstPerson = (nonDialogue.match(/\bI\b/g) ?? [])

  return {
    wordCount: words.length,
    paragraphs: paragraphs.length,
    dialogueLines: dialogueLines + singleQuoteDialogue.length,
    sensoryWords: sensoryWords.length,
    avgSentenceLen: sentences.length > 0 ? Math.round(words.length / sentences.length) : 0,
    firstPersonOutsideDialogue: firstPerson.length,
    kaelMentions: (prose.match(/\bKael\b/g) ?? []).length,
  }
}

// ── LLM-as-Judge ──────────────────────────────────────────────────────────

const judgeSchema = z.object({
  scores: z.object({
    sampleA: z.object({
      showDontTell: z.number().min(1).max(10),
      dialogueQuality: z.number().min(1).max(10),
      voiceConsistency: z.number().min(1).max(10),
      beatAdherence: z.number().min(1).max(10),
      sensoryDetail: z.number().min(1).max(10),
    }),
    sampleB: z.object({
      showDontTell: z.number().min(1).max(10),
      dialogueQuality: z.number().min(1).max(10),
      voiceConsistency: z.number().min(1).max(10),
      beatAdherence: z.number().min(1).max(10),
      sensoryDetail: z.number().min(1).max(10),
    }),
  }),
  reasoning: z.string(),
  winner: z.enum(["A", "B", "tie"]),
})

const JUDGE_PROMPT = `You are a literary critic evaluating two prose samples written from the same prompt. Score each sample on 5 dimensions from 1-10:

1. **Show Don't Tell** (1-3: heavy exposition dumps, 4-6: mixed, 7-8: mostly shown through action/dialogue, 9-10: masterful subtlety)
2. **Dialogue Quality** (1-3: stilted/absent, 4-6: functional, 7-8: distinctive voices, 9-10: each character unmistakable)
3. **Voice Consistency** (1-3: generic/shifting, 4-6: mostly consistent, 7-8: strong POV voice, 9-10: immersive and distinctive)
4. **Beat Adherence** (1-3: misses beats, 4-6: hits most, 7-8: all beats with natural flow, 9-10: beats feel inevitable)
5. **Sensory Detail** (1-3: abstract/vague, 4-6: some concrete detail, 7-8: vivid world, 9-10: you can taste the dust)

Respond with ONLY valid JSON:
{
  "scores": {
    "sampleA": { "showDontTell": N, "dialogueQuality": N, "voiceConsistency": N, "beatAdherence": N, "sensoryDetail": N },
    "sampleB": { "showDontTell": N, "dialogueQuality": N, "voiceConsistency": N, "beatAdherence": N, "sensoryDetail": N }
  },
  "reasoning": "2-3 sentence explanation of key differences",
  "winner": "A" or "B" or "tie"
}

Score independently. Do not let one dimension bias another. Be harsh — reserve 9-10 for genuinely exceptional writing.`

interface JudgeConfig {
  label: string
  apiUrl: string
  apiKey: string
  model: string
  extraBody?: Record<string, any>
}

function buildJudgeRegistry(): JudgeConfig[] {
  const judges: JudgeConfig[] = []

  if (process.env.OPENAI_API_KEY) {
    judges.push({
      label: "GPT-5.4",
      apiUrl: "https://api.openai.com/v1/chat/completions",
      apiKey: process.env.OPENAI_API_KEY,
      model: "gpt-5.4",
    })
  }

  if (process.env.CEREBRAS_API_KEY) {
    judges.push({
      label: "Cerebras Qwen3 235B",
      apiUrl: "https://api.cerebras.ai/v1/chat/completions",
      apiKey: process.env.CEREBRAS_API_KEY,
      model: "qwen-3-235b-a22b-instruct-2507",
    })
  }

  return judges
}

async function runJudge(
  judge: JudgeConfig,
  proseA: string, labelA: string,
  proseB: string, labelB: string,
): Promise<JudgeVerdict | null> {
  const userPrompt = `SAMPLE A:\n${proseA}\n\n---\n\nSAMPLE B:\n${proseB}\n\nScore both samples.`

  try {
    const res = await fetch(judge.apiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${judge.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: judge.model,
        messages: [
          { role: "system", content: JUDGE_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        ...(judge.model.startsWith("gpt-5") ? { max_completion_tokens: 2048 } : { max_tokens: 2048 }),
        response_format: { type: "json_object" },
        ...judge.extraBody,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.log(`FAIL (HTTP ${res.status}: ${text.slice(0, 80)})`)
      return null
    }

    const data = await res.json() as any
    const content = data.choices[0].message.content
    const jsonStr = extractJSON(content)
    const parsed = JSON.parse(jsonStr)
    const result = judgeSchema.safeParse(parsed)

    if (!result.success) {
      console.log(`FAIL (Zod: ${result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 80)})`)
      return null
    }

    return {
      judge: judge.label,
      modelA: labelA,
      modelB: labelB,
      scores: {
        A: result.data.scores.sampleA,
        B: result.data.scores.sampleB,
      },
      reasoning: result.data.reasoning,
      winner: result.data.winner === "A" ? labelA : result.data.winner === "B" ? labelB : "tie",
    }
  } catch (err) {
    console.log(`FAIL (${err instanceof Error ? err.message : err})`)
    return null
  }
}

// ── Report ────────────────────────────────────────────────────────────────

function printReport(results: TestResult[], proseMetrics: Map<string, ProseMetrics>, verdicts: JudgeVerdict[]) {
  console.log(`\n${"=".repeat(80)}`)
  console.log("  SPEED & VALIDITY")
  console.log("=".repeat(80))

  const header = "Model                          Scenario       Time    Tok/s  Tokens  JSON  Zod"
  console.log(`\n${header}`)
  console.log("-".repeat(header.length))

  for (const r of results) {
    const label = r.label.padEnd(30)
    const scenario = r.scenario.padEnd(14)
    const time = `${(r.totalLatencyMs / 1000).toFixed(1)}s`.padStart(6)
    const tps = `${r.tokensPerSec}`.padStart(6)
    const tokens = `${r.completionTokens}`.padStart(7)
    const json = r.jsonValid ? "  Y " : "  N "
    const zod = r.zodValid ? "  Y " : "  N "
    const err = r.error ? `  ${r.error.slice(0, 40)}` : ""
    console.log(`${label} ${scenario} ${time} ${tps} ${tokens} ${json} ${zod}${err}`)
  }

  // Prose heuristics
  if (proseMetrics.size > 0) {
    console.log(`\n${"=".repeat(80)}`)
    console.log("  PROSE HEURISTICS")
    console.log("=".repeat(80))

    const pHeader = "Model                          Words  Paras  Dialog  Sensory  AvgSent  1stPrsn  Kael"
    console.log(`\n${pHeader}`)
    console.log("-".repeat(pHeader.length))

    for (const [label, m] of proseMetrics) {
      const l = label.padEnd(30)
      console.log(`${l} ${`${m.wordCount}`.padStart(5)}  ${`${m.paragraphs}`.padStart(5)}  ${`${m.dialogueLines}`.padStart(6)}  ${`${m.sensoryWords}`.padStart(7)}  ${`${m.avgSentenceLen}`.padStart(7)}  ${`${m.firstPersonOutsideDialogue}`.padStart(7)}  ${`${m.kaelMentions}`.padStart(4)}`)
    }
  }

  // Judge verdicts
  if (verdicts.length > 0) {
    console.log(`\n${"=".repeat(80)}`)
    console.log("  LLM JUDGE VERDICTS")
    console.log("=".repeat(80))

    for (const v of verdicts) {
      console.log(`\n  [Judge: ${v.judge}] ${v.modelA} vs ${v.modelB}`)

      const dims = ["showDontTell", "dialogueQuality", "voiceConsistency", "beatAdherence", "sensoryDetail"]
      const dimLabels = ["Show/Tell", "Dialogue", "Voice", "Beats", "Sensory"]
      console.log(`    ${"Dimension".padEnd(12)} ${"A".padStart(3)} ${"B".padStart(3)}`)
      console.log(`    ${"-".repeat(20)}`)

      let totalA = 0, totalB = 0
      for (let i = 0; i < dims.length; i++) {
        const a = (v.scores.A as any)[dims[i]]
        const b = (v.scores.B as any)[dims[i]]
        totalA += a
        totalB += b
        console.log(`    ${dimLabels[i].padEnd(12)} ${`${a}`.padStart(3)} ${`${b}`.padStart(3)}`)
      }
      console.log(`    ${"TOTAL".padEnd(12)} ${`${totalA}`.padStart(3)} ${`${totalB}`.padStart(3)}`)
      console.log(`    Winner: ${v.winner}`)
      console.log(`    ${v.reasoning}`)
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const skipJudge = process.argv.includes("--skip-judge")
  const models = buildModelRegistry()

  if (models.length === 0) {
    console.error("No API keys found. Set CEREBRAS_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY in .env")
    process.exit(1)
  }

  console.log(`\nComparing ${models.length} provider(s): ${models.map(m => m.label).join(", ")}`)
  console.log(`Scenarios: ${SCENARIOS.map(s => s.name).join(", ")}`)
  if (skipJudge) console.log("LLM judge: skipped (--skip-judge)")
  console.log()

  const results: TestResult[] = []
  const proseByModel = new Map<string, string>()
  const proseMetrics = new Map<string, ProseMetrics>()

  // Run all scenarios
  for (const model of models) {
    console.log(`${"=".repeat(60)}`)
    console.log(`  ${model.label}`)
    console.log("=".repeat(60))

    for (const scenario of SCENARIOS) {
      process.stdout.write(`  ${scenario.name}... `)
      const result = await runScenario(model, scenario)
      results.push(result)

      const status = result.passed ? "PASS" : "FAIL"
      console.log(`${status}  ${(result.totalLatencyMs / 1000).toFixed(1)}s  ${result.tokensPerSec} tok/s  ${result.completionTokens} tokens${result.error ? `  ${result.error.slice(0, 50)}` : ""}`)

      if (scenario.name === "prose" && result.prose) {
        proseByModel.set(model.label, result.prose)
        proseMetrics.set(model.label, analyzeProseQuality(result.prose))

        const slug = model.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")
        await Bun.write(`output/model-comparison/${slug}-prose.md`,
          `# ${model.label}\n# ${result.tokensPerSec} tok/s | ${(result.totalLatencyMs / 1000).toFixed(1)}s | ${result.completionTokens} tokens\n\n${result.prose}`)
      }
    }
    console.log()
  }

  // LLM-as-judge — each judge evaluates each pair independently
  const verdicts: JudgeVerdict[] = []
  const judges = buildJudgeRegistry()

  if (!skipJudge && proseByModel.size >= 2 && judges.length > 0) {
    console.log("=".repeat(60))
    console.log(`  LLM-AS-JUDGE EVALUATION (${judges.map(j => j.label).join(", ")})`)
    console.log("=".repeat(60))

    const entries = [...proseByModel.entries()]
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [labelA, proseA] = entries[i]
        const [labelB, proseB] = entries[j]

        for (const judge of judges) {
          process.stdout.write(`  [${judge.label}] ${labelA} vs ${labelB}... `)
          const verdict = await runJudge(judge, proseA, labelA, proseB, labelB)
          if (verdict) {
            verdicts.push(verdict)
            console.log(`Winner: ${verdict.winner}`)
          }
        }
      }
    }
    console.log()
  } else if (!skipJudge && judges.length === 0) {
    console.log("\n  No judge API keys found (set OPENAI_API_KEY or CEREBRAS_API_KEY)")
  }

  // Print report
  printReport(results, proseMetrics, verdicts)

  // Save results
  await Bun.write("output/model-comparison/results.jsonl",
    results.map(r => JSON.stringify(r)).join("\n") + "\n")
  if (verdicts.length > 0) {
    await Bun.write("output/model-comparison/judge-verdicts.jsonl",
      verdicts.map(v => JSON.stringify(v)).join("\n") + "\n")
  }

  console.log(`\nArtifacts saved to output/model-comparison/`)
}

main()

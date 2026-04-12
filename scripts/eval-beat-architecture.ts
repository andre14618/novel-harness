/**
 * Beat Architecture Evaluation
 *
 * Tests 9 conditions: 3 granularities × 3 beat description styles
 * Measures prose features directly — NOT checker pass rates.
 *
 * Granularities: current (3 beats), medium (5-6 beats), fine (8-10 beats)
 * Styles: screenplay (current), dramatic, goal-conflict
 *
 * Usage:
 *   NOVEL_ID=novel-xxx CHAPTER=2 bun scripts/eval-beat-architecture.ts
 *
 * Outputs to stdout + saves to tuning_experiments.
 */

import db from "../data/connection"
import {
  getNovel, getChapterOutline, getCharacters,
  getCharacterStatesAtChapter, getWorldBible,
} from "../src/db"
import { buildBeatContext } from "../src/agents/writer/beat-context"
import { resolveReferences } from "../src/agents/writer/reference-resolver"
import { BEAT_WRITER_PROMPT } from "../src/prompts"
import { executeAndLog } from "../src/llm"
import { getModelForAgent } from "../models/roles"
import { getTransport } from "../src/transport"
import { createTuningExperiment, concludeExperiment } from "../data/db"

// ── Config ──────────────────────────────────────────────────────────────

// Use the latest novel by default, or override
const NOVEL_ID = process.env.NOVEL_ID
const CHAPTER = parseInt(process.env.CHAPTER ?? "2")

type Style = "screenplay" | "dramatic" | "goal-conflict"
type Granularity = "current" | "medium" | "fine"

interface BeatSpec {
  description: string
  characters: string[]
  emotionalShift: string
}

interface Condition {
  style: Style
  granularity: Granularity
  label: string
  beats: BeatSpec[]
}

interface ProseFeatures {
  wordCount: number
  dialogueWordPct: number
  interiorityPer100w: number
  actionPer100w: number
  avgSentLen: number
  sentLenCV: number
  specEcho: number           // N-gram overlap between beat descriptions and prose
  avgParaWords: number
  paragraphs: number
}

interface SeamResult {
  totalBoundaries: number
  detectedBoundaries: number
  boundaryDetectionRate: number
  falseBreaks: number
}

interface ConditionResult {
  condition: string
  style: Style
  granularity: Granularity
  beatCount: number
  beatProses: string[]
  assembledProse: string
  features: ProseFeatures
  seam: SeamResult
  totalLatencyMs: number
  totalTokens: { prompt: number; completion: number }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  // Find the novel
  let novelId = NOVEL_ID
  if (!novelId) {
    const [latest] = await db`
      SELECT id FROM novels WHERE phase = 'done' ORDER BY created_at DESC LIMIT 1
    `
    if (!latest) { console.error("No completed novels found"); process.exit(1) }
    novelId = latest.id
  }

  console.log(`\n=== Beat Architecture Evaluation ===`)
  console.log(`Novel: ${novelId}  Chapter: ${CHAPTER}\n`)

  // Create experiment
  const expId = await createTuningExperiment(
    "beat-architecture",
    `Beat architecture eval: 3 granularities × 3 styles on ${novelId} ch${CHAPTER}`,
    { novelId, chapter: CHAPTER, conditions: 9 },
    { target: "beat-writer", dimension: "prose-quality" },
  )
  console.log(`Experiment #${expId}\n`)

  // Load shared data
  const outline = await getChapterOutline(novelId, CHAPTER)
  const characters = await getCharacters(novelId)
  const charStates = await getCharacterStatesAtChapter(novelId, CHAPTER)
  const worldBible = await getWorldBible(novelId)
  const originalBeats: BeatSpec[] = outline.scenes.map((s: any) => ({
    description: s.description,
    characters: s.characters ?? [],
    emotionalShift: s.emotionalShift ?? "",
  }))

  console.log(`Original beats: ${originalBeats.length}`)
  for (const [i, b] of originalBeats.entries()) {
    console.log(`  Beat ${i}: ${b.description.slice(0, 80)}...`)
  }

  // ── Step 1: Generate all 9 beat variant sets ──────────────────────────

  console.log(`\n--- Generating beat variants ---\n`)
  const conditions = await generateAllVariants(originalBeats, outline, novelId)

  // ── Step 2: Run beat writer on each condition ─────────────────────────

  const results: ConditionResult[] = []

  for (const cond of conditions) {
    console.log(`\n--- ${cond.label} (${cond.beats.length} beats) ---`)

    // Create a modified outline with the variant's beats
    const variantOutline = {
      ...outline,
      scenes: cond.beats.map(b => ({
        description: b.description,
        characters: b.characters,
        emotionalShift: b.emotionalShift,
      })),
    }

    const beatProses: string[] = []
    let totalLatencyMs = 0
    let totalPrompt = 0
    let totalCompletion = 0

    // Pre-resolve references for all beats
    const preResolvedRefs = await Promise.all(
      variantOutline.scenes.map((beat: any) =>
        resolveReferences(beat, variantOutline, novelId, CHAPTER, characters)
          .catch(() => ({ context: "", lookupCount: 0, llmUsed: false }))
      )
    )

    for (let bi = 0; bi < cond.beats.length; bi++) {
      const beatCtx = await buildBeatContext({
        novelId, chapterNumber: CHAPTER, beatIndex: bi,
        previousBeatProse: beatProses[bi - 1],
        outline: variantOutline, characters, characterStates: charStates, worldBible,
        preResolvedRefs: preResolvedRefs[bi],
      })

      const beatWriterModel = getModelForAgent("beat-writer")
      const response = await executeAndLog(
        {
          systemPrompt: BEAT_WRITER_PROMPT,
          userPrompt: beatCtx.userPrompt,
          model: beatWriterModel?.model ?? "qwen-3-235b-a22b-instruct-2507",
          provider: beatWriterModel?.provider ?? "cerebras",
          temperature: beatWriterModel?.temperature ?? 0.8,
          maxTokens: beatWriterModel?.maxTokens ?? 4000,
          responseFormat: { type: "text" },
        },
        novelId,
        "beat-arch-eval",
        { chapter: CHAPTER, beatIndex: bi, attempt: 1 },
      )

      const prose = response.content?.trim() ?? ""
      beatProses.push(prose)
      totalLatencyMs += response.latencyMs
      totalPrompt += response.usage.prompt_tokens
      totalCompletion += response.usage.completion_tokens

      const words = prose.split(/\s+/).length
      console.log(`  Beat ${bi}: ${words}w, ${response.latencyMs}ms`)
    }

    const assembledProse = beatProses.join("\n\n")

    // ── Feature extraction ──────────────────────────────────────────────
    const features = extractFeatures(assembledProse, cond.beats)

    // ── Seam blindness test ─────────────────────────────────────────────
    const seam = await seamBlindnessTest(assembledProse, beatProses, novelId)

    results.push({
      condition: cond.label,
      style: cond.style,
      granularity: cond.granularity,
      beatCount: cond.beats.length,
      beatProses,
      assembledProse,
      features,
      seam,
      totalLatencyMs,
      totalTokens: { prompt: totalPrompt, completion: totalCompletion },
    })

    console.log(`  Features: dlg=${features.dialogueWordPct}% int=${features.interiorityPer100w}/100 echo=${features.specEcho} sent=${features.avgSentLen}w`)
    console.log(`  Seam: ${seam.detectedBoundaries}/${seam.totalBoundaries} boundaries detected (${Math.round(seam.boundaryDetectionRate * 100)}%)`)
  }

  // ── Step 3: Results table ─────────────────────────────────────────────

  console.log(`\n\n${"=".repeat(120)}`)
  console.log(`RESULTS`)
  console.log(`${"=".repeat(120)}\n`)

  const header = [
    "Condition".padEnd(25),
    "Beats",
    "Words",
    "Dlg%",
    "Int/100",
    "Act/100",
    "SentLen",
    "SentCV",
    "Echo",
    "Seam%",
    "FalseB",
    "Latency",
  ].join("  ")
  console.log(header)
  console.log("-".repeat(header.length))

  for (const r of results) {
    console.log([
      r.condition.padEnd(25),
      String(r.beatCount).padStart(5),
      String(r.features.wordCount).padStart(5),
      String(r.features.dialogueWordPct).padStart(4),
      String(r.features.interiorityPer100w.toFixed(1)).padStart(7),
      String(r.features.actionPer100w.toFixed(1)).padStart(7),
      String(r.features.avgSentLen.toFixed(1)).padStart(7),
      String(r.features.sentLenCV.toFixed(2)).padStart(6),
      String(r.features.specEcho.toFixed(2)).padStart(5),
      String(Math.round(r.seam.boundaryDetectionRate * 100)).padStart(5),
      String(r.seam.falseBreaks).padStart(6),
      `${Math.round(r.totalLatencyMs)}ms`.padStart(8),
    ].join("  "))
  }

  // ── Step 4: Dimensional analysis ──────────────────────────────────────

  console.log(`\n\n--- By Granularity (averaged across styles) ---`)
  for (const g of ["current", "medium", "fine"] as Granularity[]) {
    const group = results.filter(r => r.granularity === g)
    if (group.length === 0) continue
    const avg = (fn: (r: ConditionResult) => number) =>
      (group.reduce((s, r) => s + fn(r), 0) / group.length).toFixed(1)
    console.log(`  ${g.padEnd(10)} dlg=${avg(r => r.features.dialogueWordPct)}%  int=${avg(r => r.features.interiorityPer100w)}/100  echo=${avg(r => r.features.specEcho)}  seam=${avg(r => r.seam.boundaryDetectionRate * 100)}%`)
  }

  console.log(`\n--- By Style (averaged across granularities) ---`)
  for (const s of ["screenplay", "dramatic", "goal-conflict"] as Style[]) {
    const group = results.filter(r => r.style === s)
    if (group.length === 0) continue
    const avg = (fn: (r: ConditionResult) => number) =>
      (group.reduce((s2, r) => s2 + fn(r), 0) / group.length).toFixed(1)
    console.log(`  ${s.padEnd(15)} dlg=${avg(r => r.features.dialogueWordPct)}%  int=${avg(r => r.features.interiorityPer100w)}/100  echo=${avg(r => r.features.specEcho)}  seam=${avg(r => r.seam.boundaryDetectionRate * 100)}%`)
  }

  // ── Step 5: Save to experiment ────────────────────────────────────────

  const summary = results.map(r => ({
    condition: r.condition,
    style: r.style,
    granularity: r.granularity,
    beatCount: r.beatCount,
    features: r.features,
    seam: r.seam,
    totalLatencyMs: r.totalLatencyMs,
    totalTokens: r.totalTokens,
  }))

  // Save full prose outputs for manual reading
  const proseOutputPath = `/tmp/beat-arch-eval-${expId}.json`
  await Bun.write(proseOutputPath, JSON.stringify({
    experimentId: expId,
    novelId, chapter: CHAPTER,
    results: results.map(r => ({
      condition: r.condition,
      beatCount: r.beatCount,
      beatProses: r.beatProses,
      assembledProse: r.assembledProse,
    })),
  }, null, 2))
  console.log(`\nFull prose saved to ${proseOutputPath}`)

  // Don't auto-conclude — we need to read the prose first
  console.log(`\nExperiment #${expId} created. Read the prose, then conclude manually.`)
  console.log(`Summary:\n${JSON.stringify(summary, null, 2)}`)

  process.exit(0)
}

// ── Variant Generation ──────────────────────────────────────────────────

async function generateAllVariants(
  originalBeats: BeatSpec[],
  outline: any,
  novelId: string,
): Promise<Condition[]> {
  const conditions: Condition[] = []

  // Baseline: screenplay/current
  conditions.push({
    style: "screenplay", granularity: "current",
    label: "screenplay/current",
    beats: originalBeats,
  })

  // Generate the other 8 conditions via LLM
  const beatWriterModel = getModelForAgent("planning-plotter")
  const model = beatWriterModel?.model ?? "qwen-3-235b-a22b-instruct-2507"
  const provider = beatWriterModel?.provider ?? "cerebras"

  const beatsJson = JSON.stringify(originalBeats.map((b, i) => ({
    index: i, description: b.description, characters: b.characters,
  })), null, 2)

  const chapterContext = `Chapter: "${outline.title}"\nPOV: ${outline.povCharacter}\nSetting: ${outline.setting}\nPurpose: ${outline.purpose}`

  // Generate all variants in one structured call to avoid drift
  const variantPrompt = `You are helping with a controlled experiment on beat description styles for a novel writing pipeline.

Here is a chapter's context:
${chapterContext}

Here are the current beats (screenplay style):
${beatsJson}

I need you to create 8 variant beat sets. The narrative content must stay THE SAME — same events, same characters, same story progression. Only the description STYLE and GRANULARITY changes.

## Styles

1. **screenplay** (current) — dense micro-directions with props, spatial details, sensory cues
2. **dramatic** — what happens narratively, stripped of micro-actions. Focus on "what changes" not "what hands do". Example: "Gil discovers the bay is dying and shows Maren the evidence" instead of listing 7 physical actions.
3. **goal-conflict** — each beat framed as character GOAL + OBSTACLE. Example: "Gil wants to prove the water is toxic. Obstacle: the sample degrades in 90 minutes and Halcyon patrols the outflow zone."

## Granularities

1. **current** — same number of beats as original (${originalBeats.length})
2. **medium** — split to 5-6 beats total (finer grain, same total content)
3. **fine** — split to 8-10 beats total (finest grain)

When splitting, each sub-beat must have the correct characters array. emotionalShift can be empty string.

Return ONLY valid JSON in this structure:
{
  "variants": [
    {
      "style": "screenplay",
      "granularity": "medium",
      "beats": [
        { "description": "...", "characters": ["Name1", "Name2"], "emotionalShift": "" }
      ]
    }
  ]
}

Generate these 8 variants (skip screenplay/current since that's the baseline):
1. screenplay/medium
2. screenplay/fine
3. dramatic/current
4. dramatic/medium
5. dramatic/fine
6. goal-conflict/current
7. goal-conflict/medium
8. goal-conflict/fine`

  const response = await getTransport().execute({
    systemPrompt: "You are a story structure specialist. Respond with ONLY valid JSON.",
    userPrompt: variantPrompt,
    model,
    provider,
    temperature: 0.3,
    maxTokens: 8192,
    responseFormat: { type: "json_object" },
  })

  let parsed: any
  try {
    parsed = JSON.parse(response.content)
  } catch {
    // Try extracting JSON
    const match = response.content.match(/\{[\s\S]*\}/)
    if (!match) throw new Error("Failed to parse variant generation response")
    parsed = JSON.parse(match[0])
  }

  for (const v of parsed.variants) {
    conditions.push({
      style: v.style as Style,
      granularity: v.granularity as Granularity,
      label: `${v.style}/${v.granularity}`,
      beats: v.beats.map((b: any) => ({
        description: b.description ?? "",
        characters: b.characters ?? [],
        emotionalShift: b.emotionalShift ?? "",
      })),
    })
  }

  // Verify we got all 9 (1 baseline + 8 generated)
  const labels = conditions.map(c => c.label)
  const expected = [
    "screenplay/current", "screenplay/medium", "screenplay/fine",
    "dramatic/current", "dramatic/medium", "dramatic/fine",
    "goal-conflict/current", "goal-conflict/medium", "goal-conflict/fine",
  ]
  for (const e of expected) {
    if (!labels.includes(e)) {
      console.warn(`  WARNING: Missing variant ${e}`)
    }
  }

  console.log(`Generated ${conditions.length} conditions:`)
  for (const c of conditions) {
    console.log(`  ${c.label}: ${c.beats.length} beats`)
  }

  return conditions
}

// ── Feature Extraction ──────────────────────────────────────────────────

function extractFeatures(prose: string, beats: BeatSpec[]): ProseFeatures {
  const allWords = prose.split(/\s+/).filter(Boolean).length

  // Dialogue % — same regex as analyze-structure.ts
  const doubleQuoteMatches = prose.match(/[""\u201C][^""\u201D]+[""\u201D]/g) || []
  const curlySingleMatches = prose.match(/\u2018[^\u2018\u2019]+\u2019/g) || []
  const asciiSingleMatches = prose.match(/(?:^|[\s(—–])'((?:[^'\n]|'(?=[a-z]))+)'(?=[.,!?;\s—–)]|$)/gm) || []
  const quoteMatches = [...doubleQuoteMatches, ...curlySingleMatches, ...asciiSingleMatches]
  const dialogueWords = quoteMatches.reduce((sum, m) => sum + m.split(/\s+/).length, 0)
  const dialogueWordPct = allWords > 0 ? Math.round((dialogueWords / allWords) * 100) : 0

  // Interiority
  const interiorityMatches = prose.match(
    /\b(thought|wondered|realized|felt|remembered|knew|believed|considered|imagined|feared|hoped|wished|noticed|sensed|recalled|suspected|assumed|understood|pondered|reflected|mused)\b/gi
  ) || []
  const interiorityPer100w = allWords > 0 ? interiorityMatches.length / (allWords / 100) : 0

  // Action verbs
  const actionMatches = prose.match(
    /\b(ran|jumped|grabbed|pulled|pushed|threw|hit|kicked|ducked|sprinted|lunged|slammed|yanked|dove|charged|swung|blocked|fired|struck|stabbed|climbed|crawled|leaped|darted|hurled|tackled|wrestled|dragged|shoved|bolted|dashed|scrambled)\b/gi
  ) || []
  const actionPer100w = allWords > 0 ? actionMatches.length / (allWords / 100) : 0

  // Sentence stats
  const sentences = prose.split(/[.!?]+/).filter(s => s.trim().length > 10)
  const sentLengths = sentences.map(s => s.trim().split(/\s+/).length)
  const avgSentLen = sentLengths.length > 0
    ? sentLengths.reduce((a, b) => a + b, 0) / sentLengths.length
    : 0
  const sentLenStdDev = sentLengths.length > 1
    ? Math.sqrt(sentLengths.reduce((sum, l) => sum + (l - avgSentLen) ** 2, 0) / sentLengths.length)
    : 0
  const sentLenCV = avgSentLen > 0 ? sentLenStdDev / avgSentLen : 0

  // Paragraphs
  const paragraphs = prose.split("\n\n").filter(p => p.trim())
  const avgParaWords = paragraphs.length > 0 ? allWords / paragraphs.length : 0

  // Spec echo — N-gram overlap between beat descriptions and prose
  const specEcho = computeSpecEcho(prose, beats)

  return {
    wordCount: allWords,
    dialogueWordPct,
    interiorityPer100w: Math.round(interiorityPer100w * 10) / 10,
    actionPer100w: Math.round(actionPer100w * 10) / 10,
    avgSentLen: Math.round(avgSentLen * 10) / 10,
    sentLenCV: Math.round(sentLenCV * 100) / 100,
    specEcho: Math.round(specEcho * 100) / 100,
    avgParaWords: Math.round(avgParaWords),
    paragraphs: paragraphs.length,
  }
}

function computeSpecEcho(prose: string, beats: BeatSpec[]): number {
  // Compute average bigram overlap between each beat description and the full prose.
  // High overlap = the writer is transcribing the spec. Low overlap = interpreting.
  const proseWords = prose.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean)
  const proseBigrams = new Set<string>()
  for (let i = 0; i < proseWords.length - 1; i++) {
    proseBigrams.add(proseWords[i] + " " + proseWords[i + 1])
  }

  if (proseBigrams.size === 0) return 0

  let totalOverlap = 0
  let totalBigrams = 0

  for (const beat of beats) {
    const descWords = beat.description.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean)
    const descBigrams = new Set<string>()
    for (let i = 0; i < descWords.length - 1; i++) {
      descBigrams.add(descWords[i] + " " + descWords[i + 1])
    }

    if (descBigrams.size === 0) continue

    let overlap = 0
    for (const bg of descBigrams) {
      if (proseBigrams.has(bg)) overlap++
    }

    totalOverlap += overlap
    totalBigrams += descBigrams.size
  }

  return totalBigrams > 0 ? totalOverlap / totalBigrams : 0
}

// ── Seam Blindness Test ─────────────────────────────────────────────────

async function seamBlindnessTest(
  assembledProse: string,
  beatProses: string[],
  novelId: string,
): Promise<SeamResult> {
  if (beatProses.length <= 1) {
    return { totalBoundaries: 0, detectedBoundaries: 0, boundaryDetectionRate: 0, falseBreaks: 0 }
  }

  const totalBoundaries = beatProses.length - 1

  // Ask an LLM to identify scene transitions in the assembled prose
  const beatWriterModel = getModelForAgent("planning-plotter")
  const response = await getTransport().execute({
    systemPrompt: `You are a literary analyst. Read the chapter excerpt and identify where scene transitions or tonal shifts occur. Mark each transition point by quoting the LAST 5-8 words before the break. Return ONLY a JSON array of these boundary quotes.

Example: ["the door slammed behind her", "and then the silence returned"]

If the prose flows continuously with no detectable transitions, return an empty array: []`,
    userPrompt: assembledProse,
    model: beatWriterModel?.model ?? "qwen-3-235b-a22b-instruct-2507",
    provider: beatWriterModel?.provider ?? "cerebras",
    temperature: 0.1,
    maxTokens: 1024,
    responseFormat: { type: "json_object" },
  })

  let detectedBreaks: string[] = []
  try {
    const parsed = JSON.parse(response.content)
    detectedBreaks = Array.isArray(parsed) ? parsed : (parsed.breaks ?? parsed.transitions ?? [])
  } catch {
    const match = response.content.match(/\[[\s\S]*\]/)
    if (match) {
      try { detectedBreaks = JSON.parse(match[0]) } catch {}
    }
  }

  // Map detected breaks to actual beat boundaries
  // A detected break "matches" a beat boundary if it falls within the last 20% of a beat's prose
  let detectedBoundaries = 0
  const boundaryPositions: number[] = []
  let runningPos = 0
  for (let i = 0; i < beatProses.length - 1; i++) {
    runningPos += beatProses[i].length
    boundaryPositions.push(runningPos)
  }

  for (const breakQuote of detectedBreaks) {
    const breakPos = assembledProse.toLowerCase().indexOf(breakQuote.toLowerCase())
    if (breakPos < 0) continue

    // Check if this break is near any actual boundary (within 200 chars)
    for (const bp of boundaryPositions) {
      // Account for \n\n joining (2 chars per boundary)
      const adjustedBp = bp + boundaryPositions.indexOf(bp) * 2
      if (Math.abs(breakPos + breakQuote.length - adjustedBp) < 200) {
        detectedBoundaries++
        break
      }
    }
  }

  const falseBreaks = Math.max(0, detectedBreaks.length - detectedBoundaries)

  return {
    totalBoundaries,
    detectedBoundaries: Math.min(detectedBoundaries, totalBoundaries),
    boundaryDetectionRate: totalBoundaries > 0
      ? Math.min(detectedBoundaries, totalBoundaries) / totalBoundaries
      : 0,
    falseBreaks,
  }
}

// ── Run ─────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error("Fatal:", err)
  process.exit(1)
})

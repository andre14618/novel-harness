/**
 * Writer prompt ablation test.
 *
 * Same beats (current screenplay), 3 writer prompt variants:
 *   A: Current ("Execute the beat description precisely")
 *   B: Relaxed ("Dramatize this scene using the beat description as your guide")
 *   C: Minimal ("Write this scene")
 *
 * Isolates whether the writer prompt or the beat descriptions are the bigger lever.
 *
 * Usage:
 *   NOVEL_ID=novel-xxx CHAPTER=2 bun scripts/ablate-writer-prompt.ts
 */

import db from "../data/connection"
import {
  getChapterOutline, getCharacters,
  getCharacterStatesAtChapter, getWorldBible,
} from "../src/db"
import { buildBeatContext } from "../src/agents/writer/beat-context"
import { resolveReferences } from "../src/agents/writer/reference-resolver"
import { BEAT_WRITER_PROMPT } from "../src/prompts"
import { getModelForAgent } from "../models/roles"
import { getTransport } from "../src/transport"

const NOVEL_ID = process.env.NOVEL_ID ?? "novel-1776016972464"
const CHAPTER = parseInt(process.env.CHAPTER ?? "2")

// ── Writer prompt variants ──────────────────────────────────────────────

const PROMPT_A = BEAT_WRITER_PROMPT // current production prompt

const PROMPT_B = `You are a prose writer. Your job is to write one scene beat of a larger chapter.

Respond with ONLY the prose text. No JSON, no wrapper, no commentary. Just the scene.

Rules:
- The beat description is your creative brief. Capture its essential dramatic content — what changes, what matters, what the reader should feel. You decide how to show it.
- Write approximately the target word count. Do not summarize or abbreviate.
- Speech pattern is law: each character's speechPattern defines how they talk. Do not deviate.
- The POV character's vocabulary and worldview color the narration.
- Show emotion through body and action. Never name emotions in narration.
- Every beat with 2+ characters needs spoken dialogue. Characters talk around the real issue — subtext, not exposition.
- Anchor paragraphs in sensory detail specific to the setting.
- Use \\n\\n between paragraphs.
- If a TRANSITION BRIDGE is provided, continue naturally from where it left off. NEVER repeat or echo dialogue, phrases, or imagery from the bridge — it is already written. Move the scene forward.
- If a LANDING TARGET is provided, end on a moment that connects toward it.
- Each beat must introduce NEW action, dialogue, and detail. Do not recycle lines or motifs from previous beats.`

const PROMPT_C = `You are a prose writer. Write one scene of a larger chapter.

Respond with ONLY the prose text. No JSON, no wrapper, no commentary.

Rules:
- Use the beat description as a starting point. The scene should dramatize its content but you have full creative freedom in how.
- Write approximately the target word count.
- Speech pattern is law: each character's speechPattern defines how they talk.
- Show, don't tell. Never name emotions in narration.
- Use dialogue for scenes with 2+ characters. Subtext over exposition.
- Use \\n\\n between paragraphs.
- If a TRANSITION BRIDGE is provided, continue from where it left off. Do not repeat anything from the bridge.
- If a LANDING TARGET is provided, end connecting toward it.`

const variants = [
  { name: "A-precise", prompt: PROMPT_A },
  { name: "B-dramatize", prompt: PROMPT_B },
  { name: "C-minimal", prompt: PROMPT_C },
]

// ── Feature extraction ──────────────────────────────────────────────────

function extractFeatures(prose: string, beats: any[]) {
  const allWords = prose.split(/\s+/).filter(Boolean).length

  const doubleQuoteMatches = prose.match(/["\u201C][^"\u201D]+["\u201D]/g) || []
  const curlySingleMatches = prose.match(/\u2018[^\u2018\u2019]+\u2019/g) || []
  const asciiSingleMatches = prose.match(/(?:^|[\s(—–])'((?:[^'\n]|'(?=[a-z]))+)'(?=[.,!?;\s—–)]|$)/gm) || []
  const quoteMatches = [...doubleQuoteMatches, ...curlySingleMatches, ...asciiSingleMatches]
  const dialogueWords = quoteMatches.reduce((sum, m) => sum + m.split(/\s+/).length, 0)
  const dialogueWordPct = allWords > 0 ? Math.round((dialogueWords / allWords) * 100) : 0

  const interiorityMatches = prose.match(
    /\b(thought|wondered|realized|felt|remembered|knew|believed|considered|imagined|feared|hoped|wished|noticed|sensed|recalled|suspected|assumed|understood|pondered|reflected|mused)\b/gi
  ) || []
  const interiorityPer100w = allWords > 0 ? Math.round(interiorityMatches.length / (allWords / 100) * 10) / 10 : 0

  const sentences = prose.split(/[.!?]+/).filter((s: string) => s.trim().length > 10)
  const sentLengths = sentences.map((s: string) => s.trim().split(/\s+/).length)
  const avgSentLen = sentLengths.length > 0
    ? sentLengths.reduce((a, b) => a + b, 0) / sentLengths.length : 0
  const sentLenStdDev = sentLengths.length > 1
    ? Math.sqrt(sentLengths.reduce((sum, l) => sum + (l - avgSentLen) ** 2, 0) / sentLengths.length) : 0
  const sentLenCV = avgSentLen > 0 ? sentLenStdDev / avgSentLen : 0

  // Spec echo
  const proseWords = prose.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean)
  const proseBigrams = new Set<string>()
  for (let i = 0; i < proseWords.length - 1; i++) {
    proseBigrams.add(proseWords[i] + " " + proseWords[i + 1])
  }
  let totalOverlap = 0, totalBg = 0
  for (const beat of beats) {
    const descWords = (beat.description || "").toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean)
    const descBg = new Set<string>()
    for (let i = 0; i < descWords.length - 1; i++) descBg.add(descWords[i] + " " + descWords[i + 1])
    if (descBg.size === 0) continue
    for (const bg of descBg) if (proseBigrams.has(bg)) totalOverlap++
    totalBg += descBg.size
  }
  const specEcho = totalBg > 0 ? totalOverlap / totalBg : 0

  return {
    wordCount: allWords,
    dialogueWordPct,
    interiorityPer100w,
    avgSentLen: Math.round(avgSentLen * 10) / 10,
    sentLenCV: Math.round(sentLenCV * 100) / 100,
    specEcho: Math.round(specEcho * 100) / 100,
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Writer Prompt Ablation ===`)
  console.log(`Novel: ${NOVEL_ID}  Chapter: ${CHAPTER}\n`)

  const outline = await getChapterOutline(NOVEL_ID, CHAPTER)
  const characters = await getCharacters(NOVEL_ID)
  const charStates = await getCharacterStatesAtChapter(NOVEL_ID, CHAPTER)
  const worldBible = await getWorldBible(NOVEL_ID)

  console.log(`Beats: ${outline.scenes.length}`)
  for (const [i, s] of outline.scenes.entries()) {
    console.log(`  ${i}: ${s.description.slice(0, 80)}...`)
  }

  // Pre-resolve references (same for all variants)
  const preResolvedRefs = await Promise.all(
    outline.scenes.map((beat: any) =>
      resolveReferences(beat, outline, NOVEL_ID, CHAPTER, characters)
        .catch(() => ({ context: "", lookupCount: 0, llmUsed: false }))
    )
  )

  const beatWriterModel = getModelForAgent("beat-writer")
  const transport = getTransport()

  for (const variant of variants) {
    console.log(`\n--- ${variant.name} ---`)

    const beatProses: string[] = []
    let totalLatency = 0

    for (let bi = 0; bi < outline.scenes.length; bi++) {
      const beatCtx = await buildBeatContext({
        novelId: NOVEL_ID, chapterNumber: CHAPTER, beatIndex: bi,
        previousBeatProse: beatProses[bi - 1],
        outline, characters, characterStates: charStates, worldBible,
        preResolvedRefs: preResolvedRefs[bi],
      })

      const response = await transport.execute({
        systemPrompt: variant.prompt,
        userPrompt: beatCtx.userPrompt,
        model: beatWriterModel?.model ?? "qwen-3-235b-a22b-instruct-2507",
        provider: beatWriterModel?.provider ?? "cerebras",
        temperature: beatWriterModel?.temperature ?? 0.8,
        maxTokens: beatWriterModel?.maxTokens ?? 4000,
        responseFormat: { type: "text" },
      })

      const prose = response.content?.trim() ?? ""
      beatProses.push(prose)
      totalLatency += response.latencyMs
      console.log(`  Beat ${bi}: ${prose.split(/\s+/).length}w, ${Math.round(response.latencyMs)}ms`)
    }

    const assembled = beatProses.join("\n\n")
    const features = extractFeatures(assembled, outline.scenes)

    console.log(`  TOTAL: ${features.wordCount}w, ${Math.round(totalLatency)}ms`)
    console.log(`  dlg=${features.dialogueWordPct}%  int=${features.interiorityPer100w}/100  echo=${features.specEcho}  sentAvg=${features.avgSentLen}w  sentCV=${features.sentLenCV}`)

    // Save prose for reading
    await Bun.write(`/tmp/ablation-${variant.name}.txt`, assembled)
  }

  console.log("\nProse saved to /tmp/ablation-{A-precise,B-dramatize,C-minimal}.txt")
  process.exit(0)
}

main().catch(err => { console.error("Fatal:", err); process.exit(1) })

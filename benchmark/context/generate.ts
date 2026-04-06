/**
 * Context quality benchmark.
 *
 * Unlike prose/planning benchmarks that generate creative output and judge it,
 * this benchmark generates CONTEXT (the input to the writer) and judges whether
 * the retrieval system assembled the right information for the scene.
 *
 * Requires a multi-chapter novel to already exist in Postgres (at least 10 chapters).
 * Tests context quality at specific chapter numbers to evaluate retrieval at scale.
 */

import { resolve } from "node:path"
import { readFileSync } from "node:fs"
import db from "../../data/connection"
import { buildContext } from "../../src/agents/writer/context"
import { getChapterOutline, getCharacters, getNovel } from "../../src/db"
import { CONTEXT_DIMENSIONS, CONTEXT_DIMENSION_LABELS, contextJudgeSchema } from "./judges/schema"
import type { BenchmarkConfig, BenchmarkInput, GenerationResult } from "../engine"

// ── Config ─────────────────────────────────────────────────────────────────

export const config: BenchmarkConfig<typeof CONTEXT_DIMENSIONS[number]> = {
  name: "context",
  displayName: "Context Quality",
  dimensions: CONTEXT_DIMENSIONS,
  dimensionLabels: CONTEXT_DIMENSION_LABELS,
  judgesDir: resolve(import.meta.dir, "judges"),
  judgeSchema: contextJudgeSchema,
  scoring: "score",

  loadInputs(filter?: string[]): BenchmarkInput[] {
    // Inputs are novel_id + chapter pairs from existing multi-chapter novels
    // Loaded dynamically from DB — can't be sync, so we return placeholders
    // that get resolved in generate()
    return [] // Populated by the runner via loadContextInputs()
  },

  async generate(writer, input, runId, attempt): Promise<GenerationResult | null> {
    const { novelId, chapterNum } = input as ContextBenchmarkInput
    const start = performance.now()

    try {
      const contextString = await buildContext(novelId, chapterNum)
      const latencyMs = performance.now() - start

      return {
        output: contextString,
        wordCount: contextString.split(/\s+/).filter(Boolean).length,
        latencyMs,
      }
    } catch (err) {
      console.error(`  Context generation failed for ${novelId} ch${chapterNum}:`, err)
      return null
    }
  },

  buildJudgePrompt(input: BenchmarkInput, generatedOutput: string): string {
    const { novelId, chapterNum, sceneDescription, worldStateSummary, causalReference, knowledgeReference } = input as ContextBenchmarkInput

    let prompt = `SCENE DESCRIPTION:\n${sceneDescription}\n\n`
    prompt += `CONTEXT STRING (what the writer received):\n${generatedOutput}\n\n`

    // completeness and knowledge-accuracy judges need reference data
    if (worldStateSummary) {
      prompt += `WORLD STATE SUMMARY (all available data up to this chapter):\n${worldStateSummary}\n\n`
    }
    if (causalReference) {
      prompt += `CAUSAL CHAIN REFERENCE (known causal links):\n${causalReference}\n\n`
    }
    if (knowledgeReference) {
      prompt += `KNOWLEDGE STATE REFERENCE (what each character knows):\n${knowledgeReference}\n\n`
    }

    return prompt
  },

  scoreExtractor(parsed: any, dim: string): number {
    return parsed.score
  },

  // Daemon metadata
  promptTargets: [
    { path: "src/agents/graph-linker/prompt.md", agentName: "graph-linker" },
    { path: "src/agents/world-builder/prompt.md", agentName: "world-builder" },
    { path: "src/agents/character-agent/prompt.md", agentName: "character-agent" },
  ],
  runCmd: "bun benchmark/context/run.ts",
  daemonEnv: {
    BENCHMARK_RUNS: "1",
  },
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface ContextBenchmarkInput extends BenchmarkInput {
  novelId: string
  chapterNum: number
  sceneDescription: string
  worldStateSummary?: string
  causalReference?: string
  knowledgeReference?: string
}

// ── Input Loader (async — called by the runner, not by loadInputs) ────────

const TEST_CHAPTERS = [10, 15, 20, 25]

export async function loadContextInputs(novelFilter?: string[]): Promise<ContextBenchmarkInput[]> {
  // Find novels with enough chapters
  const novels = novelFilter
    ? await db`SELECT id, total_chapters FROM novels WHERE id = ANY(${novelFilter}) AND total_chapters >= 10`
    : await db`SELECT id, total_chapters FROM novels WHERE total_chapters >= 10 AND phase IN ('drafting', 'validation', 'done') ORDER BY created_at DESC LIMIT 3`

  const inputs: ContextBenchmarkInput[] = []

  for (const novel of novels) {
    for (const ch of TEST_CHAPTERS) {
      if (ch > novel.total_chapters) continue

      const outline = await getChapterOutline(novel.id, ch)
      const characters = await getCharacters(novel.id)
      const chapterCharNames = outline.charactersPresent.map(n => n.toLowerCase())
      const povChar = characters.find(c => c.name.toLowerCase() === outline.povCharacter?.toLowerCase())

      const sceneDescription = [
        `Chapter ${ch}: "${outline.title}"`,
        `POV: ${outline.povCharacter}`,
        `Setting: ${outline.setting}`,
        `Purpose: ${outline.purpose}`,
        `Characters present: ${outline.charactersPresent.join(", ")}`,
        `Scene beats:`,
        ...outline.scenes.map((s: any, i: number) => `  ${i + 1}. ${s.description} (${s.characters.join(", ")})`),
      ].join("\n")

      // Build world state summary for completeness judge
      const facts = await db`SELECT fact, category, established_in_chapter FROM facts WHERE novel_id = ${novel.id} AND established_in_chapter < ${ch} ORDER BY established_in_chapter`
      const events = await db`SELECT event, location, chapter_number, consequences FROM timeline_events WHERE novel_id = ${novel.id} AND chapter_number < ${ch} ORDER BY chapter_number`
      const relationships = await db`SELECT character_a, character_b, trust_level, dynamic, tension, chapter_number FROM relationship_states WHERE novel_id = ${novel.id} AND chapter_number < ${ch} ORDER BY chapter_number`
      const knowledge = await db`SELECT character_id, knowledge, source, chapter_learned, is_false FROM character_knowledge WHERE novel_id = ${novel.id} AND chapter_learned < ${ch} ORDER BY chapter_learned`

      const worldStateSummary = [
        `FACTS (${facts.length}):`,
        ...facts.slice(-100).map(f => `  ch${f.established_in_chapter} [${f.category}] ${f.fact}`),
        `\nEVENTS (${events.length}):`,
        ...events.slice(-50).map(e => `  ch${e.chapter_number}: ${e.event} at ${e.location}`),
        `\nRELATIONSHIPS (${relationships.length}):`,
        ...relationships.slice(-30).map(r => `  ch${r.chapter_number}: ${r.character_a}↔${r.character_b} [${r.trust_level}] ${r.dynamic}`),
        `\nKNOWLEDGE (${knowledge.length}):`,
        ...knowledge.slice(-50).map(k => `  ch${k.chapter_learned}: ${k.character_id} ${k.source} "${k.knowledge}"${k.is_false ? " [FALSE]" : ""}`),
      ].join("\n")

      // Build causal reference
      const causalLinks = await db`
        SELECT ec.*, te1.event as cause_event, te1.chapter_number as cause_ch,
               te2.event as effect_event, te2.chapter_number as effect_ch
        FROM event_causes ec
        JOIN timeline_events te1 ON te1.id = ec.cause_event_id
        JOIN timeline_events te2 ON te2.id = ec.effect_event_id
        WHERE ec.novel_id = ${novel.id} AND te2.chapter_number <= ${ch}
        ORDER BY te1.chapter_number`
      const causalReference = causalLinks.length > 0
        ? causalLinks.map(l => `  ch${l.cause_ch} "${l.cause_event}" → [${l.relationship}] → ch${l.effect_ch} "${l.effect_event}"`).join("\n")
        : undefined

      // Build knowledge reference
      const knowledgeWithProp = await db`
        SELECT ck.character_id, ck.knowledge, ck.source, ck.chapter_learned, ck.is_false,
               kp.from_character_id, kp.confidence, kp.propagation_type
        FROM character_knowledge ck
        LEFT JOIN knowledge_propagation kp ON kp.knowledge_id = ck.id
        WHERE ck.novel_id = ${novel.id} AND ck.chapter_learned < ${ch}
        ORDER BY ck.chapter_learned`
      const knowledgeReference = knowledgeWithProp.length > 0
        ? knowledgeWithProp.map(k => {
            let line = `  ${k.character_id}: "${k.knowledge}" (${k.source}, ch${k.chapter_learned})`
            if (k.from_character_id) line += ` [from ${k.from_character_id}, confidence: ${k.confidence}]`
            if (k.is_false) line += " [FALSE BELIEF]"
            return line
          }).join("\n")
        : undefined

      inputs.push({
        name: `${novel.id}-ch${ch}`,
        novelId: novel.id,
        chapterNum: ch,
        sceneDescription,
        worldStateSummary,
        causalReference,
        knowledgeReference,
      })
    }
  }

  return inputs
}

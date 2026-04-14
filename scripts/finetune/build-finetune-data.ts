/**
 * Generate fine-tuning training data for Together AI LoRA.
 *
 * Usage:
 *   bun scripts/build-finetune-data.ts --task fact-extractor [--limit 50]
 *
 * Tasks:
 *   fact-extractor       — chapter → { facts: [{ fact, category }] }
 *   adherence-checker    — beat spec + prose → { pass, issues }
 *   chapter-plan-checker — plan + prose → { pass, deviations }
 *   tonal-pass           — chapter → AI-tell detection + fixes
 *
 * Workflow:
 *   1. Pulls chapters from Postgres
 *   2. Runs base Qwen 3.5 9B to get baseline extraction
 *   3. Inserts each pair into finetune_training_data with status='pending'
 *   4. Review pairs in the web UI at /app/finetune
 *   5. Export approved pairs as JSONL for Together AI
 */

import db from "../../data/connection"
import { getTransport } from "../../src/transport"
import { saveTrainingPair } from "../../src/db/finetune"
import { parseArgs } from "util"

// ── System prompts (generic, not the verbose production versions) ────────

const SYSTEM_PROMPTS: Record<string, string> = {
  "fact-extractor": `Extract all continuity-relevant facts from this chapter. Each fact should be something that, if forgotten or contradicted, could cause a continuity error in future chapters.

Respond with JSON: { "facts": [{ "fact": "...", "category": "physical|rule|relationship|knowledge|identity|temporal" }] }`,

  "adherence-checker": `Check if the prose faithfully executes the scene beat specification. Report specific deviations.

Respond with JSON: { "pass": true/false, "issues": ["specific issue description", ...] }`,

  "chapter-plan-checker": `Compare the chapter prose against the chapter plan. Check that all beats are represented, characters appear as specified, emotional arcs match, and no major unplanned events are introduced.

Respond with JSON: { "pass": true/false, "deviations": ["specific deviation", ...] }`,

  "tonal-pass": `Identify AI writing cliches and unnatural phrasings in this prose. For each issue found, provide the original text and a suggested fix that sounds more natural and human-written.

Respond with JSON: { "issues": [{ "original": "...", "fix": "...", "reason": "..." }] }`,
}

// ── Data fetching ───────────────────────────────────────────────────────

interface ChapterData {
  novelId: string
  chapterNumber: number
  prose: string
  outlineJson: any
}

async function fetchChapters(lim: number): Promise<ChapterData[]> {
  const rows = await db`
    SELECT cd.novel_id, cd.chapter_number, cd.prose, co.outline_json
    FROM chapter_drafts cd
    JOIN chapter_outlines co ON co.novel_id = cd.novel_id AND co.chapter_number = cd.chapter_number
    WHERE cd.status = 'approved'
    ORDER BY cd.novel_id, cd.chapter_number
    LIMIT ${lim}
  `
  return rows.map(r => ({
    novelId: r.novel_id,
    chapterNumber: r.chapter_number,
    prose: r.prose,
    outlineJson: typeof r.outline_json === "string" ? JSON.parse(r.outline_json) : r.outline_json,
  }))
}

// ── Base model extraction ───────────────────────────────────────────────

interface BaseModelResult {
  content: string
  promptTokens: number
  completionTokens: number
  latencyMs: number
}

async function runBaseModel(systemPrompt: string, userPrompt: string): Promise<BaseModelResult> {
  const transport = getTransport()
  const response = await transport.execute({
    systemPrompt,
    userPrompt,
    model: "Qwen/Qwen3.5-9B",
    provider: "together",
    temperature: 0.1,
    maxTokens: 2048,
    responseFormat: { type: "json_object" },
  })
  return {
    content: response.content?.trim() ?? "{}",
    promptTokens: response.usage.prompt_tokens,
    completionTokens: response.usage.completion_tokens,
    latencyMs: Math.round(response.latencyMs),
  }
}

// ── Task-specific user prompt builders ──────────────────────────────────

function buildUserPrompt(task: string, chapter: ChapterData): string {
  switch (task) {
    case "fact-extractor":
      return chapter.prose

    case "adherence-checker": {
      const scenes = chapter.outlineJson?.scenes ?? []
      if (scenes.length === 0) return ""
      // Use first beat as example
      const beat = scenes[0]
      const beatProse = chapter.prose.slice(0, 2000) // approximate first beat
      return `Beat: "${beat.description}"\nCharacters: ${(beat.characters ?? []).join(", ")}\n\nProse:\n${beatProse}`
    }

    case "chapter-plan-checker": {
      const outline = chapter.outlineJson
      const sections: string[] = []
      sections.push(`CHAPTER ${outline.chapterNumber}: "${outline.title}"`)
      sections.push(`POV: ${outline.povCharacter}`)
      sections.push(`Setting: ${outline.setting}`)
      sections.push(`Characters: ${(outline.charactersPresent ?? []).join(", ")}`)
      sections.push("")
      sections.push("BEATS:")
      for (const [i, s] of (outline.scenes ?? []).entries()) {
        sections.push(`  ${i + 1}. ${s.description}`)
        sections.push(`     Characters: ${(s.characters ?? []).join(", ")}`)
        if (s.emotionalShift) sections.push(`     Shift: ${s.emotionalShift}`)
      }
      sections.push("")
      sections.push("PROSE:")
      sections.push(chapter.prose)
      return sections.join("\n")
    }

    case "tonal-pass":
      return chapter.prose

    default:
      return chapter.prose
  }
}

// ── Main (supports both CLI and programmatic use) ───────────────────────

const CONCURRENCY = 5 // parallel base model calls

export async function generateTrainingData(task: string, limit: number): Promise<{ inserted: number; skipped: number }> {
  const systemPrompt = SYSTEM_PROMPTS[task]
  if (!systemPrompt) {
    throw new Error(`Unknown task: ${task}. Valid: ${Object.keys(SYSTEM_PROMPTS).join(", ")}`)
  }

  console.log(`[finetune] Fetching up to ${limit} approved chapters...`)
  const chapters = await fetchChapters(limit)
  console.log(`[finetune] Found ${chapters.length} chapters (concurrency: ${CONCURRENCY})`)

  if (chapters.length === 0) {
    console.log("[finetune] No approved chapters found.")
    return { inserted: 0, skipped: 0 }
  }

  let inserted = 0
  let skipped = 0
  const startTime = Date.now()

  // Process in batches of CONCURRENCY
  for (let i = 0; i < chapters.length; i += CONCURRENCY) {
    const batch = chapters.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(batch.map(async (chapter, j) => {
      const idx = i + j + 1
      const userPrompt = buildUserPrompt(task, chapter)
      if (!userPrompt) return null

      const result = await runBaseModel(systemPrompt, userPrompt)
      const tps = result.latencyMs > 0 ? Math.round(result.completionTokens / (result.latencyMs / 1000)) : 0

      console.log(`  [${idx}/${chapters.length}] novel=${chapter.novelId.slice(0, 8)} ch${chapter.chapterNumber} — ${result.latencyMs}ms, ${result.promptTokens}+${result.completionTokens} tokens, ${tps} tok/s`)

      await saveTrainingPair({
        task,
        novel_id: chapter.novelId,
        chapter_number: chapter.chapterNumber,
        system_prompt: systemPrompt,
        user_content: userPrompt,
        base_output: result.content,
      })

      return true
    }))

    for (const r of results) {
      if (r.status === "fulfilled" && r.value === true) inserted++
      else if (r.status === "rejected") {
        console.error(`    Failed: ${r.reason instanceof Error ? r.reason.message : r.reason}`)
        skipped++
      } else skipped++
    }
  }

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`[finetune] Done: ${inserted} pairs inserted, ${skipped} skipped (${totalSec}s total)`)
  return { inserted, skipped }
}

// ── CLI entry point ─────────────────────────────────────────────────────

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      task: { type: "string" },
      limit: { type: "string", default: "50" },
    },
  })

  const task = values.task
  const limit = parseInt(values.limit!, 10)

  if (!task) {
    console.error("Usage: bun scripts/build-finetune-data.ts --task <task> [--limit N]")
    console.error(`Tasks: ${Object.keys(SYSTEM_PROMPTS).join(", ")}`)
    process.exit(1)
  }

  const result = await generateTrainingData(task, limit)

  console.log(`\nNext steps:`)
  console.log(`  1. Open the web UI at /app/finetune`)
  console.log(`  2. Review and correct the base model outputs`)
  console.log(`  3. Approve good pairs, reject bad ones`)
  console.log(`  4. Export approved pairs as JSONL for Together AI`)

  process.exit(result.inserted > 0 ? 0 : 1)
}

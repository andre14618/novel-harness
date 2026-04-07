/**
 * Generate fine-tuning training data for Together AI LoRA.
 *
 * Usage:
 *   bun scripts/build-finetune-data.ts --task fact-extractor [--limit 50] [--out finetune-data]
 *
 * Tasks:
 *   fact-extractor       — chapter → { facts: [{ fact, category }] }
 *   adherence-checker    — beat spec + prose → { pass, issues }
 *   chapter-plan-checker — plan + prose → { pass, deviations }
 *
 * Workflow:
 *   1. Pulls chapters from Postgres
 *   2. Runs base Qwen 3.5 9B to get baseline extraction
 *   3. Outputs JSONL pairs for human review in Claude Code
 *   4. After review, corrected outputs become training data
 *
 * Output format (Together AI JSONL):
 *   { "messages": [{ "role": "system", ... }, { "role": "user", ... }, { "role": "assistant", ... }] }
 */

import db from "../data/connection"
import { getTransport } from "../src/transport"
import { getModelForAgent } from "../models/roles"
import { parseArgs } from "util"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    task: { type: "string" },
    limit: { type: "string", default: "50" },
    out: { type: "string", default: "finetune-data" },
    "skip-base": { type: "boolean", default: false },
  },
})

const task = values.task
const limit = parseInt(values.limit!, 10)
const outDir = values.out!
const skipBase = values["skip-base"]

if (!task) {
  console.error("Usage: bun scripts/build-finetune-data.ts --task <task> [--limit N] [--out dir]")
  console.error("Tasks: fact-extractor, adherence-checker, chapter-plan-checker")
  process.exit(1)
}

// ── System prompts (generic, not the verbose production versions) ────────

const SYSTEM_PROMPTS: Record<string, string> = {
  "fact-extractor": `Extract all continuity-relevant facts from this chapter. Each fact should be something that, if forgotten or contradicted, could cause a continuity error in future chapters.

Respond with JSON: { "facts": [{ "fact": "...", "category": "physical|rule|relationship|knowledge|identity|temporal" }] }`,

  "adherence-checker": `Check if the prose faithfully executes the scene beat specification. Report specific deviations.

Respond with JSON: { "pass": true/false, "issues": ["specific issue description", ...] }`,

  "chapter-plan-checker": `Compare the chapter prose against the chapter plan. Check that all beats are represented, characters appear as specified, emotional arcs match, and no major unplanned events are introduced.

Respond with JSON: { "pass": true/false, "deviations": ["specific deviation", ...] }`,
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

async function runBaseModel(systemPrompt: string, userPrompt: string): Promise<string> {
  const transport = getTransport()
  const model = getModelForAgent("tonal-pass") // Qwen 3.5 9B on Together
  const response = await transport.execute({
    systemPrompt,
    userPrompt,
    model: "Qwen/Qwen3.5-9B",
    provider: "together",
    temperature: 0.1,
    maxTokens: 4096,
    responseFormat: { type: "json_object" },
  })
  return response.content?.trim() ?? "{}"
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

    default:
      return chapter.prose
  }
}

// ── Main ────────────────────────────────────────────────────────────────

const systemPrompt = SYSTEM_PROMPTS[task]
if (!systemPrompt) {
  console.error(`Unknown task: ${task}`)
  process.exit(1)
}

console.log(`Fetching up to ${limit} approved chapters...`)
const chapters = await fetchChapters(limit)
console.log(`Found ${chapters.length} chapters`)

if (chapters.length === 0) {
  console.log("No approved chapters found. Run some novels first.")
  process.exit(0)
}

await Bun.write(`${outDir}/.gitkeep`, "")

const outputLines: string[] = []
let processed = 0
let skipped = 0

for (const chapter of chapters) {
  const userPrompt = buildUserPrompt(task, chapter)
  if (!userPrompt) {
    skipped++
    continue
  }

  let baseOutput = "{}"
  if (!skipBase) {
    try {
      console.log(`  [${++processed}/${chapters.length}] novel=${chapter.novelId.slice(0, 8)} ch${chapter.chapterNumber} — calling base model...`)
      baseOutput = await runBaseModel(systemPrompt, userPrompt)
    } catch (err) {
      console.error(`    Failed: ${err instanceof Error ? err.message : err}`)
      skipped++
      continue
    }
  } else {
    processed++
  }

  // Together AI JSONL format
  const entry = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
      { role: "assistant", content: baseOutput },
    ],
    // Metadata for review (not sent to Together, stripped before upload)
    _meta: {
      novelId: chapter.novelId,
      chapterNumber: chapter.chapterNumber,
      task,
      needsReview: true,
    },
  }

  outputLines.push(JSON.stringify(entry))
}

// Write output
const outPath = `${outDir}/${task}-draft.jsonl`
await Bun.write(outPath, outputLines.join("\n") + "\n")

console.log(`\nDone: ${outputLines.length} pairs written to ${outPath}`)
console.log(`Skipped: ${skipped}`)
console.log(`\nNext steps:`)
console.log(`  1. Review the JSONL in Claude Code — correct the assistant outputs`)
console.log(`  2. Remove the _meta field from each line`)
console.log(`  3. Split into train/test: head -n 240 > train.jsonl, tail -n 60 > test.jsonl`)
console.log(`  4. Upload to Together AI for LoRA fine-tuning`)

process.exit(0)

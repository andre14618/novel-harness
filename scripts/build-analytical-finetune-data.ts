/**
 * Generate fine-tuning training data for the analytical agents
 * (adherence-checker, reference-resolver, chapter-plan-checker).
 *
 * Uses Cerebras Qwen 235B as the oracle — a strong model that we already
 * trust for these tasks based on this session's benchmarking. Saves each
 * (input, oracle_output) pair to finetune_training_data with status='pending'
 * for spot-check via /app/finetune.
 *
 * Differs from scripts/build-finetune-data.ts in two ways:
 *   1. Source model is the oracle (Cerebras Qwen 235B), not the slow base
 *      Qwen 3.5 9B on Together AI.
 *   2. Per-beat granularity for adherence-checker and reference-resolver
 *      (one example per beat, ~3-5x more examples per chapter than the
 *      per-chapter approach the original script uses).
 *
 * System prompts and user prompts MATCH PRODUCTION exactly so the LoRA
 * learns to respond to the same prompts the harness sends at inference time.
 *
 * Usage:
 *   bun scripts/build-analytical-finetune-data.ts --task adherence-checker --limit 10
 *   bun scripts/build-analytical-finetune-data.ts --task reference-resolver --limit 10
 *   bun scripts/build-analytical-finetune-data.ts --task chapter-plan-checker --limit 10
 *
 *   --limit applies to NUMBER OF CHAPTERS, not pairs. Per-beat tasks generate
 *   ~3-5 pairs per chapter.
 */

import db from "../data/connection"
import { getTransport } from "../src/transport"
import { saveTrainingPair } from "../src/db/finetune"
import type { ChapterOutline, SceneBeat } from "../src/types"
import { parseArgs } from "util"

const ORACLE_PROVIDER = "cerebras"
const ORACLE_MODEL = "qwen-3-235b-a22b-instruct-2507"

// ── System prompts (must match production agents exactly) ──────────────

const SYSTEM_PROMPTS: Record<string, string> = {
  "adherence-checker": "You check if prose follows a scene beat specification. Be strict but fair.",
  "reference-resolver": "You identify what background information a scene beat needs. Return JSON with specific lookups.",
  "chapter-plan-checker": "You compare a chapter draft against its plan and report specific deviations from the planned beats, characters, settings, or emotional shifts.",
}

// ── User prompt builders (must match production agents exactly) ────────

function adherenceUserPrompt(beat: SceneBeat, outline: ChapterOutline, prose: string): string {
  return `Beat: "${beat.description}"
Setting: "${outline.setting}"
Characters expected: ${beat.characters.join(", ")}

Prose:
---
${prose.slice(0, 2000)}
---

Did the prose execute the beat? Check:
1. Do the described events happen in the prose?
2. Is it set in the right place?
3. Do characters behave consistently with their roles?

Return JSON: { "pass": true/false, "deviations": ["specific issue 1", ...] }
Return pass:true with empty deviations if the beat is executed well.`
}

function referenceUserPrompt(beat: SceneBeat, outline: ChapterOutline, chapterNumber: number): string {
  return `Beat: "${beat.description}"
Characters: ${beat.characters.join(", ")}
Setting: ${outline.setting}
Chapter: ${chapterNumber}

What specific background does the writer need? Return JSON:
{ "lookups": [{ "type": "recent_events"|"relationship"|"location_events"|"knowledge", "characters": ["name"], "location": "place", "topic": "subject" }] }

Only include lookups for things implicitly referenced. Return empty lookups array if the beat is self-contained.`
}

function chapterPlanCheckUserPrompt(outline: ChapterOutline, prose: string): string {
  const beats = (outline.scenes ?? [])
    .map((s, i) => `${i + 1}. ${s.description} [characters: ${(s.characters ?? []).join(", ")}]`)
    .join("\n")
  return `CHAPTER PLAN
Title: "${outline.title}"
POV: ${outline.povCharacter}
Setting: ${outline.setting}
Beats:
${beats}

CHAPTER PROSE:
${prose}

Compare the prose against the plan. Did each beat happen in roughly the order specified? Did the named characters appear? Was the setting honored? Return JSON:
{ "pass": true/false, "deviations": ["specific deviation", ...] }
Return pass:true with empty deviations if the prose follows the plan.`
}

// ── Data fetching ──────────────────────────────────────────────────────

interface ChapterData {
  novelId: string
  chapterNumber: number
  prose: string
  outline: ChapterOutline
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
  return rows.map((r: any) => ({
    novelId: r.novel_id,
    chapterNumber: r.chapter_number,
    prose: r.prose,
    outline: typeof r.outline_json === "string" ? JSON.parse(r.outline_json) : r.outline_json,
  }))
}

// ── Oracle call ────────────────────────────────────────────────────────

async function callOracle(systemPrompt: string, userPrompt: string): Promise<{ content: string; promptTokens: number; completionTokens: number; latencyMs: number }> {
  const response = await getTransport().execute({
    systemPrompt,
    userPrompt,
    model: ORACLE_MODEL,
    provider: ORACLE_PROVIDER,
    temperature: 0.1,
    maxTokens: 2048,
    responseFormat: { type: "json_object" },
    callerId: "finetune-oracle",
  })
  return {
    content: response.content?.trim() ?? "{}",
    promptTokens: response.usage.prompt_tokens,
    completionTokens: response.usage.completion_tokens,
    latencyMs: Math.round(response.latencyMs),
  }
}

// ── Per-task pair generators ────────────────────────────────────────────

interface PairToGenerate {
  systemPrompt: string
  userPrompt: string
}

function generatePairs(task: string, chapter: ChapterData): PairToGenerate[] {
  const sys = SYSTEM_PROMPTS[task]
  if (!sys) throw new Error(`Unknown task: ${task}`)

  const pairs: PairToGenerate[] = []

  if (task === "adherence-checker" || task === "reference-resolver") {
    // Per-beat: split prose by paragraph chunks, pair each with the corresponding outline beat by index
    const scenes = chapter.outline.scenes ?? []
    if (scenes.length === 0) return pairs
    const chunks = chapter.prose.split(/\n\n+/).filter(c => c.trim().length > 50)
    if (chunks.length === 0) return pairs

    for (let bi = 0; bi < scenes.length; bi++) {
      const chunkIdx = Math.min(bi, chunks.length - 1)
      const proseChunk = chunks[chunkIdx]
      if (proseChunk.length < 100) continue
      const userPrompt = task === "adherence-checker"
        ? adherenceUserPrompt(scenes[bi], chapter.outline, proseChunk)
        : referenceUserPrompt(scenes[bi], chapter.outline, chapter.chapterNumber)
      pairs.push({ systemPrompt: sys, userPrompt })
    }
    return pairs
  }

  if (task === "chapter-plan-checker") {
    // Per-chapter: one pair per chapter (full prose + plan)
    pairs.push({ systemPrompt: sys, userPrompt: chapterPlanCheckUserPrompt(chapter.outline, chapter.prose) })
    return pairs
  }

  throw new Error(`Unknown task: ${task}`)
}

// ── Main ───────────────────────────────────────────────────────────────

const CONCURRENCY = 5

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      task: { type: "string" },
      limit: { type: "string", default: "10" },
    },
  })
  const task = values.task
  const limit = parseInt(values.limit!, 10)

  if (!task || !SYSTEM_PROMPTS[task]) {
    console.error(`Usage: bun scripts/build-analytical-finetune-data.ts --task <task> [--limit N]`)
    console.error(`Tasks: ${Object.keys(SYSTEM_PROMPTS).join(", ")}`)
    process.exit(1)
  }

  console.log(`[oracle-distill] task=${task} limit=${limit} oracle=${ORACLE_PROVIDER}/${ORACLE_MODEL}`)
  console.log(`[oracle-distill] fetching up to ${limit} approved chapters...`)
  const chapters = await fetchChapters(limit)
  console.log(`[oracle-distill] found ${chapters.length} chapters`)

  if (chapters.length === 0) {
    console.error("No approved chapters found.")
    process.exit(1)
  }

  // Build the full list of pairs to generate across all chapters
  const allPairs: Array<{ pair: PairToGenerate; chapter: ChapterData }> = []
  for (const ch of chapters) {
    for (const pair of generatePairs(task, ch)) {
      allPairs.push({ pair, chapter: ch })
    }
  }
  console.log(`[oracle-distill] expanded to ${allPairs.length} (input, expected_output) pairs`)

  let inserted = 0
  let failed = 0
  const startTime = Date.now()

  for (let i = 0; i < allPairs.length; i += CONCURRENCY) {
    const batch = allPairs.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(batch.map(async ({ pair, chapter }, j) => {
      const idx = i + j + 1
      const oracleResult = await callOracle(pair.systemPrompt, pair.userPrompt)
      console.log(`  [${idx}/${allPairs.length}] novel=${chapter.novelId.slice(0, 8)} ch${chapter.chapterNumber} — ${oracleResult.latencyMs}ms, ${oracleResult.promptTokens}+${oracleResult.completionTokens} tokens`)
      await saveTrainingPair({
        task,
        novel_id: chapter.novelId,
        chapter_number: chapter.chapterNumber,
        system_prompt: pair.systemPrompt,
        user_content: pair.userPrompt,
        base_output: oracleResult.content,
      })
      return true
    }))
    for (const r of results) {
      if (r.status === "fulfilled") inserted++
      else {
        failed++
        console.error(`    failed: ${r.reason instanceof Error ? r.reason.message : r.reason}`)
      }
    }
  }

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n[oracle-distill] done: ${inserted} pairs inserted, ${failed} failed (${totalSec}s)`)
  console.log(`\nNext steps:`)
  console.log(`  1. Spot-check ~10% via /app/finetune (filter by task=${task})`)
  console.log(`  2. Approve pairs that look correct, edit/reject the rest`)
  console.log(`  3. Run for the other tasks (the LoRA can train on a multi-task mix)`)
  console.log(`  4. Export approved pairs as JSONL for Fireworks training`)

  process.exit(0)
}

main().catch(e => {
  console.error("Fatal:", e)
  process.exit(1)
})

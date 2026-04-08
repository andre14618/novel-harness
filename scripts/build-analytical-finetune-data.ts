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

// ── Beat-writer call (for adherence-checker training data) ─────────────
// Generates fresh prose for a specific beat in isolation. Used to produce
// correctly-paired (beat, beat_prose) inputs for the adherence-checker
// oracle. Without this, splitting an existing chapter's prose by paragraph
// breaks and pairing chunks with beats by index gives mismatched inputs
// that all label as "fail" (the smoke test confirmed this).
//
// Uses Cerebras Qwen 235B for both the beat-writer and the oracle — same
// model the production beat-writer uses. Temperature 0.7 for creative
// variety so the dataset includes both clean executions and natural drift.

async function generateBeatProse(
  beat: SceneBeat,
  outline: ChapterOutline,
  chapterNumber: number,
  targetWords: number,
): Promise<string> {
  const systemPrompt = "You are a novelist writing prose that executes a specific scene beat. Match the beat description exactly. Write only the prose, no preamble or commentary."
  const userPrompt = `Setting: ${outline.setting}
Chapter ${chapterNumber}: "${outline.title}"
POV: ${outline.povCharacter}

Beat: ${beat.description}
Characters present: ${beat.characters.join(", ")}

Write approximately ${targetWords} words of prose for this beat. Stay in third-person past tense unless the chapter context suggests otherwise. Output prose only — no preamble, no commentary, no headers.`

  const response = await getTransport().execute({
    systemPrompt,
    userPrompt,
    model: ORACLE_MODEL,
    provider: ORACLE_PROVIDER,
    temperature: 0.7,
    maxTokens: 1500,
    responseFormat: { type: "text" },
    callerId: "finetune-beat-writer",
  })
  return response.content?.trim() ?? ""
}

// ── Per-task pair specs (sync — just identifies what to generate) ──────
// Pair specs are produced sync from chapter data. The async pipeline in
// processPairSpec then handles task-specific work (e.g. beat-writer call
// for adherence-checker) before calling the oracle.

type PairSpec =
  | { kind: "adherence"; beat: SceneBeat; outline: ChapterOutline; chapterNumber: number; targetWords: number }
  | { kind: "reference"; beat: SceneBeat; outline: ChapterOutline; chapterNumber: number }
  | { kind: "plancheck"; outline: ChapterOutline; prose: string; chapterNumber: number }

function generatePairSpecs(task: string, chapter: ChapterData): PairSpec[] {
  const specs: PairSpec[] = []

  if (task === "adherence-checker") {
    const scenes = chapter.outline.scenes ?? []
    if (scenes.length === 0) return specs
    const targetWords = Math.round((chapter.outline.targetWords ?? 1000) / Math.max(scenes.length, 1))
    for (let bi = 0; bi < scenes.length; bi++) {
      specs.push({
        kind: "adherence",
        beat: scenes[bi],
        outline: chapter.outline,
        chapterNumber: chapter.chapterNumber,
        targetWords,
      })
    }
    return specs
  }

  if (task === "reference-resolver") {
    const scenes = chapter.outline.scenes ?? []
    if (scenes.length === 0) return specs
    for (let bi = 0; bi < scenes.length; bi++) {
      specs.push({
        kind: "reference",
        beat: scenes[bi],
        outline: chapter.outline,
        chapterNumber: chapter.chapterNumber,
      })
    }
    return specs
  }

  if (task === "chapter-plan-checker") {
    specs.push({
      kind: "plancheck",
      outline: chapter.outline,
      prose: chapter.prose,
      chapterNumber: chapter.chapterNumber,
    })
    return specs
  }

  throw new Error(`Unknown task: ${task}`)
}

// ── Pair pipeline (async — runs beat-writer if needed, then oracle) ────

interface ProcessedPair {
  systemPrompt: string
  userPrompt: string
  oracleOutput: string
  oracleLatencyMs: number
  oraclePromptTokens: number
  oracleCompletionTokens: number
}

async function processPairSpec(task: string, spec: PairSpec): Promise<ProcessedPair> {
  const systemPrompt = SYSTEM_PROMPTS[task]
  if (!systemPrompt) throw new Error(`Unknown task: ${task}`)

  if (spec.kind === "adherence") {
    // Step 1: generate fresh beat prose via the beat-writer model
    const beatProse = await generateBeatProse(spec.beat, spec.outline, spec.chapterNumber, spec.targetWords)
    if (!beatProse || beatProse.length < 100) {
      throw new Error(`Beat-writer produced too-short prose (${beatProse.length} chars)`)
    }
    // Step 2: build the adherence-checker prompt with the fresh prose and call oracle
    const userPrompt = adherenceUserPrompt(spec.beat, spec.outline, beatProse)
    const oracle = await callOracle(systemPrompt, userPrompt)
    return { systemPrompt, userPrompt, oracleOutput: oracle.content, oracleLatencyMs: oracle.latencyMs, oraclePromptTokens: oracle.promptTokens, oracleCompletionTokens: oracle.completionTokens }
  }

  if (spec.kind === "reference") {
    const userPrompt = referenceUserPrompt(spec.beat, spec.outline, spec.chapterNumber)
    const oracle = await callOracle(systemPrompt, userPrompt)
    return { systemPrompt, userPrompt, oracleOutput: oracle.content, oracleLatencyMs: oracle.latencyMs, oraclePromptTokens: oracle.promptTokens, oracleCompletionTokens: oracle.completionTokens }
  }

  if (spec.kind === "plancheck") {
    const userPrompt = chapterPlanCheckUserPrompt(spec.outline, spec.prose)
    const oracle = await callOracle(systemPrompt, userPrompt)
    return { systemPrompt, userPrompt, oracleOutput: oracle.content, oracleLatencyMs: oracle.latencyMs, oraclePromptTokens: oracle.promptTokens, oracleCompletionTokens: oracle.completionTokens }
  }

  throw new Error(`Unknown spec kind`)
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

  // Build the full list of pair specs across all chapters
  const allSpecs: Array<{ spec: PairSpec; chapter: ChapterData }> = []
  for (const ch of chapters) {
    for (const spec of generatePairSpecs(task, ch)) {
      allSpecs.push({ spec, chapter: ch })
    }
  }
  console.log(`[oracle-distill] expanded to ${allSpecs.length} pair specs`)
  if (task === "adherence-checker") {
    console.log(`[oracle-distill] adherence-checker uses 2 LLM calls per pair (beat-writer + oracle)`)
  }

  let inserted = 0
  let failed = 0
  const startTime = Date.now()

  for (let i = 0; i < allSpecs.length; i += CONCURRENCY) {
    const batch = allSpecs.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(batch.map(async ({ spec, chapter }, j) => {
      const idx = i + j + 1
      const processed = await processPairSpec(task, spec)
      console.log(`  [${idx}/${allSpecs.length}] novel=${chapter.novelId.slice(0, 8)} ch${chapter.chapterNumber} — ${processed.oracleLatencyMs}ms, ${processed.oraclePromptTokens}+${processed.oracleCompletionTokens} tokens`)
      await saveTrainingPair({
        task,
        novel_id: chapter.novelId,
        chapter_number: chapter.chapterNumber,
        system_prompt: processed.systemPrompt,
        user_content: processed.userPrompt,
        base_output: processed.oracleOutput,
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

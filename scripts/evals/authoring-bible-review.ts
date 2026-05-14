#!/usr/bin/env bun
/**
 * Advisory authoring-bible review.
 *
 * Reads persisted planning/draft artifacts and evaluates selected
 * story/character/relationship/voice bible rules with binary gates only.
 * It intentionally does not ask the model for a numeric confidence score.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

import db from "../../src/db/connection"
import { callAgent } from "../../src/llm"
import type { ChapterOutline, CharacterProfile, SceneBeat, SeedInput, StorySpine, WorldBible } from "../../src/types"
import {
  buildAuthoringBiblePacket,
  deriveAuthoringBibleOutcome,
  renderAuthoringBibleSlice,
  selectAuthoringBibleSlice,
  type AuthoringBibleGateOutcome,
  type AuthoringBibleGateReview,
  type AuthoringBibleRepairLayer,
  type AuthoringBibleRule,
  type AuthoringBibleSlice,
  type AuthoringBibleVerdict,
} from "../../src/harness/authoring-bible"

type ModelId = "deepseek-v4-flash" | "deepseek-v4-pro"

interface Args {
  novelId: string
  chapters: number[] | null
  live: boolean
  model: ModelId
  maxTokens: number
  concurrency: number
  outputDir: string | null
  setName: string
  maxRulesPerScene: number
  json: boolean
}

interface ChapterRow {
  chapterNumber: number
  outline: ChapterOutline
  prose: string
  wordCount: number
  sceneProseBySceneId: Map<string, string>
}

type ProseSource = "scene_writer_call" | "chapter_draft"

interface AuthoringBibleReviewTask {
  taskId: string
  chapterNumber: number
  sceneIndex: number
  sceneId: string
  rule: AuthoringBibleRule
  slice: AuthoringBibleSlice
  prose: string
  proseSource: ProseSource
}

interface AuthoringBibleReviewResult extends AuthoringBibleReviewTask {
  outcome: AuthoringBibleGateOutcome
  error?: string
}

interface AuthoringBibleReviewReport {
  generatedAt: string
  novelId: string
  setName: string
  live: boolean
  model: ModelId
  taskCount: number
  results: AuthoringBibleReviewResult[]
  summaries: Array<{ verdict: AuthoringBibleVerdict; count: number }>
  repairLayers: Array<{ repairLayer: AuthoringBibleRepairLayer; count: number }>
}

const reviewSchema = z.object({
  applicable: z.boolean().nullable(),
  proseEvidencePresent: z.boolean(),
  ruleSatisfied: z.boolean().nullable(),
  contradictionPresent: z.boolean(),
  evidenceSpecific: z.boolean(),
  repairLayer: z.enum(["none", "planning", "character_bible", "voice_bible", "prose"]),
  evidence: z.object({
    ruleText: z.string().default(""),
    proseMoment: z.string().default(""),
    mismatch: z.string().default(""),
    satisfaction: z.string().default(""),
  }).default({}),
})

type ReviewOutput = z.infer<typeof reviewSchema>

export async function buildAuthoringBibleReviewReport(
  args: Args,
  generatedAt = new Date().toISOString(),
): Promise<AuthoringBibleReviewReport> {
  const novel = await loadNovelArtifacts(args.novelId)
  const chapters = await loadChapterRows(args.novelId, args.chapters)
  const packet = buildAuthoringBiblePacket({
    genre: novel.seed.genre,
    worldBible: novel.worldBible,
    storySpine: novel.storySpine,
    characters: novel.characters,
  })
  const tasks = buildReviewTasks(chapters, packet, args.maxRulesPerScene)
  const results = await runBounded(tasks.map(task => async () => {
    try {
      const review = args.live
        ? await judgeTaskLive(task, args)
        : dryReview(task)
      return { ...task, outcome: deriveAuthoringBibleOutcome(review) }
    } catch (err) {
      const review = dryReview(task, err instanceof Error ? err.message : String(err))
      return {
        ...task,
        outcome: deriveAuthoringBibleOutcome(review),
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }), args.concurrency)

  return {
    generatedAt,
    novelId: args.novelId,
    setName: args.setName,
    live: args.live,
    model: args.model,
    taskCount: tasks.length,
    results,
    summaries: summarizeVerdicts(results),
    repairLayers: summarizeRepairLayers(results),
  }
}

export function renderAuthoringBibleReviewReport(report: AuthoringBibleReviewReport): string {
  const lines = [
    "# Authoring Bible Review",
    "",
    `Novel: ${report.novelId}`,
    `Set: ${report.setName}`,
    `Live: ${report.live}`,
    `Model: ${report.model}`,
    `Tasks: ${report.taskCount}`,
    "",
    "## Verdicts",
    ...report.summaries.map(row => `- ${row.verdict}: ${row.count}`),
    "",
    "## Repair Layers",
    ...report.repairLayers.map(row => `- ${row.repairLayer}: ${row.count}`),
  ]
  const misses = report.results.filter(row => row.outcome.verdict === "miss")
  if (misses.length > 0) {
    lines.push("", "## Misses")
    for (const row of misses.slice(0, 30)) {
      lines.push(`- ch${row.chapterNumber} scene${row.sceneIndex + 1} ${row.rule.id}: ${row.outcome.evidence.mismatch || "binary gates marked miss"}`)
    }
  }
  const uncertain = report.results.filter(row => row.outcome.verdict === "uncertain")
  if (uncertain.length > 0) {
    lines.push("", "## Uncertain")
    for (const row of uncertain.slice(0, 30)) {
      const reason = row.error ?? row.outcome.evidence.mismatch ?? "insufficient specific evidence"
      lines.push(`- ch${row.chapterNumber} scene${row.sceneIndex + 1} ${row.rule.id}: ${reason}`)
    }
  }
  return lines.join("\n")
}

function buildReviewTasks(
  chapters: ChapterRow[],
  packet: ReturnType<typeof buildAuthoringBiblePacket>,
  maxRulesPerScene: number,
): AuthoringBibleReviewTask[] {
  const tasks: AuthoringBibleReviewTask[] = []
  for (const chapter of chapters) {
    for (let sceneIndex = 0; sceneIndex < chapter.outline.scenes.length; sceneIndex++) {
      const scene = chapter.outline.scenes[sceneIndex]!
      const slice = selectAuthoringBibleSlice({ packet, outline: chapter.outline, scene, sceneIndex })
      if (!slice) continue
      const sceneId = scene.sceneId ?? scene.beatId ?? `ch${chapter.chapterNumber}-scene${sceneIndex + 1}`
      const sceneProse = proseForScene({ chapter, scene, sceneIndex, sceneId })
      const rules = [
        ...slice.storyRules,
        ...slice.characterRules,
        ...slice.relationshipRules,
        ...slice.voiceRules,
      ].slice(0, maxRulesPerScene)
      for (const rule of rules) {
        tasks.push({
          taskId: `ch${chapter.chapterNumber}-${sceneId}-${rule.id}`,
          chapterNumber: chapter.chapterNumber,
          sceneIndex,
          sceneId,
          rule,
          slice,
          prose: sceneProse.prose,
          proseSource: sceneProse.source,
        })
      }
    }
  }
  return tasks
}

async function judgeTaskLive(task: AuthoringBibleReviewTask, args: Args): Promise<AuthoringBibleGateReview> {
  const result = await callAgent({
    agentName: "authoring-bible-review",
    novelId: args.novelId,
    chapter: task.chapterNumber,
    beatIndex: task.sceneIndex,
    sceneId: task.sceneId,
    systemPrompt: [
      "You are an advisory authoring-bible judge.",
      "Return only JSON matching the schema.",
      "Do not emit numeric confidence.",
      "Use binary gates. If evidence is incomplete, set uncertain-driving gates accordingly instead of guessing.",
    ].join("\n"),
    userPrompt: buildJudgePrompt(task),
    schema: reviewSchema,
    temperature: 0,
    maxTokens: args.maxTokens,
    thinking: false,
    model: args.model,
  })
  return normalizeReview(task.rule.id, result.output)
}

function buildJudgePrompt(task: AuthoringBibleReviewTask): string {
  return [
    `RULE ID: ${task.rule.id}`,
    `Rule kind: ${task.rule.kind}`,
    `Rule text: ${task.rule.text}`,
    `Applies when: ${task.rule.appliesWhen}`,
    "",
    "ACTIVE BIBLE SLICE:",
    renderAuthoringBibleSlice(task.slice),
    "",
    task.proseSource === "scene_writer_call"
      ? "SCENE PROSE:"
      : "CHAPTER PROSE FALLBACK (judge only the active scene/rule if possible):",
    task.prose,
    "",
    "Return JSON fields:",
    "- applicable: true only if this rule should be evaluated for this scene/prose.",
    "- proseEvidencePresent: true only if you can point to a concrete prose moment for the rule.",
    "- ruleSatisfied: true/false when applicable and evidence is specific; null when not applicable or uncertain.",
    "- contradictionPresent: true only when prose clearly contradicts the rule.",
    "- evidenceSpecific: true only when the evidence names a concrete action, line, choice, description, or omission.",
    "- repairLayer: none | planning | character_bible | voice_bible | prose.",
    "- evidence: short strings only; do not quote long passages.",
  ].join("\n")
}

function normalizeReview(ruleId: string, output: ReviewOutput): AuthoringBibleGateReview {
  return {
    ruleId,
    gates: {
      applicable: output.applicable,
      proseEvidencePresent: output.proseEvidencePresent,
      ruleSatisfied: output.ruleSatisfied,
      contradictionPresent: output.contradictionPresent,
      evidenceSpecific: output.evidenceSpecific,
    },
    repairLayer: output.repairLayer,
    evidence: output.evidence,
  }
}

function dryReview(task: AuthoringBibleReviewTask, error?: string): AuthoringBibleGateReview {
  return {
    ruleId: task.rule.id,
    gates: {
      applicable: true,
      proseEvidencePresent: false,
      ruleSatisfied: null,
      contradictionPresent: false,
      evidenceSpecific: false,
      judgeAbstained: Boolean(error),
    },
    repairLayer: "none",
    evidence: {
      ruleText: task.rule.text,
      mismatch: error ?? "dry-run: no model judgment",
    },
  }
}

async function loadNovelArtifacts(novelId: string): Promise<{
  seed: SeedInput
  worldBible: WorldBible | null
  storySpine: StorySpine | null
  characters: CharacterProfile[]
}> {
  const novelRows = await db`SELECT seed_json FROM novels WHERE id = ${novelId}` as Array<{ seed_json: SeedInput }>
  if (!novelRows.length) throw new Error(`novel not found: ${novelId}`)
  const worldRows = await db`SELECT content_json FROM world_bibles WHERE novel_id = ${novelId}` as Array<{ content_json: WorldBible }>
  const spineRows = await db`SELECT content_json FROM story_spines WHERE novel_id = ${novelId}` as Array<{ content_json: StorySpine }>
  const characterRows = await db`SELECT profile_json FROM characters WHERE novel_id = ${novelId} ORDER BY id` as Array<{ profile_json: CharacterProfile }>
  return {
    seed: novelRows[0]!.seed_json,
    worldBible: worldRows[0]?.content_json ?? null,
    storySpine: spineRows[0]?.content_json ?? null,
    characters: characterRows.map(row => row.profile_json),
  }
}

async function loadChapterRows(novelId: string, chapterFilter: number[] | null): Promise<ChapterRow[]> {
  const draftRows = await db`
    SELECT chapter_number, prose, word_count, version
    FROM chapter_drafts
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number ASC, version DESC
  ` as Array<{ chapter_number: number; prose: string; word_count: number; version: number }>
  const latestDraftByChapter = new Map<number, { prose: string; wordCount: number }>()
  for (const row of draftRows) {
    if (latestDraftByChapter.has(row.chapter_number)) continue
    latestDraftByChapter.set(row.chapter_number, { prose: row.prose, wordCount: row.word_count })
  }
  const outlineRows = await db`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number ASC
  ` as Array<{ chapter_number: number; outline_json: ChapterOutline }>
  const writerRows = await db`
    SELECT chapter, beat_index, scene_id, beat_id, response_content
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND phase = 'drafting'
      AND agent = 'beat-writer'
      AND failed IS NOT TRUE
      AND response_content IS NOT NULL
    ORDER BY timestamp DESC
  ` as Array<{
    chapter: number | null
    beat_index: number | null
    scene_id: string | null
    beat_id: string | null
    response_content: string | null
  }>
  const sceneProseByChapter = new Map<number, Map<string, string>>()
  for (const row of writerRows) {
    if (typeof row.chapter !== "number") continue
    const prose = row.response_content?.trim()
    if (!prose) continue
    const byKey = sceneProseByChapter.get(row.chapter) ?? new Map<string, string>()
    sceneProseByChapter.set(row.chapter, byKey)
    for (const key of [row.scene_id, row.beat_id, typeof row.beat_index === "number" ? `index:${row.beat_index}` : null]) {
      if (key && !byKey.has(key)) byKey.set(key, prose)
    }
  }

  const filter = chapterFilter && chapterFilter.length > 0 ? new Set(chapterFilter) : null
  return outlineRows.flatMap(row => {
    if (filter && !filter.has(row.chapter_number)) return []
    const draft = latestDraftByChapter.get(row.chapter_number)
    if (!draft) return []
    return [{
      chapterNumber: row.chapter_number,
      outline: row.outline_json,
      prose: draft.prose,
      wordCount: draft.wordCount,
      sceneProseBySceneId: sceneProseByChapter.get(row.chapter_number) ?? new Map(),
    }]
  })
}

function proseForScene(input: {
  chapter: ChapterRow
  scene: SceneBeat
  sceneIndex: number
  sceneId: string
}): { prose: string; source: ProseSource } {
  for (const key of [input.sceneId, input.scene.sceneId, input.scene.beatId, `index:${input.sceneIndex}`]) {
    if (!key) continue
    const prose = input.chapter.sceneProseBySceneId.get(key)
    if (prose?.trim()) return { prose, source: "scene_writer_call" }
  }
  return { prose: input.chapter.prose, source: "chapter_draft" }
}

async function runBounded<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]!()
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length || 1)) }, () => worker()))
  return results
}

function summarizeVerdicts(results: AuthoringBibleReviewResult[]): Array<{ verdict: AuthoringBibleVerdict; count: number }> {
  const counts = countBy(results.map(row => row.outcome.verdict))
  return (["pass", "miss", "uncertain", "not_applicable"] as AuthoringBibleVerdict[])
    .map(verdict => ({ verdict, count: counts[verdict] ?? 0 }))
    .filter(row => row.count > 0)
}

function summarizeRepairLayers(results: AuthoringBibleReviewResult[]): Array<{ repairLayer: AuthoringBibleRepairLayer; count: number }> {
  const counts = countBy(results.map(row => row.outcome.repairLayer))
  return (["planning", "character_bible", "voice_bible", "prose", "none"] as AuthoringBibleRepairLayer[])
    .map(repairLayer => ({ repairLayer, count: counts[repairLayer] ?? 0 }))
    .filter(row => row.count > 0)
}

function countBy<T extends string>(values: T[]): Record<T, number> {
  const out = {} as Record<T, number>
  for (const value of values) out[value] = (out[value] ?? 0) + 1
  return out
}

function parseArgs(argv: string[]): Args {
  let novelId = ""
  let chapters: number[] | null = null
  let live = false
  let model: ModelId = "deepseek-v4-flash"
  let maxTokens = 1200
  let concurrency = 4
  let outputDir: string | null = null
  let setName = `authoring-bible-review:${new Date().toISOString().slice(0, 10)}`
  let maxRulesPerScene = 12
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--novel-id" || arg === "--novel") { novelId = argv[++i] ?? ""; continue }
    if (arg === "--chapters") { chapters = parseChapterList(argv[++i] ?? ""); continue }
    if (arg === "--live") { live = true; continue }
    if (arg === "--dry-run") { live = false; continue }
    if (arg === "--model") { model = parseModel(argv[++i] ?? ""); continue }
    if (arg === "--max-tokens") { maxTokens = positiveInt(argv[++i] ?? "", "--max-tokens"); continue }
    if (arg === "--concurrency") { concurrency = positiveInt(argv[++i] ?? "", "--concurrency"); continue }
    if (arg === "--output-dir") { outputDir = argv[++i] ?? null; continue }
    if (arg === "--set-name") { setName = argv[++i] ?? setName; continue }
    if (arg === "--max-rules-per-scene") { maxRulesPerScene = positiveInt(argv[++i] ?? "", "--max-rules-per-scene"); continue }
    if (arg === "--json") { json = true; continue }
    throw new Error(`unknown arg: ${arg}`)
  }
  if (!novelId) throw new Error("--novel-id is required")
  return { novelId, chapters, live, model, maxTokens, concurrency, outputDir, setName, maxRulesPerScene, json }
}

function parseChapterList(raw: string): number[] {
  const out: number[] = []
  for (const part of raw.split(",")) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const range = trimmed.match(/^(\d+)-(\d+)$/)
    if (range) {
      const start = Number.parseInt(range[1]!, 10)
      const end = Number.parseInt(range[2]!, 10)
      for (let n = start; n <= end; n++) out.push(n)
    } else {
      out.push(Number.parseInt(trimmed, 10))
    }
  }
  return [...new Set(out.filter(Number.isFinite))].sort((a, b) => a - b)
}

function positiveInt(raw: string, name: string): number {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} requires a positive integer`)
  return parsed
}

function parseModel(raw: string): ModelId {
  if (raw === "deepseek-v4-flash" || raw === "deepseek-v4-pro") return raw
  throw new Error(`unsupported --model: ${raw}`)
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  const report = await buildAuthoringBibleReviewReport(args)
  const outputDir = args.outputDir ?? join("output", "authoring-bible-review", args.novelId, args.setName.replace(/[^a-zA-Z0-9_.-]+/g, "-"))
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, "authoring-bible-review.json"), JSON.stringify(report, null, 2))
  writeFileSync(join(outputDir, "authoring-bible-review.md"), renderAuthoringBibleReviewReport(report))
  if (args.json) {
    console.log(JSON.stringify({ ok: true, outputDir, taskCount: report.taskCount, summaries: report.summaries }, null, 2))
  } else {
    console.log(renderAuthoringBibleReviewReport(report))
    console.log(`\nArtifacts: ${outputDir}`)
  }
  return 0
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(code => process.exit(code)).catch(err => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}

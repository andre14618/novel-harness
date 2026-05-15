#!/usr/bin/env bun
/**
 * Advisory character-voice differentiation review.
 *
 * Reads persisted scene/chapter prose and asks whether scenes with multiple
 * named characters create distinguishable character voices. Binary/categorical
 * gates only; no numeric confidence and no runtime blocking.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

import { resolveAuthoringBiblePackIds } from "../../src/config/pipeline"
import db from "../../src/db/connection"
import {
  buildAuthoringBiblePacket,
  selectAuthoringBibleSlice,
  type AuthoringBibleRule,
} from "../../src/harness/authoring-bible"
import { callAgent } from "../../src/llm"
import { initNovelRun } from "../../src/logger"
import type { ChapterOutline, CharacterProfile, SceneBeat, SeedInput, StorySpine, WorldBible } from "../../src/types"

type ModelId = "deepseek-v4-flash" | "deepseek-v4-pro"
type ProseSource = "scene_writer_call" | "chapter_draft"
export type VoiceDifferentiationVerdict = "pass" | "miss" | "uncertain" | "not_applicable"
export type VoiceDifferentiationRepairLayer = "none" | "planning" | "character_bible" | "voice_bible" | "prose"

interface Args {
  novelId: string
  chapters: number[] | null
  live: boolean
  model: ModelId
  maxTokens: number
  concurrency: number
  outputDir: string | null
  setName: string
  packIds: string[]
  maxScenes: number
  json: boolean
}

interface ChapterRow {
  chapterNumber: number
  outline: ChapterOutline
  prose: string
  sceneProseBySceneId: Map<string, string>
}

interface VoiceReviewTask {
  taskId: string
  chapterNumber: number
  sceneIndex: number
  sceneId: string
  sceneNames: string[]
  prose: string
  proseSource: ProseSource
  voiceRules: AuthoringBibleRule[]
}

export interface CharacterVoiceSignal {
  name: string
  evidencePresent: boolean
  distinctFromOthers: boolean | null
  evidence: string
  missingReason: string
}

export interface VoiceDifferentiationReview {
  sceneHasMultipleSpeakingCharacters: boolean
  voicesDifferentiated: boolean | null
  characterSignals: CharacterVoiceSignal[]
  attributionRisk: "low" | "medium" | "high"
  repairLayer: VoiceDifferentiationRepairLayer
  summary: string
}

interface VoiceReviewResult extends VoiceReviewTask {
  review: VoiceDifferentiationReview
  verdict: VoiceDifferentiationVerdict
  error?: string
}

interface VoiceDifferentiationReport {
  generatedAt: string
  novelId: string
  setName: string
  packIds: string[]
  live: boolean
  model: ModelId
  taskCount: number
  summaries: Array<{ verdict: VoiceDifferentiationVerdict; count: number }>
  repairLayers: Array<{ repairLayer: VoiceDifferentiationRepairLayer; count: number }>
  results: VoiceReviewResult[]
}

const characterVoiceSignalSchema = z.preprocess(normalizeCharacterVoiceSignalPayload, z.object({
  name: z.string().default(""),
  evidencePresent: z.boolean(),
  distinctFromOthers: z.boolean().nullable(),
  evidence: z.string().default(""),
  missingReason: z.string().default(""),
}))

const voiceReviewSchema = z.preprocess(normalizeVoiceDifferentiationReviewPayload, z.object({
  sceneHasMultipleSpeakingCharacters: z.boolean(),
  voicesDifferentiated: z.boolean().nullable(),
  characterSignals: z.array(characterVoiceSignalSchema).default([]),
  attributionRisk: z.enum(["low", "medium", "high"]),
  repairLayer: z.enum(["none", "planning", "character_bible", "voice_bible", "prose"]),
  summary: z.string().default(""),
}))

type VoiceReviewOutput = z.infer<typeof voiceReviewSchema>

export function normalizeVoiceDifferentiationReviewPayload(value: unknown): unknown {
  if (!isRecord(value)) return value
  return {
    sceneHasMultipleSpeakingCharacters: booleanValue(
      value.sceneHasMultipleSpeakingCharacters ?? value.scene_has_multiple_speaking_characters,
      false,
    ),
    voicesDifferentiated: nullableBooleanValue(value.voicesDifferentiated ?? value.voices_differentiated),
    characterSignals: normalizeCharacterVoiceSignalsPayload(value.characterSignals ?? value.character_signals),
    attributionRisk: normalizeAttributionRisk(value.attributionRisk ?? value.attribution_risk),
    repairLayer: normalizeRepairLayer(value.repairLayer ?? value.repair_layer),
    summary: stringValue(value.summary),
  }
}

function normalizeCharacterVoiceSignalsPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value
  if (isRecord(value)) {
    return Object.entries(value).map(([name, signal]) => {
      if (isRecord(signal)) return { name, ...signal }
      return { name, evidence: stringValue(signal), evidencePresent: Boolean(stringValue(signal)) }
    })
  }
  return []
}

function normalizeCharacterVoiceSignalPayload(value: unknown): unknown {
  if (!isRecord(value)) {
    return {
      name: "",
      evidencePresent: false,
      distinctFromOthers: null,
      evidence: stringValue(value),
      missingReason: "",
    }
  }
  return {
    name: stringValue(value.name ?? value.character ?? value.characterName ?? value.character_name),
    evidencePresent: booleanValue(
      value.evidencePresent ?? value.evidence_present ?? value.hasEvidence ?? value.has_evidence,
      Boolean(stringValue(value.evidence ?? value.proseEvidence ?? value.prose_evidence)),
    ),
    distinctFromOthers: nullableBooleanValue(
      value.distinctFromOthers ?? value.distinct_from_others ?? value.distinctive ?? value.voiceDistinct,
    ),
    evidence: stringValue(value.evidence ?? value.proseEvidence ?? value.prose_evidence),
    missingReason: stringValue(value.missingReason ?? value.missing_reason ?? value.reason),
  }
}

export async function buildVoiceDifferentiationReport(
  args: Args,
  generatedAt = new Date().toISOString(),
): Promise<VoiceDifferentiationReport> {
  const novel = await loadNovelArtifacts(args.novelId)
  const chapters = await loadChapterRows(args.novelId, args.chapters)
  const packIds = args.packIds.length > 0
    ? args.packIds
    : resolveAuthoringBiblePackIds(novel.seed.pipelineOverrides)
  const packet = buildAuthoringBiblePacket({
    genre: novel.seed.genre,
    worldBible: novel.worldBible,
    storySpine: novel.storySpine,
    characters: novel.characters,
    packIds,
  })
  const tasks = buildReviewTasks(chapters, packet).slice(0, args.maxScenes)
  const results = await runBounded(tasks.map(task => async () => {
    try {
      const review = args.live ? await judgeTaskLive(task, args) : dryReview(task)
      return { ...task, review, verdict: deriveVoiceDifferentiationVerdict(review) }
    } catch (err) {
      const review = dryReview(task, err instanceof Error ? err.message : String(err))
      return {
        ...task,
        review,
        verdict: deriveVoiceDifferentiationVerdict(review),
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }), args.concurrency)

  return {
    generatedAt,
    novelId: args.novelId,
    setName: args.setName,
    packIds: packet.packIds,
    live: args.live,
    model: args.model,
    taskCount: tasks.length,
    summaries: summarizeVerdicts(results),
    repairLayers: summarizeRepairLayers(results),
    results,
  }
}

export function deriveVoiceDifferentiationVerdict(review: VoiceDifferentiationReview): VoiceDifferentiationVerdict {
  if (!review.sceneHasMultipleSpeakingCharacters) return "not_applicable"
  if (review.voicesDifferentiated === true && review.characterSignals.some(signal => signal.evidencePresent)) {
    return "pass"
  }
  if (review.voicesDifferentiated === false || review.attributionRisk === "high") return "miss"
  return "uncertain"
}

function buildReviewTasks(chapters: ChapterRow[], packet: ReturnType<typeof buildAuthoringBiblePacket>): VoiceReviewTask[] {
  const tasks: VoiceReviewTask[] = []
  for (const chapter of chapters) {
    for (let sceneIndex = 0; sceneIndex < chapter.outline.scenes.length; sceneIndex++) {
      const scene = chapter.outline.scenes[sceneIndex]!
      const sceneNames = sceneNamesFor(chapter.outline, scene)
      if (sceneNames.length < 2) continue
      const slice = selectAuthoringBibleSlice({ packet, outline: chapter.outline, scene, sceneIndex })
      if (!slice) continue
      const sceneId = scene.sceneId ?? scene.beatId ?? `ch${chapter.chapterNumber}-scene${sceneIndex + 1}`
      const sceneProse = proseForScene({ chapter, scene, sceneIndex, sceneId })
      tasks.push({
        taskId: `ch${chapter.chapterNumber}-${sceneId}-voice-differentiation`,
        chapterNumber: chapter.chapterNumber,
        sceneIndex,
        sceneId,
        sceneNames,
        prose: sceneProse.prose,
        proseSource: sceneProse.source,
        voiceRules: [
          ...slice.characterRules.filter(rule => isVoiceRelevantCharacterRule(rule)),
          ...slice.voiceRules,
        ],
      })
    }
  }
  return tasks
}

function isVoiceRelevantCharacterRule(rule: AuthoringBibleRule): boolean {
  const text = `${rule.id} ${rule.title} ${rule.text}`.toLowerCase()
  return text.includes("voice") || text.includes("dialogue") || text.includes("speech")
}

async function judgeTaskLive(task: VoiceReviewTask, args: Args): Promise<VoiceDifferentiationReview> {
  const result = await callAgent({
    agentName: "character-voice-differentiation-review",
    novelId: args.novelId,
    chapter: task.chapterNumber,
    beatIndex: task.sceneIndex,
    sceneId: task.sceneId,
    systemPrompt: [
      "You are an advisory prose voice judge.",
      "Judge only whether named characters in this scene have distinguishable voice/personality signals.",
      "Return only JSON matching the schema.",
      "Do not emit numeric confidence.",
      "Use binary/categorical fields. If evidence is incomplete, use null/medium instead of guessing.",
    ].join("\n"),
    userPrompt: buildJudgePrompt(task),
    schema: voiceReviewSchema,
    temperature: 0,
    maxTokens: args.maxTokens,
    thinking: false,
    model: args.model,
  })
  return normalizeReview(result.output)
}

function buildJudgePrompt(task: VoiceReviewTask): string {
  return [
    `SCENE ID: ${task.sceneId}`,
    `Named scene characters: ${task.sceneNames.join(", ")}`,
    "",
    "VOICE RULES AND CARDS:",
    ...task.voiceRules.map(rule => `- [${rule.id}] ${rule.title}: ${rule.text}`),
    "",
    task.proseSource === "scene_writer_call" ? "SCENE PROSE:" : "CHAPTER PROSE FALLBACK:",
    task.prose,
    "",
    "Return JSON fields:",
    "- sceneHasMultipleSpeakingCharacters: true only if the prose gives more than one named character a meaningful speaking or personality-bearing presence.",
    "- voicesDifferentiated: true when a reader could tell the characters apart from diction, rhythm, priorities, or behavior without relying only on dialogue tags; false when voices blur; null when evidence is insufficient.",
    "- characterSignals: one entry per relevant named character, with short evidence and no long quotes.",
    "- attributionRisk: low | medium | high for voice/identity blur.",
    "- repairLayer: none | planning | character_bible | voice_bible | prose.",
    "- summary: short reason.",
  ].join("\n")
}

function normalizeReview(output: VoiceReviewOutput): VoiceDifferentiationReview {
  return {
    sceneHasMultipleSpeakingCharacters: output.sceneHasMultipleSpeakingCharacters,
    voicesDifferentiated: output.voicesDifferentiated,
    characterSignals: output.characterSignals,
    attributionRisk: output.attributionRisk,
    repairLayer: output.repairLayer,
    summary: output.summary,
  }
}

function dryReview(task: VoiceReviewTask, error?: string): VoiceDifferentiationReview {
  return {
    sceneHasMultipleSpeakingCharacters: task.sceneNames.length > 1,
    voicesDifferentiated: null,
    characterSignals: task.sceneNames.map(name => ({
      name,
      evidencePresent: false,
      distinctFromOthers: null,
      evidence: "",
      missingReason: error ?? "dry-run: no model judgment",
    })),
    attributionRisk: "medium",
    repairLayer: "none",
    summary: error ?? "dry-run: no model judgment",
  }
}

function renderVoiceDifferentiationReport(report: VoiceDifferentiationReport): string {
  const lines = [
    "# Character Voice Differentiation Review",
    "",
    `Novel: ${report.novelId}`,
    `Set: ${report.setName}`,
    `Packs: ${report.packIds.join(", ") || "none"}`,
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
  const weak = report.results.filter(row => row.verdict === "miss" || row.verdict === "uncertain")
  if (weak.length > 0) {
    lines.push("", "## Weak Rows")
    for (const row of weak.slice(0, 30)) {
      lines.push(`- ${row.verdict.toUpperCase()} ch${row.chapterNumber} scene${row.sceneIndex + 1} ${row.sceneId}: ${row.review.summary || row.review.attributionRisk}`)
    }
  }
  lines.push("", "## Scene Reviews")
  for (const row of report.results) {
    lines.push("", `### ch${row.chapterNumber} scene${row.sceneIndex + 1} ${row.sceneId}`)
    lines.push(`- verdict: ${row.verdict}`)
    lines.push(`- source: ${row.proseSource}`)
    lines.push(`- characters: ${row.sceneNames.join(", ")}`)
    lines.push(`- attribution risk: ${row.review.attributionRisk}`)
    lines.push(`- repair layer: ${row.review.repairLayer}`)
    if (row.review.summary) lines.push(`- summary: ${row.review.summary}`)
    for (const signal of row.review.characterSignals) {
      lines.push(`- ${signal.name}: evidence=${signal.evidencePresent}; distinct=${signal.distinctFromOthers}; ${signal.evidence || signal.missingReason}`)
    }
  }
  return `${lines.join("\n")}\n`
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
    SELECT chapter_number, prose, version
    FROM chapter_drafts
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number ASC, version DESC
  ` as Array<{ chapter_number: number; prose: string; version: number }>
  const latestDraftByChapter = new Map<number, string>()
  for (const row of draftRows) {
    if (latestDraftByChapter.has(row.chapter_number)) continue
    latestDraftByChapter.set(row.chapter_number, row.prose)
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
    return [{
      chapterNumber: row.chapter_number,
      outline: row.outline_json,
      prose: latestDraftByChapter.get(row.chapter_number) ?? "",
      sceneProseBySceneId: sceneProseByChapter.get(row.chapter_number) ?? new Map<string, string>(),
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

function sceneNamesFor(outline: ChapterOutline, scene: SceneBeat): string[] {
  return uniqueStrings([outline.povCharacter, ...(scene.characters ?? [])])
}

function summarizeVerdicts(results: VoiceReviewResult[]): Array<{ verdict: VoiceDifferentiationVerdict; count: number }> {
  const order: VoiceDifferentiationVerdict[] = ["pass", "miss", "uncertain", "not_applicable"]
  return order.map(verdict => ({ verdict, count: results.filter(row => row.verdict === verdict).length }))
}

function summarizeRepairLayers(results: VoiceReviewResult[]): Array<{ repairLayer: VoiceDifferentiationRepairLayer; count: number }> {
  const order: VoiceDifferentiationRepairLayer[] = ["none", "planning", "character_bible", "voice_bible", "prose"]
  return order.map(repairLayer => ({ repairLayer, count: results.filter(row => row.review.repairLayer === repairLayer).length }))
}

async function runBounded<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (;;) {
      const index = next++
      if (index >= tasks.length) return
      results[index] = await tasks[index]!()
    }
  })
  await Promise.all(workers)
  return results
}

function parseArgs(argv: string[]): Args {
  let novelId = ""
  let chapters: number[] | null = null
  let live = false
  let model: ModelId = "deepseek-v4-flash"
  let maxTokens = 1000
  let concurrency = 4
  let outputDir: string | null = null
  let setName = `character-voice-differentiation:${new Date().toISOString().slice(0, 10)}`
  let packIds: string[] = []
  let maxScenes = 24
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
    if (arg === "--pack-id") { packIds = uniqueStrings([...packIds, argv[++i] ?? ""]); continue }
    if (arg === "--pack-ids") { packIds = uniqueStrings([...packIds, ...parseStringList(argv[++i] ?? "")]); continue }
    if (arg === "--max-scenes") { maxScenes = positiveInt(argv[++i] ?? "", "--max-scenes"); continue }
    if (arg === "--json") { json = true; continue }
    throw new Error(`unknown arg: ${arg}`)
  }
  if (!novelId) throw new Error("--novel-id is required")
  return { novelId, chapters, live, model, maxTokens, concurrency, outputDir, setName, packIds, maxScenes, json }
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

function parseStringList(raw: string): string[] {
  return raw.split(",").map(value => value.trim()).filter(Boolean)
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

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map(value => value?.trim() ?? "").filter(Boolean))]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value
  if (value == null) return ""
  return String(value)
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  const parsed = nullableBooleanValue(value)
  return parsed ?? fallback
}

function nullableBooleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  if (typeof value === "number") {
    if (value === 1) return true
    if (value === 0) return false
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["true", "yes", "pass", "present", "low"].includes(normalized)) return true
    if (["false", "no", "miss", "absent", "none"].includes(normalized)) return false
    if (["null", "uncertain", "unknown", "insufficient", ""].includes(normalized)) return null
  }
  return null
}

function normalizeAttributionRisk(value: unknown): "low" | "medium" | "high" {
  const normalized = stringValue(value).trim().toLowerCase()
  if (normalized === "low" || normalized === "medium" || normalized === "high") return normalized
  return "medium"
}

function normalizeRepairLayer(value: unknown): VoiceDifferentiationRepairLayer {
  const normalized = stringValue(value).trim().toLowerCase()
  if (normalized === "planning" || normalized === "character_bible" || normalized === "voice_bible" || normalized === "prose") return normalized
  return "none"
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  if (args.live) await initNovelRun(args.novelId)
  const report = await buildVoiceDifferentiationReport(args)
  const outputDir = args.outputDir ?? join("output", "character-voice-differentiation", args.novelId, args.setName.replace(/[^a-zA-Z0-9_.-]+/g, "-"))
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, "character-voice-differentiation-review.json"), JSON.stringify(report, null, 2))
  writeFileSync(join(outputDir, "character-voice-differentiation-review.md"), renderVoiceDifferentiationReport(report))
  if (args.json) {
    console.log(JSON.stringify({ ok: true, outputDir, taskCount: report.taskCount, summaries: report.summaries, repairLayers: report.repairLayers }, null, 2))
  } else {
    console.log(renderVoiceDifferentiationReport(report))
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

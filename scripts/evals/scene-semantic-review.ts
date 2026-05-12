#!/usr/bin/env bun
/**
 * Production-replay narrow scene-semantic LLM judge — L098 Slice 3.5
 * deliverable. Diagnostic-only, replay-only.
 *
 * Reads a persisted novel's outlines + latest persisted drafts from the production DB
 * and runs the existing `judgePlanningExcerpt` narrow rubric (POC ancestor:
 * `scripts/evals/corpus-recreation-semantic-review.ts`) per scene per
 * dimension. Never makes inline drafting calls and never writes back to the
 * novel's pipeline state.
 *
 * The POC excerpt rendering bound prose to a per-scene `chapter.json`. The
 * production runtime persists approved chapter prose as a single string in
 * `chapter_drafts.prose`, but beat-writer calls carry durable `scene_id`
 * telemetry. When those writer-call rows exist, the judge receives the
 * captured per-scene prose; otherwise it falls back to the whole chapter prose
 * with the per-scene contract as the narrow lens.
 *
 * Persistence (when `--persist`): one `eval_briefs` row per (chapter, scene,
 * dimension) tuple keyed by `set_name='scene-semantic-review:<date>'`, one
 * `eval_results` row per task carrying the judged label, ordinal, evidence
 * count, and confidence.
 *
 * Usage:
 *   bun scripts/evals/scene-semantic-review.ts \
 *     --novel-id <persisted-novel-id> \
 *     [--chapters 1-5]                 # default: every chapter with an outline+draft
 *     [--dimension sceneDramaturgy]    # repeatable; default: 6 POC dimensions
 *     [--live]                         # default: synthetic (dry) for testing
 *     [--persist]                      # writes eval rows and imports readiness lows
 *     [--no-readiness-import]          # keep readiness as artifact-only when persisting
 *     [--concurrency 4]
 *     [--set-name <slug>]              # default: scene-semantic-review:YYYYMMDD
 *     [--output-dir <path>]
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import db from "../../src/db/connection"
import { importPlanReadinessAggregateForNovel } from "../../src/harness/plan-readiness-import"
import type { ChapterOutline, SceneBeat } from "../../src/types"
import {
  judgePlanningExcerpt,
  type Dimension,
  type JudgeOutput,
  type PromptMode,
} from "./planner-discernment-calibration"
import {
  buildSceneSemanticReadinessAggregate,
  renderSceneSemanticReadinessAggregate,
} from "./scene-semantic-readiness"

type ModelId = "deepseek-v4-flash" | "deepseek-v4-pro"

export interface SceneSemanticReviewArgs {
  novelId: string
  chapters: number[] | null
  outputDir: string | null
  setName: string
  live: boolean
  persist: boolean
  readinessImport: boolean
  model: ModelId
  thinking: boolean
  maxTokens: number
  concurrency: number
  promptMode: PromptMode
  dimensions: Dimension[]
  json: boolean
}

interface ChapterRow {
  chapterNumber: number
  outline: ChapterOutline
  prose: string
  wordCount: number
  draftVersion: number
  sceneProseBySceneId: Map<string, string>
}

type SceneSemanticProseSource = "scene_writer_call" | "chapter_draft"

export interface SceneSemanticReplayTask {
  taskId: string
  chapterNumber: number
  sceneIndex: number
  sceneId: string
  legacyBeatId?: string
  dimension: Dimension
  promptMode: PromptMode
  proseSource: SceneSemanticProseSource
  excerpt: string
  obligationIds: string[]
  relevantCharacterIds: string[]
  relevantWorldFactIds: string[]
  sceneTurnIds: string[]
  threadIds: string[]
  promiseIds: string[]
  payoffIds: string[]
  sourceIds: string[]
}

export interface SceneSemanticReplaySkip {
  chapterNumber: number
  sceneIndex: number
  sceneId: string
  legacyBeatId?: string
  dimension: Dimension
  reason: string
}

export interface SceneSemanticReplayResult extends SceneSemanticReplayTask {
  label: string
  ordinal: number
  confidence: number
  evidenceFields: number
  missingForNextLevel: string
  output: JudgeOutput
  error?: string
}

export interface SceneSemanticReplayReport {
  generatedAt: string
  novelId: string
  setName: string
  chapters: number[]
  live: boolean
  model: ModelId
  thinking: boolean
  promptMode: PromptMode
  dimensions: Dimension[]
  taskCount: number
  skipCount: number
  results: SceneSemanticReplayResult[]
  skips: SceneSemanticReplaySkip[]
  summaries: Array<{
    dimension: Dimension
    count: number
    meanOrdinal: number
    lowCount: number
    labelCounts: Record<string, number>
  }>
}

const DEFAULT_DIMENSIONS: Dimension[] = [
  "sceneDramaturgy",
  "threadProgression",
  "promisePayoff",
  "motivationSpecificity",
  "worldFactPressure",
  "relationshipDelta",
]
const DEFAULT_MAX_TOKENS = 2200

export function applicabilitySkipReason(dimension: Dimension, counts: {
  worldFactCount: number
  characterCount: number
  threadRefCount: number
  promiseOrPayoffRefCount: number
}): string | null {
  if (dimension === "threadProgression" && counts.threadRefCount === 0) return "no threadId obligation declared for this scene"
  if (dimension === "promisePayoff" && counts.promiseOrPayoffRefCount === 0) return "no promiseId or payoffId obligation declared for this scene"
  if (dimension === "worldFactPressure" && counts.worldFactCount === 0) return "no world-fact sourceId obligation declared for this scene"
  if (dimension === "relationshipDelta" && counts.characterCount === 0) return "no supporting-character sourceId obligation declared for this scene"
  if (dimension === "characterMateriality" && counts.characterCount === 0) return "no supporting-character sourceId obligation declared for this scene"
  return null
}

function flattenObligations(scene: SceneBeat): Array<{
  obligationId?: string
  sourceId?: string
  sourceKind?: string
  characterId?: string
  characterName?: string
  worldFactId?: string
  threadId?: string
  promiseId?: string
  payoffId?: string
  sceneTurnId?: string
  text: string
  materialityTest?: string
}> {
  const out: ReturnType<typeof flattenObligations> = []
  const lists: Array<keyof NonNullable<SceneBeat["obligations"]>> = [
    "mustEstablish", "mustPayOff", "mustTransferKnowledge", "mustShowStateChange", "mustNotReveal",
  ]
  for (const list of lists) {
    const items = (scene.obligations?.[list] ?? []) as Array<Record<string, unknown>>
    for (const item of items) {
      out.push({
        obligationId: typeof item.obligationId === "string" ? item.obligationId : undefined,
        sourceId: typeof item.sourceId === "string" ? item.sourceId : undefined,
        sourceKind: typeof item.sourceKind === "string" ? item.sourceKind : undefined,
        characterId: typeof item.characterId === "string" ? item.characterId : undefined,
        characterName: typeof item.characterName === "string" ? item.characterName : undefined,
        worldFactId: typeof item.worldFactId === "string" ? item.worldFactId : undefined,
        threadId: typeof item.threadId === "string" ? item.threadId : undefined,
        promiseId: typeof item.promiseId === "string" ? item.promiseId : undefined,
        payoffId: typeof item.payoffId === "string" ? item.payoffId : undefined,
        sceneTurnId: typeof item.sceneTurnId === "string" ? item.sceneTurnId : undefined,
        text: typeof item.text === "string" ? item.text : "",
        materialityTest: typeof item.materialityTest === "string" ? item.materialityTest : undefined,
      })
    }
  }
  return out
}

export function buildSceneSemanticReplayTasks(input: {
  chapters: ChapterRow[]
  dimensions: Dimension[]
  promptMode: PromptMode
}): { tasks: SceneSemanticReplayTask[]; skips: SceneSemanticReplaySkip[] } {
  const tasks: SceneSemanticReplayTask[] = []
  const skips: SceneSemanticReplaySkip[] = []

  for (const chapter of input.chapters) {
    const scenes = chapter.outline.scenes ?? []
    for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
      const scene = scenes[sceneIndex]!
      const sceneId = scene.sceneId ?? scene.beatId ?? `ch${chapter.chapterNumber}-scene${sceneIndex + 1}`
      const legacyBeatId = scene.beatId
      const obligations = flattenObligations(scene)
      const sceneProse = proseForScene({ chapter, scene, sceneIndex, sceneId })

      const worldFactCount = obligations.filter(o => o.worldFactId || o.sourceKind === "fact").length
      const characterCount = obligations.filter(o => o.characterId || o.sourceKind === "knowledge" || o.sourceKind === "state").length
      const threadRefCount = obligations.filter(o => o.threadId).length
      const promiseOrPayoffRefCount = obligations.filter(o => o.promiseId || o.payoffId).length

      const obligationIds = obligations.map(o => o.obligationId).filter(Boolean) as string[]
      const characterIds = uniq(obligations.map(o => o.characterId).filter(Boolean) as string[])
      const worldFactIds = uniq(obligations.map(worldFactIdForObligation).filter(Boolean) as string[])
      const sceneTurnIds = uniq(obligations.map(o => o.sceneTurnId).filter(Boolean) as string[])
      const threadIds = uniq(obligations.map(o => o.threadId).filter(Boolean) as string[])
      const promiseIds = uniq(obligations.map(o => o.promiseId).filter(Boolean) as string[])
      const payoffIds = uniq(obligations.map(o => o.payoffId).filter(Boolean) as string[])
      const sourceIds = uniq(obligations.map(o => o.sourceId).filter(Boolean) as string[])

      for (const dimension of input.dimensions) {
        const skipReason = applicabilitySkipReason(dimension, {
          worldFactCount,
          characterCount,
          threadRefCount,
          promiseOrPayoffRefCount,
        })
        if (skipReason) {
          skips.push({ chapterNumber: chapter.chapterNumber, sceneIndex, sceneId, ...(legacyBeatId ? { legacyBeatId } : {}), dimension, reason: skipReason })
          continue
        }
        tasks.push({
          taskId: `ch${chapter.chapterNumber}-${sceneId}-${dimension}`,
          chapterNumber: chapter.chapterNumber,
          sceneIndex,
          sceneId,
          ...(legacyBeatId ? { legacyBeatId } : {}),
          dimension,
          promptMode: input.promptMode,
          proseSource: sceneProse.source,
          excerpt: renderSceneExcerpt({
            chapter,
            sceneIndex,
            scene,
            obligations,
            sceneProse: sceneProse.prose,
            proseSource: sceneProse.source,
          }),
          obligationIds,
          relevantCharacterIds: characterIds,
          relevantWorldFactIds: worldFactIds,
          sceneTurnIds,
          threadIds,
          promiseIds,
          payoffIds,
          sourceIds,
        })
      }
    }
  }
  return { tasks, skips }
}

function renderSceneExcerpt(input: {
  chapter: ChapterRow
  sceneIndex: number
  scene: SceneBeat
  obligations: ReturnType<typeof flattenObligations>
  sceneProse: string
  proseSource: SceneSemanticProseSource
}): string {
  const { chapter, sceneIndex, scene } = input
  const totalScenes = chapter.outline.scenes?.length ?? 0
  const sceneId = scene.sceneId ?? scene.beatId ?? `ch${chapter.chapterNumber}-scene${sceneIndex + 1}`
  const valueShift = scene.valueIn || scene.valueOut
    ? `${scene.valueIn ?? ""} -> ${scene.valueOut ?? ""}`
    : "(none declared)"
  const characterTargets = declaredCharacterTargets(input.obligations)
  const worldFactTargets = declaredWorldFactTargets(input.obligations)
  const storyTargets = declaredStoryTargets(input.obligations)
  return [
    `CHAPTER ${chapter.chapterNumber}: ${chapter.outline.title ?? ""}`,
    `Chapter purpose: ${chapter.outline.purpose ?? "(none)"}`,
    `POV character: ${chapter.outline.povCharacter ?? "(unspecified)"}`,
    `Setting: ${chapter.outline.setting ?? "(unspecified)"}`,
    `Target words: ${chapter.outline.targetWords ?? "(unspecified)"}; actual words: ${chapter.wordCount}`,
    "",
    `SCENE ${sceneIndex + 1} of ${totalScenes} CONTRACT:`,
    `Scene id: ${sceneId}`,
    ...(scene.beatId ? [`Legacy/beat-specific beat id: ${scene.beatId}`] : []),
    `Description: ${scene.description ?? "(none)"}`,
    `Goal: ${(scene as Record<string, unknown>).goal ?? "(none declared)"}`,
    `Opposition: ${(scene as Record<string, unknown>).opposition ?? "(none declared)"}`,
    `Turning point: ${(scene as Record<string, unknown>).turningPoint ?? "(none declared)"}`,
    `Crisis choice: ${(scene as Record<string, unknown>).crisisChoice ?? "(none declared)"}`,
    `Outcome: ${(scene as Record<string, unknown>).outcome ?? "(none declared)"}`,
    `Consequence: ${(scene as Record<string, unknown>).consequence ?? "(none declared)"}`,
    `POV personal stake: ${scene.povPersonalStake ?? "(none declared)"}`,
    `Value shift: ${valueShift}`,
    `MICE/thread: ${(scene as Record<string, unknown>).miceThread ?? "(none declared)"}`,
    "",
    "APPLICABILITY TARGETS:",
    `- characterMateriality targets: ${characterTargets.length > 0 ? characterTargets.join("; ") : "(none declared)"}`,
    `- worldFactPressure targets: ${worldFactTargets.length > 0 ? worldFactTargets.join("; ") : "(none declared)"}`,
    `- thread/promise/payoff targets: ${storyTargets.length > 0 ? storyTargets.join("; ") : "(none declared)"}`,
    "- Judge characterMateriality only against declared characterId/sourceKind=knowledge/state obligations below; do not invent required characters from the scene title, setting, description, or prose.",
    "- Judge worldFactPressure only against declared fact/worldFactId/sourceKind=fact obligations below; do not invent required world facts from setting or prose.",
    "- For thread/promise/payoff dimensions, use only the declared threadId, promiseId, and payoffId refs below.",
    "",
    "SCENE OBLIGATIONS:",
    ...formatList(input.obligations.map(o => {
      const refs = [
        o.obligationId ? `obligationId=${o.obligationId}` : "",
        o.sourceId ? `sourceId=${o.sourceId}` : "",
        o.sourceKind ? `kind=${o.sourceKind}` : "",
        o.characterId ? `characterId=${o.characterId}` : "",
        o.worldFactId ? `worldFactId=${o.worldFactId}` : "",
        o.threadId ? `threadId=${o.threadId}` : "",
        o.promiseId ? `promiseId=${o.promiseId}` : "",
        o.payoffId ? `payoffId=${o.payoffId}` : "",
      ].filter(Boolean).join(" ")
      const materiality = o.materialityTest ? ` materialityTest=${o.materialityTest}` : ""
      return `${refs}: ${o.text}${materiality}`
    })),
    "",
    input.proseSource === "scene_writer_call"
      ? "SCENE PROSE (captured beat-writer response for this scene):"
      : "CHAPTER PROSE (fallback; no per-scene writer call found, judge against this scene's contract):",
    input.sceneProse,
  ].join("\n")
}

function declaredCharacterTargets(obligations: ReturnType<typeof flattenObligations>): string[] {
  return uniq(obligations.flatMap(obligation => {
    if (!obligation.characterId && obligation.sourceKind !== "knowledge" && obligation.sourceKind !== "state") return []
    const label = obligation.characterName ?? obligation.characterId ?? obligation.sourceId ?? obligation.text
    const refs = [obligation.characterId, obligation.sourceId].filter(Boolean).join(", ")
    return refs ? `${label} (${refs})` : label
  }).filter(Boolean))
}

function declaredWorldFactTargets(obligations: ReturnType<typeof flattenObligations>): string[] {
  return uniq(obligations.flatMap(obligation => {
    const id = worldFactIdForObligation(obligation)
    if (!id) return []
    return obligation.text ? `${id}: ${obligation.text}` : id
  }))
}

function declaredStoryTargets(obligations: ReturnType<typeof flattenObligations>): string[] {
  return uniq(obligations.flatMap(obligation => [
    obligation.threadId ? `thread:${obligation.threadId}` : "",
    obligation.promiseId ? `promise:${obligation.promiseId}` : "",
    obligation.payoffId ? `payoff:${obligation.payoffId}` : "",
  ].filter(Boolean)))
}

function proseForScene(input: {
  chapter: ChapterRow
  scene: SceneBeat
  sceneIndex: number
  sceneId: string
}): { prose: string; source: SceneSemanticProseSource } {
  const candidateKeys = [
    input.sceneId,
    input.scene.sceneId,
    input.scene.beatId,
    `index:${input.sceneIndex}`,
  ].filter((key): key is string => typeof key === "string" && key.length > 0)
  for (const key of candidateKeys) {
    const prose = input.chapter.sceneProseBySceneId.get(key)
    if (prose && prose.trim().length > 0) {
      return { prose, source: "scene_writer_call" }
    }
  }
  return { prose: input.chapter.prose, source: "chapter_draft" }
}

function worldFactIdForObligation(obligation: ReturnType<typeof flattenObligations>[number]): string | undefined {
  if (obligation.worldFactId) return obligation.worldFactId
  if (!obligation.sourceId) return undefined
  if (obligation.sourceKind === "fact") return obligation.sourceId
  if (/^(fact|world)-/u.test(obligation.sourceId)) return obligation.sourceId
  return undefined
}

export async function buildSceneSemanticReplayReport(args: SceneSemanticReviewArgs, generatedAt = new Date().toISOString()): Promise<SceneSemanticReplayReport> {
  const chapters = await loadChapterRows(args.novelId, args.chapters)
  if (chapters.length === 0) {
    throw new Error(`no chapters with both an outline and a draft were found for novel ${args.novelId}`)
  }
  const taskPlan = buildSceneSemanticReplayTasks({
    chapters,
    dimensions: args.dimensions,
    promptMode: args.promptMode,
  })

  const results = await runBounded(
    taskPlan.tasks.map(task => async () => {
      try {
        const judged = await judgePlanningExcerpt({
          live: args.live,
          model: args.model,
          thinking: args.thinking,
          maxTokens: args.maxTokens,
          dimension: task.dimension,
          promptMode: task.promptMode,
          caseId: task.taskId,
          text: task.excerpt,
        })
        return {
          ...task,
          label: judged.label,
          ordinal: labelOrdinal(judged.label),
          confidence: clampNumber(Number(judged.output.confidence ?? 0), 0, 1),
          evidenceFields: Object.values(judged.output.evidence ?? {}).filter(Boolean).length,
          missingForNextLevel: judged.output.missingForNextLevel ?? "",
          output: judged.output,
        } satisfies SceneSemanticReplayResult
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        return sceneSemanticReplayErrorResult(task, error)
      }
    }),
    args.concurrency,
  )

  return {
    generatedAt,
    novelId: args.novelId,
    setName: args.setName,
    chapters: chapters.map(row => row.chapterNumber),
    live: args.live,
    model: args.model,
    thinking: args.thinking,
    promptMode: args.promptMode,
    dimensions: args.dimensions,
    taskCount: taskPlan.tasks.length,
    skipCount: taskPlan.skips.length,
    results,
    skips: taskPlan.skips,
    summaries: summarizeResults(successfulResults(results)),
  }
}

function sceneSemanticReplayErrorResult(
  task: SceneSemanticReplayTask,
  error: string,
): SceneSemanticReplayResult {
  return {
    ...task,
    label: "ERROR",
    ordinal: 0,
    confidence: 0,
    evidenceFields: 0,
    missingForNextLevel: `scene semantic judge failed: ${error}`,
    output: {
      label: "ERROR",
      confidence: 0,
      evidence: {},
      missingForNextLevel: `scene semantic judge failed: ${error}`,
      gates: {},
    },
    error,
  }
}

export function renderSceneSemanticReplayReport(report: SceneSemanticReplayReport): string {
  const lines: string[] = []
  lines.push("# Scene-Semantic Replay Review")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Novel: ${report.novelId}`)
  lines.push(`Set: ${report.setName}`)
  lines.push(`Chapters: ${report.chapters.join(", ") || "(none)"}`)
  lines.push(`Mode: ${report.live ? "live" : "dry"}; model=${report.model}; thinking=${report.thinking}; promptMode=${report.promptMode}`)
  lines.push("")
  lines.push("## Summary")
  lines.push("")
  lines.push(`- Tasks: ${report.taskCount}`)
  lines.push(`- Applicability skips: ${report.skipCount}`)
  for (const summary of report.summaries) {
    const counts = Object.entries(summary.labelCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, count]) => `${label}:${count}`)
      .join(" ")
    lines.push(`- ${summary.dimension}: count=${summary.count}; mean=${summary.meanOrdinal.toFixed(2)}; low=${summary.lowCount}; ${counts}`)
  }
  const lowRows = report.results.filter(row => !row.error && row.ordinal <= 1)
  const errorRows = report.results.filter(row => row.error)
  lines.push("")
  lines.push("## Low-Signal Findings")
  lines.push("")
  if (lowRows.length === 0) {
    lines.push("- none")
  } else {
    for (const row of lowRows) {
      lines.push(`- ch${row.chapterNumber} ${row.sceneId} ${row.dimension} ${row.label}: ${row.missingForNextLevel || "no next-level note"}`)
    }
  }
  if (report.skips.length > 0) {
    lines.push("")
    lines.push("## Applicability Skips")
    lines.push("")
    for (const row of summarizeSkips(report.skips)) {
      lines.push(`- ${row.dimension}: ${row.count}; ${row.reason}`)
    }
  }
  if (errorRows.length > 0) {
    lines.push("")
    lines.push("## Judge Errors")
    lines.push("")
    for (const row of errorRows) {
      lines.push(`- ch${row.chapterNumber} ${row.sceneId} ${row.dimension}: ${row.error}`)
    }
  }
  lines.push("")
  lines.push("## Next")
  lines.push("")
  lines.push("- Treat findings as diagnostic/readiness evidence, not blockers.")
  if (errorRows.length > 0) {
    lines.push("- Rerun errored rows with a narrower dimension set, lower concurrency, or larger token cap before treating row coverage as complete.")
  }
  lines.push("- Operator review should inspect low-signal scenes before any planner or writer change.")
  lines.push("- L092: scene-satisfaction signal cannot be promoted to blocker without separate parity-panel evidence.")
  return `${lines.join("\n")}\n`
}

async function loadChapterRows(novelId: string, chapterFilter: number[] | null): Promise<ChapterRow[]> {
  const draftRows = await db`
    SELECT chapter_number, prose, word_count, version
    FROM chapter_drafts
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number ASC, version DESC
  ` as Array<{ chapter_number: number; prose: string; word_count: number; version: number }>
  const latestDraftByChapter = new Map<number, { prose: string; wordCount: number; version: number }>()
  for (const row of draftRows) {
    if (latestDraftByChapter.has(row.chapter_number)) continue
    latestDraftByChapter.set(row.chapter_number, {
      prose: row.prose,
      wordCount: row.word_count,
      version: row.version,
    })
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
    const keys = [
      row.scene_id,
      row.beat_id,
      typeof row.beat_index === "number" ? `index:${row.beat_index}` : null,
    ].filter((key): key is string => typeof key === "string" && key.length > 0)
    for (const key of keys) {
      if (!byKey.has(key)) byKey.set(key, prose)
    }
  }

  const filterSet = chapterFilter && chapterFilter.length > 0 ? new Set(chapterFilter) : null
  const out: ChapterRow[] = []
  for (const row of outlineRows) {
    if (filterSet && !filterSet.has(row.chapter_number)) continue
    const draft = latestDraftByChapter.get(row.chapter_number)
    if (!draft) continue
    out.push({
      chapterNumber: row.chapter_number,
      outline: row.outline_json,
      prose: draft.prose,
      wordCount: draft.wordCount,
      draftVersion: draft.version,
      sceneProseBySceneId: sceneProseByChapter.get(row.chapter_number) ?? new Map(),
    })
  }
  return out
}

export async function persistSceneSemanticReplayReport(report: SceneSemanticReplayReport): Promise<{ briefRows: number; resultRows: number }> {
  let briefRows = 0
  let resultRows = 0
  for (const task of report.results) {
    const briefJson = {
      novelId: report.novelId,
      chapterNumber: task.chapterNumber,
      sceneIndex: task.sceneIndex,
      sceneId: task.sceneId,
      ...(task.legacyBeatId ? { legacyBeatId: task.legacyBeatId } : {}),
      dimension: task.dimension,
      promptMode: task.promptMode,
      proseSource: task.proseSource,
      obligationIds: task.obligationIds,
      relevantCharacterIds: task.relevantCharacterIds,
      relevantWorldFactIds: task.relevantWorldFactIds,
      sceneTurnIds: task.sceneTurnIds,
      threadIds: task.threadIds,
      promiseIds: task.promiseIds,
      payoffIds: task.payoffIds,
      sourceIds: task.sourceIds,
    }
    await db`
      INSERT INTO eval_briefs (set_name, beat_id, brief_json, notes)
      VALUES (${report.setName}, ${task.taskId}, ${briefJson}, ${`scene-semantic-review novel=${report.novelId}`})
      ON CONFLICT (set_name, beat_id) DO UPDATE SET brief_json = EXCLUDED.brief_json
    `
    briefRows++
    await db`
      INSERT INTO eval_results (
        experiment_id, set_name, beat_id, adapter_uri, cell_label,
        generated_prose, style_features, word_count
      )
      VALUES (
        NULL, ${report.setName}, ${task.taskId},
        ${`scene-semantic-judge:${report.model}:${report.thinking ? "thinking" : "no-thinking"}:${report.promptMode}`},
        ${`${task.dimension}:${task.label}`},
        ${task.missingForNextLevel ?? ""},
        ${{
          label: task.label,
          ordinal: task.ordinal,
          confidence: task.confidence,
          evidenceFields: task.evidenceFields,
          gates: task.output.gates ?? {},
        }},
        ${0}
      )
    `
    resultRows++
  }
  return { briefRows, resultRows }
}

function summarizeResults(results: SceneSemanticReplayResult[]): SceneSemanticReplayReport["summaries"] {
  const byDimension = new Map<Dimension, SceneSemanticReplayResult[]>()
  for (const result of results) {
    byDimension.set(result.dimension, [...(byDimension.get(result.dimension) ?? []), result])
  }
  return [...byDimension.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dimension, rows]) => ({
      dimension,
      count: rows.length,
      meanOrdinal: mean(rows.map(row => row.ordinal)),
      lowCount: rows.filter(row => row.ordinal <= 1).length,
      labelCounts: countBy(rows.map(row => row.label)),
    }))
}

function successfulResults(results: SceneSemanticReplayResult[]): SceneSemanticReplayResult[] {
  return results.filter(row => !row.error)
}

function summarizeSkips(skips: SceneSemanticReplaySkip[]): Array<{ dimension: Dimension; reason: string; count: number }> {
  const counts = new Map<string, { dimension: Dimension; reason: string; count: number }>()
  for (const skip of skips) {
    const key = `${skip.dimension}:${skip.reason}`
    const current = counts.get(key) ?? { dimension: skip.dimension, reason: skip.reason, count: 0 }
    current.count++
    counts.set(key, current)
  }
  return [...counts.values()].sort((a, b) => a.dimension.localeCompare(b.dimension) || a.reason.localeCompare(b.reason))
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function formatList(rows: string[]): string[] {
  return rows.length > 0 ? rows.map(row => `- ${row}`) : ["- none"]
}

function labelOrdinal(label: string): number {
  const match = label.match(/-(\d)$/)
  return match ? Number.parseInt(match[1]!, 10) : 0
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const value of values) out[value] = (out[value] ?? 0) + 1
  return out
}

async function runBounded<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  if (tasks.length === 0) return []
  const results: T[] = new Array(tasks.length)
  let next = 0
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]!()
    }
  })
  await Promise.all(workers)
  return results
}

function defaultSetName(): string {
  const d = new Date()
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(d.getUTCDate()).padStart(2, "0")
  return `scene-semantic-review:${yyyy}${mm}${dd}`
}

function parseChapterRange(value: string | null): number[] | null {
  if (!value) return null
  const out = new Set<number>()
  for (const segment of value.split(",")) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    const dashMatch = trimmed.match(/^(\d+)-(\d+)$/)
    if (dashMatch) {
      const start = Number.parseInt(dashMatch[1]!, 10)
      const end = Number.parseInt(dashMatch[2]!, 10)
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
        throw new Error(`invalid --chapters range segment: ${trimmed}`)
      }
      for (let n = start; n <= end; n++) out.add(n)
      continue
    }
    const single = Number.parseInt(trimmed, 10)
    if (!Number.isFinite(single) || single < 1) throw new Error(`invalid --chapters segment: ${trimmed}`)
    out.add(single)
  }
  return [...out].sort((a, b) => a - b)
}

function parseArgs(argv = process.argv.slice(2)): SceneSemanticReviewArgs {
  let novelId: string | null = null
  let chapters: string | null = null
  let outputDir: string | null = null
  let setName: string | null = null
  let live = false
  let persist = false
  let readinessImport = true
  let model: ModelId = "deepseek-v4-flash"
  let noThinking = false
  let maxTokens = DEFAULT_MAX_TOKENS
  let concurrency = 4
  let promptMode: PromptMode = "evidence-first"
  const dims: string[] = []
  let json = false

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const eat = (): string => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} requires a value`)
      return v
    }
    if (a === "--novel-id") { novelId = eat(); continue }
    if (a === "--chapters") { chapters = eat(); continue }
    if (a === "--output-dir") { outputDir = eat(); continue }
    if (a === "--set-name") { setName = eat(); continue }
    if (a === "--live") { live = true; continue }
    if (a === "--persist") { persist = true; continue }
    if (a === "--readiness-import") { readinessImport = true; continue }
    if (a === "--no-readiness-import") { readinessImport = false; continue }
    if (a === "--model") { model = parseModel(eat()); continue }
    if (a === "--no-thinking") { noThinking = true; continue }
    if (a === "--max-tokens") { maxTokens = positiveInt(eat(), "--max-tokens"); continue }
    if (a === "--concurrency") { concurrency = positiveInt(eat(), "--concurrency"); continue }
    if (a === "--mode") { promptMode = parsePromptMode(eat()); continue }
    if (a === "--dimension") { dims.push(eat()); continue }
    if (a === "--json") { json = true; continue }
    throw new Error(`unknown arg: ${a}`)
  }
  if (!novelId) throw new Error("--novel-id <persisted-novel-id> is required")
  const thinking = !(noThinking)
  return {
    novelId,
    chapters: parseChapterRange(chapters),
    outputDir,
    setName: setName ?? defaultSetName(),
    live,
    persist,
    readinessImport,
    model,
    thinking,
    maxTokens,
    concurrency,
    promptMode,
    dimensions: dims.length === 0 ? DEFAULT_DIMENSIONS : dims.map(parseDimension),
    json,
  }
}

function parseDimension(value: string): Dimension {
  const allowed: Dimension[] = [
    "characterAgency", "worldPressure", "endpointLanding", "causalMomentum",
    "sceneDramaturgy", "threadProgression", "promiseProgress", "promisePayoff",
    "motivationSpecificity", "characterMateriality", "relationshipDelta",
    "worldFactPressure", "stakesValueShift",
  ]
  if (allowed.includes(value as Dimension)) return value as Dimension
  throw new Error(`unsupported dimension: ${value}`)
}

function parseModel(value: string): ModelId {
  if (value === "deepseek-v4-flash" || value === "deepseek-v4-pro") return value
  throw new Error(`unsupported model: ${value}`)
}

function parsePromptMode(value: string): PromptMode {
  if (value === "direct-label" || value === "evidence-first" || value === "gate-derived") return value
  throw new Error(`unsupported mode: ${value}`)
}

function positiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

async function main(): Promise<void> {
  const args = parseArgs()
  console.log(`scene-semantic-review novel=${args.novelId} live=${args.live} persist=${args.persist}`)
  const report = await buildSceneSemanticReplayReport(args)

  const outputDir = resolve(process.cwd(), args.outputDir ?? `output/scene-semantic-review/${args.setName.replace(/[:]/g, "-")}-${args.novelId}`)
  const reviewJsonPath = join(outputDir, "scene-semantic-review.json")
  const readinessJsonPath = join(outputDir, "scene-semantic-readiness.json")
  const readinessMarkdownPath = join(outputDir, "scene-semantic-readiness.md")
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(reviewJsonPath, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(outputDir, "scene-semantic-review.md"), renderSceneSemanticReplayReport(report))
  const readiness = buildSceneSemanticReadinessAggregate([{
    report,
    sourceReport: reviewJsonPath,
  }])
  writeFileSync(readinessJsonPath, `${JSON.stringify(readiness, null, 2)}\n`)
  writeFileSync(readinessMarkdownPath, renderSceneSemanticReadinessAggregate(readiness))

  if (args.persist) {
    const persisted = await persistSceneSemanticReplayReport(report)
    console.log(`persisted ${persisted.briefRows} briefs and ${persisted.resultRows} results to set "${args.setName}"`)
    if (args.readinessImport) {
      const imported = await importPlanReadinessAggregateForNovel({
        novelId: report.novelId,
        aggregate: readiness,
        importedByKind: "script",
        importedByRef: `scene-semantic-review:${report.setName}`,
        refreshStaleness: true,
      })
      console.log(`imported ${imported.inserted} readiness items, updated ${imported.updated}, skipped ${imported.skipped.length}`)
    }
  }

  console.log(args.json ? JSON.stringify(report, null, 2) : renderSceneSemanticReplayReport(report))
  console.log(`wrote ${reviewJsonPath}`)
  console.log(`wrote ${join(outputDir, "scene-semantic-review.md")}`)
  console.log(`wrote ${readinessJsonPath}`)
  console.log(`wrote ${readinessMarkdownPath}`)
  process.exit(0)
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err instanceof Error ? err.stack : err)
    process.exit(1)
  })
}

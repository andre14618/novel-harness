/**
 * Scene-First Novella POC runner.
 *
 * Pragmatic, NOT production-grade. Lives outside `src/` because POC
 * lane discipline is "produce a readable artifact fast" — see
 * docs/sessions/2026-05-10-scene-migration-plan.md and the operator
 * call to split POC vs. Production lanes.
 *
 * One command: load a concept fixture, run concept + planning +
 * drafting end-to-end with scene-first flags set in
 * pipelineOverrides, capture per-chapter prose + scene contracts +
 * trace events to a timestamped output dir. Diagnostics + HTML are
 * separate scripts in this dir.
 *
 * No production default flips. The flags are all per-novel
 * pipelineOverrides. The chapter-level checker settle loops are
 * skipped via `draftCaptureModeV1=true` so checker hangs cannot
 * block prose collection.
 *
 * Usage:
 *   bun poc/scene-first-novella/run.ts \
 *     [--fixture docs/fixtures/scene-first/concepts/pre-resolved/P3-debt-binder-resolved.json] \
 *     [--chapters 3] \
 *     [--writer-expansion-mode retry-short-scenes-v1|off] \
 *     [--run-id poc-scene-first-<ts>]    # default auto-derived from timestamp
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { initDB, createNovel, getChapterOutline, getApprovedDraft, getLatestChapterDraft } from "../../src/db"
import { runConceptPhase } from "../../src/phases/concept"
import { runPlanningPhase } from "../../src/phases/planning"
import { runDraftingPhase } from "../../src/phases/drafting"
import { initNovelRun } from "../../src/logger"
import { setAutoMode, setResolverMode } from "../../src/cli"
import { getMode } from "../../src/gates"
import db from "../../src/db/connection"
import { parseConceptFixture } from "../../scripts/fixture/scene-first-fixture-schema"
import type { SeedInput } from "../../src/types"

const DEFAULT_FIXTURE = "docs/fixtures/scene-first/concepts/pre-resolved/P3-debt-binder-resolved.json"
const POC_OUTPUT_ROOT = "poc/scene-first-novella/output"
type WriterExpansionMode = "off" | "retry-short-scenes-v1"
type PlanningNotePreset = "none" | "single-obligation-hardcap-v2"
type ObligationControlMode = "none" | "chapter-budget-v1"
type LoadBearingObligationKey =
  | "mustEstablish"
  | "mustPayOff"
  | "mustTransferKnowledge"
  | "mustShowStateChange"
  | "mustNotReveal"

export interface Args {
  fixturePath: string
  chapters: number
  runId: string
  captureOnly: boolean
  writerExpansionMode: WriterExpansionMode
  planningNotePreset: PlanningNotePreset
  obligationControl: ObligationControlMode
}

interface SceneContractCoverage {
  totalScenes: number
  anyContractFieldScenes: number
  coreContractFieldScenes: number
  crisisChoiceScenes: number
  choiceAlternativesScenes: number
  anyFieldRate: number
  coreFieldRate: number
  crisisChoiceRate: number
  choiceAlternativesRate: number
}

interface TraceabilityCoverage {
  scenesWithSceneId: number
  scenesWithBeatId: number
  obligationIds: number
  sourceIds: number
  characterIds: number
  threadIds: number
  promiseIds: number
  payoffIds: number
}

interface ChapterArtifactStats {
  chapterNumber: number
  title: string
  targetWords: number
  proseWordCount: number
  sceneCount: number
  traceEvents: number
  llmCalls: number
  writerCalls: number
  promptTokens: number
  completionTokens: number
  cost: number
}

interface ObligationControlReport {
  mode: ObligationControlMode
  applied: boolean
  chapters: Array<{
    chapterNumber: number
    budget: number
    before: number
    after: number
    removed: number
  }>
}

const LOAD_BEARING_OBLIGATION_KEYS: LoadBearingObligationKey[] = [
  "mustPayOff",
  "mustEstablish",
  "mustTransferKnowledge",
  "mustShowStateChange",
  "mustNotReveal",
]

const SINGLE_OBLIGATION_HARDCAP_V2_NOTE = [
  "POC EXPERIMENT: single-obligation-hardcap-v2.",
  "The prior density-cap run still emitted 17 load-bearing obligations across 9 scenes and overshot 1.90x.",
  "For this run, preserve the same 3 chapters, exactly 9 scene contracts, and the same endpoints, but make obligation load the controlled variable.",
  "State mapping must inventory only durable state required after the chapter. Do not create state solely because something happened on page.",
  "Across the whole chapter, target at most 3 load-bearing obligations in chapters 1 and 2 and at most 4 in chapter 3.",
  "Each scene should carry at most one load-bearing obligation, except the final Council-choice scene may carry two.",
  "Do not emit both a fact obligation and a knowledge obligation for the same story payload. Pick the one list that makes the payload writer-visible.",
  "Prefer scene-contract goal/opposition/turn/outcome text for local scene work; reserve obligations for continuity-critical payloads only.",
  "Do not emit obligations for summons, travel, room setup, mood, already-known deadlines, or restating the scene description.",
].join(" ")

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value != null
}

function sceneContractCoverageFromScenes(scenes: any[]): SceneContractCoverage {
  let anyContractFieldScenes = 0
  let coreContractFieldScenes = 0
  let crisisChoiceScenes = 0
  let choiceAlternativesScenes = 0
  for (const scene of scenes) {
    const hasGoal = nonEmpty(scene?.goal)
    const hasOpposition = nonEmpty(scene?.opposition)
    const hasTurningPoint = nonEmpty(scene?.turningPoint)
    const hasOutcome = nonEmpty(scene?.outcome)
    const hasConsequence = nonEmpty(scene?.consequence)
    const hasValueIn = nonEmpty(scene?.valueIn)
    const hasValueOut = nonEmpty(scene?.valueOut)
    const hasStake = nonEmpty(scene?.povPersonalStake)
    const hasCrisisChoice = nonEmpty(scene?.crisisChoice)
    const hasChoiceAlternatives = Array.isArray(scene?.choiceAlternatives) && scene.choiceAlternatives.length >= 2
    if (
      hasGoal || hasOpposition || hasTurningPoint || hasOutcome || hasConsequence ||
      hasValueIn || hasValueOut || hasStake || hasCrisisChoice || hasChoiceAlternatives
    ) {
      anyContractFieldScenes++
    }
    if (
      hasGoal && hasOpposition && hasTurningPoint && hasOutcome && hasConsequence &&
      hasValueIn && hasValueOut && hasStake
    ) {
      coreContractFieldScenes++
    }
    if (hasCrisisChoice) crisisChoiceScenes++
    if (hasChoiceAlternatives) choiceAlternativesScenes++
  }
  const totalScenes = scenes.length
  return {
    totalScenes,
    anyContractFieldScenes,
    coreContractFieldScenes,
    crisisChoiceScenes,
    choiceAlternativesScenes,
    anyFieldRate: totalScenes > 0 ? anyContractFieldScenes / totalScenes : 0,
    coreFieldRate: totalScenes > 0 ? coreContractFieldScenes / totalScenes : 0,
    crisisChoiceRate: totalScenes > 0 ? crisisChoiceScenes / totalScenes : 0,
    choiceAlternativesRate: totalScenes > 0 ? choiceAlternativesScenes / totalScenes : 0,
  }
}

function mergeCoverage(a: SceneContractCoverage, b: SceneContractCoverage): SceneContractCoverage {
  const totalScenes = a.totalScenes + b.totalScenes
  const anyContractFieldScenes = a.anyContractFieldScenes + b.anyContractFieldScenes
  const coreContractFieldScenes = a.coreContractFieldScenes + b.coreContractFieldScenes
  const crisisChoiceScenes = a.crisisChoiceScenes + b.crisisChoiceScenes
  const choiceAlternativesScenes = a.choiceAlternativesScenes + b.choiceAlternativesScenes
  return {
    totalScenes,
    anyContractFieldScenes,
    coreContractFieldScenes,
    crisisChoiceScenes,
    choiceAlternativesScenes,
    anyFieldRate: totalScenes > 0 ? anyContractFieldScenes / totalScenes : 0,
    coreFieldRate: totalScenes > 0 ? coreContractFieldScenes / totalScenes : 0,
    crisisChoiceRate: totalScenes > 0 ? crisisChoiceScenes / totalScenes : 0,
    choiceAlternativesRate: totalScenes > 0 ? choiceAlternativesScenes / totalScenes : 0,
  }
}

function collectTraceabilityCoverage(scenes: any[]): TraceabilityCoverage {
  const coverage: TraceabilityCoverage = {
    scenesWithSceneId: 0,
    scenesWithBeatId: 0,
    obligationIds: 0,
    sourceIds: 0,
    characterIds: 0,
    threadIds: 0,
    promiseIds: 0,
    payoffIds: 0,
  }
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    const object = value as Record<string, unknown>
    if (typeof object.obligationId === "string" && object.obligationId) coverage.obligationIds++
    if (typeof object.sourceId === "string" && object.sourceId) coverage.sourceIds++
    if (typeof object.characterId === "string" && object.characterId) coverage.characterIds++
    if (typeof object.threadId === "string" && object.threadId) coverage.threadIds++
    if (typeof object.promiseId === "string" && object.promiseId) coverage.promiseIds++
    if (typeof object.payoffId === "string" && object.payoffId) coverage.payoffIds++
    for (const child of Object.values(object)) visit(child)
  }
  for (const scene of scenes) {
    if (typeof scene?.sceneId === "string" && scene.sceneId) coverage.scenesWithSceneId++
    if (typeof scene?.beatId === "string" && scene.beatId) coverage.scenesWithBeatId++
    visit(scene)
  }
  return coverage
}

function mergeTraceabilityCoverage(a: TraceabilityCoverage, b: TraceabilityCoverage): TraceabilityCoverage {
  return {
    scenesWithSceneId: a.scenesWithSceneId + b.scenesWithSceneId,
    scenesWithBeatId: a.scenesWithBeatId + b.scenesWithBeatId,
    obligationIds: a.obligationIds + b.obligationIds,
    sourceIds: a.sourceIds + b.sourceIds,
    characterIds: a.characterIds + b.characterIds,
    threadIds: a.threadIds + b.threadIds,
    promiseIds: a.promiseIds + b.promiseIds,
    payoffIds: a.payoffIds + b.payoffIds,
  }
}

function parseWriterExpansionMode(value: string | undefined): WriterExpansionMode {
  if (value === "off" || value === "retry-short-scenes-v1") return value
  throw new Error(`--writer-expansion-mode must be "off" or "retry-short-scenes-v1"; got ${value ?? "(missing)"}`)
}

function parsePlanningNotePreset(value: string | undefined): PlanningNotePreset {
  if (value === "none" || value === "single-obligation-hardcap-v2") return value
  throw new Error(`--planning-note-preset must be "none" or "single-obligation-hardcap-v2"; got ${value ?? "(missing)"}`)
}

function parseObligationControlMode(value: string | undefined): ObligationControlMode {
  if (value === "none" || value === "chapter-budget-v1") return value
  throw new Error(`--obligation-control must be "none" or "chapter-budget-v1"; got ${value ?? "(missing)"}`)
}

export function parseArgs(argv: string[]): Args {
  let fixturePath = DEFAULT_FIXTURE
  let chapters = 3
  let runId: string | null = null
  let captureOnly = false
  let writerExpansionMode: WriterExpansionMode = "retry-short-scenes-v1"
  let planningNotePreset: PlanningNotePreset = "none"
  let obligationControl: ObligationControlMode = "none"
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--fixture") { fixturePath = argv[++i] ?? fixturePath; continue }
    if (a === "--chapters") { chapters = Number.parseInt(argv[++i] ?? "3", 10); continue }
    if (a === "--run-id") { runId = argv[++i] ?? null; continue }
    if (a === "--capture-only") { captureOnly = true; continue }
    if (a === "--writer-expansion-mode") { writerExpansionMode = parseWriterExpansionMode(argv[++i]); continue }
    if (a === "--planning-note-preset") { planningNotePreset = parsePlanningNotePreset(argv[++i]); continue }
    if (a === "--obligation-control") { obligationControl = parseObligationControlMode(argv[++i]); continue }
    throw new Error(`unknown arg: ${a}`)
  }
  if (!Number.isFinite(chapters) || chapters < 1) {
    throw new Error(`--chapters must be a positive integer; got ${chapters}`)
  }
  if (captureOnly && !runId) {
    throw new Error(`--capture-only requires --run-id <existing-novel-id>`)
  }
  return {
    fixturePath,
    chapters,
    runId: runId ?? `poc-scene-first-${Date.now()}`,
    captureOnly,
    writerExpansionMode,
    planningNotePreset,
    obligationControl,
  }
}

function appendRawNote(seed: SeedInput, note: string): SeedInput {
  const directives = seed.directives ?? {
    lockedCharacters: [],
    requiredBeats: [],
    forbidden: [],
    tonalAnchors: [],
    structuralConstraints: { povRotation: "", pacing: "" },
    storyThreads: [],
    storyDebts: [],
    storyPayoffs: [],
    rawNotes: "",
  }
  return {
    ...seed,
    directives: {
      ...directives,
      rawNotes: [directives.rawNotes?.trim(), note].filter(Boolean).join("\n\n"),
    },
  }
}

export function applyPlanningNotePreset(seed: SeedInput, preset: PlanningNotePreset): SeedInput {
  if (preset === "none") return seed
  return appendRawNote(seed, SINGLE_OBLIGATION_HARDCAP_V2_NOTE)
}

function hardObligationCount(scene: any): number {
  const obligations = scene?.obligations ?? {}
  return LOAD_BEARING_OBLIGATION_KEYS.reduce((sum, key) => {
    const items = obligations[key]
    return sum + (Array.isArray(items) ? items.length : 0)
  }, 0)
}

function chapterHardObligationBudget(chapterNumber: number): number {
  return chapterNumber >= 3 ? 4 : 3
}

function obligationScore(entry: {
  key: LoadBearingObligationKey
  item: any
  sceneIndex: number
}): number {
  const keyScore: Record<LoadBearingObligationKey, number> = {
    mustPayOff: 80,
    mustEstablish: 60,
    mustTransferKnowledge: 50,
    mustShowStateChange: 40,
    mustNotReveal: 20,
  }
  const stage = typeof entry.item?.storyDebtStage === "string" ? entry.item.storyDebtStage : ""
  const stageScore = stage === "final_payoff" ? 35
    : stage === "partial_payoff" ? 25
      : stage === "progress" ? 10
        : 0
  const payoffScore = typeof entry.item?.payoffId === "string" && entry.item.payoffId && entry.item.payoffId !== "null" ? 30 : 0
  const text = typeof entry.item?.text === "string" ? entry.item.text.toLowerCase() : ""
  const endpointScore = /\b(decide|decides|chooses|refuses|proposes|council|vote|velo|third path)\b/.test(text) ? 12 : 0
  return keyScore[entry.key] + stageScore + payoffScore + endpointScore + entry.sceneIndex / 10
}

export function compactOutlineObligationsForChapterBudget(outline: any): {
  outline: any
  report: ObligationControlReport["chapters"][number]
} {
  const chapterNumber = Number(outline?.chapterNumber ?? 0)
  const scenes = Array.isArray(outline?.scenes) ? outline.scenes : []
  const budget = chapterHardObligationBudget(chapterNumber)
  const before = scenes.reduce((sum: number, scene: any) => sum + hardObligationCount(scene), 0)
  if (before <= budget) {
    return {
      outline,
      report: { chapterNumber, budget, before, after: before, removed: 0 },
    }
  }

  const entries: Array<{
    id: string
    key: LoadBearingObligationKey
    item: any
    sceneIndex: number
    itemIndex: number
    sourceId: string
    score: number
  }> = []
  scenes.forEach((scene: any, sceneIndex: number) => {
    const obligations = scene?.obligations ?? {}
    for (const key of LOAD_BEARING_OBLIGATION_KEYS) {
      const items = Array.isArray(obligations[key]) ? obligations[key] : []
      items.forEach((item: any, itemIndex: number) => {
        const sourceId = typeof item?.sourceId === "string" ? item.sourceId : ""
        const entry = {
          id: `${sceneIndex}:${key}:${itemIndex}`,
          key,
          item,
          sceneIndex,
          itemIndex,
          sourceId,
          score: 0,
        }
        entry.score = obligationScore(entry)
        entries.push(entry)
      })
    }
  })

  const keep = new Set<string>()
  const keptSourceIds = new Set<string>()
  const sceneCounts = new Map<number, number>()
  const sorted = [...entries].sort((a, b) => b.score - a.score || a.sceneIndex - b.sceneIndex || a.itemIndex - b.itemIndex)
  const select = (allowPerScene: number): void => {
    for (const entry of sorted) {
      if (keep.size >= budget) return
      if (keep.has(entry.id)) continue
      if (entry.sourceId && keptSourceIds.has(entry.sourceId)) continue
      const maxForScene = entry.sceneIndex === scenes.length - 1 ? Math.max(allowPerScene, 2) : allowPerScene
      if ((sceneCounts.get(entry.sceneIndex) ?? 0) >= maxForScene) continue
      keep.add(entry.id)
      if (entry.sourceId) keptSourceIds.add(entry.sourceId)
      sceneCounts.set(entry.sceneIndex, (sceneCounts.get(entry.sceneIndex) ?? 0) + 1)
    }
  }
  select(1)
  select(2)
  select(Number.POSITIVE_INFINITY)

  const compacted = {
    ...outline,
    scenes: scenes.map((scene: any, sceneIndex: number) => {
      const existing = scene?.obligations ?? {}
      const nextObligations: Record<string, any[]> = { ...existing }
      for (const key of LOAD_BEARING_OBLIGATION_KEYS) {
        const items = Array.isArray(existing[key]) ? existing[key] : []
        nextObligations[key] = items.filter((_: any, itemIndex: number) => keep.has(`${sceneIndex}:${key}:${itemIndex}`))
      }
      return { ...scene, obligations: nextObligations }
    }),
  }
  const after = compacted.scenes.reduce((sum: number, scene: any) => sum + hardObligationCount(scene), 0)
  return {
    outline: compacted,
    report: {
      chapterNumber,
      budget,
      before,
      after,
      removed: before - after,
    },
  }
}

async function applyObligationControl(novelId: string, mode: ObligationControlMode): Promise<ObligationControlReport> {
  const report: ObligationControlReport = { mode, applied: mode !== "none", chapters: [] }
  if (mode === "none") return report

  const rows = await db`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number ASC
  ` as Array<{ chapter_number: number; outline_json: unknown }>

  for (const row of rows) {
    const outline = typeof row.outline_json === "string" ? JSON.parse(row.outline_json) : row.outline_json
    const compacted = compactOutlineObligationsForChapterBudget(outline)
    report.chapters.push(compacted.report)
    if (compacted.report.removed > 0) {
      await db`
        UPDATE chapter_outlines
        SET outline_json = ${JSON.stringify(compacted.outline)}::jsonb
        WHERE novel_id = ${novelId} AND chapter_number = ${row.chapter_number}
      `
    }
  }

  return report
}

async function captureChapterArtifacts(
  novelId: string,
  outputDir: string,
  chapterCount: number,
): Promise<{ savedChapters: number[]; missingChapters: number[]; chapterStats: ChapterArtifactStats[] }> {
  const saved: number[] = []
  const missing: number[] = []
  const chapterStats: ChapterArtifactStats[] = []
  for (let ch = 1; ch <= chapterCount; ch++) {
    const outline = await getChapterOutline(novelId, ch).catch(() => null)
    if (!outline) {
      missing.push(ch)
      continue
    }
    // Approved draft is the post-checker artifact. In draftCaptureModeV1
    // the chapter is approved immediately after writer drafts prose, so
    // getApprovedDraft returns the writer output directly.
    const approved = await getApprovedDraft(novelId, ch).catch(() => null)
    const latest = approved ?? await getLatestChapterDraft(novelId, ch).catch(() => null)

    const traceEvents = await db`
      SELECT event_type, chapter, beat_index, payload, "timestamp" AS ts
      FROM pipeline_events
      WHERE novel_id = ${novelId} AND chapter = ${ch}
      ORDER BY "timestamp" ASC
    ` as Array<{ event_type: string; chapter: number; beat_index: number | null; payload: unknown; ts: string }>

    const llmCalls = await db`
      SELECT id, agent, attempt, scene_id, beat_id, beat_index,
             prompt_tokens, completion_tokens, cost,
             length(user_prompt) AS user_prompt_chars
      FROM llm_calls
      WHERE novel_id = ${novelId} AND chapter = ${ch}
      ORDER BY timestamp ASC
    ` as Array<{ id: number; agent: string; attempt: number; scene_id: string | null; beat_id: string | null; beat_index: number | null; prompt_tokens: number; completion_tokens: number; cost: number; user_prompt_chars: number }>

    const prose = latest?.prose ?? ""
    const wordCount = latest?.wordCount ?? 0
    const proseHeader = `# Chapter ${ch}: ${outline.title}\n\n*POV: ${outline.povCharacter}*\n*Setting: ${outline.setting}*\n*Word count: ${wordCount} (target ${outline.targetWords})*\n\n`
    await writeFile(join(outputDir, `chapter-${ch}.md`), proseHeader + prose, "utf8")

    const sceneContracts = {
      runId: novelId,
      chapterNumber: ch,
      chapterId: outline.chapterId ?? null,
      title: outline.title,
      povCharacter: outline.povCharacter,
      povCharacterId: outline.povCharacterId ?? null,
      setting: outline.setting,
      purpose: outline.purpose,
      targetWords: outline.targetWords,
      proseWordCount: wordCount,
      scenes: (outline.scenes ?? []).map((s: any, idx: number) => ({
        sceneIndex: idx,
        sceneId: s.sceneId ?? null,
        beatId: s.beatId ?? null,
        kind: s.kind ?? null,
        description: s.description ?? "",
        characters: s.characters ?? [],
        povPersonalStake: s.povPersonalStake ?? null,
        // Scene-contract fields (populated when scenePlanContractV1=true and the
        // planner authored them).
        contract: {
          goal: s.goal ?? null,
          opposition: s.opposition ?? null,
          turningPoint: s.turningPoint ?? null,
          crisisChoice: s.crisisChoice ?? null,
          choiceAlternatives: s.choiceAlternatives ?? [],
          outcome: s.outcome ?? null,
          consequence: s.consequence ?? null,
          valueIn: s.valueIn ?? null,
          valueOut: s.valueOut ?? null,
          targetWords: s.targetWords ?? null,
        },
        valueShifted: s.valueShifted ?? null,
        gapPresent: s.gapPresent ?? null,
        lifeValueAxes: s.lifeValueAxes ?? [],
        miceActive: s.miceActive ?? [],
        miceOpens: s.miceOpens ?? [],
        miceCloses: s.miceCloses ?? [],
        obligations: {
          mustEstablish: s.obligations?.mustEstablish ?? [],
          mustPayOff: s.obligations?.mustPayOff ?? [],
          mustTransferKnowledge: s.obligations?.mustTransferKnowledge ?? [],
          mustShowStateChange: s.obligations?.mustShowStateChange ?? [],
          mustNotReveal: s.obligations?.mustNotReveal ?? [],
          allowedNewEntities: s.obligations?.allowedNewEntities ?? [],
        },
        requiredPayoffs: s.requiredPayoffs ?? [],
      })),
      establishedFacts: outline.establishedFacts ?? [],
      characterStateChanges: outline.characterStateChanges ?? [],
      knowledgeChanges: outline.knowledgeChanges ?? [],
    }
    await writeFile(
      join(outputDir, `chapter-${ch}.scene-contracts.json`),
      JSON.stringify(sceneContracts, null, 2),
      "utf8",
    )

    const trace = {
      runId: novelId,
      chapterNumber: ch,
      events: traceEvents.map(e => ({
        eventType: e.event_type,
        chapter: e.chapter,
        beatIndex: e.beat_index,
        ts: e.ts,
        payload: e.payload,
      })),
      llmCalls: llmCalls.map(c => ({
        id: c.id,
        agent: c.agent,
        attempt: c.attempt,
        sceneId: c.scene_id,
        beatId: c.beat_id,
        beatIndex: c.beat_index,
        promptTokens: c.prompt_tokens,
        completionTokens: c.completion_tokens,
        cost: c.cost,
        userPromptChars: c.user_prompt_chars,
      })),
      counts: {
        events: traceEvents.length,
        llmCalls: llmCalls.length,
        writerCalls: llmCalls.filter(c => c.agent === "beat-writer").length,
      },
    }
    await writeFile(
      join(outputDir, `chapter-${ch}.trace.json`),
      JSON.stringify(trace, null, 2),
      "utf8",
    )

    chapterStats.push({
      chapterNumber: ch,
      title: outline.title,
      targetWords: outline.targetWords,
      proseWordCount: wordCount,
      sceneCount: (outline.scenes ?? []).length,
      traceEvents: traceEvents.length,
      llmCalls: llmCalls.length,
      writerCalls: llmCalls.filter(c => c.agent === "beat-writer").length,
      promptTokens: llmCalls.reduce((sum, c) => sum + (c.prompt_tokens ?? 0), 0),
      completionTokens: llmCalls.reduce((sum, c) => sum + (c.completion_tokens ?? 0), 0),
      cost: llmCalls.reduce((sum, c) => sum + Number(c.cost ?? 0), 0),
    })
    saved.push(ch)
  }
  return { savedChapters: saved, missingChapters: missing, chapterStats }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  console.log(`fixture: ${args.fixturePath}`)
  console.log(`chapters: ${args.chapters}`)
  console.log(`runId: ${args.runId}`)
  console.log(`planning note preset: ${args.planningNotePreset}`)
  console.log(`obligation control: ${args.obligationControl}`)

  setAutoMode(true)
  setResolverMode(getMode(true))

  const fixtureFile = Bun.file(args.fixturePath)
  if (!await fixtureFile.exists()) throw new Error(`fixture not found: ${args.fixturePath}`)
  const fixture = parseConceptFixture(await fixtureFile.json(), args.fixturePath)
  console.log(`profile: ${fixture.fixture_metadata.profile}`)
  console.log(`expected baseline ratio: ${fixture.fixture_metadata.expected_baseline_ratio}`)

  // Build the seed: fixture concept + chapter-count override + scene-first
  // pipelineOverrides. Production defaults are NOT touched — every flag is
  // set on this single novel via seed.pipelineOverrides.
  const seedBase: SeedInput = applyPlanningNotePreset({
    ...fixture.concept,
    chapterCount: args.chapters,
    pipelineOverrides: {
      ...((fixture.concept as any).pipelineOverrides ?? {}),
      // Planner emits scene-contract fields per L096 (causal-motivation-v3).
      scenePlanContractV1: true,
      // Writer renders SCENE CONTRACT block + scene-call shape per L097.
      sceneCallWriterV1: true,
      // Expansion-retry path is default for the POC, but can be disabled to
      // isolate writer expansion effects while preserving the same fixture.
      writerExpansionMode: args.writerExpansionMode,
      // POC lane: skip chapter-level checker settle loops so prose
      // collection survives checker/API hangs. Diagnostics run post-hoc.
      draftCaptureModeV1: true,
    },
  }, args.planningNotePreset)
  const seed: SeedInput = seedBase

  const outputDir = join(POC_OUTPUT_ROOT, args.runId)
  await mkdir(outputDir, { recursive: true })
  console.log(`output dir: ${outputDir}\n`)

  // Persist the resolved seed alongside the run for traceability.
  await writeFile(
    join(outputDir, "seed.json"),
    JSON.stringify({ runId: args.runId, fixturePath: args.fixturePath, seed }, null, 2),
    "utf8",
  )

  await initDB(args.runId)
  if (args.captureOnly) {
    await initNovelRun(args.runId)
    console.log(`capture-only mode: skipping concept/planning/drafting; targeting existing novel ${args.runId}\n`)
  } else {
    await createNovel(args.runId, seed)
    await initNovelRun(args.runId)
    console.log(`novel created: ${args.runId}\n`)

    console.log("━━━ concept phase ━━━")
    await runConceptPhase(args.runId, seed)

    console.log("\n━━━ planning phase ━━━")
    await runPlanningPhase(args.runId)
  }

  const obligationControlReport = !args.captureOnly
    ? await applyObligationControl(args.runId, args.obligationControl)
    : { mode: args.obligationControl, applied: false, chapters: [] }
  if (obligationControlReport.applied) {
    const removed = obligationControlReport.chapters.reduce((sum, ch) => sum + ch.removed, 0)
    console.log(`\nobligation control ${args.obligationControl}: removed ${removed} load-bearing obligation(s) before drafting`)
    await writeFile(
      join(outputDir, "obligation-control-report.json"),
      JSON.stringify(obligationControlReport, null, 2),
      "utf8",
    )
  }

  // Sanity check: are any scene-contract fields populated? POC runs are
  // allowed to continue even if the planner under-populates (per the
  // operator's call to "stop only if planner produces unusable scene
  // contracts"). Log the populated-field rate so the operator can decide
  // whether to scrap and re-plan.
  const planCheck = await db`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = ${args.runId}
    ORDER BY chapter_number ASC
  ` as Array<{ chapter_number: number; outline_json: unknown }>
  let sceneContractCoverage: SceneContractCoverage = sceneContractCoverageFromScenes([])
  let traceabilityCoverage: TraceabilityCoverage = collectTraceabilityCoverage([])
  for (const row of planCheck) {
    const outline = typeof row.outline_json === "string" ? JSON.parse(row.outline_json) : row.outline_json
    const scenes = (outline as any)?.scenes ?? []
    sceneContractCoverage = mergeCoverage(sceneContractCoverage, sceneContractCoverageFromScenes(scenes))
    traceabilityCoverage = mergeTraceabilityCoverage(traceabilityCoverage, collectTraceabilityCoverage(scenes))
  }
  console.log(
    `\nplanner output: ${planCheck.length} chapters, ${sceneContractCoverage.totalScenes} scenes; ` +
    `${sceneContractCoverage.anyContractFieldScenes}/${sceneContractCoverage.totalScenes} scenes have any scene-contract field, ` +
    `${sceneContractCoverage.coreContractFieldScenes}/${sceneContractCoverage.totalScenes} have core contract fields, ` +
    `${sceneContractCoverage.choiceAlternativesScenes}/${sceneContractCoverage.totalScenes} declare >=2 choice alternatives.`,
  )
  if (!args.captureOnly && sceneContractCoverage.totalScenes === 0) {
    throw new Error(`planner produced no scenes; aborting before drafting (would burn tokens with no upside)`)
  }
  if (sceneContractCoverage.anyContractFieldScenes === 0) {
    console.warn(`WARNING: planner populated 0 scene-contract fields. The scene-call writer prompt will degrade to legacy-shaped (header only). Continuing anyway — POC discipline says collect the artifact and decide post-hoc.`)
  }

  let draftingResult: { kind: string } = { kind: "capture-only" }
  if (!args.captureOnly) {
    console.log("\n━━━ drafting phase (draft-capture mode) ━━━")
    draftingResult = await runDraftingPhase(args.runId)
    console.log(`drafting kind: ${draftingResult.kind}`)
  }

  console.log("\n━━━ capturing artifacts ━━━")
  const { savedChapters, missingChapters, chapterStats } = await captureChapterArtifacts(args.runId, outputDir, args.chapters)
  console.log(`saved chapters: [${savedChapters.join(", ")}]`)
  if (missingChapters.length > 0) {
    console.log(`missing chapters: [${missingChapters.join(", ")}] (no chapter_outlines row)`)
  }

  // Final summary written for downstream tools.
  const totalProseWords = chapterStats.reduce((sum, ch) => sum + ch.proseWordCount, 0)
  const totalTargetWords = chapterStats.reduce((sum, ch) => sum + ch.targetWords, 0)
  const totalPromptTokens = chapterStats.reduce((sum, ch) => sum + ch.promptTokens, 0)
  const totalCompletionTokens = chapterStats.reduce((sum, ch) => sum + ch.completionTokens, 0)
  const totalCost = chapterStats.reduce((sum, ch) => sum + ch.cost, 0)
  await writeFile(
    join(outputDir, "run-summary.json"),
    JSON.stringify({
      runId: args.runId,
      fixturePath: args.fixturePath,
      profile: fixture.fixture_metadata.profile,
      chaptersRequested: args.chapters,
      chaptersSaved: savedChapters,
      chaptersMissing: missingChapters,
      // Backwards-compatible alias. Means "any scene-contract field", not
      // "every possible contract field."
      plannerSceneContractFieldRate: sceneContractCoverage.anyFieldRate,
      sceneContractCoverage,
      traceabilityCoverage,
      wordCounts: {
        chapters: chapterStats.map(ch => ({
          chapterNumber: ch.chapterNumber,
          title: ch.title,
          proseWords: ch.proseWordCount,
          targetWords: ch.targetWords,
          ratio: ch.targetWords > 0 ? ch.proseWordCount / ch.targetWords : null,
        })),
        totalProseWords,
        totalTargetWords,
        ratio: totalTargetWords > 0 ? totalProseWords / totalTargetWords : null,
      },
      llmUsage: {
        calls: chapterStats.reduce((sum, ch) => sum + ch.llmCalls, 0),
        writerCalls: chapterStats.reduce((sum, ch) => sum + ch.writerCalls, 0),
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        cost: totalCost,
      },
      chapterStats,
      planningNotePreset: args.planningNotePreset,
      obligationControl: obligationControlReport,
      draftingResultKind: draftingResult.kind,
      pipelineOverrides: seed.pipelineOverrides,
      capturedAt: new Date().toISOString(),
    }, null, 2),
    "utf8",
  )

  console.log(`\n✓ POC artifact at: ${outputDir}`)
  console.log(`  next: bun poc/scene-first-novella/diagnostics.ts --run-dir ${outputDir}`)
  console.log(`        bun poc/scene-first-novella/render-html.ts --run-dir ${outputDir}`)

  process.exit(0)
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}

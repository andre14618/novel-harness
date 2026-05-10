#!/usr/bin/env bun
/**
 * Read-only diagnostic for planner semantic allocation quality.
 *
 * This is deliberately not a runtime gate. It exposes whether a chapter plan
 * is writer-ready before spending drafting tokens: beat budget, endpoint
 * overlap, character materiality, beat story-turn readiness, and obligation
 * coverage.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { chapterOutlineSchema, type ChapterOutline } from "../../src/agents/planning-plotter/schema"
import { assessBeatCountForTarget } from "../../src/harness/beat-counts"
import { validateBeatObligationCoverage } from "../../src/harness/beat-obligations"
import type { SceneBeat } from "../../src/types"

export interface PlannerQualityOutlineRow {
  chapter_number: number
  outline_json: unknown
}

export type PlannerQualityFlag =
  | "over_planned_beats"
  | "under_planned_beats"
  | "endpoint_not_declared"
  | "endpoint_low_overlap"
  | "character_not_visible_in_beat_text"
  | "weak_story_turn_beat"
  | "obligation_coverage_error"
  | "overloaded_obligations"

export interface PlannerQualityCharacterMateriality {
  character: string
  listedInBeats: number
  mentionedInBeatText: number
  visible: boolean
}

export interface PlannerQualityEndpoint {
  declared: string | null
  finalBeat: string | null
  finalSceneRef: string | null
  finalScenePreserveIds: PlannerQualityPreserveIds
  overlapRatio: number | null
  missingTokens: string[]
}

export interface PlannerQualityPreserveIds {
  obligationIds: string[]
  characterIds: string[]
  worldFactIds: string[]
  sceneTurnIds: string[]
  threadIds: string[]
  promiseIds: string[]
  payoffIds: string[]
  sourceIds: string[]
}

export interface PlannerQualityChapter {
  chapter: number
  chapterRef: string | null
  title: string
  targetWords: number | null
  plannedBeats: number
  recommendedBeats: number | null
  beatDeltaFromRecommended: number | null
  purpose: string
  endpoint: PlannerQualityEndpoint
  characters: PlannerQualityCharacterMateriality[]
  weakStoryTurnBeats: Array<{
    beat: number
    kind: string
    description: string
    targetRef: string | null
    preserveIds: PlannerQualityPreserveIds
  }>
  obligationHealth: {
    valid: boolean
    errors: string[]
    warnings: string[]
    overloadedBeats: number
    missingSourceIds: number
    orphanFacts: number
    orphanKnowledgeChanges: number
    orphanStateChanges: number
  }
  flags: PlannerQualityFlag[]
}

export interface PlannerQualityReport {
  novelId: string | null
  chapters: PlannerQualityChapter[]
  totals: {
    chapters: number
    plannedBeats: number
    overPlannedChapters: number
    underPlannedChapters: number
    endpointIssues: number
    inactiveCharacterFindings: number
    weakStoryTurnBeats: number
    obligationErrorChapters: number
    overloadedObligationChapters: number
  }
}

interface Args {
  novelId: string | null
  json: boolean
  readinessJson: string | null
  importReadiness: boolean
}

const ENDPOINT_PATTERNS = [
  /\bchapter ends with\s+(.+?)(?:\.|$)/i,
  /\bends with\s+(.+?)(?:\.|$)/i,
  /\bending with\s+(.+?)(?:\.|$)/i,
  /\bends by\s+(.+?)(?:\.|$)/i,
]

const STOPWORDS = new Set([
  "about", "after", "again", "against", "also", "because", "before", "being",
  "between", "chapter", "could", "from", "have", "into", "that", "their",
  "them", "then", "there", "this", "through", "with", "will", "would",
  "while", "where", "which", "what", "when", "reader", "hooking",
])

const STORY_TURN_TERMS = [
  "accept", "admit", "break", "choose", "corner", "confront", "decide",
  "demand", "discover", "escape", "expose", "fail", "flee", "force",
  "kill", "learn", "prove", "realize", "refuse", "reveal", "risk",
  "sacrifice", "threaten", "warn",
]

const EMPTY_PRESERVE_IDS: PlannerQualityPreserveIds = {
  obligationIds: [],
  characterIds: [],
  worldFactIds: [],
  sceneTurnIds: [],
  threadIds: [],
  promiseIds: [],
  payoffIds: [],
  sourceIds: [],
}

export function buildPlannerQualityReport(
  rows: readonly PlannerQualityOutlineRow[],
  novelId: string | null = null,
): PlannerQualityReport {
  const chapters = rows
    .map(rowToChapter)
    .filter((chapter): chapter is PlannerQualityChapter => chapter !== null)
    .sort((a, b) => a.chapter - b.chapter)

  return {
    novelId,
    chapters,
    totals: {
      chapters: chapters.length,
      plannedBeats: chapters.reduce((sum, chapter) => sum + chapter.plannedBeats, 0),
      overPlannedChapters: chapters.filter(chapter => chapter.flags.includes("over_planned_beats")).length,
      underPlannedChapters: chapters.filter(chapter => chapter.flags.includes("under_planned_beats")).length,
      endpointIssues: chapters.filter(chapter =>
        chapter.flags.includes("endpoint_not_declared") ||
        chapter.flags.includes("endpoint_low_overlap")
      ).length,
      inactiveCharacterFindings: chapters.reduce(
        (sum, chapter) => sum + chapter.characters.filter(character => !character.visible).length,
        0,
      ),
      weakStoryTurnBeats: chapters.reduce((sum, chapter) => sum + chapter.weakStoryTurnBeats.length, 0),
      obligationErrorChapters: chapters.filter(chapter => chapter.flags.includes("obligation_coverage_error")).length,
      overloadedObligationChapters: chapters.filter(chapter => chapter.flags.includes("overloaded_obligations")).length,
    },
  }
}

function rowToChapter(row: PlannerQualityOutlineRow): PlannerQualityChapter | null {
  const parsed = chapterOutlineSchema.safeParse(row.outline_json)
  if (!parsed.success) return null
  const outline = parsed.data
  const targetWords = positiveNumber(outline.targetWords) ? Number(outline.targetWords) : null
  const plannedBeats = outline.scenes.length
  const beatAssessment = targetWords === null ? null : assessBeatCountForTarget(targetWords, plannedBeats)
  const endpoint = endpointAssessment(outline)
  const characters = characterMateriality(outline)
  const weakStoryTurnBeats = storyTurnWeaknesses(outline)
  const coverage = validateBeatObligationCoverage(outline)

  const flags: PlannerQualityFlag[] = []
  if (beatAssessment?.overPlanned) flags.push("over_planned_beats")
  if (beatAssessment?.underPlanned) flags.push("under_planned_beats")
  if (!endpoint.declared) flags.push("endpoint_not_declared")
  else if ((endpoint.overlapRatio ?? 0) < 0.45) flags.push("endpoint_low_overlap")
  if (characters.some(character => !character.visible)) flags.push("character_not_visible_in_beat_text")
  if (weakStoryTurnBeats.length > 0) flags.push("weak_story_turn_beat")
  if (!coverage.valid) flags.push("obligation_coverage_error")
  if (coverage.summary.overloadedBeats > 0) flags.push("overloaded_obligations")

  return {
    chapter: Number(outline.chapterNumber ?? row.chapter_number),
    chapterRef: outline.chapterId ?? null,
    title: outline.title,
    targetWords,
    plannedBeats,
    recommendedBeats: beatAssessment?.recommendedBeats ?? null,
    beatDeltaFromRecommended: beatAssessment?.beatDeltaFromRecommended ?? null,
    purpose: outline.purpose,
    endpoint,
    characters,
    weakStoryTurnBeats,
    obligationHealth: {
      valid: coverage.valid,
      errors: coverage.errors,
      warnings: coverage.warnings,
      overloadedBeats: coverage.summary.overloadedBeats,
      missingSourceIds: coverage.summary.missingSourceIds,
      orphanFacts: coverage.summary.orphanFacts,
      orphanKnowledgeChanges: coverage.summary.orphanKnowledgeChanges,
      orphanStateChanges: coverage.summary.orphanStateChanges,
    },
    flags,
  }
}

function endpointAssessment(outline: ChapterOutline): PlannerQualityEndpoint {
  const declared = extractEndpoint(outline.purpose)
  const finalScene = outline.scenes.at(-1) as SceneBeat | undefined
  const finalBeat = finalScene?.description ?? null
  const finalSceneRef = finalScene
    ? sceneTargetRef(outline, finalScene, outline.scenes.length - 1)
    : null
  const finalScenePreserveIds = finalScene ? preserveIdsForScene(finalScene) : EMPTY_PRESERVE_IDS
  if (!declared || !finalBeat) {
    return {
      declared,
      finalBeat,
      finalSceneRef,
      finalScenePreserveIds,
      overlapRatio: declared ? 0 : null,
      missingTokens: declared ? contentTokens(declared) : [],
    }
  }
  const declaredTokens = unique(contentTokens(declared))
  const finalTokens = new Set(contentTokens(finalBeat))
  const matched = declaredTokens.filter(token => finalTokens.has(token))
  return {
    declared,
    finalBeat,
    finalSceneRef,
    finalScenePreserveIds,
    overlapRatio: declaredTokens.length > 0 ? matched.length / declaredTokens.length : null,
    missingTokens: declaredTokens.filter(token => !finalTokens.has(token)),
  }
}

function characterMateriality(outline: ChapterOutline): PlannerQualityCharacterMateriality[] {
  const beats = outline.scenes ?? []
  const pov = normalizeName(outline.povCharacter)
  return unique(outline.charactersPresent ?? []).map(character => {
    const name = normalizeName(character)
    const listedInBeats = beats.filter(beat =>
      (beat.characters ?? []).some(beatCharacter => normalizeName(beatCharacter) === name)
    ).length
    const mentionedInBeatText = beats.filter(beat => textMentionsCharacter(beat.description, character)).length
    return {
      character,
      listedInBeats,
      mentionedInBeatText,
      // POV characters can drive a chapter through close interiority even when
      // the name is not repeated in every beat. Non-POV characters need text
      // visibility to be considered materially present by this deterministic pass.
      visible: name === pov ? listedInBeats > 0 || mentionedInBeatText > 0 : mentionedInBeatText > 0,
    }
  })
}

function storyTurnWeaknesses(outline: ChapterOutline): PlannerQualityChapter["weakStoryTurnBeats"] {
  return outline.scenes.flatMap((beat, index) => {
    const desc = beat.description ?? ""
    const issue = {
      beat: index + 1,
      kind: beat.kind,
      description: desc,
      targetRef: sceneTargetRef(outline, beat as SceneBeat, index),
      preserveIds: preserveIdsForScene(beat as SceneBeat),
    }
    const tokens = contentTokens(desc)
    if (tokens.length < 6) return [issue]
    const hasTurnTerm = STORY_TURN_TERMS.some(term => tokens.includes(term))
    const hasPressurePunctuation = /[;:—-]/.test(desc)
    const hasMultipleClauses = /\bbut\b|\bwhen\b|\bwhile\b|\bforcing\b|\bso\b/i.test(desc)
    if (hasTurnTerm || hasPressurePunctuation || hasMultipleClauses) return []
    return [issue]
  })
}

export function buildPlannerQualityReadinessAggregate(
  report: PlannerQualityReport,
  sourceReport = "planner-quality-report",
): Record<string, unknown> {
  const groups: Record<string, unknown>[] = []
  for (const chapter of report.chapters) {
    if (chapter.flags.includes("endpoint_not_declared") && chapter.chapterRef) {
      groups.push(readinessGroup({
        groupId: `planner-quality:ch${chapter.chapter}:endpoint-missing`,
        report,
        chapter,
        target: { kind: "chapter_outline", ref: chapter.chapterRef, fieldPath: "purpose" },
        dimension: "endpointPlanning",
        label: "ENDPOINT-PLAN-0",
        severity: "medium",
        fixIntent: "declare_chapter_endpoint_before_drafting",
        rationale: "Planner quality diagnostic found no declared chapter endpoint in the chapter purpose.",
        missingForNextLevel: "Declare the intended endpoint/hook in the chapter purpose before drafting.",
        evidence: { purpose: chapter.purpose },
        preserveIds: EMPTY_PRESERVE_IDS,
        sourceReport,
      }))
    }

    if (
      chapter.flags.includes("endpoint_low_overlap") &&
      chapter.endpoint.declared &&
      chapter.endpoint.finalSceneRef
    ) {
      groups.push(readinessGroup({
        groupId: `planner-quality:ch${chapter.chapter}:endpoint-low-overlap`,
        report,
        chapter,
        sceneId: chapter.endpoint.finalSceneRef,
        target: {
          kind: "scene_plan",
          ref: chapter.endpoint.finalSceneRef,
          fieldPath: "description",
        },
        dimension: "endpointPlanning",
        label: "ENDPOINT-PLAN-1",
        severity: "medium",
        fixIntent: "align_final_scene_contract_with_declared_endpoint",
        rationale: "Planner quality diagnostic found the final scene has low token overlap with the declared chapter endpoint.",
        missingForNextLevel: "Revise the final scene contract so the declared endpoint lands through a concrete action, consequence, or hook.",
        evidence: {
          declaredEndpoint: chapter.endpoint.declared,
          finalScene: chapter.endpoint.finalBeat ?? "",
          overlapRatio: chapter.endpoint.overlapRatio == null ? "" : chapter.endpoint.overlapRatio.toFixed(2),
          missingTokens: chapter.endpoint.missingTokens.join(","),
        },
        preserveIds: chapter.endpoint.finalScenePreserveIds,
        sourceReport,
      }))
    }

    for (const turn of chapter.weakStoryTurnBeats) {
      if (!turn.targetRef) continue
      groups.push(readinessGroup({
        groupId: `planner-quality:ch${chapter.chapter}:turn:${turn.beat}`,
        report,
        chapter,
        sceneId: turn.targetRef,
        target: {
          kind: "scene_plan",
          ref: turn.targetRef,
          fieldPath: "description",
        },
        dimension: "storyTurnReadiness",
        label: "TURN-PLAN-1",
        severity: "medium",
        fixIntent: "make_scene_turn_playable_before_drafting",
        rationale: "Planner quality diagnostic found a scene description without enough concrete turn pressure.",
        missingForNextLevel: "Give the scene a playable turn: goal pressure, opposition, decision, reversal, or consequence.",
        evidence: {
          beat: String(turn.beat),
          kind: turn.kind,
          description: turn.description,
        },
        preserveIds: turn.preserveIds,
        sourceReport,
      }))
    }
  }

  const labels = groups.flatMap(group =>
    Array.isArray(group.findings)
      ? (group.findings as Array<Record<string, unknown>>).map(finding => String(finding.label ?? ""))
      : []
  ).filter(Boolean)

  return {
    sourceReports: [sourceReport],
    labels: unique(labels),
    groups,
  }
}

function readinessGroup(args: {
  groupId: string
  report: PlannerQualityReport
  chapter: PlannerQualityChapter
  sceneId?: string
  target: { kind: "chapter_outline" | "scene_plan"; ref: string; fieldPath: string }
  dimension: string
  label: string
  severity: "medium" | "low" | "info"
  fixIntent: string
  rationale: string
  missingForNextLevel: string
  evidence: Record<string, string>
  preserveIds: PlannerQualityPreserveIds
  sourceReport: string
}): Record<string, unknown> {
  return {
    groupId: args.groupId,
    fixtureId: args.report.novelId ?? "planner-quality",
    armId: "production-planner-quality",
    methodPackEnabled: false,
    unitType: args.target.kind === "chapter_outline" ? "chapter" : "scene",
    chapterId: args.chapter.chapterRef ?? `chapter:${args.chapter.chapter}`,
    ...(args.sceneId ? { sceneId: args.sceneId } : {}),
    sourceIds: args.preserveIds,
    rewritePacket: {
      preserveIds: args.preserveIds,
      proposalCandidate: {
        action: "field_replace",
        target: args.target,
        requiresProposedValue: true,
        proposedValueStatus: "operator_required",
        safeToAutoApply: false,
        sourceAgent: "planner-quality-report",
      },
    },
    findings: [{
      findingId: `${args.groupId}:1`,
      sourceReport: args.sourceReport,
      promptMode: "deterministic-planner-quality",
      dimension: args.dimension,
      label: args.label,
      severity: args.severity,
      fixIntent: args.fixIntent,
      rationale: args.rationale,
      missingForNextLevel: args.missingForNextLevel,
      evidence: args.evidence,
    }],
    excerpt: Object.entries(args.evidence)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n"),
  }
}

function sceneTargetRef(outline: ChapterOutline, scene: SceneBeat, index: number): string | null {
  return scene.sceneId ?? scene.beatId ?? `${outline.chapterId ?? `chapter-${outline.chapterNumber}`}-scene-${index + 1}`
}

function preserveIdsForScene(scene: SceneBeat): PlannerQualityPreserveIds {
  const obligations = sceneObligationRecords(scene)
  const sourceIds = obligations.map(value => stringField(value, "sourceId")).filter(Boolean)
  return {
    obligationIds: unique(obligations.map(value => stringField(value, "obligationId")).filter(Boolean)),
    characterIds: unique([
      ...stringArrayField(scene as unknown as Record<string, unknown>, "requiredCharacterIds"),
      ...stringArrayField(scene as unknown as Record<string, unknown>, "affectedCharacterIds"),
      ...obligations.map(value => stringField(value, "characterId")),
    ].filter(Boolean)),
    worldFactIds: unique([
      ...stringArrayField(scene as unknown as Record<string, unknown>, "requiredWorldFactIds"),
      ...obligations.map(value => stringField(value, "worldFactId")),
      ...obligations
        .filter(value => stringField(value, "sourceKind") === "fact" || /^(fact|world)-/u.test(stringField(value, "sourceId")))
        .map(value => stringField(value, "sourceId")),
    ].filter(Boolean)),
    sceneTurnIds: unique(obligations.map(value => stringField(value, "sceneTurnId")).filter(Boolean)),
    threadIds: unique(obligations.map(value => stringField(value, "threadId")).filter(Boolean)),
    promiseIds: unique(obligations.map(value => stringField(value, "promiseId")).filter(Boolean)),
    payoffIds: unique(obligations.map(value => stringField(value, "payoffId")).filter(Boolean)),
    sourceIds: unique(sourceIds),
  }
}

function sceneObligationRecords(scene: SceneBeat): Array<Record<string, unknown>> {
  const obligations = scene.obligations as Record<string, unknown> | undefined
  if (!obligations) return []
  const out: Array<Record<string, unknown>> = []
  for (const value of Object.values(obligations)) {
    if (!Array.isArray(value)) continue
    for (const item of value) {
      if (item && typeof item === "object" && !Array.isArray(item)) out.push(item as Record<string, unknown>)
    }
  }
  return out
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === "string" ? value : ""
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function extractEndpoint(purpose: string): string | null {
  for (const pattern of ENDPOINT_PATTERNS) {
    const match = purpose.match(pattern)
    if (match?.[1]) return match[1].trim()
  }
  return null
}

function textMentionsCharacter(text: string, character: string): boolean {
  const textTokens = new Set(contentTokens(text))
  const nameTokens = contentTokens(character)
  return nameTokens.some(token => textTokens.has(token))
}

function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['']/g, "")
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 3 && !STOPWORDS.has(token))
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ")
}

function positiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

export function renderPlannerQualityReport(report: PlannerQualityReport): string {
  const lines: string[] = []
  lines.push(`Planner quality report${report.novelId ? ` for ${report.novelId}` : ""}`)
  lines.push(
    `Chapters=${report.totals.chapters}; beats=${report.totals.plannedBeats}; ` +
      `overPlanned=${report.totals.overPlannedChapters}; underPlanned=${report.totals.underPlannedChapters}; ` +
      `endpointIssues=${report.totals.endpointIssues}; inactiveCharacters=${report.totals.inactiveCharacterFindings}; ` +
      `weakStoryTurns=${report.totals.weakStoryTurnBeats}; obligationErrors=${report.totals.obligationErrorChapters}; ` +
      `overloadedObligations=${report.totals.overloadedObligationChapters}`,
  )
  if (report.chapters.length === 0) {
    lines.push("No chapter outlines found.")
    return lines.join("\n")
  }

  for (const chapter of report.chapters) {
    lines.push("")
    lines.push(
      `ch${chapter.chapter} "${chapter.title}": target=${chapter.targetWords ?? "?"}, ` +
        `beats=${chapter.plannedBeats} (rec=${chapter.recommendedBeats ?? "?"}, ` +
        `delta=${chapter.beatDeltaFromRecommended ?? "?"}), flags=${chapter.flags.join(",") || "none"}`,
    )
    if (chapter.endpoint.declared) {
      lines.push(
        `  endpoint overlap=${formatNullable(chapter.endpoint.overlapRatio, 2)}; ` +
          `declared=${chapter.endpoint.declared}`,
      )
      if (chapter.endpoint.missingTokens.length > 0) {
        lines.push(`  endpoint missing tokens=${chapter.endpoint.missingTokens.slice(0, 8).join(",")}`)
      }
    } else {
      lines.push("  endpoint not declared in purpose")
    }
    const inactive = chapter.characters.filter(character => !character.visible)
    if (inactive.length > 0) {
      lines.push(
        `  inactive listed characters=${inactive.map(character =>
          `${character.character}(beatRefs=${character.listedInBeats}, textRefs=${character.mentionedInBeatText})`
        ).join("; ")}`,
      )
    }
    if (chapter.weakStoryTurnBeats.length > 0) {
      lines.push(
        `  weak story-turn beats=${chapter.weakStoryTurnBeats.map(beat =>
          `${beat.beat}:${beat.kind}`
        ).join(",")}`,
      )
    }
    if (!chapter.obligationHealth.valid) {
      lines.push(`  obligation errors=${chapter.obligationHealth.errors.slice(0, 3).join("; ")}`)
    }
  }
  return lines.join("\n")
}

function formatNullable(value: number | null, digits: number): string {
  return value === null ? "?" : value.toFixed(digits)
}

function parseArgs(argv: string[]): Args {
  let novelId: string | null = null
  let json = false
  let readinessJson: string | null = null
  let importReadiness = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--novel") {
      const value = argv[++i]
      if (!value) throw new Error("--novel requires a value")
      novelId = value
    } else if (arg === "--json") {
      json = true
    } else if (arg === "--readiness-json") {
      const value = argv[++i]
      if (!value) throw new Error("--readiness-json requires a value")
      readinessJson = value
    } else if (arg === "--import-readiness") {
      importReadiness = true
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }
  return { novelId, json, readinessJson, importReadiness }
}

let loadedDb: { default: typeof import("../../src/db/connection").default } | null = null

async function getDb(): Promise<typeof import("../../src/db/connection").default> {
  loadedDb ??= await import("../../src/db/connection")
  return loadedDb.default
}

async function loadRows(novelId: string): Promise<PlannerQualityOutlineRow[]> {
  const db = await getDb()
  const rows = await db`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number
  ` as PlannerQualityOutlineRow[]
  return rows
}

async function closeDb(): Promise<void> {
  if (!loadedDb) return
  await loadedDb.default.end().catch(() => {})
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error(usage())
    return 2
  }
  if (!args.novelId) {
    console.error(usage())
    return 2
  }
  try {
    const report = buildPlannerQualityReport(await loadRows(args.novelId), args.novelId)
    const readiness = args.readinessJson || args.importReadiness
      ? buildPlannerQualityReadinessAggregate(report, `planner-quality-report:${args.novelId}`)
      : null
    if (args.readinessJson && readiness) {
      const outPath = resolve(args.readinessJson)
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, `${JSON.stringify(readiness, null, 2)}\n`)
      console.error(`wrote planner-quality readiness aggregate to ${outPath}`)
    }
    if (args.importReadiness && readiness) {
      const { importPlanReadinessAggregateForNovel } = await import("../../src/harness/plan-readiness-import")
      const imported = await importPlanReadinessAggregateForNovel({
        novelId: args.novelId,
        aggregate: readiness,
        importedByKind: "script",
        importedByRef: "planner-quality-report",
        refreshStaleness: true,
      })
      console.error(`imported ${imported.inserted} readiness items, updated ${imported.updated}, skipped ${imported.skipped.length}`)
    }
    console.log(args.json ? JSON.stringify(report, null, 2) : renderPlannerQualityReport(report))
    return 0
  } finally {
    await closeDb()
  }
}

function usage(): string {
  return "usage: bun scripts/analysis/planner-quality-report.ts --novel <novelId> [--json] [--readiness-json <path>] [--import-readiness]"
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}

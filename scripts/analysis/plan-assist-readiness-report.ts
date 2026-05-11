#!/usr/bin/env bun
/**
 * Convert Plan-Assist gate rows into Plan Readiness-compatible review items.
 * This is advisory/manual: it preserves the stop evidence and target refs but
 * never mutates plans unless a later operator review creates a proposal.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import {
  listExhaustionsForNovel,
  type ExhaustionDeviation,
  type ExhaustionKind,
  type ExhaustionRow,
} from "../../src/db/chapter-exhaustions"

type Severity = "high" | "medium" | "low" | "info"

export interface PlanAssistReadinessArgs {
  novelId: string
  outputPath: string | null
  jsonPath: string | null
  importReadiness: boolean
  includeResolved: boolean
}

export interface PlanAssistReadinessChapterTarget {
  chapterNumber: number
  chapterId: string
  beatIdsByIndex: Record<string, string>
  sceneIdsByIndex: Record<string, string>
}

interface PlanAssistReadinessFinding {
  findingId: string
  sourceReport: string
  promptMode: "plan-assist-gate"
  dimension: "planAssistGate"
  label: string
  severity: Severity
  fixIntent: string
  rationale: string
  missingForNextLevel: string
  evidence: Record<string, string>
}

type PlanAssistReadinessTarget =
  | { kind: "beat_plan"; ref: string }
  | { kind: "scene_plan"; ref: string }
  | { kind: "chapter_outline"; ref: string; fieldPath: "purpose" }

type PlanAssistReadinessAction = "beat_replace" | "field_replace"

interface SourceIds {
  obligationIds: string[]
  characterIds: string[]
  worldFactIds: string[]
  sceneTurnIds: string[]
  threadIds: string[]
  promiseIds: string[]
  payoffIds: string[]
  sourceIds: string[]
}

interface PlanAssistReadinessGroup {
  groupId: string
  fixtureId: string
  armId: "plan-assist-readiness"
  methodPackEnabled: false
  unitType: "chapter" | "scene" | "beat"
  chapterId: string
  sceneId: string
  sourceIds: SourceIds
  highestSeverity: Severity
  fixIntents: string[]
  dimensions: ["planAssistGate"]
  findings: PlanAssistReadinessFinding[]
  rewritePacket: {
    targetSummary: string
    rewriteGoals: string[]
    preserveIds: SourceIds
    proposalCandidate: {
      action: PlanAssistReadinessAction
      target: PlanAssistReadinessTarget
      requiresProposedValue: true
      proposedValueStatus: "operator_required"
      safeToAutoApply: false
      sourceAgent: "plan-assist-readiness"
    }
  }
  excerpt: string
}

export interface PlanAssistReadinessAggregate {
  generatedAt: string
  sourceReports: string[]
  labels: string[]
  maxOrdinal: 1
  findingCount: number
  groupCount: number
  exhaustionRows: number
  pendingRows: number
  groups: PlanAssistReadinessGroup[]
}

interface Bucket {
  row: ExhaustionRow
  chapterTarget: PlanAssistReadinessChapterTarget
  target: PlanAssistReadinessTarget
  unitType: "chapter" | "scene" | "beat"
  sceneId: string
  beatId: string
  deviations: NormalizedDeviation[]
}

interface NormalizedDeviation {
  description: string
  beatIndex: number | null
  beatId: string
  sceneId: string
  metadataJson: string
}

export function parseArgs(argv = process.argv.slice(2)): PlanAssistReadinessArgs {
  let novelId = ""
  let outputPath: string | null = null
  let jsonPath: string | null = null
  let importReadiness = false
  let includeResolved = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--novel") {
      novelId = requireValue(argv[++i], "--novel")
    } else if (arg === "--output") {
      outputPath = requireValue(argv[++i], "--output")
    } else if (arg === "--json") {
      jsonPath = requireValue(argv[++i], "--json")
    } else if (arg === "--import-readiness") {
      importReadiness = true
    } else if (arg === "--include-resolved") {
      includeResolved = true
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }

  if (!novelId) throw new Error("--novel is required")
  return { novelId, outputPath, jsonPath, importReadiness, includeResolved }
}

export function buildPlanAssistReadinessAggregate(input: {
  novelId: string
  exhaustions: readonly ExhaustionRow[]
  chapterTargets: readonly PlanAssistReadinessChapterTarget[]
  includeResolved?: boolean
  generatedAt?: string
}): PlanAssistReadinessAggregate {
  const includeResolved = input.includeResolved === true
  const chapterTargetByNumber = new Map(input.chapterTargets.map(target => [target.chapterNumber, target]))
  const relevantRows = input.exhaustions.filter(row => includeResolved || row.decision == null)
  const buckets = new Map<string, Bucket>()

  for (const row of relevantRows) {
    const chapterTarget = chapterTargetByNumber.get(row.chapter)
    if (!chapterTarget) continue
    for (const deviation of row.unresolvedDeviations) {
      const normalized = normalizeDeviation(deviation, chapterTarget)
      const target = targetForDeviation(chapterTarget, normalized)
      const key = `${row.id}:${target.kind}:${target.ref}:${"fieldPath" in target ? target.fieldPath : "self"}`
      const bucket = buckets.get(key) ?? {
        row,
        chapterTarget,
        target,
        unitType: target.kind === "beat_plan" ? "beat" as const : target.kind === "scene_plan" ? "scene" as const : "chapter" as const,
        sceneId: normalized.sceneId,
        beatId: normalized.beatId,
        deviations: [],
      }
      if (!bucket.sceneId && normalized.sceneId) bucket.sceneId = normalized.sceneId
      if (!bucket.beatId && normalized.beatId) bucket.beatId = normalized.beatId
      bucket.deviations.push(normalized)
      buckets.set(key, bucket)
    }
  }

  const groups = [...buckets.values()]
    .sort(compareBuckets)
    .map((bucket, index) => bucketToGroup(input.novelId, bucket, index + 1))

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceReports: unique(relevantRows.map(row => `chapter_exhaustions:${row.id}`)),
    labels: unique(groups.flatMap(group => group.findings.map(finding => finding.label))),
    maxOrdinal: 1,
    findingCount: groups.reduce((sum, group) => sum + group.findings.length, 0),
    groupCount: groups.length,
    exhaustionRows: input.exhaustions.length,
    pendingRows: input.exhaustions.filter(row => row.decision == null).length,
    groups,
  }
}

export function renderPlanAssistReadinessAggregate(report: PlanAssistReadinessAggregate): string {
  const lines: string[] = []
  lines.push("# Plan-Assist Readiness Candidates")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Exhaustion rows: ${report.exhaustionRows}`)
  lines.push(`Pending rows: ${report.pendingRows}`)
  lines.push(`Groups: ${report.groupCount}`)
  lines.push(`Findings: ${report.findingCount}`)
  lines.push("")
  lines.push("These are manual Plan Readiness candidates from Plan-Assist gate evidence. They do not auto-mutate the plan.")
  lines.push("")
  if (report.groups.length === 0) {
    lines.push("No pending Plan-Assist gate rows produced readiness candidates.")
    return `${lines.join("\n")}\n`
  }
  for (const group of report.groups) {
    const finding = group.findings[0]!
    lines.push(`## ${group.groupId} ${group.highestSeverity.toUpperCase()} ${group.chapterId}`)
    lines.push("")
    lines.push(`Target: ${targetLabel(group.rewritePacket.proposalCandidate.target)}`)
    lines.push(`Label: ${finding.label}`)
    lines.push(`Gate: ${finding.evidence.kind} row=${finding.evidence.exhaustionId} attempt=${finding.evidence.attempt}`)
    lines.push(`Issues: ${finding.evidence.issueCount}`)
    lines.push("")
    lines.push("Operator question:")
    lines.push("- Does this gate indicate a real upstream planning edit, an allowed entity/scope decision, or an acceptable checker finding?")
    lines.push("")
    for (const description of splitDescriptions(finding.evidence.descriptions)) {
      lines.push(`- ${description}`)
    }
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

export async function loadPlanAssistReadinessInputs(novelId: string): Promise<{
  exhaustions: ExhaustionRow[]
  chapterTargets: PlanAssistReadinessChapterTarget[]
}> {
  const [exhaustions, chapterTargets] = await Promise.all([
    listExhaustionsForNovel(novelId),
    loadChapterTargets(novelId),
  ])
  return { exhaustions, chapterTargets }
}

function bucketToGroup(novelId: string, bucket: Bucket, ordinal: number): PlanAssistReadinessGroup {
  const groupId = `${ordinal}`.padStart(3, "0")
  const findingId = `${groupId}.1`
  const label = labelForKind(bucket.row.kind)
  const fixIntent = fixIntentForKind(bucket.row.kind)
  const sourceIds = sourceIdsForBucket(bucket)
  const descriptions = bucket.deviations.map(deviation => deviation.description)
  const metadataValues = bucket.deviations
    .map(deviation => deviation.metadataJson)
    .filter(Boolean)
    .map(value => JSON.parse(value))
  const metadataJson = metadataValues.length > 0 ? compactJson(metadataValues) : ""
  const targetSummary = targetLabel(bucket.target)
  const finding: PlanAssistReadinessFinding = {
    findingId,
    sourceReport: `chapter_exhaustions:${bucket.row.id}`,
    promptMode: "plan-assist-gate",
    dimension: "planAssistGate",
    label,
    severity: "high",
    fixIntent,
    rationale: `${bucket.row.kind} Plan-Assist gate blocked chapter ${bucket.row.chapter} with ${descriptions.length} unresolved issue${descriptions.length === 1 ? "" : "s"}.`,
    missingForNextLevel: missingForNextLevel(bucket.row.kind),
    evidence: {
      exhaustionId: String(bucket.row.id),
      kind: bucket.row.kind,
      resolverMode: bucket.row.resolverMode,
      decision: bucket.row.decision ?? "pending",
      chapter: String(bucket.row.chapter),
      attempt: String(bucket.row.attempt),
      firedAt: bucket.row.firedAt,
      issueCount: String(descriptions.length),
      descriptions: descriptions.join("\n"),
      target: targetSummary,
      ...(bucket.beatId ? { beatId: bucket.beatId } : {}),
      ...(bucket.sceneId ? { sceneId: bucket.sceneId } : {}),
      ...(metadataJson ? { metadataJson } : {}),
    },
  }

  return {
    groupId,
    fixtureId: novelId,
    armId: "plan-assist-readiness",
    methodPackEnabled: false,
    unitType: bucket.unitType,
    chapterId: bucket.chapterTarget.chapterId,
    sceneId: bucket.sceneId,
    sourceIds,
    highestSeverity: "high",
    fixIntents: [fixIntent],
    dimensions: ["planAssistGate"],
    findings: [finding],
    rewritePacket: {
      targetSummary,
      rewriteGoals: [
        finding.missingForNextLevel,
        "Keep the gate advisory until an operator chooses a planning edit, override, or allowed-entity decision.",
      ],
      preserveIds: sourceIds,
      proposalCandidate: {
        action: bucket.target.kind === "chapter_outline" ? "field_replace" : "beat_replace",
        target: bucket.target,
        requiresProposedValue: true,
        proposedValueStatus: "operator_required",
        safeToAutoApply: false,
        sourceAgent: "plan-assist-readiness",
      },
    },
    excerpt: descriptions.join("\n"),
  }
}

function targetForDeviation(
  chapterTarget: PlanAssistReadinessChapterTarget,
  deviation: NormalizedDeviation,
): PlanAssistReadinessTarget {
  if (deviation.beatId) return { kind: "beat_plan", ref: deviation.beatId }
  if (deviation.sceneId) return { kind: "scene_plan", ref: deviation.sceneId }
  return { kind: "chapter_outline", ref: chapterTarget.chapterId, fieldPath: "purpose" }
}

function normalizeDeviation(
  deviation: ExhaustionDeviation,
  chapterTarget: PlanAssistReadinessChapterTarget,
): NormalizedDeviation {
  const beatIndex = Number.isInteger(deviation.beat_index) ? deviation.beat_index : null
  const indexKey = beatIndex == null ? "" : String(beatIndex)
  const beatId = cleanString(deviation.beatId) || chapterTarget.beatIdsByIndex[indexKey] || ""
  const sceneId = cleanString(deviation.sceneId) || chapterTarget.sceneIdsByIndex[indexKey] || ""
  return {
    description: cleanString(deviation.description) || "(missing Plan-Assist deviation description)",
    beatIndex,
    beatId,
    sceneId,
    metadataJson: compactJson(deviation.metadata),
  }
}

function labelForKind(kind: ExhaustionKind): string {
  if (kind === "integrity-exhausted") return "PLAN-ASSIST-INTEGRITY"
  if (kind === "reviser-rejected") return "PLAN-ASSIST-REVISER-REJECTED"
  return "PLAN-ASSIST-CHECKER-BLOCKER"
}

function fixIntentForKind(kind: ExhaustionKind): string {
  if (kind === "integrity-exhausted") return "resolve_integrity_exhaustion_plan_pressure"
  if (kind === "reviser-rejected") return "resolve_reviser_rejected_plan_change"
  return "resolve_plan_assist_checker_blocker"
}

function missingForNextLevel(kind: ExhaustionKind): string {
  if (kind === "integrity-exhausted") {
    return "Revise the upstream plan if the prose integrity failure is caused by overloaded, duplicated, or contradictory beat pressure; otherwise mark the gate as an acceptable drafting/checker issue."
  }
  if (kind === "reviser-rejected") {
    return "Review the rejected automatic plan revision and either provide a human planning edit or mark the original plan/checker finding as acceptable."
  }
  return "Revise the upstream beat/chapter plan, add an explicit allowed-entity/scope decision, or mark the checker finding as acceptable/false-positive with rationale."
}

function sourceIdsForBucket(bucket: Bucket): SourceIds {
  const sceneTurnIds = unique([
    bucket.beatId,
    bucket.sceneId,
    ...bucket.deviations.flatMap(deviation => [deviation.beatId, deviation.sceneId]),
  ].filter(Boolean))
  return {
    obligationIds: [],
    characterIds: [],
    worldFactIds: [],
    sceneTurnIds,
    threadIds: [],
    promiseIds: [],
    payoffIds: [],
    sourceIds: unique([
      `chapter_exhaustions:${bucket.row.id}`,
      ...sceneTurnIds,
    ]),
  }
}

function compareBuckets(a: Bucket, b: Bucket): number {
  return a.row.chapter - b.row.chapter
    || a.row.attempt - b.row.attempt
    || a.row.id - b.row.id
    || targetLabel(a.target).localeCompare(targetLabel(b.target))
}

function targetLabel(target: PlanAssistReadinessTarget): string {
  return `${target.kind}:${target.ref}${"fieldPath" in target ? `:${target.fieldPath}` : ""}`
}

function splitDescriptions(value: string): string[] {
  return value.split("\n").map(line => line.trim()).filter(Boolean)
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function compactJson(value: unknown): string {
  if (value == null) return ""
  try {
    return JSON.stringify(value)
  } catch {
    return ""
  }
}

function cleanString(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : ""
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} requires a value`)
  return value
}

function writeOutput(path: string, content: string): void {
  const abs = resolve(path)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

async function loadChapterTargets(novelId: string): Promise<PlanAssistReadinessChapterTarget[]> {
  const { default: db } = await import("../../src/db/connection")
  const rows = await db`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number
  ` as Array<{ chapter_number: number; outline_json: unknown }>
  return rows.map(row => chapterTargetFromOutline(row.chapter_number, row.outline_json))
}

function chapterTargetFromOutline(chapterNumber: number, outline: unknown): PlanAssistReadinessChapterTarget {
  const record = asRecord(outline)
  const chapterId = cleanString(record?.chapterId) || `chapter:${chapterNumber}`
  const beatIdsByIndex: Record<string, string> = {}
  const sceneIdsByIndex: Record<string, string> = {}
  const scenes = Array.isArray(record?.scenes) ? record.scenes : []
  scenes.forEach((scene, index) => {
    const sceneRecord = asRecord(scene)
    const beatId = cleanString(sceneRecord?.beatId)
    const sceneId = cleanString(sceneRecord?.sceneId)
    if (beatId) beatIdsByIndex[String(index)] = beatId
    if (sceneId) sceneIdsByIndex[String(index)] = sceneId
  })
  return { chapterNumber, chapterId, beatIdsByIndex, sceneIdsByIndex }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

async function closeDb(): Promise<void> {
  const { default: db } = await import("../../src/db/connection")
  await db.end().catch(() => {})
}

async function main(): Promise<number> {
  let args: PlanAssistReadinessArgs
  try {
    args = parseArgs()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/plan-assist-readiness-report.ts --novel <novelId> [--output <report.md>] [--json <report.json>] [--import-readiness] [--include-resolved]")
    return 2
  }

  try {
    const inputs = await loadPlanAssistReadinessInputs(args.novelId)
    const aggregate = buildPlanAssistReadinessAggregate({
      novelId: args.novelId,
      exhaustions: inputs.exhaustions,
      chapterTargets: inputs.chapterTargets,
      includeResolved: args.includeResolved,
    })
    const rendered = renderPlanAssistReadinessAggregate(aggregate)
    if (args.outputPath) writeOutput(args.outputPath, rendered)
    if (args.jsonPath) writeOutput(args.jsonPath, `${JSON.stringify(aggregate, null, 2)}\n`)
    console.log(rendered)
    if (args.importReadiness) {
      const { importPlanReadinessAggregateForNovel } = await import("../../src/harness/plan-readiness-import")
      const imported = await importPlanReadinessAggregateForNovel({
        novelId: args.novelId,
        aggregate,
        importedByKind: "script",
        importedByRef: "plan-assist-readiness-report",
        refreshStaleness: true,
      })
      console.log(`imported ${imported.inserted} readiness items, updated ${imported.updated}, skipped ${imported.skipped.length}`)
    }
    return 0
  } catch (err) {
    console.error(err instanceof Error ? err.stack : String(err))
    return 1
  } finally {
    await closeDb()
  }
}

if (import.meta.main) {
  process.exit(await main())
}

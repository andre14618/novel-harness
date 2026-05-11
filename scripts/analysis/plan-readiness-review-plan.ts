#!/usr/bin/env bun
/**
 * Build an explicit operator-plan scaffold from existing Plan Readiness items.
 * The scaffold is meant to be reviewed and edited before
 * diagnostics:plan-readiness-apply mutates readiness state or creates proposals.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { PlanReadinessItem } from "../../src/db/plan-readiness"
import {
  PLAN_READINESS_STATUSES,
  type PlanReadinessStatus,
} from "../../src/harness/plan-readiness"
import type {
  PlanReadinessActionPlan,
  PlanReadinessApplyDecision,
} from "./plan-readiness-apply"
import {
  formatSourceDraftingIsolationAssessment,
  loadSourceDraftingIsolationAssessment,
  type SourceDraftingIsolationAssessment,
} from "../../src/harness/drafting-source"
import { enrichOutlineIds } from "../../src/harness/ids"
import type { ChapterOutline } from "../../src/types"

type StatusFilter = PlanReadinessStatus | "all"

const DEFAULT_NOTE = "Generated default. Replace with an operator judgment before non-dry-run apply."

export interface PlanReadinessReviewPlanArgs {
  novelId: string
  outputPath: string | null
  jsonPath: string | null
  status: StatusFilter
  limit: number
  defaultDecision: PlanReadinessApplyDecision
}

export interface PlanReadinessReviewPlanReport {
  generatedAt: string
  novelId: string
  status: StatusFilter
  defaultDecision: PlanReadinessApplyDecision
  draftingSource: SourceDraftingIsolationAssessment | null
  itemCount: number
  summary: {
    byStatus: Record<string, number>
    byLabel: Record<string, number>
    byDimension: Record<string, number>
    byTargetKind: Record<string, number>
  }
  plan: PlanReadinessActionPlan
  items: Array<{
    id: string
    status: string
    severity: string
    label: string
    dimension: string
    target: string
    explanation: string
    missingForNextLevel: string | null
    evidence: Record<string, string>
    preserveIds: PlanReadinessItem["preserveIds"]
    proposalCandidate: unknown
    currentValueSummary: unknown
  }>
}

interface PlanReadinessReviewTargetContext {
  currentValueSummary: unknown
}

export function parseArgs(argv = process.argv.slice(2)): PlanReadinessReviewPlanArgs {
  let novelId = ""
  let outputPath: string | null = null
  let jsonPath: string | null = null
  let status: StatusFilter = "open"
  let limit = 200
  let defaultDecision: PlanReadinessApplyDecision = "deferred"

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--novel") {
      novelId = requireValue(argv[++i], "--novel")
    } else if (arg === "--output") {
      outputPath = requireValue(argv[++i], "--output")
    } else if (arg === "--json") {
      jsonPath = requireValue(argv[++i], "--json")
    } else if (arg === "--status") {
      status = statusValue(requireValue(argv[++i], "--status"))
    } else if (arg === "--limit") {
      limit = positiveInt(requireValue(argv[++i], "--limit"), "--limit")
    } else if (arg === "--default-decision") {
      defaultDecision = defaultDecisionValue(requireValue(argv[++i], "--default-decision"))
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }

  if (!novelId) throw new Error("--novel is required")
  return { novelId, outputPath, jsonPath, status, limit, defaultDecision }
}

export function buildReviewPlanReport(input: {
  novelId: string
  items: readonly PlanReadinessItem[]
  status: StatusFilter
  defaultDecision?: PlanReadinessApplyDecision
  draftingSource?: SourceDraftingIsolationAssessment | null
  targetContexts?: ReadonlyMap<string, PlanReadinessReviewTargetContext>
  generatedAt?: string
}): PlanReadinessReviewPlanReport {
  const defaultDecision = input.defaultDecision ?? "deferred"
  const items = [...input.items].sort(compareReadinessItems)
  const plan: PlanReadinessActionPlan = {
    actions: items.map(item => actionForItem(item, defaultDecision, input.targetContexts?.get(formatTarget(item)) ?? null)),
  }

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    novelId: input.novelId,
    status: input.status,
    defaultDecision,
    draftingSource: input.draftingSource ?? null,
    itemCount: items.length,
    summary: {
      byStatus: countBy(items, item => item.status),
      byLabel: countBy(items, item => item.diagnosticLabel),
      byDimension: countBy(items, item => item.dimension),
      byTargetKind: countBy(items, item => item.target.kind),
    },
    plan,
    items: items.map(item => ({
      id: item.id,
      status: item.status,
      severity: item.severity,
      label: item.diagnosticLabel,
      dimension: item.dimension,
      target: formatTarget(item),
      explanation: item.explanation,
      missingForNextLevel: item.missingForNextLevel,
      evidence: item.evidence,
      preserveIds: item.preserveIds,
      proposalCandidate: item.metadata.proposalCandidate ?? null,
      currentValueSummary: input.targetContexts?.get(formatTarget(item))?.currentValueSummary ?? null,
    })),
  }
}

function actionForItem(
  item: PlanReadinessItem,
  defaultDecision: PlanReadinessApplyDecision,
  context: PlanReadinessReviewTargetContext | null,
): PlanReadinessActionPlan["actions"][number] {
  const proposalCandidate = item.metadata.proposalCandidate ?? null
  return {
    match: {
      itemId: item.id,
      label: item.diagnosticLabel,
      dimension: item.dimension,
      targetKind: item.target.kind,
      targetRef: item.target.ref,
      ...(item.target.fieldPath ? { targetFieldPath: item.target.fieldPath } : {}),
    },
    decision: defaultDecision,
    operatorNote: DEFAULT_NOTE,
    ...(proposalCandidate
      ? {
        proposalCandidate,
        proposalInstruction: "To create a planning proposal, set decision to the candidate action and replace proposedValueTemplate with proposedValue.",
        proposedValueTemplate: proposedValueTemplateFor(item),
      }
      : {}),
    ...(context ? { currentValueSummary: context.currentValueSummary } : {}),
  }
}

function proposedValueTemplateFor(item: PlanReadinessItem): unknown {
  const proposalCandidate = item.metadata.proposalCandidate
  const action = typeof proposalCandidate === "object" && proposalCandidate !== null && !Array.isArray(proposalCandidate)
    ? (proposalCandidate as Record<string, unknown>).action
    : null
  if (action === "beat_reorder" || action === "scene_select") {
    const sceneRefs = stringListFromCsv(item.evidence.sceneRefs)
    return sceneRefs.length > 0 ? sceneRefs : ["replace-with-reviewed-scene-id-order"]
  }
  return {
    target: {
      kind: item.target.kind,
      ref: item.target.ref,
      ...(item.target.fieldPath ? { fieldPath: item.target.fieldPath } : {}),
    },
    replaceWithReviewedValue: true,
  }
}

function stringListFromCsv(value: string | undefined): string[] {
  if (!value) return []
  return value.split(",").map(item => item.trim()).filter(Boolean)
}

export function renderReviewPlanReport(report: PlanReadinessReviewPlanReport): string {
  const lines: string[] = []
  lines.push("# Plan Readiness Review Plan")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Novel: ${report.novelId}`)
  lines.push(`Status filter: ${report.status}`)
  lines.push(`Default decision: ${report.defaultDecision}`)
  lines.push(`Items: ${report.itemCount}`)
  lines.push("")
  lines.push("## Drafting Source")
  lines.push("")
  lines.push(...renderDraftingSourceLines(report.draftingSource))
  lines.push("")
  lines.push("## Summary")
  lines.push(`- by label: ${formatCounts(report.summary.byLabel)}`)
  lines.push(`- by dimension: ${formatCounts(report.summary.byDimension)}`)
  lines.push(`- by target kind: ${formatCounts(report.summary.byTargetKind)}`)
  lines.push("")
  lines.push("## Operator Plan")
  lines.push("")
  lines.push(`Review and edit the JSON plan before running \`diagnostics:plan-readiness-apply\` without \`--dry-run\`.`)
  lines.push("")
  for (const item of report.items) {
    lines.push(`### ${item.label} ${item.target}`)
    lines.push("")
    lines.push(`- item: ${item.id}`)
    lines.push(`- status: ${item.status}`)
    lines.push(`- severity: ${item.severity}`)
    lines.push(`- dimension: ${item.dimension}`)
    lines.push(`- explanation: ${item.explanation}`)
    if (item.missingForNextLevel) lines.push(`- missing: ${item.missingForNextLevel}`)
    const evidenceLines = Object.entries(item.evidence)
      .filter(([, value]) => value.length > 0)
      .slice(0, 8)
      .map(([key, value]) => `${key}=${value}`)
    if (evidenceLines.length > 0) lines.push(`- evidence: ${evidenceLines.join("; ")}`)
    const preserve = formatPreserveIds(item.preserveIds)
    if (preserve) lines.push(`- preserve IDs: ${preserve}`)
    const current = renderCurrentValueSummary(item.currentValueSummary)
    if (current.length > 0) lines.push(...current)
    if (item.proposalCandidate) lines.push("- proposal candidate: available in JSON")
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

async function run(args: PlanReadinessReviewPlanArgs): Promise<PlanReadinessReviewPlanReport> {
  const { listPlanReadinessItems } = await import("../../src/db/plan-readiness")
  const [items, draftingSource, targetContexts] = await Promise.all([
    listPlanReadinessItems(args.novelId, {
      status: args.status,
      limit: args.limit,
    }),
    loadSourceDraftingIsolationAssessment(args.novelId),
    loadReviewTargetContexts(args.novelId),
  ])
  return buildReviewPlanReport({
    novelId: args.novelId,
    items,
    status: args.status,
    defaultDecision: args.defaultDecision,
    draftingSource,
    targetContexts,
  })
}

async function loadReviewTargetContexts(
  novelId: string,
): Promise<Map<string, PlanReadinessReviewTargetContext>> {
  const { getChapterOutlines } = await import("../../src/db/outlines")
  const outlines = await getChapterOutlines(novelId).catch(() => [])
  const out = new Map<string, PlanReadinessReviewTargetContext>()
  for (const outline of outlines) {
    const normalized = canonicalOutlineForReview(outline)
    const chapterRef = normalized.chapterId ?? `chapter:${normalized.chapterNumber}`
    const sceneOrder = (normalized.scenes ?? []).map((scene, index) => sceneSummary(scene, index))
    out.set(`chapter_outline:${chapterRef}:scenes`, {
      currentValueSummary: sceneOrder,
    })
  }
  return out
}

function canonicalOutlineForReview(outline: ChapterOutline): ChapterOutline {
  const normalized = JSON.parse(JSON.stringify(outline)) as ChapterOutline
  enrichOutlineIds(normalized)
  return normalized
}

function sceneSummary(scene: NonNullable<ChapterOutline["scenes"]>[number], index: number): {
  index: number
  ref: string
  kind: string
  description: string
} {
  const record = scene as Record<string, unknown>
  return {
    index: index + 1,
    ref: stringValue(record.sceneId) || stringValue(record.beatId) || `scene-${index + 1}`,
    kind: stringValue(record.kind) || "(none)",
    description: truncate(stringValue(record.description), 240),
  }
}

function compareReadinessItems(a: PlanReadinessItem, b: PlanReadinessItem): number {
  return severityRank(b.severity) - severityRank(a.severity) ||
    a.target.kind.localeCompare(b.target.kind) ||
    a.target.ref.localeCompare(b.target.ref) ||
    a.dimension.localeCompare(b.dimension) ||
    a.diagnosticLabel.localeCompare(b.diagnosticLabel) ||
    a.id.localeCompare(b.id)
}

function severityRank(severity: string): number {
  if (severity === "high") return 4
  if (severity === "medium") return 3
  if (severity === "low") return 2
  return 1
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
  return entries.length === 0 ? "(none)" : entries.map(([key, count]) => `${key}: ${count}`).join(", ")
}

function formatTarget(item: PlanReadinessItem): string {
  return `${item.target.kind}:${item.target.ref}${item.target.fieldPath ? `:${item.target.fieldPath}` : ""}`
}

function renderDraftingSourceLines(assessment: SourceDraftingIsolationAssessment | null): string[] {
  if (!assessment) return ["- clean for drafting evidence: unknown"]
  const state = assessment.state
  return [
    `- clean for drafting evidence: ${assessment.clean ? "yes" : "no"}`,
    ...(assessment.issue ? [`- issue: ${assessment.issue}`] : []),
    ...(assessment.guidance ? [`- guidance: ${assessment.guidance}`] : []),
    ...(state
      ? [
        `- state: phase=${state.phase ?? "(none)"} current_chapter=${state.currentChapter ?? "(none)"} outlines=${state.outlineCount} drafts=${state.draftCount}`,
      ]
      : []),
    `- summary: ${formatSourceDraftingIsolationAssessment(assessment)}`,
  ]
}

function formatPreserveIds(preserveIds: PlanReadinessItem["preserveIds"]): string {
  return Object.entries(preserveIds)
    .filter(([, ids]) => Array.isArray(ids) && ids.length > 0)
    .map(([key, ids]) => `${key}=${(ids as string[]).join(",")}`)
    .join("; ")
}

function renderCurrentValueSummary(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return []
  const lines = ["- current scenes:"]
  for (const item of value.slice(0, 24)) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const index = stringValue(record.index)
    const ref = stringValue(record.ref)
    const description = stringValue(record.description)
    lines.push(`  - ${index ? `${index}. ` : ""}${ref}${description ? ` - ${description}` : ""}`)
  }
  return lines.length > 1 ? lines : []
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`
}

function statusValue(raw: string): StatusFilter {
  if (raw === "all" || (PLAN_READINESS_STATUSES as readonly string[]).includes(raw)) {
    return raw as StatusFilter
  }
  throw new Error(`--status must be all or one of ${PLAN_READINESS_STATUSES.join(", ")}`)
}

function defaultDecisionValue(raw: string): PlanReadinessApplyDecision {
  if (
    raw === "accepted_as_is" ||
    raw === "not_applicable" ||
    raw === "deferred" ||
    raw === "fixed"
  ) {
    return raw
  }
  throw new Error("--default-decision must be accepted_as_is, not_applicable, deferred, or fixed")
}

function positiveInt(raw: string, flag: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} must be a positive integer`)
  return n
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

async function closeDb(): Promise<void> {
  const { default: db } = await import("../../src/db/connection")
  await db.end().catch(() => {})
}

async function main(): Promise<number> {
  let args: PlanReadinessReviewPlanArgs
  try {
    args = parseArgs()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/plan-readiness-review-plan.ts --novel <novelId> [--output <report.md>] [--json <plan.json>] [--status <open|deferred|all>] [--limit <n>] [--default-decision <status>]")
    return 2
  }

  try {
    const report = await run(args)
    if (args.outputPath) writeOutput(args.outputPath, renderReviewPlanReport(report))
    if (args.jsonPath) writeOutput(args.jsonPath, `${JSON.stringify(report.plan, null, 2)}\n`)
    console.log(renderReviewPlanReport(report))
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

#!/usr/bin/env bun
/**
 * Convert production checker warning/blocker evidence into Plan
 * Readiness-compatible groups. This is advisory/manual: it creates review
 * candidates for upstream planning consistency and does not mutate plans.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import {
  buildCheckerWarningReport,
  loadCheckerWarningInputs,
  renderCheckerWarningReport,
  type CheckerWarningItem,
  type CheckerWarningReport,
} from "./checker-warning-report"

type Severity = "high" | "medium" | "low" | "info"

export interface CheckerReadinessArgs {
  novelId: string
  outputPath: string | null
  jsonPath: string | null
  importReadiness: boolean
  includeWarnings: boolean
}

export interface CheckerReadinessChapterTarget {
  chapterNumber: number
  chapterId: string
}

interface CheckerReadinessFinding {
  findingId: string
  sourceReport: string
  promptMode: string
  dimension: "planConsistency"
  label: string
  severity: Severity
  fixIntent: string
  rationale: string
  missingForNextLevel: string
  evidence: Record<string, string>
}

interface CheckerReadinessGroup {
  groupId: string
  fixtureId: string
  armId: string
  methodPackEnabled: false
  unitType: "chapter"
  chapterId: string
  sceneId: ""
  sourceIds: {
    obligationIds: string[]
    characterIds: string[]
    worldFactIds: string[]
    sceneTurnIds: string[]
    threadIds: string[]
    promiseIds: string[]
    payoffIds: string[]
    sourceIds: string[]
  }
  highestSeverity: Severity
  fixIntents: string[]
  dimensions: ["planConsistency"]
  findings: CheckerReadinessFinding[]
  rewritePacket: {
    targetSummary: string
    rewriteGoals: string[]
    preserveIds: CheckerReadinessGroup["sourceIds"]
    proposalCandidate: {
      action: "field_replace"
      target: {
        kind: "chapter_outline"
        ref: string
        fieldPath: "purpose"
      }
      requiresProposedValue: true
      proposedValueStatus: "operator_required"
      safeToAutoApply: false
      sourceAgent: "production-checker-warning-report"
    }
  }
  excerpt: string
}

export interface CheckerReadinessAggregate {
  generatedAt: string
  sourceReports: string[]
  labels: string[]
  maxOrdinal: 1
  findingCount: number
  groupCount: number
  groups: CheckerReadinessGroup[]
}

export function parseArgs(argv = process.argv.slice(2)): CheckerReadinessArgs {
  let novelId = ""
  let outputPath: string | null = null
  let jsonPath: string | null = null
  let importReadiness = false
  let includeWarnings = false

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
    } else if (arg === "--include-warnings") {
      includeWarnings = true
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }

  if (!novelId) throw new Error("--novel is required")
  return { novelId, outputPath, jsonPath, importReadiness, includeWarnings }
}

export function buildCheckerReadinessAggregate(input: {
  report: CheckerWarningReport
  chapterTargets: readonly CheckerReadinessChapterTarget[]
  includeWarnings?: boolean
  generatedAt?: string
}): CheckerReadinessAggregate {
  const chapterTargetByNumber = new Map(input.chapterTargets.map(target => [target.chapterNumber, target.chapterId]))
  const groups: CheckerReadinessGroup[] = []
  const includeWarnings = input.includeWarnings === true

  for (const chapter of input.report.chapters) {
    if (chapter.chapter == null) continue
    const chapterId = chapterTargetByNumber.get(chapter.chapter)
    if (!chapterId) continue
    const items = chapter.items.filter(item => itemShouldBecomeReadiness(item, includeWarnings))
    for (const item of items) {
      const severity = readinessSeverityFor(item)
      const label = checkerReadinessLabel(item)
      const sourceIds = emptySourceIds()
      const finding: CheckerReadinessFinding = {
        findingId: "pending.1",
        sourceReport: `checker-warning-report:${input.report.novelId ?? "unknown"}`,
        promptMode: "deterministic-checker-warning",
        dimension: "planConsistency",
        label,
        severity,
        fixIntent: "resolve_plan_checker_contradiction",
        rationale: `${item.source} ${item.severity} found a planning/draft consistency issue in chapter ${chapter.chapter}.`,
        missingForNextLevel: "Revise the upstream chapter/scene plan so the draft target does not require a contradiction, or mark the checker finding as acceptable/false-positive with rationale.",
        evidence: {
          source: item.source,
          severity: item.severity,
          description: item.description,
          chapter: String(chapter.chapter),
          rowId: String(item.rowId),
          polarity: item.polarity,
          calibration: item.calibration,
          ...(item.attempt == null ? {} : { attempt: String(item.attempt) }),
          ...(item.beatId ? { beatId: item.beatId } : {}),
          ...(item.plannedItemId ? { plannedItemId: item.plannedItemId } : {}),
        },
      }
      groups.push({
        groupId: "000",
        fixtureId: input.report.novelId ?? "unknown",
        armId: "checker-warning-report",
        methodPackEnabled: false,
        unitType: "chapter",
        chapterId,
        sceneId: "",
        sourceIds,
        highestSeverity: severity,
        fixIntents: [finding.fixIntent],
        dimensions: ["planConsistency"],
        findings: [finding],
        rewritePacket: {
          targetSummary: `chapter ${chapter.chapter} ${chapterId}`,
          rewriteGoals: [
            finding.missingForNextLevel,
            "Keep checker findings advisory/manual until an operator chooses a planning edit.",
          ],
          preserveIds: sourceIds,
          proposalCandidate: {
            action: "field_replace",
            target: {
              kind: "chapter_outline",
              ref: chapterId,
              fieldPath: "purpose",
            },
            requiresProposedValue: true,
            proposedValueStatus: "operator_required",
            safeToAutoApply: false,
            sourceAgent: "production-checker-warning-report",
          },
        },
        excerpt: item.description,
      })
    }
  }

  groups.sort((a, b) =>
    severityRank(b.highestSeverity) - severityRank(a.highestSeverity)
    || a.chapterId.localeCompare(b.chapterId)
    || a.excerpt.localeCompare(b.excerpt)
  )
  groups.forEach((group, index) => {
    group.groupId = `${index + 1}`.padStart(3, "0")
    group.findings[0]!.findingId = `${group.groupId}.1`
  })

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceReports: [`checker-warning-report:${input.report.novelId ?? "unknown"}`],
    labels: [],
    maxOrdinal: 1,
    findingCount: groups.length,
    groupCount: groups.length,
    groups,
  }
}

export function renderCheckerReadinessAggregate(report: CheckerReadinessAggregate): string {
  const lines: string[] = []
  lines.push("# Checker Readiness Candidates")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Groups: ${report.groupCount}`)
  lines.push(`Findings: ${report.findingCount}`)
  lines.push("")
  lines.push("These are manual Plan Readiness candidates from checker evidence. They do not auto-mutate the plan.")
  lines.push("")
  for (const group of report.groups) {
    const finding = group.findings[0]!
    lines.push(`## ${group.groupId} ${group.highestSeverity.toUpperCase()} ${group.chapterId}`)
    lines.push("")
    lines.push(`Target: chapter_outline:${group.chapterId}:purpose`)
    lines.push(`Label: ${finding.label}`)
    lines.push(`Source: ${finding.evidence.source}`)
    lines.push(`Issue: ${finding.evidence.description}`)
    lines.push("")
    lines.push("Operator question:")
    lines.push("- Is this a real upstream plan-consistency issue that needs a planning edit, or a checker false positive/acceptable drafting choice?")
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

function itemShouldBecomeReadiness(item: CheckerWarningItem, includeWarnings: boolean): boolean {
  if (item.polarity === "positive") return false
  if (item.severity === "blocker") return true
  return includeWarnings && item.severity === "warning" && item.calibration === "standard"
}

function checkerReadinessLabel(item: CheckerWarningItem): string {
  if (item.source === "continuity-facts") return item.severity === "blocker" ? "CONTINUITY-BLOCKER" : "CONTINUITY-WARNING"
  if (item.source === "continuity-state") return item.severity === "blocker" ? "STATE-BLOCKER" : "STATE-WARNING"
  return item.severity === "blocker" ? "FUNCTIONAL-BLOCKER" : "FUNCTIONAL-WARNING"
}

function readinessSeverityFor(item: CheckerWarningItem): Severity {
  if (item.severity === "blocker") return "high"
  if (item.severity === "warning") return "medium"
  if (item.severity === "nit") return "low"
  return "info"
}

function severityRank(severity: Severity): number {
  return severity === "high" ? 4 : severity === "medium" ? 3 : severity === "low" ? 2 : 1
}

function emptySourceIds(): CheckerReadinessGroup["sourceIds"] {
  return {
    obligationIds: [],
    characterIds: [],
    worldFactIds: [],
    sceneTurnIds: [],
    threadIds: [],
    promiseIds: [],
    payoffIds: [],
    sourceIds: [],
  }
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

export async function loadCheckerReadinessChapterTargets(novelId: string): Promise<CheckerReadinessChapterTarget[]> {
  const { default: db } = await import("../../src/db/connection")
  const rows = await db`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number
  ` as Array<{ chapter_number: number; outline_json: { chapterId?: string } }>
  return rows.map(row => ({
    chapterNumber: row.chapter_number,
    chapterId: row.outline_json.chapterId ?? `chapter:${row.chapter_number}`,
  }))
}

async function closeDb(): Promise<void> {
  const { default: db } = await import("../../src/db/connection")
  await db.end().catch(() => {})
}

async function main(): Promise<number> {
  let args: CheckerReadinessArgs
  try {
    args = parseArgs()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/checker-readiness-report.ts --novel <novelId> [--output <report.md>] [--json <report.json>] [--import-readiness] [--include-warnings]")
    return 2
  }

  try {
    const checkerReport = buildCheckerWarningReport(await loadCheckerWarningInputs(args.novelId), args.novelId)
    const aggregate = buildCheckerReadinessAggregate({
      report: checkerReport,
      chapterTargets: await loadCheckerReadinessChapterTargets(args.novelId),
      includeWarnings: args.includeWarnings,
    })
    const rendered = renderCheckerReadinessAggregate(aggregate)
    if (args.outputPath) writeOutput(args.outputPath, rendered)
    if (args.jsonPath) writeOutput(args.jsonPath, `${JSON.stringify(aggregate, null, 2)}\n`)
    console.log(rendered)
    console.log(renderCheckerWarningReport(checkerReport))
    if (args.importReadiness) {
      const { importPlanReadinessAggregateForNovel } = await import("../../src/harness/plan-readiness-import")
      const imported = await importPlanReadinessAggregateForNovel({
        novelId: args.novelId,
        aggregate,
        importedByKind: "script",
        importedByRef: "checker-readiness-report",
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

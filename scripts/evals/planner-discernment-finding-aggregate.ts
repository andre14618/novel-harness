#!/usr/bin/env bun
/**
 * Aggregate planner-discernment findings into proposal-ready rewrite packets.
 *
 * This is diagnostic-only. It does not generate proposed prose/planning text,
 * create planning_edit envelopes, mutate plans, or auto-approve anything.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"

const DEFAULT_LABELS = [
  "REL-1",
  "MOTIVE-1",
  "MOTIVE-2",
  "STAKES-2",
  "MATERIAL-0",
  "MATERIAL-1",
  "WFACT-0",
  "WFACT-1",
]

interface Args {
  reports: string[]
  labels: string[]
  outputDir: string | null
  limit: number | null
  json: boolean
}

interface SourceIds {
  obligationIds: string[]
  characterIds: string[]
  worldFactIds: string[]
}

interface ProposalCandidate {
  action: "field_replace"
  target: {
    kind: "scene_plan" | "beat_plan" | "chapter_outline"
    ref: string
    fieldPath: "description" | "purpose"
  }
  requiresProposedValue: true
  proposedValueStatus: "semantic_rewrite_required"
  safeToAutoApply: false
  sourceAgent: "planner-discernment-aggregate"
}

interface AggregatedFinding {
  findingId: string
  sourceReport: string
  promptMode: string
  dimension: string
  label: string
  severity: "high" | "medium" | "low" | "info"
  fixIntent: string
  rationale: string
  missingForNextLevel: string
  evidence: Record<string, string>
}

interface RewritePacket {
  targetSummary: string
  rewriteGoals: string[]
  preserveIds: SourceIds
  proposalCandidate: ProposalCandidate
}

interface FindingGroup {
  groupId: string
  fixtureId: string
  armId: string
  methodPackEnabled: boolean
  unitType: "chapter" | "scene"
  chapterId: string
  sceneId: string | null
  sourceIds: SourceIds
  highestSeverity: "high" | "medium" | "low" | "info"
  fixIntents: string[]
  dimensions: string[]
  findings: AggregatedFinding[]
  rewritePacket: RewritePacket
  excerpt: string
}

interface AggregateReport {
  generatedAt: string
  sourceReports: string[]
  labels: string[]
  findingCount: number
  groupCount: number
  groups: FindingGroup[]
}

export function buildFindingAggregate(args: Args, generatedAt = new Date().toISOString()): AggregateReport {
  const sourceReports = args.reports.map(resolveReportPath)
  const findingsByGroup = new Map<string, {
    result: any
    findings: AggregatedFinding[]
  }>()

  for (const sourceReport of sourceReports) {
    const report = JSON.parse(readFileSync(sourceReport, "utf-8")) as any
    for (const result of report.results ?? []) {
      const label = String(result.label ?? "")
      if (!args.labels.includes(label)) continue
      const groupKey = [
        result.fixtureId,
        result.armId,
        result.chapterId,
        result.sceneId ?? "",
      ].join("\t")
      const existing = findingsByGroup.get(groupKey) ?? { result, findings: [] }
      existing.findings.push(toFinding(result, sourceReport, existing.findings.length + 1))
      findingsByGroup.set(groupKey, existing)
    }
  }

  const groups = [...findingsByGroup.values()].map((group, index) => toGroup(group.result, group.findings, index + 1))
    .sort((a, b) => (
      severityRank(b.highestSeverity) - severityRank(a.highestSeverity)
      || a.fixtureId.localeCompare(b.fixtureId)
      || a.armId.localeCompare(b.armId)
      || a.chapterId.localeCompare(b.chapterId)
      || String(a.sceneId ?? "").localeCompare(String(b.sceneId ?? ""))
    ))
  const limited = args.limit === null ? groups : groups.slice(0, args.limit)
  limited.forEach((group, index) => {
    group.groupId = `${index + 1}`.padStart(3, "0")
    group.findings.forEach((finding, findingIndex) => {
      finding.findingId = `${group.groupId}.${findingIndex + 1}`
    })
  })

  return {
    generatedAt,
    sourceReports,
    labels: args.labels,
    findingCount: limited.reduce((sum, group) => sum + group.findings.length, 0),
    groupCount: limited.length,
    groups: limited,
  }
}

export function renderFindingAggregate(report: AggregateReport): string {
  const lines: string[] = []
  lines.push("# Planner Discernment Finding Aggregate")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Groups: ${report.groupCount}`)
  lines.push(`Findings: ${report.findingCount}`)
  lines.push(`Labels: ${report.labels.join(", ")}`)
  lines.push("")
  lines.push("## Source Reports")
  for (const source of report.sourceReports) lines.push(`- ${source}`)
  lines.push("")
  for (const group of report.groups) {
    lines.push(`## ${group.groupId} ${group.highestSeverity.toUpperCase()} ${group.fixtureId} ${group.chapterId}${group.sceneId ? `/${group.sceneId}` : ""}`)
    lines.push("")
    lines.push(`Arm: ${group.armId}`)
    lines.push(`Target: ${group.rewritePacket.proposalCandidate.target.kind}:${group.rewritePacket.proposalCandidate.target.ref}:${group.rewritePacket.proposalCandidate.target.fieldPath}`)
    lines.push(`Fix intents: ${group.fixIntents.join(", ")}`)
    lines.push(`Dimensions: ${group.dimensions.join(", ")}`)
    lines.push(`Safe to auto-apply: ${group.rewritePacket.proposalCandidate.safeToAutoApply}`)
    lines.push("")
    lines.push("Rewrite goals:")
    for (const goal of group.rewritePacket.rewriteGoals) lines.push(`- ${goal}`)
    lines.push("")
    lines.push("Preserve IDs:")
    lines.push(`- obligations: ${group.sourceIds.obligationIds.join(", ") || "none"}`)
    lines.push(`- characters: ${group.sourceIds.characterIds.join(", ") || "none"}`)
    lines.push(`- world facts: ${group.sourceIds.worldFactIds.join(", ") || "none"}`)
    lines.push("")
    lines.push("Findings:")
    for (const finding of group.findings) {
      lines.push(`- ${finding.findingId} ${finding.label} ${finding.dimension} (${finding.severity}): ${finding.rationale}`)
      if (finding.missingForNextLevel) lines.push(`  missing: ${finding.missingForNextLevel}`)
    }
    lines.push("")
    lines.push("Proposal candidate:")
    lines.push("```json")
    lines.push(JSON.stringify(group.rewritePacket.proposalCandidate, null, 2))
    lines.push("```")
    lines.push("")
    lines.push("Excerpt:")
    lines.push("```text")
    lines.push(group.excerpt.trim() || "(excerpt unavailable)")
    lines.push("```")
    lines.push("")
  }
  return lines.join("\n")
}

function toFinding(result: any, sourceReport: string, index: number): AggregatedFinding {
  const dimension = String(result.dimension ?? "")
  const label = String(result.label ?? "")
  const fixIntent = fixIntentFor(dimension, label)
  return {
    findingId: String(index),
    sourceReport,
    promptMode: String(result.promptMode ?? ""),
    dimension,
    label,
    severity: severityFor(label),
    fixIntent,
    rationale: rationaleFor(dimension, label),
    missingForNextLevel: String(result.missingForNextLevel ?? result.output?.missingForNextLevel ?? ""),
    evidence: normalizeEvidence(result.output?.evidence),
  }
}

function toGroup(result: any, findings: AggregatedFinding[], index: number): FindingGroup {
  const sceneId = result.sceneId ? String(result.sceneId) : null
  const chapterId = String(result.chapterId ?? "")
  const sourceIds = extractSourceIds(result)
  const proposalCandidate = proposalCandidateFor(sceneId, chapterId)
  const fixIntents = unique(findings.map(finding => finding.fixIntent))
  const dimensions = unique(findings.map(finding => finding.dimension))
  const highestSeverity = highestSeverityOf(findings)
  return {
    groupId: `${index}`.padStart(3, "0"),
    fixtureId: String(result.fixtureId ?? ""),
    armId: String(result.armId ?? ""),
    methodPackEnabled: Boolean(result.methodPackEnabled),
    unitType: sceneId ? "scene" : "chapter",
    chapterId,
    sceneId,
    sourceIds,
    highestSeverity,
    fixIntents,
    dimensions,
    findings,
    rewritePacket: {
      targetSummary: sceneId ? `scene ${sceneId}` : `chapter ${chapterId}`,
      rewriteGoals: fixIntents.map(intent => rewriteGoalFor(intent)),
      preserveIds: sourceIds,
      proposalCandidate,
    },
    excerpt: String(result.text ?? ""),
  }
}

function proposalCandidateFor(sceneId: string | null, chapterId: string): ProposalCandidate {
  if (sceneId) {
    return {
      action: "field_replace",
      target: { kind: "scene_plan", ref: sceneId, fieldPath: "description" },
      requiresProposedValue: true,
      proposedValueStatus: "semantic_rewrite_required",
      safeToAutoApply: false,
      sourceAgent: "planner-discernment-aggregate",
    }
  }
  return {
    action: "field_replace",
    target: { kind: "chapter_outline", ref: chapterId, fieldPath: "purpose" },
    requiresProposedValue: true,
    proposedValueStatus: "semantic_rewrite_required",
    safeToAutoApply: false,
    sourceAgent: "planner-discernment-aggregate",
  }
}

function extractSourceIds(result: any): SourceIds {
  const text = String(result.text ?? "")
  return {
    obligationIds: stringArray(result.requiredObligationIds) || parseIdLine(text, "Required obligation IDs"),
    characterIds: stringArray(result.requiredCharacterIds) || parseIdLine(text, "Required character IDs"),
    worldFactIds: stringArray(result.requiredWorldFactIds) || parseIdLine(text, "Required world fact IDs"),
  }
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.map(item => String(item)).filter(item => item.length > 0)
}

function parseIdLine(text: string, label: string): string[] {
  const match = text.match(new RegExp(`^${escapeRegex(label)}:\\s*(.+)$`, "m"))
  if (!match) return []
  return match[1]!
    .split(",")
    .map(part => part.trim())
    .filter(part => part.length > 0 && part !== "none")
}

function fixIntentFor(dimension: string, label: string): string {
  if (dimension === "relationshipDelta") return "add_relationship_delta_or_mark_not_relationship_scene"
  if (dimension === "motivationSpecificity" && label === "MOTIVE-1") return "sharpen_character_specific_motivation"
  if (dimension === "motivationSpecificity") return "consider_internal_tradeoff"
  if (dimension === "stakesValueShift") return "consider_sharper_cost_or_next_conflict"
  if (dimension === "characterMateriality") return "make_required_character_material_or_remove_requirement"
  if (dimension === "worldFactPressure") return "make_world_fact_operational_or_remove_requirement"
  return "review_only"
}

function rewriteGoalFor(intent: string): string {
  if (intent === "add_relationship_delta_or_mark_not_relationship_scene") {
    return "If this scene depends on relationship pressure, revise the scene contract so the interaction changes trust, leverage, obligation, power, loyalty, or future pressure; otherwise remove relationship expectations from this target."
  }
  if (intent === "sharpen_character_specific_motivation") {
    return "Revise the scene contract so the POV tactic follows from a specific desire, fear, flaw, value, or relationship pressure instead of generic plot movement."
  }
  if (intent === "consider_internal_tradeoff") {
    return "Operator review: decide whether this scene needs a stronger internal tradeoff or whether specific motivation is sufficient."
  }
  if (intent === "consider_sharper_cost_or_next_conflict") {
    return "Operator review: decide whether the value shift should become sharper, costlier, more irreversible, or force the next conflict."
  }
  if (intent === "make_required_character_material_or_remove_requirement") {
    return "Revise the scene contract so required non-POV characters materially change choice, conflict, tactic, outcome, consequence, or future pressure; otherwise remove them from required character IDs."
  }
  if (intent === "make_world_fact_operational_or_remove_requirement") {
    return "Revise the scene contract so required world facts constrain action, create cost, reveal information, alter outcome, or force next conflict; otherwise remove them from required world fact IDs."
  }
  return "Operator review required before planner rewrite."
}

function rationaleFor(dimension: string, label: string): string {
  if (dimension === "relationshipDelta" && label === "REL-1") return "relationship-applicable scene appears static"
  if (dimension === "motivationSpecificity" && label === "MOTIVE-1") return "motivation appears generic or weakly tied to character"
  if (dimension === "motivationSpecificity" && label === "MOTIVE-2") return "motivation is specific, but may lack internal tradeoff"
  if (dimension === "stakesValueShift" && label === "STAKES-2") return "value shift exists, but may lack sharp cost, irreversibility, or next-conflict pressure"
  if (dimension === "characterMateriality") return "required character may not be doing enough material scene work"
  if (dimension === "worldFactPressure") return "required world fact may not be operational in the scene"
  return "selected diagnostic label requires operator review"
}

function severityFor(label: string): AggregatedFinding["severity"] {
  const ordinal = labelOrdinal(label)
  if (ordinal === 0) return "high"
  if (ordinal === 1) return "medium"
  if (ordinal === 2) return "low"
  return "info"
}

function highestSeverityOf(findings: AggregatedFinding[]): AggregatedFinding["severity"] {
  return findings.reduce<AggregatedFinding["severity"]>((highest, finding) => (
    severityRank(finding.severity) > severityRank(highest) ? finding.severity : highest
  ), "info")
}

function severityRank(severity: AggregatedFinding["severity"]): number {
  if (severity === "high") return 3
  if (severity === "medium") return 2
  if (severity === "low") return 1
  return 0
}

function labelOrdinal(label: string): number {
  const match = label.match(/-(\d)$/)
  return match ? Number.parseInt(match[1]!, 10) : 0
}

function normalizeEvidence(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) out[key] = String(value ?? "")
  return out
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function resolveReportPath(path: string): string {
  const abs = resolve(process.cwd(), path)
  if (!existsSync(abs)) throw new Error(`report not found: ${abs}`)
  if (abs.endsWith(".json")) return abs
  const reportPath = join(abs, "planner-discernment-real-data-report.json")
  if (!existsSync(reportPath)) throw new Error(`report directory missing planner-discernment-real-data-report.json: ${abs}`)
  return reportPath
}

function parseArgs(argv: string[]): Args {
  const reports: string[] = []
  const labels: string[] = []
  let outputDir: string | null = null
  let limit: number | null = null
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--report") reports.push(requireValue(argv, ++i, "--report"))
    else if (arg.startsWith("--report=")) reports.push(arg.slice("--report=".length))
    else if (arg === "--label") labels.push(requireValue(argv, ++i, "--label"))
    else if (arg.startsWith("--label=")) labels.push(arg.slice("--label=".length))
    else if (arg === "--output-dir") outputDir = requireValue(argv, ++i, "--output-dir")
    else if (arg.startsWith("--output-dir=")) outputDir = arg.slice("--output-dir=".length)
    else if (arg === "--limit") limit = parsePositiveInt(requireValue(argv, ++i, "--limit"), "--limit")
    else if (arg.startsWith("--limit=")) limit = parsePositiveInt(arg.slice("--limit=".length), "--limit")
    else if (arg === "--json") json = true
    else throw new Error(`unknown arg: ${arg}`)
  }
  if (reports.length === 0) throw new Error("--report is required")
  return {
    reports,
    labels: labels.length > 0 ? labels : DEFAULT_LABELS,
    outputDir,
    limit,
    json,
  }
}

function defaultOutputDir(reports: string[]): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const source = reports.length === 1 ? basename(reports[0]!).replace(/\.json$/, "") : "multi-report"
  return `output/method-pack-diagnostics/${stamp}/planner-discernment-finding-aggregate-${source}`
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index]
  if (!value) throw new Error(`${flag} requires a value`)
  return value
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/evals/planner-discernment-finding-aggregate.ts --report <report-json-or-dir> [--label <LABEL> ...] [--limit <n>] [--output-dir <dir>] [--json]")
    return 2
  }
  if (!args.outputDir) args.outputDir = defaultOutputDir(args.reports)
  const report = buildFindingAggregate(args)
  const abs = resolve(process.cwd(), args.outputDir)
  mkdirSync(abs, { recursive: true })
  writeFileSync(join(abs, "planner-discernment-finding-aggregate.json"), JSON.stringify(report, null, 2))
  writeFileSync(join(abs, "planner-discernment-finding-aggregate.md"), renderFindingAggregate(report))
  console.log(args.json ? JSON.stringify(report, null, 2) : renderFindingAggregate(report))
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}

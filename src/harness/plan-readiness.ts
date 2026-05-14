import { stableHash } from "../canon/proposal-envelope"

export const PLAN_READINESS_STATUSES = [
  "open",
  "accepted_as_is",
  "not_applicable",
  "deferred",
  "proposal_created",
  "fixed",
  "stale",
] as const

export const PLAN_READINESS_OPERATOR_DISPOSITIONS = [
  "real_issue",
  "false_positive",
  "not_applicable",
  "acceptable_choice",
  "defer_to_drafting",
  "fixed",
] as const

export const PLAN_READINESS_IMPORTER_KINDS = ["human", "agent", "script", "test"] as const

export type PlanReadinessStatus = (typeof PLAN_READINESS_STATUSES)[number]
export type PlanReadinessOperatorDisposition = (typeof PLAN_READINESS_OPERATOR_DISPOSITIONS)[number]
export type PlanReadinessImporterKind = (typeof PLAN_READINESS_IMPORTER_KINDS)[number]
export type PlanReadinessTargetKind = "chapter_outline" | "scene_plan" | "beat_plan" | "beat_obligation"
export type PlanReadinessSourceHashKind = "target_current_version" | "diagnostic_excerpt"
export type PlanReadinessSeverity = "high" | "medium" | "low" | "info"

export interface PlanReadinessPreserveIds {
  obligationIds: string[]
  characterIds: string[]
  worldFactIds: string[]
  sceneTurnIds: string[]
  threadIds: string[]
  promiseIds: string[]
  payoffIds: string[]
  sourceIds: string[]
}

export interface PlanReadinessTarget {
  kind: PlanReadinessTargetKind
  ref: string
  fieldPath?: string
}

export interface PlanReadinessItemDraft {
  id: string
  novelId: string
  target: PlanReadinessTarget
  sourceHash: string
  sourceHashKind: PlanReadinessSourceHashKind
  diagnosticLabel: string
  dimension: string
  fixIntent: string
  severity: PlanReadinessSeverity
  explanation: string
  missingForNextLevel: string | null
  preserveIds: PlanReadinessPreserveIds
  evidence: Record<string, string>
  sourceReportPaths: string[]
  importedByKind: PlanReadinessImporterKind
  importedByRef: string | null
  metadata: Record<string, unknown>
}

export interface BuildReadinessDraftsArgs {
  novelId: string
  aggregate: unknown
  targetVersions?: Record<string, string> | Map<string, string>
  importedByKind?: PlanReadinessImporterKind
  importedByRef?: string | null
}

export interface BuildReadinessDraftsResult {
  drafts: PlanReadinessItemDraft[]
  skipped: Array<{ reason: string; target?: unknown }>
}

interface AggregateReportLike {
  sourceReports?: unknown
  labels?: unknown
  groups?: unknown
}

interface AggregateGroupLike {
  groupId?: unknown
  fixtureId?: unknown
  armId?: unknown
  methodPackEnabled?: unknown
  unitType?: unknown
  chapterId?: unknown
  sceneId?: unknown
  sourceIds?: unknown
  rewritePacket?: unknown
  findings?: unknown
  excerpt?: unknown
}

interface AggregateFindingLike {
  findingId?: unknown
  sourceReport?: unknown
  promptMode?: unknown
  dimension?: unknown
  label?: unknown
  severity?: unknown
  fixIntent?: unknown
  rationale?: unknown
  missingForNextLevel?: unknown
  evidence?: unknown
}

type CandidateAction = "field_replace" | "beat_replace" | "beat_reorder" | "scene_select" | "beat_requirement_remove"
const PLAN_READINESS_TARGET_KINDS = new Set<PlanReadinessTargetKind>([
  "chapter_outline",
  "scene_plan",
  "beat_plan",
  "beat_obligation",
])

export function buildPlanReadinessDraftsFromAggregate(
  args: BuildReadinessDraftsArgs,
): BuildReadinessDraftsResult {
  const report = asRecord(args.aggregate) as AggregateReportLike
  const groups = Array.isArray(report.groups) ? report.groups as AggregateGroupLike[] : []
  const sourceReports = stringArray(report.sourceReports)
  const targetVersions = normalizeTargetVersions(args.targetVersions)
  const importedByKind = args.importedByKind ?? "script"
  const importedByRef = args.importedByRef ?? null
  const drafts: PlanReadinessItemDraft[] = []
  const skipped: Array<{ reason: string; target?: unknown }> = []

  for (const group of groups) {
    const target = extractTarget(group)
    if (!target) {
      skipped.push({ reason: "unsupported or missing proposal candidate target", target: group })
      continue
    }
    const targetKey = readinessTargetKey(target)
    const currentVersion = targetVersions.get(targetKey)
    const excerpt = stringValue(group.excerpt)
    const sourceHash = currentVersion ?? stableHash({ target, excerpt })
    const sourceHashKind: PlanReadinessSourceHashKind = currentVersion
      ? "target_current_version"
      : "diagnostic_excerpt"
    const preserveIds = normalizePreserveIds(
      (asRecord(group.rewritePacket)?.preserveIds ?? group.sourceIds),
    )
    const proposalCandidate = normalizeProposalCandidate(
      asRecord(asRecord(group.rewritePacket)?.proposalCandidate),
    )
    const findings = Array.isArray(group.findings) ? group.findings as AggregateFindingLike[] : []
    if (findings.length === 0) {
      skipped.push({ reason: "group contained no findings", target })
      continue
    }

    if (!shouldImportFindingsAsGroup(proposalCandidate)) {
      for (const finding of findings) {
        const dimension = stringValue(finding.dimension)
        const diagnosticLabel = stringValue(finding.label)
        const fixIntent = stringValue(finding.fixIntent) || "review_only"
        if (!dimension || !diagnosticLabel) {
          skipped.push({ reason: "finding missing dimension or label", target })
          continue
        }
        const severity = normalizeSeverity(finding.severity)
        const explanation = stringValue(finding.rationale) || "planner readiness diagnostic"
        const missingForNextLevel = stringValue(finding.missingForNextLevel) || null
        const sourceReportPaths = unique([
          ...sourceReports,
          ...[stringValue(finding.sourceReport)].filter(Boolean),
        ])
        const id = planReadinessItemId({
          novelId: args.novelId,
          target,
          sourceHash,
          dimension,
          diagnosticLabel,
          fixIntent,
        })
        drafts.push({
          id,
          novelId: args.novelId,
          target,
          sourceHash,
          sourceHashKind,
          diagnosticLabel,
          dimension,
          fixIntent,
          severity,
          explanation,
          missingForNextLevel,
          preserveIds,
          evidence: normalizeStringRecord(finding.evidence),
          sourceReportPaths,
          importedByKind,
          importedByRef,
          metadata: {
            aggregateGroupId: stringValue(group.groupId),
            aggregateFindingId: stringValue(finding.findingId),
            fixtureId: stringValue(group.fixtureId),
            armId: stringValue(group.armId),
            methodPackEnabled: Boolean(group.methodPackEnabled),
            unitType: stringValue(group.unitType),
            chapterId: stringValue(group.chapterId),
            sceneId: stringValue(group.sceneId),
            promptMode: stringValue(finding.promptMode),
            sourceHashKind,
            ...(proposalCandidate ? { proposalCandidate } : {}),
          },
        })
      }
      continue
    }

    const usableFindings = findings.filter(finding =>
      Boolean(stringValue(finding.dimension)) && Boolean(stringValue(finding.label))
    )
    if (usableFindings.length === 0) {
      skipped.push({ reason: "finding missing dimension or label", target })
      continue
    }
    if (usableFindings.length !== findings.length) {
      skipped.push({ reason: "some grouped findings missing dimension or label", target })
    }

    const dimension = groupedString(usableFindings.map(finding => stringValue(finding.dimension)), "grouped")
    const diagnosticLabel = groupedString(usableFindings.map(finding => stringValue(finding.label)), "GROUPED-DIAGNOSTIC")
    const fixIntent = groupedString(usableFindings.map(finding => stringValue(finding.fixIntent) || "review_only"), "grouped_review")
    const severity = highestSeverity(usableFindings.map(finding => normalizeSeverity(finding.severity)))
    const explanation = groupedExplanation(usableFindings)
    const missingForNextLevel = groupedMissingForNextLevel(usableFindings)
    const sourceReportPaths = unique([
      ...sourceReports,
      ...usableFindings.map(finding => stringValue(finding.sourceReport)).filter(Boolean),
    ])
    const evidence = groupedEvidence(usableFindings)
    const id = planReadinessItemId({
      novelId: args.novelId,
      target,
      sourceHash,
      dimension,
      diagnosticLabel,
      fixIntent,
    })
    drafts.push({
      id,
      novelId: args.novelId,
      target,
      sourceHash,
      sourceHashKind,
      diagnosticLabel,
      dimension,
      fixIntent,
      severity,
      explanation,
      missingForNextLevel,
      preserveIds,
      evidence,
      sourceReportPaths,
      importedByKind,
      importedByRef,
      metadata: {
        aggregateGroupId: stringValue(group.groupId),
        aggregateFindingId: stringValue(usableFindings[0]?.findingId),
        aggregateFindingIds: usableFindings.map(finding => stringValue(finding.findingId)).filter(Boolean),
        fixtureId: stringValue(group.fixtureId),
        armId: stringValue(group.armId),
        methodPackEnabled: Boolean(group.methodPackEnabled),
        unitType: stringValue(group.unitType),
        chapterId: stringValue(group.chapterId),
        sceneId: stringValue(group.sceneId),
        promptMode: groupedString(usableFindings.map(finding => stringValue(finding.promptMode)), "unknown"),
        sourceHashKind,
        ...(usableFindings.length > 1 ? { groupedFindingCount: usableFindings.length } : {}),
        ...(proposalCandidate ? { proposalCandidate } : {}),
      },
    })
  }

  return { drafts, skipped }
}

export function planReadinessItemId(args: {
  novelId: string
  target: PlanReadinessTarget
  sourceHash: string
  dimension: string
  diagnosticLabel: string
  fixIntent: string
}): string {
  const hash = stableHash({
    v: "plan-readiness-item-v1",
    novelId: args.novelId,
    target: args.target,
    sourceHash: args.sourceHash,
    dimension: args.dimension,
    diagnosticLabel: args.diagnosticLabel,
    fixIntent: args.fixIntent,
  })
  return `readiness-${hash.slice(0, 32)}`
}

export function readinessTargetKey(target: PlanReadinessTarget): string {
  return `${target.kind}:${target.ref}`
}

function extractTarget(group: AggregateGroupLike): PlanReadinessTarget | null {
  const packet = asRecord(group.rewritePacket)
  const candidate = asRecord(packet?.proposalCandidate)
  const rawTarget = asRecord(candidate?.target)
  const kind = stringValue(rawTarget?.kind)
  const ref = stringValue(rawTarget?.ref)
  if (!PLAN_READINESS_TARGET_KINDS.has(kind as PlanReadinessTargetKind) || !ref) return null
  const fieldPath = stringValue(rawTarget?.fieldPath)
  return {
    kind: kind as PlanReadinessTargetKind,
    ref,
    ...(fieldPath ? { fieldPath } : {}),
  }
}

function normalizeProposalCandidate(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!raw) return null
  const action = normalizeCandidateAction(raw.action)
  const target = normalizeCandidateTarget(asRecord(raw.target))
  const out: Record<string, unknown> = {
    ...(action ? { action } : {}),
    ...(target ? { target } : {}),
  }
  if (hasOwn(raw, "proposedValue")) out.proposedValue = raw.proposedValue
  if (hasOwn(raw, "requiresProposedValue")) out.requiresProposedValue = Boolean(raw.requiresProposedValue)
  if (hasOwn(raw, "safeToAutoApply")) out.safeToAutoApply = Boolean(raw.safeToAutoApply)
  const proposedValueStatus = stringValue(raw.proposedValueStatus)
  if (proposedValueStatus) out.proposedValueStatus = proposedValueStatus
  const sourceAgent = stringValue(raw.sourceAgent)
  if (sourceAgent) out.sourceAgent = sourceAgent
  return Object.keys(out).length > 0 ? out : null
}

function normalizeCandidateAction(value: unknown): CandidateAction | null {
  return value === "field_replace" ||
    value === "beat_replace" ||
    value === "beat_reorder" ||
    value === "scene_select" ||
    value === "beat_requirement_remove"
    ? value
    : null
}

function normalizeCandidateTarget(raw: Record<string, unknown> | null): PlanReadinessTarget | null {
  if (!raw) return null
  const kind = stringValue(raw.kind)
  const ref = stringValue(raw.ref)
  if (!PLAN_READINESS_TARGET_KINDS.has(kind as PlanReadinessTargetKind) || !ref) return null
  const fieldPath = stringValue(raw.fieldPath)
  return {
    kind: kind as PlanReadinessTargetKind,
    ref,
    ...(fieldPath ? { fieldPath } : {}),
  }
}

function normalizePreserveIds(raw: unknown): PlanReadinessPreserveIds {
  const record = asRecord(raw)
  return {
    obligationIds: stringArray(record?.obligationIds),
    characterIds: stringArray(record?.characterIds),
    worldFactIds: stringArray(record?.worldFactIds),
    sceneTurnIds: stringArray(record?.sceneTurnIds),
    threadIds: stringArray(record?.threadIds),
    promiseIds: stringArray(record?.promiseIds),
    payoffIds: stringArray(record?.payoffIds),
    sourceIds: stringArray(record?.sourceIds),
  }
}

function normalizeTargetVersions(
  versions: Record<string, string> | Map<string, string> | undefined,
): Map<string, string> {
  if (!versions) return new Map()
  if (versions instanceof Map) return new Map(versions)
  return new Map(Object.entries(versions))
}

function normalizeSeverity(value: unknown): PlanReadinessSeverity {
  if (value === "high" || value === "medium" || value === "low" || value === "info") {
    return value
  }
  return "info"
}

function normalizeStringRecord(raw: unknown): Record<string, string> {
  const record = asRecord(raw)
  if (!record) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) out[key] = stringValue(value)
  return out
}

function shouldImportFindingsAsGroup(proposalCandidate: Record<string, unknown> | null): boolean {
  const sourceAgent = stringValue(proposalCandidate?.sourceAgent)
  return sourceAgent === "production-checker-warning-report" ||
    sourceAgent === "plan-state-consistency"
}

function groupedString(values: string[], fallback: string): string {
  const uniqueValues = unique(values.filter(Boolean))
  if (uniqueValues.length === 0) return fallback
  if (uniqueValues.length === 1) return uniqueValues[0]!
  return uniqueValues.join("+")
}

function highestSeverity(values: PlanReadinessSeverity[]): PlanReadinessSeverity {
  return values.sort((a, b) => severityRank(b) - severityRank(a))[0] ?? "info"
}

function severityRank(value: PlanReadinessSeverity): number {
  return value === "high" ? 4 : value === "medium" ? 3 : value === "low" ? 2 : 1
}

function groupedExplanation(findings: AggregateFindingLike[]): string {
  if (findings.length === 1) {
    return stringValue(findings[0]?.rationale) || "planner readiness diagnostic"
  }
  const rationales = unique(findings.map(finding => stringValue(finding.rationale)).filter(Boolean))
  return `${findings.length} grouped readiness findings target the same upstream plan field.${rationales.length > 0 ? ` ${rationales.join(" ")}` : ""}`
}

function groupedMissingForNextLevel(findings: AggregateFindingLike[]): string | null {
  const values = unique(findings.map(finding => stringValue(finding.missingForNextLevel)).filter(Boolean))
  if (values.length === 0) return null
  return values.join("\n")
}

function groupedEvidence(findings: AggregateFindingLike[]): Record<string, string> {
  if (findings.length === 1) return normalizeStringRecord(findings[0]?.evidence)
  const rows = findings.map(finding => ({
    findingId: stringValue(finding.findingId),
    label: stringValue(finding.label),
    severity: stringValue(finding.severity),
    dimension: stringValue(finding.dimension),
    fixIntent: stringValue(finding.fixIntent),
    evidence: normalizeStringRecord(finding.evidence),
  }))
  return {
    findingCount: String(findings.length),
    findingIds: rows.map(row => row.findingId).filter(Boolean).join(","),
    findingLabels: unique(rows.map(row => row.label).filter(Boolean)).join(","),
    findingsJson: JSON.stringify(rows),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return unique(value.map(item => stringValue(item)).filter(Boolean))
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

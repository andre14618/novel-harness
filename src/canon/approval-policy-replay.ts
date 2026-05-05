/**
 * Phase 7 tracer bullet — ApprovalPolicy replay metrics.
 *
 * The replay layer is intentionally pure: it consumes historical resolution
 * audit rows and computes promotion-grade metrics without touching production
 * state. DB loaders and CLI wrappers live outside this module.
 */

import {
  evaluatePolicy,
  type ApprovalPolicy,
  type PolicyDecision,
} from "./approval-policy"
import type {
  ProposalEnvelopeKind,
  ProposalEnvelopeRisk,
  ProposalEnvelopeResolvedBy,
  ProposalEnvelopeStatus,
  ReviewProposalEnvelope,
} from "./proposal-envelope"

export type ReplayActualDecision = "approve" | "reject" | "other"

export interface PolicyReplayRow {
  id: string
  novelId: string
  kind: ProposalEnvelopeKind
  risk: ProposalEnvelopeRisk
  status: ProposalEnvelopeStatus
  resolvedByKind: ProposalEnvelopeResolvedBy | null
  policyDecision: PolicyDecision
  policyVersion: string
  resolvedAt: string
  sourceTable: "proposal_envelopes" | "canon_proposals"
  /**
   * Optional downstream-impact observations captured after the proposal was
   * resolved. Historical audit rows may not have these yet; replay reports
   * surface null metrics until a loader or fixture supplies the signal.
   */
  downstreamCheckerFired?: boolean | null
  downstreamEditChurn?: number | null
  downstreamCanonConflict?: boolean | null
}

export interface PolicyReplayBucket {
  key: string
  kind?: ProposalEnvelopeKind
  risk?: ProposalEnvelopeRisk
  total: number
  statusCounts: Record<string, number>
  policyCounts: Record<PolicyDecision, number>
  humanApprove: number
  humanReject: number
  approvalRate: number
  policyApprovePrecision: number | null
  policyRejectPrecision: number | null
  autoPrecision: number | null
  agreementRate: number | null
  interventionRate: number
  autonomousResolutionRate: number
  canonAutoApproveRate: number
  downstreamCheckerFireRate: number | null
  averageEditChurn: number | null
  canonConflictRate: number | null
}

export interface PolicyReplayReport {
  generatedAt: string
  totalRows: number
  byKind: PolicyReplayBucket[]
  byKindRisk: PolicyReplayBucket[]
  overall: PolicyReplayBucket
  promotion: PolicyPromotionResult
}

export interface FrozenPolicyReplayCase {
  id: string
  status: ProposalEnvelopeStatus
  resolvedByKind?: ProposalEnvelopeResolvedBy | null
  resolvedAt: string
  sourceTable: "proposal_envelopes" | "canon_proposals"
  downstreamCheckerFired?: boolean | null
  downstreamEditChurn?: number | null
  downstreamCanonConflict?: boolean | null
  /**
   * Frozen proposal state observed at proposal-generation time. The replay
   * runner evaluates this envelope against a candidate policy; it never
   * applies the proposal or reloads mutable artifacts.
   */
  envelope: ReviewProposalEnvelope
}

export interface CandidatePolicyReplayResult {
  policyVersion: string
  rows: PolicyReplayRow[]
  report: PolicyReplayReport
}

export interface FrozenGeneratorExpectedEnvelope {
  envelopeId: string
  status: ProposalEnvelopeStatus
  resolvedByKind?: ProposalEnvelopeResolvedBy | null
  resolvedAt: string
  sourceTable: "proposal_envelopes" | "canon_proposals"
  downstreamCheckerFired?: boolean | null
  downstreamEditChurn?: number | null
  downstreamCanonConflict?: boolean | null
}

export interface FrozenProposalGeneratorReplayCase<TInput = unknown> {
  id: string
  input: TInput
  expected: readonly FrozenGeneratorExpectedEnvelope[]
}

export interface ProposalGeneratorReplayResult {
  policyVersion: string
  caseCount: number
  generatedEnvelopeCount: number
  matchedEnvelopeCount: number
  missingExpected: Array<{ caseId: string; envelopeId: string }>
  unexpectedGenerated: Array<{ caseId: string; envelopeId: string }>
  rows: PolicyReplayRow[]
  report: PolicyReplayReport
}

export type ProposalGenerator<TInput> = (
  input: TInput,
) => ReviewProposalEnvelope[] | Promise<ReviewProposalEnvelope[]>

export interface PolicyPromotionThresholds {
  minRows?: number
  minAutoPrecision?: number
  maxCanonAutoApproveRate?: number
}

export type PolicyPromotionTier = "dev" | "assisted" | "autonomous"

export interface PolicyPromotionResult {
  pass: boolean
  reasons: string[]
  thresholds: Required<PolicyPromotionThresholds>
}

const DEFAULT_THRESHOLDS: Required<PolicyPromotionThresholds> = {
  minRows: 1,
  minAutoPrecision: 0.95,
  maxCanonAutoApproveRate: 0,
}

const TIER_THRESHOLDS: Record<PolicyPromotionTier, Required<PolicyPromotionThresholds>> = {
  dev: DEFAULT_THRESHOLDS,
  assisted: {
    minRows: 25,
    minAutoPrecision: 0.95,
    maxCanonAutoApproveRate: 0,
  },
  autonomous: {
    minRows: 100,
    minAutoPrecision: 0.98,
    maxCanonAutoApproveRate: 0,
  },
}

const ZERO_POLICY_COUNTS: Record<PolicyDecision, number> = {
  approve: 0,
  queue: 0,
  reject: 0,
  shadow: 0,
}

export function actualDecisionForStatus(status: ProposalEnvelopeStatus): ReplayActualDecision {
  if (status === "approved" || status === "modified") return "approve"
  if (status === "rejected") return "reject"
  return "other"
}

export function buildPolicyReplayReport(
  rows: readonly PolicyReplayRow[],
  opts: {
    generatedAt?: string
    thresholds?: PolicyPromotionThresholds
  } = {},
): PolicyReplayReport {
  const generatedAt = opts.generatedAt ?? new Date().toISOString()
  const byKind = groupRows(rows, (row) => row.kind).map(([kind, group]) =>
    bucketFromRows(`kind=${kind}`, group, { kind: kind as ProposalEnvelopeKind }),
  )
  const byKindRisk = groupRows(rows, (row) => `${row.kind}|${row.risk}`).map(([key, group]) => {
    const [kind, risk] = key.split("|") as [ProposalEnvelopeKind, ProposalEnvelopeRisk]
    return bucketFromRows(`kind=${kind} risk=${risk}`, group, { kind, risk })
  })
  const overall = bucketFromRows("overall", rows)
  const promotion = evaluatePolicyPromotion(overall, byKind, opts.thresholds)

  return {
    generatedAt,
    totalRows: rows.length,
    byKind,
    byKindRisk,
    overall,
    promotion,
  }
}

export function replayCandidatePolicy(
  cases: readonly FrozenPolicyReplayCase[],
  policy: ApprovalPolicy,
  opts: {
    generatedAt?: string
    thresholds?: PolicyPromotionThresholds
  } = {},
): CandidatePolicyReplayResult {
  const rows = cases.map((replayCase) => {
    const evaluation = evaluatePolicy(replayCase.envelope, policy)
    return {
      id: replayCase.id,
      novelId: replayCase.envelope.novelId,
      kind: replayCase.envelope.kind,
      risk: replayCase.envelope.risk,
      status: replayCase.status,
      resolvedByKind: replayCase.resolvedByKind ?? null,
      policyDecision: evaluation.decision,
      policyVersion: evaluation.policyVersion,
      resolvedAt: replayCase.resolvedAt,
      sourceTable: replayCase.sourceTable,
      downstreamCheckerFired: replayCase.downstreamCheckerFired ?? null,
      downstreamEditChurn: replayCase.downstreamEditChurn ?? null,
      downstreamCanonConflict: replayCase.downstreamCanonConflict ?? null,
    } satisfies PolicyReplayRow
  })

  return {
    policyVersion: policy.version,
    rows,
    report: buildPolicyReplayReport(rows, opts),
  }
}

export async function replayProposalGenerator<TInput>(
  cases: readonly FrozenProposalGeneratorReplayCase<TInput>[],
  policy: ApprovalPolicy,
  generate: ProposalGenerator<TInput>,
  opts: {
    generatedAt?: string
    thresholds?: PolicyPromotionThresholds
  } = {},
): Promise<ProposalGeneratorReplayResult> {
  const rows: PolicyReplayRow[] = []
  const missingExpected: Array<{ caseId: string; envelopeId: string }> = []
  const unexpectedGenerated: Array<{ caseId: string; envelopeId: string }> = []
  let generatedEnvelopeCount = 0
  let matchedEnvelopeCount = 0

  for (const replayCase of cases) {
    const generated = await generate(replayCase.input)
    generatedEnvelopeCount += generated.length
    const generatedById = new Map(generated.map((envelope) => [envelope.id, envelope]))
    const expectedIds = new Set(replayCase.expected.map((expected) => expected.envelopeId))

    for (const expected of replayCase.expected) {
      const envelope = generatedById.get(expected.envelopeId)
      if (!envelope) {
        missingExpected.push({ caseId: replayCase.id, envelopeId: expected.envelopeId })
        continue
      }

      matchedEnvelopeCount++
      const evaluation = evaluatePolicy(envelope, policy)
      rows.push({
        id: `${replayCase.id}:${envelope.id}`,
        novelId: envelope.novelId,
        kind: envelope.kind,
        risk: envelope.risk,
        status: expected.status,
        resolvedByKind: expected.resolvedByKind ?? null,
        policyDecision: evaluation.decision,
        policyVersion: evaluation.policyVersion,
        resolvedAt: expected.resolvedAt,
        sourceTable: expected.sourceTable,
        downstreamCheckerFired: expected.downstreamCheckerFired ?? null,
        downstreamEditChurn: expected.downstreamEditChurn ?? null,
        downstreamCanonConflict: expected.downstreamCanonConflict ?? null,
      })
    }

    for (const envelope of generated) {
      if (!expectedIds.has(envelope.id)) {
        unexpectedGenerated.push({ caseId: replayCase.id, envelopeId: envelope.id })
      }
    }
  }

  return {
    policyVersion: policy.version,
    caseCount: cases.length,
    generatedEnvelopeCount,
    matchedEnvelopeCount,
    missingExpected,
    unexpectedGenerated,
    rows,
    report: buildPolicyReplayReport(rows, opts),
  }
}

export function evaluatePolicyPromotion(
  overall: PolicyReplayBucket,
  byKind: readonly PolicyReplayBucket[],
  thresholds: PolicyPromotionThresholds = {},
): PolicyPromotionResult {
  const resolved: Required<PolicyPromotionThresholds> = {
    minRows: thresholds.minRows ?? DEFAULT_THRESHOLDS.minRows,
    minAutoPrecision: thresholds.minAutoPrecision ?? DEFAULT_THRESHOLDS.minAutoPrecision,
    maxCanonAutoApproveRate: thresholds.maxCanonAutoApproveRate ?? DEFAULT_THRESHOLDS.maxCanonAutoApproveRate,
  }
  const reasons: string[] = []

  if (overall.total < resolved.minRows) {
    reasons.push(`insufficient replay rows: ${overall.total} < ${resolved.minRows}`)
  }
  if (overall.autoPrecision !== null && overall.autoPrecision < resolved.minAutoPrecision) {
    reasons.push(
      `auto precision below threshold: ${formatPct(overall.autoPrecision)} < ${formatPct(resolved.minAutoPrecision)}`,
    )
  }
  for (const bucket of byKind) {
    if (bucket.kind === "canon_update" && bucket.canonAutoApproveRate > resolved.maxCanonAutoApproveRate) {
      reasons.push(
        `canon auto-approve rate above threshold: ${formatPct(bucket.canonAutoApproveRate)} > ${formatPct(resolved.maxCanonAutoApproveRate)}`,
      )
    }
  }

  if (reasons.length === 0) {
    reasons.push("promotion thresholds passed")
  }

  return {
    pass: reasons.length === 1 && reasons[0] === "promotion thresholds passed",
    reasons,
    thresholds: resolved,
  }
}

export function policyPromotionThresholdsForTier(
  tier: PolicyPromotionTier,
  overrides: PolicyPromotionThresholds = {},
): Required<PolicyPromotionThresholds> {
  const base = TIER_THRESHOLDS[tier]
  return {
    minRows: overrides.minRows ?? base.minRows,
    minAutoPrecision: overrides.minAutoPrecision ?? base.minAutoPrecision,
    maxCanonAutoApproveRate: overrides.maxCanonAutoApproveRate ?? base.maxCanonAutoApproveRate,
  }
}

export function renderPolicyReplayMarkdown(report: PolicyReplayReport): string {
  const lines: string[] = []
  lines.push(`# ApprovalPolicy Replay Report`)
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Rows: ${report.totalRows}`)
  lines.push(`Promotion: ${report.promotion.pass ? "PASS" : "FAIL"}`)
  for (const reason of report.promotion.reasons) {
    lines.push(`- ${reason}`)
  }
  lines.push("")
  lines.push(`## Overall`)
  lines.push(renderBucketLine(report.overall))
  lines.push("")
  lines.push(`## By Kind`)
  for (const bucket of report.byKind) {
    lines.push(`- ${renderBucketLine(bucket)}`)
  }
  lines.push("")
  lines.push(`## By Kind And Risk`)
  for (const bucket of report.byKindRisk) {
    lines.push(`- ${renderBucketLine(bucket)}`)
  }
  return lines.join("\n")
}

function bucketFromRows(
  key: string,
  rows: readonly PolicyReplayRow[],
  labels: { kind?: ProposalEnvelopeKind; risk?: ProposalEnvelopeRisk } = {},
): PolicyReplayBucket {
  const policyCounts = { ...ZERO_POLICY_COUNTS }
  const statusCounts: Record<string, number> = {}
  let humanApprove = 0
  let humanReject = 0
  let policyApproveMatch = 0
  let policyRejectMatch = 0
  let agreementNumerator = 0
  let agreementDenominator = 0
  let autonomousResolutions = 0
  let downstreamCheckerObserved = 0
  let downstreamCheckerFires = 0
  let editChurnObserved = 0
  let editChurnTotal = 0
  let canonConflictObserved = 0
  let canonConflicts = 0

  for (const row of rows) {
    policyCounts[row.policyDecision]++
    statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1
    if (row.resolvedByKind === "policy") autonomousResolutions++

    const actual = actualDecisionForStatus(row.status)
    if (actual === "approve") humanApprove++
    if (actual === "reject") humanReject++
    if (row.policyDecision === "approve" && actual === "approve") policyApproveMatch++
    if (row.policyDecision === "reject" && actual === "reject") policyRejectMatch++
    if (actual !== "other") {
      agreementDenominator++
      if (row.policyDecision === actual) agreementNumerator++
    }
    if (row.downstreamCheckerFired !== undefined && row.downstreamCheckerFired !== null) {
      downstreamCheckerObserved++
      if (row.downstreamCheckerFired) downstreamCheckerFires++
    }
    if (row.downstreamEditChurn !== undefined && row.downstreamEditChurn !== null) {
      editChurnObserved++
      editChurnTotal += row.downstreamEditChurn
    }
    if (row.downstreamCanonConflict !== undefined && row.downstreamCanonConflict !== null) {
      canonConflictObserved++
      if (row.downstreamCanonConflict) canonConflicts++
    }
  }

  const autoDecisions = policyCounts.approve + policyCounts.reject
  const autoMatches = policyApproveMatch + policyRejectMatch
  const canonAutoApproves = labels.kind === "canon_update" ? policyCounts.approve : 0

  return {
    key,
    ...labels,
    total: rows.length,
    statusCounts,
    policyCounts,
    humanApprove,
    humanReject,
    approvalRate: safeRatio(humanApprove, rows.length) ?? 0,
    policyApprovePrecision: safeRatio(policyApproveMatch, policyCounts.approve),
    policyRejectPrecision: safeRatio(policyRejectMatch, policyCounts.reject),
    autoPrecision: safeRatio(autoMatches, autoDecisions),
    agreementRate: safeRatio(agreementNumerator, agreementDenominator),
    interventionRate: safeRatio(policyCounts.queue, rows.length) ?? 0,
    autonomousResolutionRate: safeRatio(autonomousResolutions, rows.length) ?? 0,
    canonAutoApproveRate: safeRatio(canonAutoApproves, rows.length) ?? 0,
    downstreamCheckerFireRate: safeRatio(downstreamCheckerFires, downstreamCheckerObserved),
    averageEditChurn: safeRatio(editChurnTotal, editChurnObserved),
    canonConflictRate: safeRatio(canonConflicts, canonConflictObserved),
  }
}

function groupRows<T extends string>(
  rows: readonly PolicyReplayRow[],
  keyFor: (row: PolicyReplayRow) => T,
): Array<[T, PolicyReplayRow[]]> {
  const grouped = new Map<T, PolicyReplayRow[]>()
  for (const row of rows) {
    const key = keyFor(row)
    const group = grouped.get(key)
    if (group) group.push(row)
    else grouped.set(key, [row])
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function safeRatio(n: number, d: number): number | null {
  return d === 0 ? null : n / d
}

function renderBucketLine(bucket: PolicyReplayBucket): string {
  return [
    bucket.key,
    `n=${bucket.total}`,
    `autoPrecision=${formatMaybePct(bucket.autoPrecision)}`,
    `agreement=${formatMaybePct(bucket.agreementRate)}`,
    `intervention=${formatPct(bucket.interventionRate)}`,
    `approval=${formatPct(bucket.approvalRate)}`,
    `checkerFire=${formatMaybePct(bucket.downstreamCheckerFireRate)}`,
    `avgEditChurn=${formatMaybeNumber(bucket.averageEditChurn)}`,
    `canonConflict=${formatMaybePct(bucket.canonConflictRate)}`,
    `policy={approve:${bucket.policyCounts.approve}, queue:${bucket.policyCounts.queue}, reject:${bucket.policyCounts.reject}, shadow:${bucket.policyCounts.shadow}}`,
  ].join(" | ")
}

function formatMaybeNumber(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2)
}

function formatMaybePct(value: number | null): string {
  return value === null ? "n/a" : formatPct(value)
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

import type { ProposalEnvelopeStatus } from "../canon/proposal-envelope"
import {
  listPlanReadinessItems,
  type PlanReadinessItem,
} from "../db/plan-readiness"
import { findEnvelopeById } from "../db/proposal-envelopes"
import {
  findProposalResolutionImpact,
  findProposalResolutionOutcome,
  listProposalCheckerObservationsByProposal,
  type ProposalCheckerObservation,
  type ProposalResolutionImpact,
  type ProposalResolutionOutcome,
} from "../db/proposal-resolution-outcomes"
import {
  listPlanningMutationLineageByProposal,
  type PlanningMutationAffectedRef,
  type PlanningMutationLineage,
} from "../db/planning-mutation-lineage"

export type PlanReadinessOutcomeObservationStatus =
  | "not_observed"
  | "lineage_only"
  | "observed_no_checker_signal"
  | "checker_clear"
  | "checker_fired"

export type PlanReadinessOutcomeInterpretation =
  | "open_without_proposal"
  | "manual_disposition_no_change"
  | "deferred_operator_review"
  | "stale_item"
  | "missing_linked_proposal"
  | "pending_operator_resolution"
  | "rejected_or_not_applied"
  | "applied_missing_lineage"
  | "applied_no_downstream_observation"
  | "applied_downstream_observed"
  | "applied_downstream_checker_fired"

export interface PlanReadinessProposalSummary {
  id: string
  kind: string
  status: ProposalEnvelopeStatus
  risk: string
  summary: string
  target: {
    kind: string
    ref: string
    fieldPath: string | null
    currentVersion: string
  }
  source: {
    agent: string
    userMessage: string | null
    parentEnvelopeId: string | null
  }
  createdAt: string
  resolvedAt: string | null
  resolvedByKind: string | null
  resolvedNote: string | null
  modified: boolean
  policyRecommendation: {
    decision: string
    reasons: string[]
  }
  resolutionPolicy: {
    decision: string | null
    version: string | null
    reasons: string[]
  }
}

export interface PlanReadinessOutcomeDownstream {
  observationStatus: PlanReadinessOutcomeObservationStatus
  interpretation: PlanReadinessOutcomeInterpretation
  planningLineage: PlanningMutationLineage[]
  projectedAffectedRefs: PlanningMutationAffectedRef[]
  proposalOutcome: ProposalResolutionOutcome | null
  resolutionImpact: ProposalResolutionImpact | null
  checkerObservations: ProposalCheckerObservation[]
  notes: string[]
}

export interface PlanReadinessOutcomeItem {
  readinessItem: PlanReadinessItem
  proposal: PlanReadinessProposalSummary | null
  downstream: PlanReadinessOutcomeDownstream
}

export interface PlanReadinessOutcomeReport {
  ok: true
  novelId: string
  summary: {
    totalItems: number
    byReadinessStatus: Record<string, number>
    byOperatorDisposition: Record<string, number>
    byProposalStatus: Record<string, number>
    linkedProposalCount: number
    resolvedProposalCount: number
    appliedProposalCount: number
    planningLineageRecordedCount: number
    downstreamObservedCount: number
    downstreamCheckerFiredCount: number
    needsDownstreamObservationCount: number
    missingLinkedProposalCount: number
  }
  items: PlanReadinessOutcomeItem[]
}

export async function loadPlanReadinessOutcomeReport(
  novelId: string,
  opts: { limit?: number } = {},
): Promise<PlanReadinessOutcomeReport> {
  const limit = opts.limit ?? 200
  const readinessItems = await listPlanReadinessItems(novelId, { status: "all", limit })
  const items: PlanReadinessOutcomeItem[] = []
  for (const item of readinessItems) {
    items.push(await loadPlanReadinessOutcomeItem(item))
  }
  return {
    ok: true,
    novelId,
    summary: summarizeOutcomeItems(items),
    items,
  }
}

async function loadPlanReadinessOutcomeItem(
  item: PlanReadinessItem,
): Promise<PlanReadinessOutcomeItem> {
  let proposal: PlanReadinessProposalSummary | null = null
  let proposalOutcome: ProposalResolutionOutcome | null = null
  let resolutionImpact: ProposalResolutionImpact | null = null
  let checkerObservations: ProposalCheckerObservation[] = []
  let planningLineage: PlanningMutationLineage[] = []

  if (item.proposalEnvelopeId) {
    const row = await findEnvelopeById(item.proposalEnvelopeId)
    if (row && row.novel_id === item.novelId) {
      proposal = proposalSummary(row)
      proposalOutcome = await findProposalResolutionOutcome("proposal_envelopes", row.id)
      resolutionImpact = await findProposalResolutionImpact("proposal_envelopes", row.id)
      checkerObservations = await listProposalCheckerObservationsByProposal("proposal_envelopes", row.id)
      planningLineage = await listPlanningMutationLineageByProposal(row.id, { sourceTable: "proposal_envelopes" })
    }
  }

  const observationStatus = deriveObservationStatus({
    proposalOutcome,
    resolutionImpact,
    checkerObservations,
    planningLineage,
  })
  const interpretation = deriveInterpretation({
    item,
    proposal,
    observationStatus,
    planningLineage,
  })
  return {
    readinessItem: item,
    proposal,
    downstream: {
      observationStatus,
      interpretation,
      planningLineage,
      projectedAffectedRefs: collectProjectedAffectedRefs(planningLineage),
      proposalOutcome,
      resolutionImpact,
      checkerObservations,
      notes: downstreamNotes({
        item,
        proposal,
        proposalOutcome,
        resolutionImpact,
        checkerObservations,
        planningLineage,
        observationStatus,
        interpretation,
      }),
    },
  }
}

function proposalSummary(row: PlanReadinessProposalEnvelopeRow): PlanReadinessProposalSummary {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status as ProposalEnvelopeStatus,
    risk: row.risk,
    summary: row.summary,
    target: {
      kind: row.target_kind,
      ref: row.target_ref,
      fieldPath: row.target_field_path,
      currentVersion: row.target_current_version,
    },
    source: {
      agent: row.source_agent,
      userMessage: row.source_user_message,
      parentEnvelopeId: row.parent_envelope_id,
    },
    createdAt: toIso(row.created_at),
    resolvedAt: row.resolved_at == null ? null : toIso(row.resolved_at),
    resolvedByKind: row.resolved_by_kind,
    resolvedNote: row.resolved_note,
    modified: row.modified_payload != null,
    policyRecommendation: {
      decision: row.policy_decision,
      reasons: normalizeStringArray(row.policy_reasons),
    },
    resolutionPolicy: {
      decision: row.resolution_policy_decision,
      version: row.resolution_policy_version,
      reasons: normalizeStringArray(row.resolution_policy_reasons),
    },
  }
}

function deriveObservationStatus(args: {
  proposalOutcome: ProposalResolutionOutcome | null
  resolutionImpact: ProposalResolutionImpact | null
  checkerObservations: ProposalCheckerObservation[]
  planningLineage: PlanningMutationLineage[]
}): PlanReadinessOutcomeObservationStatus {
  if (args.checkerObservations.some((obs) => obs.fired)) return "checker_fired"
  if (args.proposalOutcome?.downstreamCheckerFired === true) return "checker_fired"
  if (args.checkerObservations.length > 0) return "checker_clear"
  if (args.proposalOutcome?.downstreamCheckerFired === false) return "checker_clear"
  if (args.proposalOutcome || args.resolutionImpact) return "observed_no_checker_signal"
  if (args.planningLineage.length > 0) return "lineage_only"
  return "not_observed"
}

function deriveInterpretation(args: {
  item: PlanReadinessItem
  proposal: PlanReadinessProposalSummary | null
  observationStatus: PlanReadinessOutcomeObservationStatus
  planningLineage: PlanningMutationLineage[]
}): PlanReadinessOutcomeInterpretation {
  if (args.item.status === "stale") return "stale_item"
  if (!args.item.proposalEnvelopeId) {
    if (args.item.status === "deferred") return "deferred_operator_review"
    if (args.item.status === "open") return "open_without_proposal"
    return "manual_disposition_no_change"
  }
  if (!args.proposal) return "missing_linked_proposal"
  if (args.proposal.status === "pending") return "pending_operator_resolution"
  if (args.proposal.status === "rejected" || args.proposal.status === "shadowed" || args.proposal.status === "expired") {
    return "rejected_or_not_applied"
  }
  if (args.observationStatus === "checker_fired") return "applied_downstream_checker_fired"
  if (args.observationStatus === "checker_clear" || args.observationStatus === "observed_no_checker_signal") {
    return "applied_downstream_observed"
  }
  if (args.planningLineage.length === 0) return "applied_missing_lineage"
  return "applied_no_downstream_observation"
}

function downstreamNotes(args: {
  item: PlanReadinessItem
  proposal: PlanReadinessProposalSummary | null
  proposalOutcome: ProposalResolutionOutcome | null
  resolutionImpact: ProposalResolutionImpact | null
  checkerObservations: ProposalCheckerObservation[]
  planningLineage: PlanningMutationLineage[]
  observationStatus: PlanReadinessOutcomeObservationStatus
  interpretation: PlanReadinessOutcomeInterpretation
}): string[] {
  const notes: string[] = []
  if (args.item.proposalEnvelopeId && !args.proposal) {
    notes.push("Readiness item links to a proposal envelope that was not found for this novel.")
  }
  if (
    args.proposal &&
    (args.proposal.status === "approved" || args.proposal.status === "modified") &&
    args.planningLineage.length === 0
  ) {
    notes.push("Proposal resolved as applied, but no planning mutation lineage row was found.")
  }
  if (
    args.interpretation === "applied_no_downstream_observation" &&
    args.observationStatus === "lineage_only"
  ) {
    notes.push("Planning mutation lineage exists, but no exact downstream checker/outcome observation is attached yet.")
  }
  if (args.proposalOutcome) {
    notes.push("Exact proposal resolution outcome observation is attached.")
  }
  if (args.resolutionImpact) {
    notes.push("Exact proposal resolution impact context is attached.")
  }
  if (args.checkerObservations.length > 0) {
    notes.push(`${args.checkerObservations.length} exact checker observation(s) are attached.`)
  }
  return notes
}

function collectProjectedAffectedRefs(
  planningLineage: PlanningMutationLineage[],
): PlanningMutationAffectedRef[] {
  const seen = new Set<string>()
  const out: PlanningMutationAffectedRef[] = []
  for (const row of planningLineage) {
    for (const ref of row.affectedDownstreamRefs) {
      const key = `${ref.kind}:${ref.ref}:${ref.fieldPath ?? ""}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(ref)
    }
  }
  return out
}

function summarizeOutcomeItems(
  items: PlanReadinessOutcomeItem[],
): PlanReadinessOutcomeReport["summary"] {
  const summary: PlanReadinessOutcomeReport["summary"] = {
    totalItems: items.length,
    byReadinessStatus: {},
    byOperatorDisposition: {},
    byProposalStatus: {},
    linkedProposalCount: 0,
    resolvedProposalCount: 0,
    appliedProposalCount: 0,
    planningLineageRecordedCount: 0,
    downstreamObservedCount: 0,
    downstreamCheckerFiredCount: 0,
    needsDownstreamObservationCount: 0,
    missingLinkedProposalCount: 0,
  }
  for (const item of items) {
    increment(summary.byReadinessStatus, item.readinessItem.status)
    increment(summary.byOperatorDisposition, item.readinessItem.operatorDisposition ?? "none")
    if (item.readinessItem.proposalEnvelopeId) summary.linkedProposalCount++
    if (item.proposal) {
      increment(summary.byProposalStatus, item.proposal.status)
      if (item.proposal.status !== "pending") summary.resolvedProposalCount++
      if (item.proposal.status === "approved" || item.proposal.status === "modified") {
        summary.appliedProposalCount++
      }
    } else if (item.readinessItem.proposalEnvelopeId) {
      summary.missingLinkedProposalCount++
    }
    if (item.downstream.planningLineage.length > 0) summary.planningLineageRecordedCount++
    if (
      item.downstream.proposalOutcome ||
      item.downstream.resolutionImpact ||
      item.downstream.checkerObservations.length > 0
    ) {
      summary.downstreamObservedCount++
    }
    if (item.downstream.observationStatus === "checker_fired") summary.downstreamCheckerFiredCount++
    if (
      item.downstream.interpretation === "applied_no_downstream_observation" ||
      item.downstream.interpretation === "applied_missing_lineage"
    ) {
      summary.needsDownstreamObservationCount++
    }
  }
  return summary
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function normalizeStringArray(raw: unknown): string[] {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value
}

// Local structural copy of the row shape returned by findEnvelopeById. This
// keeps the public outcome report narrow without broadening proposal-envelope
// persistence APIs beyond this read-only attribution use case.
type PlanReadinessProposalEnvelopeRow = NonNullable<Awaited<ReturnType<typeof findEnvelopeById>>>

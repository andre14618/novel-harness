#!/usr/bin/env bun
/**
 * Apply an explicit Plan Readiness operator plan to an existing production
 * novel. This is a production-path control: it records dispositions or creates
 * normal manual planning_edit proposals through the Plan Readiness route.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { z } from "zod"
import type { PlanReadinessItem } from "../../src/db/plan-readiness"
import {
  formatSourceDraftingIsolationAssessment,
  loadSourceDraftingIsolationAssessment,
  type SourceDraftingIsolationAssessment,
} from "../../src/harness/drafting-source"

const targetKindSchema = z.enum(["chapter_outline", "scene_plan", "beat_plan"])
const dispositionDecisionSchema = z.enum([
  "accepted_as_is",
  "not_applicable",
  "deferred",
  "fixed",
])
const proposalDecisionSchema = z.enum(["field_replace", "beat_replace", "beat_reorder", "scene_select", "beat_requirement_remove"])
const decisionSchema = z.union([dispositionDecisionSchema, proposalDecisionSchema])

const actionPlanSchema = z.object({
  actions: z.array(z.object({
    match: z.object({
      itemId: z.string().optional(),
      label: z.string().optional(),
      dimension: z.string().optional(),
      targetRef: z.string().optional(),
      targetKind: targetKindSchema.optional(),
      targetFieldPath: z.string().optional(),
    }),
    diagnostic: z.object({
      label: z.string(),
      dimension: z.string(),
      severity: z.string(),
      fixIntent: z.string().optional(),
      explanation: z.string().optional(),
      missingForNextLevel: z.string().nullable().optional(),
    }).optional(),
    evidence: z.record(z.string(), z.string()).optional(),
    preserveIds: z.record(z.string(), z.array(z.string())).optional(),
    sourceReportPaths: z.array(z.string()).optional(),
    decision: decisionSchema,
    proposedValue: z.unknown().optional(),
    proposedValueTemplate: z.unknown().optional(),
    proposalCandidate: z.unknown().optional(),
    proposalInstruction: z.string().optional(),
    currentValueSummary: z.unknown().optional(),
    useCandidate: z.boolean().optional(),
    operatorNote: z.string().optional(),
    rationale: z.string().optional(),
  })),
})

export type PlanReadinessApplyDecision = z.infer<typeof decisionSchema>
export type PlanReadinessActionPlan = z.infer<typeof actionPlanSchema>
export type PlanReadinessPlanAction = PlanReadinessActionPlan["actions"][number]

export interface PlanReadinessApplyArgs {
  novelId: string
  planPath: string
  outputPath: string | null
  dryRun: boolean
  approveProposals: boolean
  json: boolean
  limit: number
}

export interface SelectedReadinessAction {
  planAction: PlanReadinessPlanAction
  item: PlanReadinessItem | null
  error: string | null
}

export interface AppliedReadinessAction {
  itemId: string
  label: string
  dimension: string
  target: PlanReadinessItem["target"] | null
  decision: PlanReadinessApplyDecision
  dryRun: boolean
  status: number | null
  ok: boolean
  proposalEnvelopeId: string | null
  approved: boolean
  error: string | null
}

export interface PlanReadinessApplyReport {
  generatedAt: string
  novelId: string
  dryRun: boolean
  planPath: string
  draftingSource: SourceDraftingIsolationAssessment
  summary: {
    requestedActions: number
    matchedActions: number
    appliedActions: number
    dispositionActions: number
    proposalActions: number
    approvedProposals: number
    errors: number
  }
  actions: AppliedReadinessAction[]
  outcomes: unknown
}

export function parseArgs(argv = process.argv.slice(2)): PlanReadinessApplyArgs {
  let novelId = ""
  let planPath = ""
  let outputPath: string | null = null
  let dryRun = false
  let approveProposals = false
  let json = false
  let limit = 200

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--novel") {
      novelId = requireValue(argv[++i], "--novel")
    } else if (arg === "--plan") {
      planPath = requireValue(argv[++i], "--plan")
    } else if (arg === "--output") {
      outputPath = requireValue(argv[++i], "--output")
    } else if (arg === "--dry-run") {
      dryRun = true
    } else if (arg === "--approve-proposals") {
      approveProposals = true
    } else if (arg === "--json") {
      json = true
    } else if (arg === "--limit") {
      limit = positiveInt(requireValue(argv[++i], "--limit"), "--limit")
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }

  if (!novelId) throw new Error("--novel is required")
  if (!planPath) throw new Error("--plan is required")
  return { novelId, planPath, outputPath, dryRun, approveProposals, json, limit }
}

export function loadActionPlan(path: string): PlanReadinessActionPlan {
  const abs = resolve(path)
  if (!existsSync(abs)) throw new Error(`plan file not found: ${abs}`)
  const parsed = actionPlanSchema.safeParse(JSON.parse(readFileSync(abs, "utf8")))
  if (!parsed.success) {
    throw new Error(`invalid plan file: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`)
  }
  return parsed.data
}

export function selectReadinessActions(
  items: readonly PlanReadinessItem[],
  actions: readonly PlanReadinessPlanAction[],
): SelectedReadinessAction[] {
  const consumed = new Set<string>()
  return actions.map((planAction) => {
    const item = items.find(candidate =>
      !consumed.has(candidate.id) &&
      (candidate.status === "open" || candidate.status === "deferred") &&
      itemMatches(candidate, planAction.match)
    ) ?? null
    if (!item) {
      return {
        planAction,
        item: null,
        error: "no matching open/deferred readiness item",
      }
    }
    consumed.add(item.id)
    return { planAction, item, error: null }
  })
}

export function requestBodyForPlanAction(action: PlanReadinessPlanAction): Record<string, unknown> {
  if (isProposalDecision(action.decision)) {
    return {
      action: action.decision,
      ...(Object.prototype.hasOwnProperty.call(action, "proposedValue")
        ? { proposedValue: action.proposedValue }
        : {}),
      ...(action.useCandidate !== undefined ? { useCandidate: action.useCandidate } : {}),
      ...(action.operatorNote ? { operatorNote: action.operatorNote } : {}),
      ...(action.rationale ? { rationale: action.rationale } : {}),
    }
  }
  return {
    status: action.decision,
    ...(action.operatorNote ? { operatorNote: action.operatorNote } : {}),
  }
}

async function run(args: PlanReadinessApplyArgs): Promise<PlanReadinessApplyReport> {
  const plan = loadActionPlan(args.planPath)
  const { listPlanReadinessItems } = await import("../../src/db/plan-readiness")
  const [items, draftingSource] = await Promise.all([
    listPlanReadinessItems(args.novelId, { status: "all", limit: args.limit }),
    loadSourceDraftingIsolationAssessment(args.novelId),
  ])
  const selections = selectReadinessActions(items, plan.actions)
  const actions: AppliedReadinessAction[] = []

  for (const selection of selections) {
    if (!selection.item) {
      actions.push(actionResultForMissing(selection, args.dryRun))
      continue
    }
    if (args.dryRun) {
      actions.push(actionResultForItem(selection.item, selection.planAction, {
        dryRun: true,
        status: null,
        ok: true,
        proposalEnvelopeId: null,
        error: null,
      }))
      continue
    }

    const path = isProposalDecision(selection.planAction.decision)
      ? `/api/novel/${encodeURIComponent(args.novelId)}/plan-readiness/${encodeURIComponent(selection.item.id)}/create-planning-proposal`
      : `/api/novel/${encodeURIComponent(args.novelId)}/plan-readiness/${encodeURIComponent(selection.item.id)}/disposition`
    const response = await invokeReadiness("POST", path, requestBodyForPlanAction(selection.planAction))
    const body = await response.json().catch((err) => ({ ok: false, error: String(err) }))
    const proposalEnvelopeId = stringValue(body?.proposal?.envelope?.id ?? body?.proposal?.id)
    const approval = response.ok && body?.ok !== false && args.approveProposals && proposalEnvelopeId
      ? await approvePlanningProposal(args.novelId, proposalEnvelopeId, selection.planAction.operatorNote)
      : { approved: false, error: null as string | null }
    actions.push(actionResultForItem(selection.item, selection.planAction, {
      dryRun: false,
      status: response.status,
      ok: response.ok && body?.ok !== false && approval.error === null,
      proposalEnvelopeId,
      approved: approval.approved,
      error: response.ok && body?.ok !== false ? approval.error : stringValue(body?.error ?? response.statusText),
    }))
  }

  const outcomesResponse = await invokeReadiness(
    "GET",
    `/api/novel/${encodeURIComponent(args.novelId)}/plan-readiness/outcomes`,
  )
  const outcomes = await outcomesResponse.json().catch((err) => ({ ok: false, error: String(err) }))
  return {
    generatedAt: new Date().toISOString(),
    novelId: args.novelId,
    dryRun: args.dryRun,
    planPath: resolve(args.planPath),
    draftingSource,
    summary: summarizeActions(plan.actions.length, actions),
    actions,
    outcomes,
  }
}

function itemMatches(item: PlanReadinessItem, match: PlanReadinessPlanAction["match"]): boolean {
  if (match.itemId && item.id !== match.itemId) return false
  if (match.label && item.diagnosticLabel !== match.label) return false
  if (match.dimension && item.dimension !== match.dimension) return false
  if (match.targetRef && item.target.ref !== match.targetRef) return false
  if (match.targetKind && item.target.kind !== match.targetKind) return false
  if (match.targetFieldPath && item.target.fieldPath !== match.targetFieldPath) return false
  return true
}

function actionResultForMissing(
  selection: SelectedReadinessAction,
  dryRun: boolean,
): AppliedReadinessAction {
  return {
    itemId: selection.planAction.match.itemId ?? "(unmatched)",
    label: selection.planAction.match.label ?? "(any)",
    dimension: selection.planAction.match.dimension ?? "(any)",
    target: null,
    decision: selection.planAction.decision,
    dryRun,
    status: null,
    ok: false,
    proposalEnvelopeId: null,
    approved: false,
    error: selection.error,
  }
}

function actionResultForItem(
  item: PlanReadinessItem,
  planAction: PlanReadinessPlanAction,
  outcome: {
    dryRun: boolean
    status: number | null
    ok: boolean
    proposalEnvelopeId: string | null
    approved?: boolean
    error: string | null
  },
): AppliedReadinessAction {
  return {
    itemId: item.id,
    label: item.diagnosticLabel,
    dimension: item.dimension,
    target: item.target,
    decision: planAction.decision,
    approved: outcome.approved ?? false,
    ...outcome,
  }
}

function summarizeActions(
  requestedActions: number,
  actions: readonly AppliedReadinessAction[],
): PlanReadinessApplyReport["summary"] {
  return {
    requestedActions,
    matchedActions: actions.filter(action => action.target !== null).length,
    appliedActions: actions.filter(action => action.ok && !action.dryRun).length,
    dispositionActions: actions.filter(action => !isProposalDecision(action.decision)).length,
    proposalActions: actions.filter(action => isProposalDecision(action.decision)).length,
    approvedProposals: actions.filter(action => action.approved).length,
    errors: actions.filter(action => !action.ok).length,
  }
}

export function renderReport(report: PlanReadinessApplyReport): string {
  const lines: string[] = []
  lines.push("# Plan Readiness Apply")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Novel: ${report.novelId}`)
  lines.push(`Dry run: ${report.dryRun}`)
  lines.push(`Plan: ${report.planPath}`)
  lines.push("")
  lines.push("## Drafting Source")
  lines.push(`- clean for drafting evidence: ${report.draftingSource.clean ? "yes" : "no"}`)
  if (report.draftingSource.issue) lines.push(`- issue: ${report.draftingSource.issue}`)
  if (report.draftingSource.guidance) lines.push(`- guidance: ${report.draftingSource.guidance}`)
  const state = report.draftingSource.state
  if (state) {
    lines.push(`- state: phase=${state.phase ?? "(none)"} current_chapter=${state.currentChapter ?? "(none)"} outlines=${state.outlineCount} drafts=${state.draftCount}`)
  }
  lines.push(`- summary: ${formatSourceDraftingIsolationAssessment(report.draftingSource)}`)
  lines.push("")
  lines.push("## Summary")
  lines.push(`- requested: ${report.summary.requestedActions}`)
  lines.push(`- matched: ${report.summary.matchedActions}`)
  lines.push(`- applied: ${report.summary.appliedActions}`)
  lines.push(`- proposals: ${report.summary.proposalActions}`)
  lines.push(`- approved proposals: ${report.summary.approvedProposals}`)
  lines.push(`- dispositions: ${report.summary.dispositionActions}`)
  lines.push(`- errors: ${report.summary.errors}`)
  lines.push("")
  lines.push("## Actions")
  for (const action of report.actions) {
    const target = action.target
      ? `${action.target.kind}:${action.target.ref}${action.target.fieldPath ? `:${action.target.fieldPath}` : ""}`
      : "(unmatched)"
    const suffix = action.proposalEnvelopeId
      ? ` proposal=${action.proposalEnvelopeId}${action.approved ? " approved=true" : ""}`
      : action.error
        ? ` error=${action.error}`
        : ""
    lines.push(`- ${action.decision} ${action.label} ${target} ok=${action.ok}${suffix}`)
  }
  return lines.join("\n")
}

async function invokeReadiness(method: string, path: string, body?: unknown): Promise<Response> {
  const { handlePlanReadinessRoute } = await import("../../src/orchestrator/plan-readiness-routes")
  const url = new URL(`http://localhost${path}`)
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { "content-type": "application/json" }
  }
  const response = await handlePlanReadinessRoute(new Request(url, init), url)
  if (!response) throw new Error(`Plan Readiness route did not handle ${method} ${path}`)
  return response
}

async function approvePlanningProposal(
  novelId: string,
  envelopeId: string,
  operatorNote: string | undefined,
): Promise<{ approved: boolean; error: string | null }> {
  const response = await invokePlanningProposal(
    "POST",
    `/api/novel/${encodeURIComponent(novelId)}/planning-proposals/${encodeURIComponent(envelopeId)}/resolve`,
    {
      status: "approved",
      resolvedBy: "script",
      operatorNote: operatorNote ?? "Approved by plan-readiness-apply --approve-proposals.",
    },
  )
  const body = await response.json().catch((err) => ({ ok: false, error: String(err) }))
  const approved = response.ok && body?.ok !== false
  return {
    approved,
    error: approved ? null : stringValue(body?.error ?? response.statusText),
  }
}

async function invokePlanningProposal(method: string, path: string, body?: unknown): Promise<Response> {
  const { handlePlanningProposalRoute } = await import("../../src/orchestrator/planning-proposal-routes")
  const url = new URL(`http://localhost${path}`)
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { "content-type": "application/json" }
  }
  const response = await handlePlanningProposalRoute(new Request(url, init), url)
  if (!response) throw new Error(`Planning Proposal route did not handle ${method} ${path}`)
  return response
}

function isProposalDecision(decision: PlanReadinessApplyDecision): boolean {
  return decision === "field_replace" ||
    decision === "beat_replace" ||
    decision === "beat_reorder" ||
    decision === "scene_select" ||
    decision === "beat_requirement_remove"
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} requires a value`)
  return value
}

function positiveInt(raw: string, flag: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} must be a positive integer`)
  return n
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

async function closeDb(): Promise<void> {
  const { default: db } = await import("../../src/db/connection")
  await db.end().catch(() => {})
}

async function main(): Promise<number> {
  let args: PlanReadinessApplyArgs
  try {
    args = parseArgs()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/plan-readiness-apply.ts --novel <novelId> --plan <plan.json> [--output <report.md>] [--dry-run] [--approve-proposals] [--json] [--limit <n>]")
    return 2
  }

  try {
    const report = await run(args)
    if (args.outputPath) {
      const outPath = resolve(args.outputPath)
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, args.json ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report))
    }
    console.log(args.json ? JSON.stringify(report, null, 2) : renderReport(report))
    return report.summary.errors > 0 ? 1 : 0
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    return 1
  } finally {
    await closeDb()
  }
}

if (import.meta.main) {
  process.exit(await main())
}

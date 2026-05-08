#!/usr/bin/env bun
/**
 * Exercise the Plan Readiness Review bridge on disposable planner-diagnostic data.
 *
 * This is a diagnostic smoke/data-loop. It imports existing planner-discernment
 * findings, records sample operator dispositions, creates normal manual
 * planning_edit proposals, optionally approves them, and writes an outcome
 * report. It does not draft prose, call LLMs, or promote runtime behavior.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"

import db, { migrate } from "../../src/db/connection"
import { createNovel } from "../../src/db/novels"
import { saveChapterOutline } from "../../src/db/outlines"
import { listPlanReadinessItems, type PlanReadinessItem } from "../../src/db/plan-readiness"
import { getChapterOutlines } from "../../src/db/outlines"
import { handlePlanReadinessRoute } from "../../src/orchestrator/plan-readiness-routes"
import { handlePlanningProposalRoute } from "../../src/orchestrator/planning-proposal-routes"
import type { ChapterOutline, SceneBeat, SeedInput } from "../../src/types"
import type { BeatObligationsContract } from "../../src/schemas/shared"
import {
  buildFindingAggregate,
  renderFindingAggregate,
} from "./planner-discernment-finding-aggregate"
import {
  plannerContractPlanSchema,
  type PlannerContractPlan,
} from "./method-pack-planner-diagnostic"

const DEFAULT_LABELS = [
  "REL-1",
  "MOTIVE-1",
  "MOTIVE-2",
  "STAKES-2",
  "MATERIAL-1",
  "WFACT-1",
]

interface Args {
  reports: string[]
  cellPath: string
  armId: string
  labels: string[]
  limit: number
  outputDir: string | null
  novelId: string | null
  approveProposals: boolean
  json: boolean
}

interface MethodPackCell {
  diagnosticId: string
  fixturePath: string
  arms: Array<{
    armId: string
    label: string
    methodPackEnabled: boolean
    plan: unknown
  }>
}

interface LoopAction {
  kind: "disposition" | "proposal"
  itemId: string
  label: string
  targetRef: string
  status?: string
  operatorDisposition?: string
  action?: "field_replace" | "beat_requirement_remove"
  proposalEnvelopeId?: string
  resolutionStatus?: string
  error?: string
}

interface LoopReport {
  generatedAt: string
  novelId: string
  source: {
    cellPath: string
    fixtureId: string
    armId: string
    reports: string[]
    labels: string[]
  }
  imported: {
    inserted: number
    updated: number
    skipped: number
    itemCount: number
  }
  actions: LoopAction[]
  outcomes: unknown
  aggregate: unknown
}

export function outlinesFromPlannerContractPlan(plan: PlannerContractPlan): ChapterOutline[] {
  return plan.chapters.map((chapter, index) => {
    const scenes = chapter.scenes.map((scene) => {
      const obligations = chapter.obligations.filter((obligation) =>
        scene.requiredObligationIds.includes(obligation.obligationId)
      )
      return {
        beatId: scene.sceneId,
        kind: "action",
        description: [
          `Scene function: ${scene.sceneFunction}`,
          `Goal: ${scene.goal}`,
          `Conflict: ${scene.conflict}`,
          `Turn/value shift: ${scene.turnOrValueShift}`,
          `Outcome: ${scene.outcome}`,
          `Consequence: ${scene.consequence}`,
        ].filter(Boolean).join("\n"),
        characters: scene.requiredCharacterIds,
        requiredCharacterIds: scene.requiredCharacterIds,
        requiredWorldFactIds: scene.requiredWorldFactIds,
        obligations: obligationsForScene(obligations),
        mustEstablish: [],
        mustPayOff: [],
        mustTransferKnowledge: [],
        mustShowStateChange: [],
        requiredPayoffs: [],
      } as unknown as SceneBeat
    })
    const characterIds = unique([
      chapter.povCharacterId,
      ...chapter.scenes.flatMap(scene => scene.requiredCharacterIds),
    ].filter(Boolean))
    return {
      chapterNumber: index + 1,
      chapterId: chapter.chapterId,
      title: chapter.chapterFunction || `Chapter ${index + 1}`,
      povCharacter: chapter.povCharacterId,
      povCharacterId: chapter.povCharacterId,
      setting: unique(chapter.scenes.map(scene => scene.locationOrArena).filter(Boolean)).join("; "),
      purpose: [
        chapter.chapterFunction,
        chapter.protagonistPressure,
        chapter.centralConflict,
        chapter.irreversibleChange,
        chapter.endpointOrHook,
      ].filter(Boolean).join(" "),
      targetWords: 1500,
      charactersPresent: characterIds,
      charactersPresentIds: characterIds,
      scenes,
      establishedFacts: [],
      characterStateChanges: [],
      knowledgeChanges: [],
    } as unknown as ChapterOutline
  })
}

export function filterAggregateForCellArm(aggregate: any, fixtureId: string, armId: string, limit: number): any {
  const groups = Array.isArray(aggregate.groups) ? aggregate.groups : []
  const filtered = groups
    .filter((group: any) => String(group.fixtureId ?? "") === fixtureId)
    .filter((group: any) => String(group.armId ?? "") === armId)
    .slice(0, limit)
    .map((group: any, index: number) => ({
      ...group,
      groupId: `${index + 1}`.padStart(3, "0"),
      findings: Array.isArray(group.findings)
        ? group.findings.map((finding: any, findingIndex: number) => ({
          ...finding,
          findingId: `${String(index + 1).padStart(3, "0")}.${findingIndex + 1}`,
        }))
        : [],
    }))
  return {
    ...aggregate,
    groups: filtered,
    groupCount: filtered.length,
    findingCount: filtered.reduce((sum: number, group: any) => sum + (group.findings?.length ?? 0), 0),
  }
}

export function renderLoopReport(report: LoopReport): string {
  const summary = outcomeSummary(report.outcomes)
  const lines: string[] = []
  lines.push("# Plan Readiness Data Loop")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Novel: ${report.novelId}`)
  lines.push(`Cell: ${report.source.cellPath}`)
  lines.push(`Fixture/arm: ${report.source.fixtureId} / ${report.source.armId}`)
  lines.push(`Reports: ${report.source.reports.length}`)
  lines.push(`Labels: ${report.source.labels.join(", ")}`)
  lines.push("")
  lines.push("## Import")
  lines.push(`- inserted: ${report.imported.inserted}`)
  lines.push(`- updated: ${report.imported.updated}`)
  lines.push(`- skipped: ${report.imported.skipped}`)
  lines.push(`- imported items: ${report.imported.itemCount}`)
  lines.push("")
  lines.push("## Sample Review Actions")
  for (const action of report.actions) {
    const suffix = action.error
      ? ` ERROR: ${action.error}`
      : action.proposalEnvelopeId
        ? ` proposal=${action.proposalEnvelopeId}${action.resolutionStatus ? ` resolution=${action.resolutionStatus}` : ""}`
        : ""
    lines.push(`- ${action.kind}: ${action.label} ${action.targetRef} ${action.status ?? action.action ?? ""}${suffix}`.trim())
  }
  lines.push("")
  lines.push("## Outcomes")
  lines.push(`- linked proposals: ${summary.linkedProposalCount ?? "n/a"}`)
  lines.push(`- applied proposals: ${summary.appliedProposalCount ?? "n/a"}`)
  lines.push(`- planning lineage recorded: ${summary.planningLineageRecordedCount ?? "n/a"}`)
  lines.push(`- needs downstream observation: ${summary.needsDownstreamObservationCount ?? "n/a"}`)
  lines.push(`- downstream observed: ${summary.downstreamObservedCount ?? "n/a"}`)
  lines.push("")
  lines.push("## Interpretation")
  lines.push("- This proves the diagnostic-to-readiness-to-planning-edit path can run end to end on disposable planner data.")
  lines.push("- This does not prove story-quality improvement; drafting/checker outcome evidence still requires a later prose run or operator-labeled review.")
  return lines.join("\n")
}

async function runLoop(args: Args): Promise<LoopReport> {
  await migrate()
  const cell = loadCell(args.cellPath)
  const fixtureId = fixtureIdFromPath(cell.fixturePath)
  const arm = cell.arms.find(candidate => candidate.armId === args.armId)
  if (!arm) throw new Error(`arm not found in cell: ${args.armId}`)
  const parsedPlan = plannerContractPlanSchema.safeParse(arm.plan)
  if (!parsedPlan.success) {
    throw new Error(`cell arm plan invalid: ${parsedPlan.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`)
  }

  const aggregate = buildFindingAggregate({
    reports: args.reports,
    labels: args.labels,
    outputDir: null,
    limit: null,
    json: false,
  })
  const filteredAggregate = filterAggregateForCellArm(aggregate, fixtureId, args.armId, args.limit)
  if (filteredAggregate.groups.length === 0) {
    throw new Error(`no aggregate groups for fixture=${fixtureId} arm=${args.armId}; try different --label or --report`)
  }

  const novelId = args.novelId ?? `plan-readiness-loop-${Date.now()}`
  await createDisposableNovel(novelId, parsedPlan.data)

  const imported = await expectRouteJson(await invokeReadiness(
    "POST",
    `/api/novel/${novelId}/plan-readiness/import`,
    {
      aggregate: filteredAggregate,
      importedByKind: "script",
      importedByRef: "plan-readiness-data-loop",
    },
  ), "import readiness")

  const items = (await listPlanReadinessItems(novelId, { status: "all", limit: 100 }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const actions = await applySampleReviewActions(novelId, items, args.approveProposals)
  const outcomes = await expectRouteJson(await invokeReadiness(
    "GET",
    `/api/novel/${novelId}/plan-readiness/outcomes`,
  ), "readiness outcomes")

  return {
    generatedAt: new Date().toISOString(),
    novelId,
    source: {
      cellPath: args.cellPath,
      fixtureId,
      armId: args.armId,
      reports: args.reports,
      labels: args.labels,
    },
    imported: {
      inserted: Number(imported.inserted ?? 0),
      updated: Number(imported.updated ?? 0),
      skipped: Array.isArray(imported.skipped) ? imported.skipped.length : 0,
      itemCount: Array.isArray(imported.items) ? imported.items.length : 0,
    },
    actions,
    outcomes,
    aggregate: filteredAggregate,
  }
}

async function createDisposableNovel(novelId: string, plan: PlannerContractPlan): Promise<void> {
  const seed: SeedInput = {
    premise: `Disposable Plan Readiness Review smoke for ${plan.armId}.`,
    genre: "fantasy",
    characters: [],
    chapterCount: plan.chapters.length,
  }
  await createNovel(novelId, seed)
  for (const outline of outlinesFromPlannerContractPlan(plan)) {
    await saveChapterOutline(novelId, outline)
  }
}

async function applySampleReviewActions(
  novelId: string,
  items: readonly PlanReadinessItem[],
  approveProposals: boolean,
): Promise<LoopAction[]> {
  const actions: LoopAction[] = []
  const consumed = new Set<string>()
  const outlines = await getChapterOutlines(novelId)

  const fieldItem = items.find(item => item.status === "open" && !consumed.has(item.id))
  if (fieldItem) {
    consumed.add(fieldItem.id)
    actions.push(await createFieldReplaceProposal(novelId, fieldItem, outlines, false))
  }

  const removeItem = items.find(item =>
    item.status === "open" &&
    !consumed.has(item.id) &&
    item.target.kind === "beat_plan" &&
    removableRequirementForItem(item, outlines) !== null
  )
  if (removeItem) {
    consumed.add(removeItem.id)
    actions.push(await createRemoveRequirementProposal(novelId, removeItem, outlines, false))
  }

  const dispositionSpecs = [
    {
      status: "not_applicable",
      operatorDisposition: "not_applicable",
      operatorNote: "Sample disposition: this diagnostic is not applicable to the selected scene contract.",
    },
    {
      status: "accepted_as_is",
      operatorDisposition: "acceptable_choice",
      operatorNote: "Sample disposition: the operator accepts the current plan shape for this item.",
    },
    {
      status: "deferred",
      operatorDisposition: "defer_to_drafting",
      operatorNote: "Sample disposition: leave this as a drafting watchpoint instead of editing the plan.",
    },
  ]

  for (const spec of dispositionSpecs) {
    const item = items.find(candidate => candidate.status === "open" && !consumed.has(candidate.id))
    if (!item) break
    consumed.add(item.id)
    const response = await invokeReadiness(
      "POST",
      `/api/novel/${novelId}/plan-readiness/${item.id}/disposition`,
      spec,
    )
    const body = await response?.json().catch((err) => ({ ok: false, error: String(err) }))
    actions.push({
      kind: "disposition",
      itemId: item.id,
      label: item.diagnosticLabel,
      targetRef: item.target.ref,
      status: spec.status,
      operatorDisposition: spec.operatorDisposition,
      ...(response?.ok ? {} : { error: String(body?.error ?? response?.status ?? "unknown") }),
    })
  }

  if (approveProposals) {
    for (const action of actions) {
      if (action.kind !== "proposal" || !action.proposalEnvelopeId || action.error) continue
      action.resolutionStatus = await approvePlanningProposal(novelId, action.proposalEnvelopeId)
    }
  }

  return actions
}

async function createFieldReplaceProposal(
  novelId: string,
  item: PlanReadinessItem,
  outlines: readonly ChapterOutline[],
  approveProposals: boolean,
): Promise<LoopAction> {
  const current = currentValueForItem(item, outlines)
  const proposedValue = [
    current || item.explanation,
    "",
    `Readiness revision: address ${item.diagnosticLabel} by making ${item.fixIntent} explicit while preserving ${JSON.stringify(item.preserveIds)}.`,
    item.missingForNextLevel ? `Missing for next level: ${item.missingForNextLevel}` : "",
  ].filter(Boolean).join("\n")
  const created = await invokeReadiness(
    "POST",
    `/api/novel/${novelId}/plan-readiness/${item.id}/create-planning-proposal`,
    {
      action: "field_replace",
      proposedValue,
      operatorNote: "Sample operator action: create a replacement planning proposal from readiness review.",
      rationale: `Sample readiness loop replacement for ${item.diagnosticLabel}.`,
    },
  )
  const body = await created?.json().catch((err) => ({ ok: false, error: String(err) }))
  const envelopeId = body?.proposal?.envelope?.id
  const action: LoopAction = {
    kind: "proposal",
    itemId: item.id,
    label: item.diagnosticLabel,
    targetRef: item.target.ref,
    action: "field_replace",
    proposalEnvelopeId: typeof envelopeId === "string" ? envelopeId : undefined,
    ...(created?.ok ? {} : { error: String(body?.error ?? created?.status ?? "unknown") }),
  }
  if (created?.ok && typeof envelopeId === "string" && approveProposals) {
    action.resolutionStatus = await approvePlanningProposal(novelId, envelopeId)
  }
  return action
}

async function createRemoveRequirementProposal(
  novelId: string,
  item: PlanReadinessItem,
  outlines: readonly ChapterOutline[],
  approveProposals: boolean,
): Promise<LoopAction> {
  const proposedValue = removableRequirementForItem(item, outlines)
  if (!proposedValue) {
    return {
      kind: "proposal",
      itemId: item.id,
      label: item.diagnosticLabel,
      targetRef: item.target.ref,
      action: "beat_requirement_remove",
      error: "no removable requirement found",
    }
  }
  const created = await invokeReadiness(
    "POST",
    `/api/novel/${novelId}/plan-readiness/${item.id}/create-planning-proposal`,
    {
      action: "beat_requirement_remove",
      proposedValue,
      operatorNote: "Sample operator action: remove one requirement that readiness review marked as not doing work.",
      rationale: `Sample readiness loop requirement removal for ${item.diagnosticLabel}.`,
    },
  )
  const body = await created?.json().catch((err) => ({ ok: false, error: String(err) }))
  const envelopeId = body?.proposal?.envelope?.id
  const action: LoopAction = {
    kind: "proposal",
    itemId: item.id,
    label: item.diagnosticLabel,
    targetRef: item.target.ref,
    action: "beat_requirement_remove",
    proposalEnvelopeId: typeof envelopeId === "string" ? envelopeId : undefined,
    ...(created?.ok ? {} : { error: String(body?.error ?? created?.status ?? "unknown") }),
  }
  if (created?.ok && typeof envelopeId === "string" && approveProposals) {
    action.resolutionStatus = await approvePlanningProposal(novelId, envelopeId)
  }
  return action
}

async function approvePlanningProposal(novelId: string, envelopeId: string): Promise<string> {
  const url = new URL(`http://localhost/api/novel/${encodeURIComponent(novelId)}/planning-proposals/${encodeURIComponent(envelopeId)}/resolve`)
  const res = await handlePlanningProposalRoute(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: "approved",
        resolvedBy: "script",
        operatorNote: "Approved by disposable plan-readiness data loop.",
      }),
    }),
    url,
  )
  const body = await res?.json().catch((err) => ({ ok: false, error: String(err) }))
  if (!res?.ok || body?.ok === false) {
    return `error:${String(body?.error ?? res?.status ?? "unknown")}`
  }
  return "approved"
}

function removableRequirementForItem(
  item: PlanReadinessItem,
  outlines: readonly ChapterOutline[],
): { requiredCharacterIds: string[]; requiredWorldFactIds: string[] } | null {
  const beat = item.target.kind === "beat_plan" ? findBeat(outlines, item.target.ref) : null
  if (!beat) return null
  const requiredCharacterIds = [...((beat as any).requiredCharacterIds ?? [])].map(String)
  const requiredWorldFactIds = [...((beat as any).requiredWorldFactIds ?? [])].map(String)
  if (requiredCharacterIds.length > 1) {
    return {
      requiredCharacterIds: requiredCharacterIds.slice(0, -1),
      requiredWorldFactIds,
    }
  }
  if (requiredWorldFactIds.length > 0) {
    return {
      requiredCharacterIds,
      requiredWorldFactIds: requiredWorldFactIds.slice(0, -1),
    }
  }
  return null
}

function currentValueForItem(item: PlanReadinessItem, outlines: readonly ChapterOutline[]): string {
  if (item.target.kind === "chapter_outline") {
    const outline = outlines.find(candidate => candidate.chapterId === item.target.ref)
    return String((outline as any)?.[item.target.fieldPath ?? "purpose"] ?? "")
  }
  const beat = findBeat(outlines, item.target.ref)
  return String((beat as any)?.[item.target.fieldPath ?? "description"] ?? "")
}

function findBeat(outlines: readonly ChapterOutline[], beatId: string): SceneBeat | null {
  for (const outline of outlines) {
    const beat = (outline.scenes ?? []).find(candidate => candidate.beatId === beatId)
    if (beat) return beat
  }
  return null
}

function obligationsForScene(obligations: PlannerContractPlan["chapters"][number]["obligations"]): BeatObligationsContract {
  return {
    mustEstablish: obligations.map(obligation => ({
      text: obligation.requirementText,
      obligationId: obligation.obligationId,
      sourceId: obligation.sourceId,
      sourceKind: sourceKindForObligation(obligation.sourceKind),
      characterId: obligation.linkedCharacterIds[0],
    })),
    mustPayOff: [],
    mustTransferKnowledge: [],
    mustShowStateChange: [],
    mustNotReveal: [],
    allowedNewEntities: [],
  }
}

function sourceKindForObligation(sourceKind: string): "fact" | "knowledge" | "state" | "payoff" {
  if (sourceKind === "character") return "state"
  if (sourceKind === "story_promise") return "payoff"
  if (sourceKind === "world") return "fact"
  return "knowledge"
}

function loadCell(path: string): MethodPackCell {
  const abs = resolve(process.cwd(), path)
  if (!existsSync(abs)) throw new Error(`cell not found: ${abs}`)
  return JSON.parse(readFileSync(abs, "utf-8")) as MethodPackCell
}

function fixtureIdFromPath(path: string): string {
  return basename(path).replace(/\.json$/, "")
}

async function invokeReadiness(method: string, path: string, body?: unknown): Promise<Response | null> {
  const url = new URL(`http://localhost${path}`)
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { "content-type": "application/json" }
  }
  return handlePlanReadinessRoute(new Request(url, init), url)
}

async function expectRouteJson(res: Response | null, label: string): Promise<any> {
  if (!res) throw new Error(`${label}: route did not handle request`)
  const body = await res.json()
  if (!res.ok || body?.ok === false) {
    throw new Error(`${label}: ${String(body?.error ?? res.status)}`)
  }
  return body
}

function outcomeSummary(outcomes: unknown): Record<string, unknown> {
  if (!outcomes || typeof outcomes !== "object") return {}
  const summary = (outcomes as { summary?: unknown }).summary
  return summary && typeof summary === "object" ? summary as Record<string, unknown> : {}
}

function parseArgs(argv: string[]): Args {
  const reports: string[] = []
  const labels: string[] = []
  let cellPath = ""
  let armId = "test:commercial-fantasy-adventure-v0:flash"
  let limit = 5
  let outputDir: string | null = null
  let novelId: string | null = null
  let approveProposals = true
  let json = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--report") reports.push(requireValue(argv, ++i, "--report"))
    else if (arg.startsWith("--report=")) reports.push(arg.slice("--report=".length))
    else if (arg === "--cell") cellPath = requireValue(argv, ++i, "--cell")
    else if (arg.startsWith("--cell=")) cellPath = arg.slice("--cell=".length)
    else if (arg === "--arm") armId = requireValue(argv, ++i, "--arm")
    else if (arg.startsWith("--arm=")) armId = arg.slice("--arm=".length)
    else if (arg === "--label") labels.push(requireValue(argv, ++i, "--label"))
    else if (arg.startsWith("--label=")) labels.push(arg.slice("--label=".length))
    else if (arg === "--limit") limit = parsePositiveInt(requireValue(argv, ++i, "--limit"), "--limit")
    else if (arg.startsWith("--limit=")) limit = parsePositiveInt(arg.slice("--limit=".length), "--limit")
    else if (arg === "--output-dir") outputDir = requireValue(argv, ++i, "--output-dir")
    else if (arg.startsWith("--output-dir=")) outputDir = arg.slice("--output-dir=".length)
    else if (arg === "--novel-id") novelId = requireValue(argv, ++i, "--novel-id")
    else if (arg.startsWith("--novel-id=")) novelId = arg.slice("--novel-id=".length)
    else if (arg === "--no-approve") approveProposals = false
    else if (arg === "--json") json = true
    else throw new Error(`unknown arg: ${arg}`)
  }

  if (reports.length === 0) throw new Error("--report is required")
  if (!cellPath) throw new Error("--cell is required")
  return {
    reports,
    cellPath,
    armId,
    labels: labels.length > 0 ? labels : DEFAULT_LABELS,
    limit,
    outputDir,
    novelId,
    approveProposals,
    json,
  }
}

function defaultOutputDir(cellPath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return `output/method-pack-diagnostics/${stamp}/plan-readiness-data-loop-${basename(cellPath, ".json")}`
}

function writeReportFiles(report: LoopReport, outputDir: string): void {
  const abs = resolve(process.cwd(), outputDir)
  mkdirSync(abs, { recursive: true })
  writeFileSync(join(abs, "plan-readiness-data-loop.json"), JSON.stringify(report, null, 2))
  writeFileSync(join(abs, "plan-readiness-data-loop.md"), renderLoopReport(report))
  writeFileSync(join(abs, "finding-aggregate.json"), JSON.stringify(report.aggregate, null, 2))
  writeFileSync(join(abs, "finding-aggregate.md"), renderFindingAggregate(report.aggregate as any))
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

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

async function closeDb(): Promise<void> {
  try {
    await db.end({ timeout: 1 })
  } catch {
    // The connection is lazy; if DATABASE_URL was missing there may be no DB
    // handle to close.
  }
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/evals/plan-readiness-data-loop.ts --cell <method-pack-cell.json> --report <real-data-report.json> [--report <json> ...] [--arm <armId>] [--label <LABEL> ...] [--limit <n>] [--output-dir <dir>] [--novel-id <id>] [--no-approve] [--json]")
    return 2
  }

  try {
    const report = await runLoop(args)
    const outputDir = args.outputDir ?? defaultOutputDir(args.cellPath)
    writeReportFiles(report, outputDir)
    console.log(args.json ? JSON.stringify(report, null, 2) : renderLoopReport(report))
    console.error(`wrote ${outputDir}`)
    await closeDb()
    return 0
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    await closeDb()
    return 1
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}

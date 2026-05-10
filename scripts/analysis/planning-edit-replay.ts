#!/usr/bin/env bun
/**
 * Replay approved planning_edit proposals from one Novel onto another Novel
 * through the normal planning-proposal route. This is for carrying accepted
 * Plan Readiness fixes from generated evidence artifacts back to a clean
 * Drafting Evidence Source without direct DB mutation.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import db from "../../src/db/connection"
import {
  planningEditPayloadSchema,
  type PlanningEditPayload,
} from "../../src/canon/planning-edit-proposal"
import { previewPlanningImpact } from "../../src/harness/planning-targets"
import { handlePlanningProposalRoute } from "../../src/orchestrator/planning-proposal-routes"

export interface PlanningEditReplayArgs {
  fromNovels: string[]
  toNovel: string
  proposalIds: string[]
  allApproved: boolean
  approve: boolean
  dryRun: boolean
  limit: number
  outputPath: string | null
  json: boolean
}

export interface PlanningEditReplaySource {
  id: string
  novelId: string
  status: string
  payload: PlanningEditPayload
}

export interface PlanningEditReplayItem {
  sourceProposalId: string
  sourceNovelId: string
  action: PlanningEditPayload["action"]
  target: PlanningEditPayload["target"]
  dryRun: boolean
  targetAvailable: boolean
  createdProposalId: string | null
  approved: boolean
  ok: boolean
  error: string | null
}

export interface PlanningEditReplayReport {
  generatedAt: string
  fromNovels: string[]
  toNovel: string
  dryRun: boolean
  approve: boolean
  summary: {
    requested: number
    replayable: number
    created: number
    approved: number
    errors: number
  }
  items: PlanningEditReplayItem[]
}

interface ProposalRow {
  id: string
  novel_id: string
  status: string
  payload: unknown
  modified_payload: unknown
}

export function parseArgs(argv = process.argv.slice(2)): PlanningEditReplayArgs {
  const fromNovels: string[] = []
  const proposalIds: string[] = []
  let toNovel = ""
  let allApproved = false
  let approve = false
  let dryRun = false
  let limit = 200
  let outputPath: string | null = null
  let json = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--from-novel") {
      fromNovels.push(requireValue(argv[++i], "--from-novel"))
    } else if (arg === "--to-novel") {
      toNovel = requireValue(argv[++i], "--to-novel")
    } else if (arg === "--proposal-id") {
      proposalIds.push(requireValue(argv[++i], "--proposal-id"))
    } else if (arg === "--all-approved") {
      allApproved = true
    } else if (arg === "--approve") {
      approve = true
    } else if (arg === "--dry-run") {
      dryRun = true
    } else if (arg === "--limit") {
      limit = positiveInt(requireValue(argv[++i], "--limit"), "--limit")
    } else if (arg === "--output") {
      outputPath = requireValue(argv[++i], "--output")
    } else if (arg === "--json") {
      json = true
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }

  if (!toNovel) throw new Error("--to-novel is required")
  if (fromNovels.length === 0 && proposalIds.length === 0) {
    throw new Error("--from-novel or --proposal-id is required")
  }
  if (!allApproved && proposalIds.length === 0) {
    throw new Error("--all-approved is required when replaying by --from-novel")
  }
  return {
    fromNovels,
    toNovel,
    proposalIds,
    allApproved,
    approve,
    dryRun,
    limit,
    outputPath,
    json,
  }
}

export function effectivePlanningEditPayload(row: Pick<ProposalRow, "payload" | "modified_payload">): PlanningEditPayload {
  const raw = row.modified_payload ?? row.payload
  const value = typeof raw === "string" ? JSON.parse(raw) : raw
  return planningEditPayloadSchema.parse(value)
}

export function createPlanningProposalBodyForReplay(
  source: PlanningEditReplaySource,
): Record<string, unknown> {
  return {
    action: source.payload.action,
    target: source.payload.target,
    proposedValue: source.payload.proposedValue,
    rationale: `Replay approved planning edit ${source.id} from ${source.novelId}.`,
    source: {
      agent: "planning-edit-replay",
      parentEnvelopeId: source.id,
      userMessage: `replaySourceNovel=${source.novelId}; replaySourceProposal=${source.id}`,
    },
    evidence: [{
      kind: "structured",
      ref: `proposal_envelopes:${source.id}`,
      text: JSON.stringify({
        replaySourceNovel: source.novelId,
        replaySourceProposal: source.id,
        sourceStatus: source.status,
        sourceTarget: source.payload.target,
      }),
    }],
  }
}

async function run(args: PlanningEditReplayArgs): Promise<PlanningEditReplayReport> {
  const sources = await loadReplaySources(args)
  const items: PlanningEditReplayItem[] = []
  for (const source of sources) {
    items.push(await replayOne(args, source))
  }
  return {
    generatedAt: new Date().toISOString(),
    fromNovels: args.fromNovels,
    toNovel: args.toNovel,
    dryRun: args.dryRun,
    approve: args.approve,
    summary: summarize(items, sources.length),
    items,
  }
}

async function loadReplaySources(args: PlanningEditReplayArgs): Promise<PlanningEditReplaySource[]> {
  const rows = args.proposalIds.length > 0
    ? await db`
        SELECT id, novel_id, status, payload, modified_payload
        FROM proposal_envelopes
        WHERE kind = 'planning_edit'
          AND id = ANY(${pgTextArray(args.proposalIds)}::text[])
        ORDER BY created_at ASC
      ` as ProposalRow[]
    : await db`
        SELECT id, novel_id, status, payload, modified_payload
        FROM proposal_envelopes
        WHERE kind = 'planning_edit'
          AND status = 'approved'
          AND novel_id = ANY(${pgTextArray(args.fromNovels)}::text[])
        ORDER BY created_at ASC
        LIMIT ${args.limit}
      ` as ProposalRow[]

  return rows.map((row) => {
    if (row.status !== "approved") {
      throw new Error(`proposal ${row.id} status is ${row.status}; only approved planning_edit proposals can be replayed`)
    }
    return {
      id: row.id,
      novelId: row.novel_id,
      status: row.status,
      payload: effectivePlanningEditPayload(row),
    }
  })
}

async function replayOne(
  args: PlanningEditReplayArgs,
  source: PlanningEditReplaySource,
): Promise<PlanningEditReplayItem> {
  const base = {
    sourceProposalId: source.id,
    sourceNovelId: source.novelId,
    action: source.payload.action,
    target: source.payload.target,
    dryRun: args.dryRun,
  }

  try {
    await previewPlanningImpact(args.toNovel, source.payload.target)
  } catch (err) {
    return {
      ...base,
      targetAvailable: false,
      createdProposalId: null,
      approved: false,
      ok: false,
      error: `target unavailable: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (args.dryRun) {
    return {
      ...base,
      targetAvailable: true,
      createdProposalId: null,
      approved: false,
      ok: true,
      error: null,
    }
  }

  const createResponse = await invokePlanningProposal(
    "POST",
    `/api/novel/${encodeURIComponent(args.toNovel)}/planning-proposals`,
    createPlanningProposalBodyForReplay(source),
  )
  const createBody = await createResponse.json().catch((err) => ({ ok: false, error: String(err) }))
  const createdProposalId = stringValue(createBody?.envelope?.id)
  if (!createResponse.ok || createBody?.ok === false || !createdProposalId) {
    return {
      ...base,
      targetAvailable: true,
      createdProposalId,
      approved: false,
      ok: false,
      error: stringValue(createBody?.error ?? createResponse.statusText) ?? "proposal creation failed",
    }
  }

  if (!args.approve) {
    return {
      ...base,
      targetAvailable: true,
      createdProposalId,
      approved: false,
      ok: true,
      error: null,
    }
  }

  const resolveResponse = await invokePlanningProposal(
    "POST",
    `/api/novel/${encodeURIComponent(args.toNovel)}/planning-proposals/${encodeURIComponent(createdProposalId)}/resolve`,
    {
      status: "approved",
      resolvedBy: "script",
      operatorNote: `Approved by planning-edit-replay from ${source.id}.`,
    },
  )
  const resolveBody = await resolveResponse.json().catch((err) => ({ ok: false, error: String(err) }))
  return {
    ...base,
    targetAvailable: true,
    createdProposalId,
    approved: resolveResponse.ok && resolveBody?.ok !== false,
    ok: resolveResponse.ok && resolveBody?.ok !== false,
    error: resolveResponse.ok && resolveBody?.ok !== false
      ? null
      : stringValue(resolveBody?.error ?? resolveResponse.statusText) ?? "proposal approval failed",
  }
}

export function renderReport(report: PlanningEditReplayReport): string {
  const lines: string[] = []
  lines.push("# Planning Edit Replay")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`From novels: ${report.fromNovels.length > 0 ? report.fromNovels.join(", ") : "(explicit proposals)"}`)
  lines.push(`To novel: ${report.toNovel}`)
  lines.push(`Dry run: ${report.dryRun}`)
  lines.push(`Approve: ${report.approve}`)
  lines.push("")
  lines.push("## Summary")
  lines.push(`- requested: ${report.summary.requested}`)
  lines.push(`- replayable: ${report.summary.replayable}`)
  lines.push(`- created: ${report.summary.created}`)
  lines.push(`- approved: ${report.summary.approved}`)
  lines.push(`- errors: ${report.summary.errors}`)
  lines.push("")
  lines.push("## Items")
  for (const item of report.items) {
    const target = `${item.target.kind}:${item.target.ref}:${"fieldPath" in item.target ? item.target.fieldPath : ""}`
    const suffix = item.error ? ` error=${item.error}` : item.createdProposalId ? ` proposal=${item.createdProposalId}` : ""
    lines.push(`- ${item.sourceProposalId} ${item.action} ${target} ok=${item.ok}${suffix}`)
  }
  return `${lines.join("\n")}\n`
}

function summarize(
  items: readonly PlanningEditReplayItem[],
  requested: number,
): PlanningEditReplayReport["summary"] {
  return {
    requested,
    replayable: items.filter(item => item.targetAvailable).length,
    created: items.filter(item => item.createdProposalId).length,
    approved: items.filter(item => item.approved).length,
    errors: items.filter(item => !item.ok).length,
  }
}

async function invokePlanningProposal(method: string, path: string, body: unknown): Promise<Response> {
  const url = new URL(`http://localhost${path}`)
  const response = await handlePlanningProposalRoute(new Request(url, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }), url)
  if (!response) throw new Error(`Planning proposal route did not handle ${method} ${path}`)
  return response
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

function pgTextArray(values: readonly string[]): string {
  return `{${values.map(value => `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`).join(",")}}`
}

function writeOutput(path: string, content: string): void {
  const abs = resolve(path)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

async function closeDb(): Promise<void> {
  await db.end().catch(() => {})
}

async function main(): Promise<number> {
  let args: PlanningEditReplayArgs
  try {
    args = parseArgs()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/planning-edit-replay.ts --to-novel <id> (--proposal-id <id>... | --from-novel <id> --all-approved) [--approve] [--dry-run] [--output <path>] [--json]")
    return 2
  }

  try {
    const report = await run(args)
    const content = args.json ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report)
    if (args.outputPath) writeOutput(args.outputPath, content)
    console.log(content)
    return report.summary.errors > 0 ? 1 : 0
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

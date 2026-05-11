import { z } from "zod"
import {
  PLAN_READINESS_IMPORTER_KINDS,
  PLAN_READINESS_OPERATOR_DISPOSITIONS,
  PLAN_READINESS_STATUSES,
  readinessTargetKey,
  type PlanReadinessStatus,
  type PlanReadinessTargetKind,
} from "../harness/plan-readiness"
import {
  importPlanReadinessAggregateForNovel,
  loadReadinessTargetVersions,
  targetVersionsForStaleness,
} from "../harness/plan-readiness-import"
import {
  findPlanReadinessItem,
  listPlanReadinessItems,
  markStalePlanReadinessItems,
  updatePlanReadinessDisposition,
  type PlanReadinessItem,
} from "../db/plan-readiness"
import { PlanningTargetLookupError } from "../harness/planning-targets"
import { loadPlanReadinessOutcomeReport } from "../harness/plan-readiness-outcomes"
import { handlePlanningProposalRoute } from "./planning-proposal-routes"

const statusSchema = z.enum(PLAN_READINESS_STATUSES)
const statusQuerySchema = z.union([statusSchema, z.literal("all")])

const importBodySchema = z.object({
  aggregate: z.unknown(),
  importedByKind: z.enum(PLAN_READINESS_IMPORTER_KINDS).optional(),
  importedByRef: z.string().optional(),
  refreshStaleness: z.boolean().optional().default(true),
})

const dispositionBodySchema = z
  .object({
    status: statusSchema,
    operatorDisposition: z.enum(PLAN_READINESS_OPERATOR_DISPOSITIONS).nullable().optional(),
    operatorNote: z.string().nullable().optional(),
    proposalEnvelopeId: z.string().nullable().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.status === "proposal_created" && !body.proposalEnvelopeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["proposalEnvelopeId"],
        message: "proposalEnvelopeId is required when status === \"proposal_created\"",
      })
    }
  })

const createPlanningProposalBodySchema = z.object({
  action: z.enum(["field_replace", "beat_replace", "beat_reorder", "scene_select", "beat_requirement_remove"]).optional(),
  proposedValue: z.unknown().optional(),
  useCandidate: z.boolean().optional().default(false),
  operatorNote: z.string().nullable().optional(),
  rationale: z.string().optional(),
})

type ReadinessProposalAction = "field_replace" | "beat_replace" | "beat_reorder" | "scene_select" | "beat_requirement_remove"

export async function handlePlanReadinessRoute(
  req: Request,
  url: URL,
): Promise<Response | null> {
  const listMatch = /^\/api\/novel\/([^/]+)\/plan-readiness\/?$/.exec(url.pathname)
  if (listMatch) {
    const novelId = decodeURIComponent(listMatch[1]!)
    if (req.method === "GET") return handleListPlanReadiness(url, novelId)
    return new Response("Method not allowed", { status: 405 })
  }

  const importMatch = /^\/api\/novel\/([^/]+)\/plan-readiness\/import\/?$/.exec(url.pathname)
  if (importMatch) {
    const novelId = decodeURIComponent(importMatch[1]!)
    if (req.method === "POST") return handleImportPlanReadiness(req, novelId)
    return new Response("Method not allowed", { status: 405 })
  }

  const refreshMatch = /^\/api\/novel\/([^/]+)\/plan-readiness\/refresh-staleness\/?$/.exec(url.pathname)
  if (refreshMatch) {
    const novelId = decodeURIComponent(refreshMatch[1]!)
    if (req.method === "POST") return handleRefreshPlanReadinessStaleness(novelId)
    return new Response("Method not allowed", { status: 405 })
  }

  const outcomesMatch = /^\/api\/novel\/([^/]+)\/plan-readiness\/outcomes\/?$/.exec(url.pathname)
  if (outcomesMatch) {
    const novelId = decodeURIComponent(outcomesMatch[1]!)
    if (req.method === "GET") return handlePlanReadinessOutcomes(url, novelId)
    return new Response("Method not allowed", { status: 405 })
  }

  const createProposalMatch =
    /^\/api\/novel\/([^/]+)\/plan-readiness\/([^/]+)\/create-planning-proposal\/?$/.exec(url.pathname)
  if (createProposalMatch) {
    const novelId = decodeURIComponent(createProposalMatch[1]!)
    const itemId = decodeURIComponent(createProposalMatch[2]!)
    if (req.method === "POST") return handleCreatePlanningProposalFromReadiness(req, novelId, itemId)
    return new Response("Method not allowed", { status: 405 })
  }

  const itemMatch = /^\/api\/novel\/([^/]+)\/plan-readiness\/([^/]+)\/?$/.exec(url.pathname)
  if (itemMatch) {
    const novelId = decodeURIComponent(itemMatch[1]!)
    const itemId = decodeURIComponent(itemMatch[2]!)
    if (req.method === "GET") return handleGetPlanReadinessItem(novelId, itemId)
    return new Response("Method not allowed", { status: 405 })
  }

  const dispositionMatch =
    /^\/api\/novel\/([^/]+)\/plan-readiness\/([^/]+)\/disposition\/?$/.exec(url.pathname)
  if (dispositionMatch) {
    const novelId = decodeURIComponent(dispositionMatch[1]!)
    const itemId = decodeURIComponent(dispositionMatch[2]!)
    if (req.method === "POST") return handlePlanReadinessDisposition(req, novelId, itemId)
    return new Response("Method not allowed", { status: 405 })
  }

  return null
}

async function handleListPlanReadiness(url: URL, novelId: string): Promise<Response> {
  const statusRaw = url.searchParams.get("status") ?? "open"
  const parsedStatus = statusQuerySchema.safeParse(statusRaw)
  if (!parsedStatus.success) {
    return Response.json(
      { ok: false, error: "invalid status", validStatuses: ["all", ...PLAN_READINESS_STATUSES] },
      { status: 400 },
    )
  }
  const limit = parseLimit(url.searchParams.get("limit"), 200)
  const targetRef = url.searchParams.get("targetRef") ?? undefined
  try {
    const items = await listPlanReadinessItems(novelId, {
      status: parsedStatus.data,
      limit,
      targetRef,
    })
    return Response.json({ ok: true, novelId, items })
  } catch (err) {
    return planReadinessErrorResponse(err, "plan-readiness list failed")
  }
}

async function handleGetPlanReadinessItem(novelId: string, itemId: string): Promise<Response> {
  try {
    const item = await findPlanReadinessItem(novelId, itemId)
    if (!item) return Response.json({ ok: false, error: "readiness item not found" }, { status: 404 })
    return Response.json({ ok: true, novelId, item })
  } catch (err) {
    return planReadinessErrorResponse(err, "plan-readiness lookup failed")
  }
}

async function handleImportPlanReadiness(req: Request, novelId: string): Promise<Response> {
  let body: z.infer<typeof importBodySchema>
  try {
    const parsed = importBodySchema.safeParse(await req.json())
    if (!parsed.success) return invalidBody(parsed.error)
    body = parsed.data
  } catch (err) {
    return Response.json({ ok: false, error: `malformed json: ${String(err)}` }, { status: 400 })
  }

  try {
    const result = await importPlanReadinessAggregateForNovel({
      novelId,
      aggregate: body.aggregate,
      importedByKind: body.importedByKind ?? "script",
      importedByRef: body.importedByRef ?? null,
      refreshStaleness: body.refreshStaleness,
    })
    return Response.json({
      ok: true,
      novelId,
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
      items: result.items,
    })
  } catch (err) {
    return planReadinessErrorResponse(err, "plan-readiness import failed")
  }
}

async function handleRefreshPlanReadinessStaleness(novelId: string): Promise<Response> {
  try {
    const targetVersions = await loadReadinessTargetVersions(novelId)
    const result = await markStalePlanReadinessItems(novelId, targetVersionsForStaleness(targetVersions))
    return Response.json({ ok: true, novelId, ...result })
  } catch (err) {
    return planReadinessErrorResponse(err, "plan-readiness staleness refresh failed")
  }
}

async function handlePlanReadinessOutcomes(url: URL, novelId: string): Promise<Response> {
  const limit = parseLimit(url.searchParams.get("limit"), 200)
  try {
    const report = await loadPlanReadinessOutcomeReport(novelId, { limit })
    return Response.json(report)
  } catch (err) {
    return planReadinessErrorResponse(err, "plan-readiness outcome report failed")
  }
}

async function handlePlanReadinessDisposition(
  req: Request,
  novelId: string,
  itemId: string,
): Promise<Response> {
  let body: z.infer<typeof dispositionBodySchema>
  try {
    const parsed = dispositionBodySchema.safeParse(await req.json())
    if (!parsed.success) return invalidBody(parsed.error)
    body = parsed.data
  } catch (err) {
    return Response.json({ ok: false, error: `malformed json: ${String(err)}` }, { status: 400 })
  }

  try {
    const item = await updatePlanReadinessDisposition({
      id: itemId,
      novelId,
      status: body.status,
      operatorDisposition: body.operatorDisposition ?? dispositionForStatus(body.status),
      operatorNote: body.operatorNote ?? null,
      proposalEnvelopeId: body.proposalEnvelopeId ?? null,
    })
    if (!item) return Response.json({ ok: false, error: "readiness item not found" }, { status: 404 })
    return Response.json({ ok: true, novelId, item })
  } catch (err) {
    return planReadinessErrorResponse(err, "plan-readiness disposition failed")
  }
}

async function handleCreatePlanningProposalFromReadiness(
  req: Request,
  novelId: string,
  itemId: string,
): Promise<Response> {
  let body: z.infer<typeof createPlanningProposalBodySchema>
  try {
    const raw = await req.json()
    const useCandidateRequested = raw !== null &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      (raw as { useCandidate?: unknown }).useCandidate === true
    if (!hasOwn(raw, "proposedValue") && !useCandidateRequested) {
      return Response.json(
        {
          ok: false,
          error: "proposedValue is required to create a planning proposal from readiness review",
        },
        { status: 400 },
      )
    }
    const parsed = createPlanningProposalBodySchema.safeParse(raw)
    if (!parsed.success) return invalidBody(parsed.error)
    body = parsed.data
  } catch (err) {
    return Response.json({ ok: false, error: `malformed json: ${String(err)}` }, { status: 400 })
  }

  try {
    const item = await findPlanReadinessItem(novelId, itemId)
    if (!item) return Response.json({ ok: false, error: "readiness item not found" }, { status: 404 })
    if (item.status === "proposal_created" && item.proposalEnvelopeId) {
      return Response.json(
        {
          ok: false,
          error: "readiness item already has a planning proposal",
          readinessItemId: item.id,
          proposalEnvelopeId: item.proposalEnvelopeId,
        },
        { status: 409 },
      )
    }
    if (item.status !== "open" && item.status !== "deferred") {
      return Response.json(
        {
          ok: false,
          error: "readiness item is not open for proposal creation",
          readinessItemId: item.id,
          status: item.status,
        },
        { status: 409 },
      )
    }
    const candidate = readinessProposalCandidate(item)
    const effectiveAction = body.action ?? candidate?.action ?? "field_replace"
    const effectiveProposedValue = hasOwn(body, "proposedValue")
      ? body.proposedValue
      : body.useCandidate && candidate && hasOwn(candidate, "proposedValue")
        ? candidate.proposedValue
        : undefined
    if (effectiveProposedValue === undefined) {
      return Response.json(
        {
          ok: false,
          error: "proposedValue is required to create a planning proposal from readiness review",
          readinessItemId: item.id,
          candidateAvailable: Boolean(candidate),
        },
        { status: 400 },
      )
    }
    if (body.useCandidate && candidate?.target && !sameReadinessTarget(candidate.target, item.target)) {
      return Response.json(
        {
          ok: false,
          error: "readiness proposal candidate target does not match item target",
          readinessItemId: item.id,
          target: item.target,
          candidateTarget: candidate.target,
        },
        { status: 409 },
      )
    }

    if (
      effectiveAction === "beat_requirement_remove" &&
      item.target.kind !== "beat_plan" &&
      item.target.kind !== "scene_plan"
    ) {
      return Response.json(
        {
          ok: false,
          error: "beat_requirement_remove readiness proposals require a scene_plan or beat_plan target",
          readinessItemId: item.id,
          target: item.target,
        },
        { status: 400 },
      )
    }
    if (
      effectiveAction === "beat_replace" &&
      item.target.kind !== "beat_plan" &&
      item.target.kind !== "scene_plan"
    ) {
      return Response.json(
        {
          ok: false,
          error: "beat_replace readiness proposals require a scene_plan or beat_plan target",
          readinessItemId: item.id,
          target: item.target,
        },
        { status: 400 },
      )
    }
    if (
      (effectiveAction === "beat_reorder" || effectiveAction === "scene_select") &&
      item.target.kind !== "chapter_outline"
    ) {
      return Response.json(
        {
          ok: false,
          error: `${effectiveAction} readiness proposals require a chapter_outline target`,
          readinessItemId: item.id,
          target: item.target,
        },
        { status: 400 },
      )
    }
    if (item.sourceHashKind === "target_current_version") {
      const targetVersions = await loadReadinessTargetVersions(novelId)
      const currentVersion = targetVersions.get(readinessTargetKey(item.target))
      if (!currentVersion) {
        return Response.json(
          { ok: false, error: "readiness target not found", readinessItemId: item.id },
          { status: 404 },
        )
      }
      if (currentVersion !== item.sourceHash) {
        await markStalePlanReadinessItems(novelId, [{
          targetKind: item.target.kind,
          targetRef: item.target.ref,
          sourceHash: currentVersion,
        }])
        return Response.json(
          {
            ok: false,
            error: "stale-readiness-item",
            readinessItemId: item.id,
            expectedSourceHash: item.sourceHash,
            actualSourceHash: currentVersion,
          },
          { status: 409 },
        )
      }
    }

    const createUrl = new URL(`http://localhost/api/novel/${encodeURIComponent(novelId)}/planning-proposals`)
    const proposalTarget = effectiveAction === "beat_requirement_remove"
      ? { kind: item.target.kind as "scene_plan" | "beat_plan", ref: item.target.ref, fieldPath: "requirements" as const }
      : effectiveAction === "beat_replace"
        ? { kind: item.target.kind as "scene_plan" | "beat_plan", ref: item.target.ref, fieldPath: "self" as const }
        : effectiveAction === "beat_reorder" || effectiveAction === "scene_select"
          ? { kind: "chapter_outline" as const, ref: item.target.ref, fieldPath: "scenes" as const }
          : item.target
    const planningBody = {
      action: effectiveAction,
      target: proposalTarget,
      proposedValue: effectiveProposedValue,
      rationale: body.rationale ?? readinessProposalRationale(item, body.operatorNote ?? null),
      source: {
        agent: "plan-readiness-review",
        userMessage: readinessProposalUserMessage(item, body.operatorNote ?? null),
      },
      evidence: readinessProposalEvidence(item, body.operatorNote ?? null),
    }
    const proposalResponse = await handlePlanningProposalRoute(
      new Request(createUrl, {
        method: "POST",
        body: JSON.stringify(planningBody),
        headers: { "content-type": "application/json" },
      }),
      createUrl,
    )
    if (!proposalResponse) {
      return Response.json(
        { ok: false, error: "planning proposal route did not handle readiness bridge request" },
        { status: 500 },
      )
    }
    const proposalBody = await proposalResponse.json()
    if (!proposalResponse.ok || proposalBody.ok === false) {
      return Response.json(
        {
          ...proposalBody,
          readinessItemId: item.id,
        },
        { status: proposalResponse.status },
      )
    }
    const envelopeId = proposalBody.envelope?.id
    if (typeof envelopeId !== "string" || envelopeId.length === 0) {
      return Response.json(
        { ok: false, error: "planning proposal response missing envelope id", readinessItemId: item.id },
        { status: 500 },
      )
    }

    const updated = await updatePlanReadinessDisposition({
      id: item.id,
      novelId,
      status: "proposal_created",
      operatorDisposition: "real_issue",
      operatorNote: body.operatorNote ?? null,
      proposalEnvelopeId: envelopeId,
    })
    return Response.json({
      ok: true,
      novelId,
      readinessItem: updated,
      proposal: proposalBody,
    })
  } catch (err) {
    return planReadinessErrorResponse(err, "plan-readiness proposal bridge failed")
  }
}

function dispositionForStatus(status: PlanReadinessStatus) {
  if (status === "accepted_as_is") return "acceptable_choice"
  if (status === "not_applicable") return "not_applicable"
  if (status === "deferred") return "defer_to_drafting"
  if (status === "fixed") return "fixed"
  if (status === "proposal_created") return "real_issue"
  return null
}

function parseLimit(raw: string | null, fallback: number): number {
  if (raw == null) return fallback
  if (!/^\d+$/.test(raw)) return fallback
  return Math.min(Math.max(parseInt(raw, 10), 1), 500)
}

function readinessProposalRationale(item: PlanReadinessItem, operatorNote: string | null): string {
  return [
    `Plan Readiness Review marked ${item.diagnosticLabel} on ${item.target.kind}:${item.target.ref}.`,
    `Fix intent: ${item.fixIntent}.`,
    `Diagnostic: ${item.explanation}`,
    item.missingForNextLevel ? `Missing for next level: ${item.missingForNextLevel}` : "",
    operatorNote ? `Operator note: ${operatorNote}` : "",
    `Preserve IDs: ${JSON.stringify(item.preserveIds)}`,
  ].filter(Boolean).join("\n")
}

function readinessProposalUserMessage(item: PlanReadinessItem, operatorNote: string | null): string {
  return [
    `readinessItemId=${item.id}`,
    `dimension=${item.dimension}`,
    `label=${item.diagnosticLabel}`,
    `fixIntent=${item.fixIntent}`,
    operatorNote ? `operatorNote=${operatorNote}` : "",
  ].filter(Boolean).join("; ")
}

function readinessProposalEvidence(item: PlanReadinessItem, operatorNote: string | null) {
  return [
    {
      kind: "structured" as const,
      ref: `plan_readiness_items:${item.id}`,
      text: JSON.stringify({
        readinessItemId: item.id,
        dimension: item.dimension,
        diagnosticLabel: item.diagnosticLabel,
        fixIntent: item.fixIntent,
        severity: item.severity,
        explanation: item.explanation,
        missingForNextLevel: item.missingForNextLevel,
        preserveIds: item.preserveIds,
        evidence: item.evidence,
        operatorNote,
      }),
    },
  ]
}

function readinessProposalCandidate(item: PlanReadinessItem): {
  action?: ReadinessProposalAction
  target?: { kind: PlanReadinessTargetKind; ref: string; fieldPath?: string }
  proposedValue?: unknown
} | null {
  const raw = item.metadata.proposalCandidate
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const action = record.action === "field_replace" ||
    record.action === "beat_replace" ||
    record.action === "beat_reorder" ||
    record.action === "scene_select" ||
    record.action === "beat_requirement_remove"
    ? record.action
    : undefined
  const target = normalizeCandidateTarget(record.target)
  return {
    ...(action ? { action } : {}),
    ...(target ? { target } : {}),
    ...(hasOwn(record, "proposedValue") ? { proposedValue: record.proposedValue } : {}),
  }
}

function normalizeCandidateTarget(raw: unknown): { kind: PlanReadinessTargetKind; ref: string; fieldPath?: string } | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const kind = record.kind
  const ref = record.ref
  const fieldPath = record.fieldPath
  if ((kind !== "chapter_outline" && kind !== "scene_plan" && kind !== "beat_plan") || typeof ref !== "string" || !ref) {
    return undefined
  }
  return {
    kind,
    ref,
    ...(typeof fieldPath === "string" && fieldPath.length > 0 ? { fieldPath } : {}),
  }
}

function sameReadinessTarget(
  a: { kind: PlanReadinessTargetKind; ref: string; fieldPath?: string },
  b: { kind: PlanReadinessTargetKind; ref: string; fieldPath?: string },
): boolean {
  return a.kind === b.kind && a.ref === b.ref && (a.fieldPath ?? "") === (b.fieldPath ?? "")
}

function hasOwn(value: unknown, key: string): boolean {
  return value !== null &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, key)
}

function invalidBody(error: z.ZodError): Response {
  return Response.json(
    {
      ok: false,
      error: "invalid request body",
      issues: error.issues.map(issue => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    { status: 400 },
  )
}

function planReadinessErrorResponse(err: unknown, prefix: string): Response {
  if (err instanceof PlanningTargetLookupError) {
    return Response.json({ ok: false, error: err.message }, { status: err.status })
  }
  return Response.json(
    { ok: false, error: `${prefix}: ${String(err)}` },
    { status: 500 },
  )
}

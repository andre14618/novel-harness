import { z } from "zod"
import {
  buildPlanReadinessDraftsFromAggregate,
  PLAN_READINESS_IMPORTER_KINDS,
  PLAN_READINESS_OPERATOR_DISPOSITIONS,
  PLAN_READINESS_STATUSES,
  readinessTargetKey,
  type PlanReadinessStatus,
  type PlanReadinessTargetKind,
} from "../harness/plan-readiness"
import {
  findPlanReadinessItem,
  listPlanReadinessItems,
  markStalePlanReadinessItems,
  updatePlanReadinessDisposition,
  upsertPlanReadinessItems,
  type PlanReadinessItem,
} from "../db/plan-readiness"
import { loadPlanningTargetMap, PlanningTargetLookupError } from "../harness/planning-targets"
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
  proposedValue: z.unknown().optional(),
  operatorNote: z.string().nullable().optional(),
  rationale: z.string().optional(),
})

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
    const targetVersions = await loadReadinessTargetVersions(novelId)
    if (body.refreshStaleness) {
      await markStalePlanReadinessItems(novelId, targetVersionsForStaleness(targetVersions))
    }
    const built = buildPlanReadinessDraftsFromAggregate({
      novelId,
      aggregate: body.aggregate,
      targetVersions,
      importedByKind: body.importedByKind ?? "script",
      importedByRef: body.importedByRef ?? null,
    })
    const result = await upsertPlanReadinessItems(built.drafts)
    return Response.json({
      ok: true,
      novelId,
      inserted: result.inserted,
      updated: result.updated,
      skipped: built.skipped,
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
    if (!hasOwn(raw, "proposedValue")) {
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
    const planningBody = {
      action: "field_replace",
      target: item.target,
      proposedValue: body.proposedValue,
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

async function loadReadinessTargetVersions(novelId: string): Promise<Map<string, string>> {
  const map = await loadPlanningTargetMap(novelId)
  const out = new Map<string, string>()
  for (const target of map.targets) {
    if (target.kind === "chapter_outline" || target.kind === "beat_plan") {
      out.set(readinessTargetKey({ kind: target.kind, ref: target.ref }), target.currentVersion)
    }
  }
  return out
}

function targetVersionsForStaleness(
  targetVersions: Map<string, string>,
): Array<{ targetKind: PlanReadinessTargetKind; targetRef: string; sourceHash: string }> {
  const out: Array<{ targetKind: PlanReadinessTargetKind; targetRef: string; sourceHash: string }> = []
  for (const [key, sourceHash] of targetVersions.entries()) {
    const [targetKind, ...rest] = key.split(":")
    if (targetKind !== "chapter_outline" && targetKind !== "beat_plan") continue
    out.push({ targetKind, targetRef: rest.join(":"), sourceHash })
  }
  return out
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

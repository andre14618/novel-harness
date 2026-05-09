import { z } from "zod"
import {
  loadPlanningTargetMap,
  previewPlanningImpact,
  PLANNING_TARGET_KINDS,
  PlanningTargetLookupError,
} from "../harness/planning-targets"

const targetKindSchema = z.enum(PLANNING_TARGET_KINDS)

const impactPreviewBodySchema = z.object({
  target: z.object({
    kind: targetKindSchema,
    ref: z.string().min(1),
    fieldPath: z.string().min(1).optional(),
  }),
})

export async function handlePlanningTargetRoute(
  req: Request,
  url: URL,
): Promise<Response | null> {
  const path = url.pathname

  const listMatch = path.match(/^\/api\/novel\/([^/]+)\/planning-targets$/)
  if (listMatch && req.method === "GET") {
    const novelId = decodeURIComponent(listMatch[1])
    try {
      const map = await loadPlanningTargetMap(novelId)
      return Response.json(map)
    } catch (err) {
      return planningTargetErrorResponse(err, "planning-targets failed")
    }
  }

  const targetMatch = path.match(/^\/api\/novel\/([^/]+)\/planning-targets\/([^/]+)\/([^/]+)$/)
  if (targetMatch && req.method === "GET") {
    const novelId = decodeURIComponent(targetMatch[1])
    const kind = decodeURIComponent(targetMatch[2])
    const ref = decodeURIComponent(targetMatch[3])
    const parsedKind = targetKindSchema.safeParse(kind)
    if (!parsedKind.success) {
      return Response.json(
        {
          ok: false,
          error: "invalid target kind",
          validKinds: PLANNING_TARGET_KINDS,
        },
        { status: 400 },
      )
    }
    try {
      const map = await loadPlanningTargetMap(novelId)
      const target = map.targets.find((candidate) =>
        planningTargetKindsSameArtifact(candidate.kind, parsedKind.data) && candidate.ref === ref
      )
      if (!target) {
        return Response.json(
          { ok: false, error: `planning target not found: ${kind}:${ref}` },
          { status: 404 },
        )
      }
      return Response.json({
        ok: true,
        novelId,
        planningSnapshotVersion: map.planningSnapshotVersion,
        planningSnapshotHash: map.planningSnapshotHash,
        target,
      })
    } catch (err) {
      return planningTargetErrorResponse(err, "planning-target lookup failed")
    }
  }

  const previewMatch = path.match(/^\/api\/novel\/([^/]+)\/planning-impact\/preview$/)
  if (previewMatch && req.method === "POST") {
    const novelId = decodeURIComponent(previewMatch[1])
    let body: z.infer<typeof impactPreviewBodySchema>
    try {
      const raw = await req.json()
      const parsed = impactPreviewBodySchema.safeParse(raw)
      if (!parsed.success) {
        return Response.json(
          {
            ok: false,
            error: "invalid request body",
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
          { status: 400 },
        )
      }
      body = parsed.data
    } catch (err) {
      return Response.json({ ok: false, error: `malformed json: ${String(err)}` }, { status: 400 })
    }

    try {
      const preview = await previewPlanningImpact(novelId, body.target)
      return Response.json(preview)
    } catch (err) {
      return planningTargetErrorResponse(err, "planning-impact preview failed")
    }
  }

  return null
}

function planningTargetKindsSameArtifact(a: string, b: string): boolean {
  return (
    a === b ||
    ((a === "scene_plan" || a === "beat_plan") && (b === "scene_plan" || b === "beat_plan"))
  )
}

function planningTargetErrorResponse(err: unknown, prefix: string): Response {
  if (err instanceof PlanningTargetLookupError) {
    return Response.json({ ok: false, error: err.message }, { status: err.status })
  }
  return Response.json(
    { ok: false, error: `${prefix}: ${String(err)}` },
    { status: 500 },
  )
}

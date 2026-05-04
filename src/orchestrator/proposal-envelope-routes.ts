/**
 * Proposal Envelope Resolve API.
 *
 * Charter: docs/charters/world-bible-architecture.md
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 3 — Artifact Patch Proposal Cards"
 *
 * Phase 3 commit 2 — per-patch approve / reject / modify route. The /adjust
 * route from Phase 3 commit 1 returns `proposalEnvelopes` alongside the
 * legacy `proposedPatches` list. This route lets the operator resolve
 * each envelope independently:
 *
 *   POST /api/novel/:novelId/proposal-envelopes/resolve
 *     Body: {
 *       envelope:        ArtifactPatchEnvelope (full envelope from /adjust),
 *       status:          "approved" | "rejected" | "modified",
 *       modifiedPayload?: AdjusterPatch (required when status === "modified"),
 *       operatorNote?:   string,
 *     }
 *
 * Behavior:
 *   - Validates the body shape; missing modifiedPayload on a `modified`
 *     resolution is a 400.
 *   - Recomputes the live artifact hash via `stableHash(canonicalize(...))`
 *     and compares against `envelope.target.currentVersion`. A mismatch is
 *     409 — the artifact moved under the operator's feet, the patch is
 *     stale and would overwrite a newer human edit. Per Phase 3 acceptance
 *     §"Stale patches cannot overwrite newer human edits".
 *   - On `rejected`: no-op. Returns `{ ok: true, applied: false }`.
 *   - On `approved`: applies `envelope.payload` (the original AdjusterPatch).
 *   - On `modified`: applies `modifiedPayload` instead. The modified payload
 *     MUST target the same artifact (e.g., same characterId for character
 *     patches) — defense against switching target via modify (would let an
 *     operator edit one character while pretending to approve a patch on
 *     another).
 *   - Returns the new artifact hash so the UI can refresh its
 *     `target.currentVersion` snapshot without re-fetching the artifact.
 *
 * Persistence is NOT in scope for this commit (Phase 3 commit 4). The
 * envelope is body-carried; the route is stateless from the substrate's
 * perspective. That keeps the contract narrow: this commit ships the
 * resolve mechanics + precondition guard and nothing else.
 */

import { z } from "zod"
import { stableHash } from "../canon/proposal-envelope"
import { adjusterPatchSchema } from "../agents/artifact-adjuster/schema"
import type { AdjusterPatch } from "../agents/artifact-adjuster/schema"

const targetRefSchema = z.object({
  kind: z.enum([
    "planning_directive",
    "world_bible",
    "character",
    "story_spine",
    "chapter_outline",
    "canon_fact",
    "prose_span",
  ]),
  ref: z.string(),
  fieldPath: z.string().optional(),
  currentVersion: z.string(),
})

const sourceRefSchema = z.object({
  agent: z.string(),
  userMessage: z.string().optional(),
  parentEnvelopeId: z.string().optional(),
})

const evidenceSchema = z.object({
  kind: z.enum(["quote", "structured", "link"]),
  text: z.string(),
  ref: z.string().optional(),
})

const policyRecommendationSchema = z.object({
  decision: z.enum(["queue", "shadow", "auto-apply"]),
  reasons: z.array(z.string()),
})

const preconditionSchema = z.object({
  kind: z.enum(["artifact_hash", "snapshot_hash", "draft_hash", "canon_generation"]),
  hash: z.string(),
})

const envelopeSchema = z.object({
  id: z.string(),
  kind: z.literal("artifact_patch"),
  novelId: z.string(),
  target: targetRefSchema,
  source: sourceRefSchema,
  status: z.string(),
  risk: z.enum(["mechanical", "low", "medium", "high"]),
  summary: z.string(),
  rationale: z.string(),
  evidence: z.array(evidenceSchema),
  payload: adjusterPatchSchema,
  precondition: preconditionSchema,
  policyRecommendation: policyRecommendationSchema,
  createdAt: z.string(),
})

const resolveBodySchema = z
  .object({
    envelope: envelopeSchema,
    status: z.enum(["approved", "rejected", "modified"]),
    modifiedPayload: adjusterPatchSchema.optional(),
    operatorNote: z.string().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.status === "modified" && body.modifiedPayload === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modifiedPayload"],
        message: "modifiedPayload is required when status === \"modified\"",
      })
    }
  })

type ResolveBody = z.infer<typeof resolveBodySchema>

function patchTargetsSameArtifact(a: AdjusterPatch, b: AdjusterPatch): boolean {
  // Patches must agree on which artifact they touch. Per-type:
  //   characterUpdate / characterRename → same characterId
  //   worldUpdate → both must be worldUpdate (single artifact)
  //   spineUpdate → both must be spineUpdate (single artifact)
  // Cross-type modify (e.g., approve a worldUpdate by submitting a
  // characterUpdate as modifiedPayload) is rejected: a "modify" is meant
  // to refine the same proposal, not to switch targets.
  if (a.type === "characterUpdate" || a.type === "characterRename") {
    if (b.type !== "characterUpdate" && b.type !== "characterRename") return false
    return a.characterId === b.characterId
  }
  if (a.type === "worldUpdate") return b.type === "worldUpdate"
  if (a.type === "spineUpdate") return b.type === "spineUpdate"
  return false
}

interface ApplyResult {
  newVersion: string
}

async function applyPatch(
  novelId: string,
  patch: AdjusterPatch,
): Promise<ApplyResult> {
  const {
    updateCharacterFields,
    updateWorldBibleFields,
    updateStorySpineFields,
    getCharacters,
    getWorldBible,
    getStorySpine,
  } = await import("../db")

  switch (patch.type) {
    case "characterUpdate": {
      const updated = await updateCharacterFields(novelId, patch.characterId, patch.patch as Record<string, unknown>)
      return { newVersion: stableHash(updated) }
    }
    case "characterRename": {
      const updated = await updateCharacterFields(novelId, patch.characterId, { name: patch.newName })
      return { newVersion: stableHash(updated) }
    }
    case "worldUpdate": {
      const updated = await updateWorldBibleFields(novelId, patch.patch as Record<string, unknown>)
      return { newVersion: stableHash(updated) }
    }
    case "spineUpdate": {
      const updated = await updateStorySpineFields(novelId, patch.patch as Record<string, unknown>)
      return { newVersion: stableHash(updated) }
    }
  }
}

async function readLiveTargetVersion(
  novelId: string,
  patch: AdjusterPatch,
): Promise<string | null> {
  const { getCharacters, getWorldBible, getStorySpine } = await import("../db")
  switch (patch.type) {
    case "characterUpdate":
    case "characterRename": {
      const characters = await getCharacters(novelId).catch(() => [] as unknown[])
      const target = (characters as { id?: string }[]).find((c) => c.id === patch.characterId)
      if (!target) return null
      return stableHash(target)
    }
    case "worldUpdate": {
      const world = await getWorldBible(novelId).catch(() => null)
      return stableHash(world)
    }
    case "spineUpdate": {
      const spine = await getStorySpine(novelId).catch(() => null)
      return stableHash(spine)
    }
  }
}

export async function handleProposalEnvelopeRoute(
  req: Request,
  url: URL,
): Promise<Response | null> {
  const path = url.pathname

  const resolveMatch = path.match(/^\/api\/novel\/([^/]+)\/proposal-envelopes\/resolve$/)
  if (resolveMatch && req.method === "POST") {
    const novelId = decodeURIComponent(resolveMatch[1])

    let body: ResolveBody
    try {
      const raw = await req.json()
      const parsed = resolveBodySchema.safeParse(raw)
      if (!parsed.success) {
        return Response.json(
          {
            ok: false,
            error: "invalid request body",
            issues: parsed.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          },
          { status: 400 },
        )
      }
      body = parsed.data
    } catch (err) {
      return Response.json({ ok: false, error: `malformed json: ${String(err)}` }, { status: 400 })
    }

    if (body.envelope.novelId !== novelId) {
      return Response.json(
        {
          ok: false,
          error: "envelope.novelId does not match URL novelId",
          envelopeNovelId: body.envelope.novelId,
          urlNovelId: novelId,
        },
        { status: 400 },
      )
    }

    const patchToApply: AdjusterPatch =
      body.status === "modified" && body.modifiedPayload !== undefined
        ? body.modifiedPayload
        : body.envelope.payload

    if (
      body.status === "modified" &&
      body.modifiedPayload !== undefined &&
      !patchTargetsSameArtifact(body.envelope.payload, body.modifiedPayload)
    ) {
      return Response.json(
        {
          ok: false,
          error:
            "modifiedPayload must target the same artifact as the original envelope payload",
        },
        { status: 400 },
      )
    }

    // Stale-precondition check. We re-derive the live artifact hash and
    // compare to the envelope's snapshot. The precondition.hash field on
    // the envelope mirrors target.currentVersion — checking either is
    // sufficient; we use target.currentVersion since that's the field
    // documented in the design's §Proposal Envelope.
    let actualVersion: string | null
    try {
      actualVersion = await readLiveTargetVersion(novelId, body.envelope.payload)
    } catch (err) {
      return Response.json(
        { ok: false, error: `failed to read live artifact: ${String(err)}` },
        { status: 500 },
      )
    }

    if (actualVersion === null) {
      return Response.json(
        {
          ok: false,
          error: "target artifact missing",
          envelopeId: body.envelope.id,
        },
        { status: 404 },
      )
    }

    if (actualVersion !== body.envelope.target.currentVersion) {
      return Response.json(
        {
          ok: false,
          error: "stale-precondition",
          envelopeId: body.envelope.id,
          expectedVersion: body.envelope.target.currentVersion,
          actualVersion,
        },
        { status: 409 },
      )
    }

    if (body.status === "rejected") {
      return Response.json({
        ok: true,
        envelopeId: body.envelope.id,
        applied: false,
        status: "rejected",
      })
    }

    // approved or modified — apply patchToApply.
    let result: ApplyResult
    try {
      result = await applyPatch(novelId, patchToApply)
    } catch (err) {
      return Response.json(
        { ok: false, error: `apply failed: ${String(err)}`, envelopeId: body.envelope.id },
        { status: 500 },
      )
    }

    return Response.json({
      ok: true,
      envelopeId: body.envelope.id,
      applied: true,
      status: body.status,
      newVersion: result.newVersion,
    })
  }

  return null
}

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
 * Persistence (Phase 3 commit 4 follow-up A): If the envelope was persisted
 * by the /adjust route, this route also writes the resolution status to
 * `proposal_envelopes` *inside the same `db.begin(...)`* as the artifact
 * apply — both either commit together or roll back together. A second
 * resolve attempt on a non-pending envelope row surfaces as 409 +
 * `actualStatus` (independent precondition from the artifact-hash check;
 * catches duplicate rejects that don't move the artifact hash). If the
 * envelope row is missing entirely (e.g., /adjust persistence failed, or
 * the envelope predates this commit), the route degrades gracefully: the
 * artifact apply proceeds and the resolution is logged but not persisted.
 * Body-carry remains the load-bearing path; persistence is an additive
 * audit trail.
 */

import { z } from "zod"
import db from "../db/connection"
import { stableHash } from "../canon/proposal-envelope"
import { adjusterPatchSchema } from "../agents/artifact-adjuster/schema"
import type { AdjusterPatch } from "../agents/artifact-adjuster/schema"
import { findEnvelopeById, updateEnvelopeResolution } from "../db/proposal-envelopes"
import {
  evaluatePolicy,
  type ApprovalPolicy,
  type PolicyEvaluation,
} from "../canon/approval-policy"

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
  decision: z.enum(["queue", "approve", "reject", "shadow"]),
  policyVersion: z.string().optional(),
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
  status: z.enum(["pending", "approved", "rejected", "modified", "shadowed", "expired"]),
  risk: z.enum(["mechanical", "low", "medium", "high"]),
  summary: z.string(),
  rationale: z.string(),
  evidence: z.array(evidenceSchema),
  payload: adjusterPatchSchema,
  precondition: preconditionSchema,
  policyRecommendation: policyRecommendationSchema,
  createdAt: z.string(),
})

const approvalPolicySchema = z.object({
  version: z.string(),
  mode: z.enum(["manual", "assisted", "autonomous", "eval"]),
  autoApproveRiskCeiling: z.enum(["mechanical", "low", "medium", "high"]).optional(),
  manualKinds: z
    .array(z.enum(["artifact_patch", "canon_update", "prose_edit", "editorial_flag"]))
    .optional(),
})

const resolveBodySchema = z
  .object({
    envelope: envelopeSchema,
    status: z.enum(["approved", "rejected", "modified"]),
    modifiedPayload: adjusterPatchSchema.optional(),
    operatorNote: z.string().optional(),
    policy: approvalPolicySchema.optional(),
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

/**
 * Phase 6 commit 2: when no policy is provided, default to manual mode. The
 * design's "manual is the safe default" — every proposal queues for the
 * operator unless the caller passes an explicit autonomous/assisted policy.
 * The version string is opaque; pin "manual-v1" so audit-trail consumers can
 * distinguish "no policy attached" (NULL) from "explicit manual default".
 */
const DEFAULT_MANUAL_POLICY: ApprovalPolicy = {
  version: "manual-v1",
  mode: "manual",
}

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

async function applyPatchTx(
  tx: typeof db,
  novelId: string,
  patch: AdjusterPatch,
): Promise<ApplyResult> {
  const {
    updateCharacterFields,
    updateWorldBibleFields,
    updateStorySpineFields,
  } = await import("../db")

  switch (patch.type) {
    case "characterUpdate": {
      const updated = await updateCharacterFields(novelId, patch.characterId, patch.patch as Record<string, unknown>, tx)
      return { newVersion: stableHash(updated) }
    }
    case "characterRename": {
      const updated = await updateCharacterFields(novelId, patch.characterId, { name: patch.newName }, tx)
      return { newVersion: stableHash(updated) }
    }
    case "worldUpdate": {
      const updated = await updateWorldBibleFields(novelId, patch.patch as Record<string, unknown>, tx)
      return { newVersion: stableHash(updated) }
    }
    case "spineUpdate": {
      const updated = await updateStorySpineFields(novelId, patch.patch as Record<string, unknown>, tx)
      return { newVersion: stableHash(updated) }
    }
  }
}

/**
 * Codex round-4 HIGH: the precondition check + apply must be ATOMIC. We
 * read the target artifact under a row-level lock (`FOR UPDATE`) inside
 * the same transaction that performs the apply. A concurrent edit blocks
 * on the lock until our transaction commits or rolls back; on rollback
 * (e.g., precondition mismatch) the concurrent writer proceeds against
 * the unchanged row. Without this, two transactions could each
 * compute-and-trust the same hash, both pass the check, and the second
 * apply would silently overwrite the first.
 *
 * Returns `null` ONLY when the target row genuinely does not exist
 * (no rows returned by the FOR UPDATE select). Real DB errors (connection
 * loss, query timeout) propagate as exceptions — caller decides how to
 * surface them.
 */
async function readLockedTarget(
  tx: typeof db,
  novelId: string,
  patch: AdjusterPatch,
): Promise<unknown | null> {
  switch (patch.type) {
    case "characterUpdate":
    case "characterRename": {
      const rows = await tx`SELECT profile_json FROM characters
                            WHERE novel_id = ${novelId} AND id = ${patch.characterId}
                            FOR UPDATE`
      if (rows.length === 0) return null
      return (rows[0] as { profile_json: unknown }).profile_json
    }
    case "worldUpdate": {
      const rows = await tx`SELECT content_json FROM world_bibles
                            WHERE novel_id = ${novelId}
                            FOR UPDATE`
      if (rows.length === 0) return null
      return (rows[0] as { content_json: unknown }).content_json
    }
    case "spineUpdate": {
      const rows = await tx`SELECT content_json FROM story_spines
                            WHERE novel_id = ${novelId}
                            FOR UPDATE`
      if (rows.length === 0) return null
      return (rows[0] as { content_json: unknown }).content_json
    }
  }
}

type ResolveOutcome =
  | { kind: "rejected"; envelopeId: string }
  | { kind: "applied"; envelopeId: string; status: "approved" | "modified"; newVersion: string }
  | { kind: "stale"; envelopeId: string; expectedVersion: string; actualVersion: string }
  | { kind: "missing"; envelopeId: string }
  | { kind: "alreadyResolved"; envelopeId: string; actualStatus: string }

interface OutcomeWrapper {
  __resolveOutcome: ResolveOutcome
}

function wrapOutcome(outcome: ResolveOutcome): OutcomeWrapper {
  return { __resolveOutcome: outcome }
}

function isOutcomeWrapper(err: unknown): err is OutcomeWrapper {
  return (
    typeof err === "object" &&
    err !== null &&
    "__resolveOutcome" in err
  )
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

    // Phase 6 commit 2: evaluate the active approval policy against the
    // envelope. The result is recorded for AUDIT (resolution_policy_*
    // columns) — Phase 7's replay harness compares it against the operator's
    // status to compute autonomy metrics. The operator's `status` still
    // drives what actually applies in this commit; a future commit will add
    // an autonomous decide path that lets the policy fire the apply directly.
    const activePolicy: ApprovalPolicy = body.policy ?? DEFAULT_MANUAL_POLICY
    const policyEvaluation: PolicyEvaluation = evaluatePolicy(body.envelope, activePolicy)

    // Atomic compare-and-apply (Codex round-4 HIGH).
    // SELECT FOR UPDATE locks the target row inside the transaction; the
    // hash recomputation and the subsequent apply both happen under that
    // lock. A concurrent edit blocks until our tx commits or rolls back.
    // Rollback paths: missing row → throw missing outcome; hash mismatch
    // → throw stale outcome. Both unwind the transaction with no changes.
    //
    // Phase 3 commit 4 follow-up A: the envelope-row resolution write
    // joins the same tx. If the envelope row exists and is non-pending
    // (concurrent resolve race), throw alreadyResolved → 409 + rollback.
    // If the envelope row is missing (no /adjust persistence happened),
    // skip the write — body-carry semantics still apply.
    let outcome: ResolveOutcome
    try {
      outcome = await db.begin(async (tx: typeof db) => {
        const live = await readLockedTarget(tx, novelId, body.envelope.payload)
        if (live === null) {
          throw wrapOutcome({ kind: "missing", envelopeId: body.envelope.id })
        }
        const actualVersion = stableHash(live)
        if (actualVersion !== body.envelope.target.currentVersion) {
          throw wrapOutcome({
            kind: "stale",
            envelopeId: body.envelope.id,
            expectedVersion: body.envelope.target.currentVersion,
            actualVersion,
          })
        }

        let runtime: ResolveOutcome
        if (body.status === "rejected") {
          runtime = { kind: "rejected", envelopeId: body.envelope.id }
        } else {
          // approved or modified — apply within the same tx so the apply
          // either succeeds end-to-end or rolls back together with the lock.
          const result = await applyPatchTx(tx, novelId, patchToApply)
          runtime = {
            kind: "applied",
            envelopeId: body.envelope.id,
            status: body.status,
            newVersion: result.newVersion,
          }
        }

        // Persist resolution to proposal_envelopes (best-effort: missing
        // row degrades gracefully; non-pending row is a hard 409). Joins
        // this transaction so the envelope row and the artifact stay in
        // sync — a rollback on either side rolls back both.
        const updated = await updateEnvelopeResolution(
          {
            id: body.envelope.id,
            status: body.status,
            resolvedAt: new Date().toISOString(),
            resolvedByKind: "human",
            resolvedByRef: null,
            resolvedNote: body.operatorNote ?? null,
            modifiedPayload: body.status === "modified" ? body.modifiedPayload ?? null : null,
            policyDecision: policyEvaluation.decision,
            policyVersion: policyEvaluation.policyVersion,
            policyReasons: policyEvaluation.reasons,
          },
          tx,
        )
        if (!updated) {
          // 0 rows affected: either row doesn't exist, or it's already
          // resolved (status guard fired). Look up the row to disambiguate.
          const row = await findEnvelopeById(body.envelope.id, tx)
          if (row !== null && row.status !== "pending") {
            throw wrapOutcome({
              kind: "alreadyResolved",
              envelopeId: body.envelope.id,
              actualStatus: row.status,
            })
          }
          if (row !== null && row.status === "pending") {
            // OpenCode review MEDIUM A (2026-05-04): a concurrent insert
            // appeared between updateEnvelopeResolution (saw 0 rows) and
            // findEnvelopeById (sees pending row). Without this retry the
            // tx commits with the artifact applied but the envelope row
            // still pending in DB — wrong audit-trail state. Retry the
            // update inside the same tx so the resolution either lands
            // or surfaces alreadyResolved (if a third actor raced us in
            // turn).
            const retried = await updateEnvelopeResolution(
              {
                id: body.envelope.id,
                status: body.status,
                resolvedAt: new Date().toISOString(),
                resolvedByKind: "human",
                resolvedByRef: null,
                resolvedNote: body.operatorNote ?? null,
                modifiedPayload: body.status === "modified" ? body.modifiedPayload ?? null : null,
                policyDecision: policyEvaluation.decision,
                policyVersion: policyEvaluation.policyVersion,
                policyReasons: policyEvaluation.reasons,
              },
              tx,
            )
            if (!retried) {
              // Lost a second race — another resolver landed between the
              // two updates. Surface as alreadyResolved so the caller
              // re-fetches the latest state instead of committing with a
              // stale audit row.
              const reread = await findEnvelopeById(body.envelope.id, tx)
              throw wrapOutcome({
                kind: "alreadyResolved",
                envelopeId: body.envelope.id,
                actualStatus: reread?.status ?? "unknown",
              })
            }
          } else {
            // Row genuinely missing — /adjust persistence didn't fire
            // (older envelope, or transient DB error during build).
            // Audit gap accepted; the artifact apply still happened.
            console.warn(
              `[resolve] envelope ${body.envelope.id} not in proposal_envelopes; audit gap`,
            )
          }
        }

        return runtime
      })
    } catch (err) {
      if (isOutcomeWrapper(err)) {
        outcome = err.__resolveOutcome
      } else {
        return Response.json(
          { ok: false, error: `apply failed: ${String(err)}`, envelopeId: body.envelope.id },
          { status: 500 },
        )
      }
    }

    switch (outcome.kind) {
      case "missing":
        return Response.json(
          { ok: false, error: "target artifact missing", envelopeId: outcome.envelopeId },
          { status: 404 },
        )
      case "stale":
        return Response.json(
          {
            ok: false,
            error: "stale-precondition",
            envelopeId: outcome.envelopeId,
            expectedVersion: outcome.expectedVersion,
            actualVersion: outcome.actualVersion,
          },
          { status: 409 },
        )
      case "alreadyResolved":
        return Response.json(
          {
            ok: false,
            error: "envelope already resolved",
            envelopeId: outcome.envelopeId,
            actualStatus: outcome.actualStatus,
          },
          { status: 409 },
        )
      case "rejected":
        return Response.json({
          ok: true,
          envelopeId: outcome.envelopeId,
          applied: false,
          status: "rejected",
          policy: {
            decision: policyEvaluation.decision,
            version: policyEvaluation.policyVersion,
          },
        })
      case "applied":
        return Response.json({
          ok: true,
          envelopeId: outcome.envelopeId,
          applied: true,
          status: outcome.status,
          newVersion: outcome.newVersion,
          policy: {
            decision: policyEvaluation.decision,
            version: policyEvaluation.policyVersion,
          },
        })
    }
  }

  return null
}

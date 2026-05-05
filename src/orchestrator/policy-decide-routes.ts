/**
 * Phase 6 commit 5 — Autonomous policy-decide endpoint.
 *
 * Charter: docs/charters/world-bible-architecture.md
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 6 — Approval Policy Engine"
 *
 *   POST /api/novel/:novelId/proposal-envelopes/:envelopeId/policy-decide
 *     Body: {
 *       policy: ApprovalPolicy,
 *       operatorNote?: string,
 *     }
 *
 * The route:
 *   1. Loads the envelope by id from `proposal_envelopes`. If missing →
 *      404. If novelId mismatch → 400. If non-pending → 409 (already
 *      resolved by another caller).
 *   2. Coerces the row into a typed envelope based on `kind`. Supports
 *      `artifact_patch` and `prose_edit`. `canon_update` envelopes (if any
 *      ever land in this table — canon proposals live in `canon_proposals`)
 *      → 422 with a redirect message.
 *   3. Evaluates the active `ApprovalPolicy` via `evaluatePolicy`.
 *   4. Dispatches by `evaluation.decision`:
 *      - `queue` — return 200 + reasons, no mutation. Operator still
 *        decides this one manually.
 *      - `shadow` — record `status="shadowed"` + audit fields, no apply.
 *        Phase 7's replay metrics consume this.
 *      - `approve` — re-issue the existing kind-specific resolve route
 *        with `status="approved"`, `resolvedBy="policy"`, the same policy.
 *        That route handles the atomic compare-and-apply transaction;
 *        the audit row gets the same policy fields the manual path would.
 *      - `reject` — same shape, `status="rejected"`.
 *
 * Why dispatch via Request reissue instead of factoring out a shared
 * helper: the existing resolve routes are tested and stable, with the
 * concurrent-resolve race retry, hash-precondition lock, etc. Re-issuing
 * a Request with `resolvedBy: "policy"` reuses every guard those routes
 * carry. The cost is one extra zod parse on the constructed body. The
 * benefit is no risk of subtle drift between the manual and autonomous
 * apply paths — they ARE the same path.
 *
 * Out of scope:
 *   - Loading per-novel persisted policy configuration. Caller passes the
 *     policy in the body; future commits can add a default-policy lookup.
 *   - Bulk autonomous decide over all pending envelopes for a novel.
 *     A wrapper around this route covers it client-side.
 *   - Canon update envelopes — those live in `canon_proposals`, a
 *     different table. The `manualKinds: ["canon_update"]` default would
 *     return queue regardless, but the dispatch lives at
 *     `/api/novel/:id/canon-proposals/:proposalId/resolve`. Phase 6 commit 4+
 *     wires the audit-trail fields on that path.
 */

import { z } from "zod"
import db from "../db/connection"
import {
  findEnvelopeById,
  rowToArtifactPatchEnvelope,
  updateEnvelopeResolution,
} from "../db/proposal-envelopes"
import { rowToProseEditEnvelope } from "../db/editorial-envelopes"
import {
  evaluatePolicy,
  type ApprovalPolicy,
  type PolicyEvaluation,
} from "../canon/approval-policy"
import { handleProposalEnvelopeRoute } from "./proposal-envelope-routes"
import { handleProseEditRoute } from "./prose-edit-routes"
import type { ArtifactPatchEnvelope } from "../canon/proposal-envelope"
import type { ProseEditEnvelope } from "../canon/editorial-proposal"

const approvalPolicySchema = z.object({
  version: z.string(),
  mode: z.enum(["manual", "assisted", "autonomous", "eval"]),
  autoApproveRiskCeiling: z.enum(["mechanical", "low", "medium", "high"]).optional(),
  manualKinds: z
    .array(z.enum(["artifact_patch", "canon_update", "prose_edit", "editorial_flag", "planning_edit"]))
    .optional(),
})

const decideBodySchema = z.object({
  policy: approvalPolicySchema,
  operatorNote: z.string().optional(),
})

type DecideBody = z.infer<typeof decideBodySchema>

export async function handlePolicyDecideRoute(
  req: Request,
  url: URL,
): Promise<Response | null> {
  const m = /^\/api\/novel\/([^/]+)\/proposal-envelopes\/([^/]+)\/policy-decide\/?$/.exec(
    url.pathname,
  )
  if (!m) return null
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  const novelId = decodeURIComponent(m[1])
  const envelopeId = decodeURIComponent(m[2])

  // Body parse
  let body: DecideBody
  try {
    const raw = await req.json()
    const parsed = decideBodySchema.safeParse(raw)
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
    return Response.json(
      { ok: false, error: `malformed json: ${String(err)}` },
      { status: 400 },
    )
  }

  // Load envelope
  const row = await findEnvelopeById(envelopeId)
  if (!row) {
    return Response.json(
      { ok: false, error: "envelope not found", envelopeId },
      { status: 404 },
    )
  }
  if (row.novel_id !== novelId) {
    return Response.json(
      {
        ok: false,
        error: "envelope.novelId does not match URL novelId",
        envelopeNovelId: row.novel_id,
        urlNovelId: novelId,
      },
      { status: 400 },
    )
  }
  if (row.status !== "pending") {
    return Response.json(
      {
        ok: false,
        error: "envelope already resolved",
        envelopeId,
        actualStatus: row.status,
      },
      { status: 409 },
    )
  }

  // Coerce by kind
  let typedEnvelope: ArtifactPatchEnvelope | ProseEditEnvelope
  if (row.kind === "artifact_patch") {
    typedEnvelope = rowToArtifactPatchEnvelope(row)
  } else if (row.kind === "prose_edit") {
    typedEnvelope = rowToProseEditEnvelope(row)
  } else if (row.kind === "canon_update" || row.kind === "editorial_flag" || row.kind === "planning_edit") {
    return Response.json(
      {
        ok: false,
        error: "kind not supported by policy-decide",
        envelopeId,
        kind: row.kind,
        message:
          row.kind === "canon_update"
            ? "canon_update envelopes resolve via /api/novel/:id/canon-proposals/:proposalId/resolve"
            : row.kind === "planning_edit"
              ? "planning_edit envelopes resolve via /api/novel/:id/planning-proposals/:envelopeId/resolve"
              : "editorial_flag envelopes are flag-only — convert to a prose_edit envelope before resolving",
      },
      { status: 422 },
    )
  } else {
    return Response.json(
      { ok: false, error: `unknown envelope kind ${row.kind}`, envelopeId },
      { status: 422 },
    )
  }

  // Evaluate
  const policy: ApprovalPolicy = body.policy
  const evaluation: PolicyEvaluation = evaluatePolicy(typedEnvelope, policy)

  // Dispatch
  if (evaluation.decision === "queue") {
    const currentStatus = await db.begin(async (tx) => {
      const rows = await tx`SELECT status FROM proposal_envelopes WHERE id = ${envelopeId} FOR UPDATE`
      return rows.length > 0 ? rows[0].status : null
    })
    if (currentStatus === null) {
      return Response.json({ ok: false, error: "envelope not found", envelopeId }, { status: 404 })
    }
    if (currentStatus !== "pending") {
      return Response.json(
        { ok: false, error: "envelope already resolved", envelopeId, actualStatus: currentStatus },
        { status: 409 },
      )
    }

    return Response.json({
      ok: true,
      envelopeId,
      decision: "queue",
      reasons: evaluation.reasons,
      policy: { version: evaluation.policyVersion },
      mutated: false,
    })
  }

  if (evaluation.decision === "shadow") {
    // Record what the policy would have done without firing the apply.
    // resolved_by_kind = "policy" so audit consumers know this wasn't a
    // human decision. The shadowed status keeps the row out of the
    // pending list while preserving the evidence for replay.
    const resolvedAt = new Date().toISOString()
    const updated = await db.begin(async (tx) =>
      updateEnvelopeResolution(
        {
          id: envelopeId,
          status: "shadowed",
          resolvedAt,
          resolvedByKind: "policy",
          resolvedByRef: null,
          resolvedNote: body.operatorNote ?? null,
          modifiedPayload: null,
          policyDecision: evaluation.decision,
          policyVersion: evaluation.policyVersion,
          policyReasons: evaluation.reasons,
        },
        tx,
      ),
    )
    if (!updated) {
      // Lost a race — someone else resolved between our load + this update.
      const fresh = await findEnvelopeById(envelopeId)
      return Response.json(
        {
          ok: false,
          error: "envelope already resolved",
          envelopeId,
          actualStatus: fresh?.status ?? "unknown",
        },
        { status: 409 },
      )
    }
    return Response.json({
      ok: true,
      envelopeId,
      decision: "shadow",
      shadowOf: evaluation.shadowOf ?? null,
      reasons: evaluation.reasons,
      policy: { version: evaluation.policyVersion },
      mutated: true,
      status: "shadowed",
    })
  }

  // approve / reject — re-issue the kind-specific resolve route with
  // resolvedBy="policy". Status maps decision→status: "approve" → "approved",
  // "reject" → "rejected".
  const status = evaluation.decision === "approve" ? "approved" : "rejected"
  const targetPath =
    typedEnvelope.kind === "artifact_patch"
      ? `/api/novel/${novelId}/proposal-envelopes/resolve`
      : `/api/novel/${novelId}/prose-edits/resolve`
  const targetUrl = new URL(targetPath, url.origin)
  const reissueBody = {
    envelope: typedEnvelope,
    status,
    operatorNote: body.operatorNote,
    policy,
    resolvedBy: "policy" as const,
  }
  const reissueReq = new Request(targetUrl, {
    method: "POST",
    body: JSON.stringify(reissueBody),
    headers: { "content-type": "application/json" },
  })

  const handler =
    typedEnvelope.kind === "artifact_patch"
      ? handleProposalEnvelopeRoute
      : handleProseEditRoute
  const inner = await handler(reissueReq, targetUrl)
  if (!inner) {
    return Response.json(
      {
        ok: false,
        error: "internal dispatch failed (no handler match)",
        envelopeId,
      },
      { status: 500 },
    )
  }

  // Augment the inner response with the policy-decide envelope. We re-read
  // the body and re-emit so callers get the unified shape regardless of
  // which kind dispatched.
  const innerBody = (await inner.json()) as Record<string, unknown>
  if ((typeof innerBody.ok === "boolean" && innerBody.ok === false) || inner.status >= 400) {
    return Response.json(
      {
        ...innerBody,
        policyEvaluation: {
          decision: evaluation.decision,
          version: evaluation.policyVersion,
          reasons: evaluation.reasons,
        },
      },
      { status: inner.status },
    )
  }

  return Response.json(
    {
      ...innerBody,
      decision: evaluation.decision,
      reasons: evaluation.reasons,
      policy: { decision: evaluation.decision, version: evaluation.policyVersion },
      mutated: innerBody.applied === true || innerBody.status === "rejected",
    },
    { status: inner.status },
  )
}

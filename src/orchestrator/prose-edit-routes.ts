/**
 * Phase 5 commit 4 — Prose-edit envelope apply route.
 *
 * Charter: docs/charters/world-bible-architecture.md
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 5 — Editorial Proposal Workbench"
 *
 * `POST /api/novel/:novelId/prose-edits/resolve`
 *
 * Body: `{ envelope, status, operatorNote? }`. Status is one of
 * `"approved" | "rejected"`. Modify is intentionally not in scope for
 * v1 — a structured prose-edit modify (re-author the replacement text)
 * is its own UX surface; reject + propose-new is the documented
 * workflow until then.
 *
 * Approve flow (atomic):
 *   1. `db.begin(...)` opens a transaction.
 *   2. `getLatestChapterDraft(..., forUpdate: true)` pulls the latest
 *      draft row and locks it.
 *   3. `computeProseHash(prose)` (sha256 of utf-8 bytes) compared to
 *      `envelope.precondition.hash`. Mismatch → 409 + actualHash;
 *      transaction rolls back without writes.
 *   4. Span-target apply: `prose.slice(0, start) + replacement + prose.slice(end)`.
 *      Beat-target deferred to a follow-up — needs beat-offset map on
 *      the prose, which the runtime doesn't currently persist.
 *   5. `saveChapterDraft(..., tx)` writes the new prose as version+1.
 *      `updateEnvelopeResolution(..., tx)` flips the envelope row to
 *      'approved'; both writes commit together.
 *
 * Reject flow:
 *   1. `updateEnvelopeResolution(..., 'rejected', tx)` — no draft writes.
 *
 * Stale precondition + concurrent-resolve race + missing-draft + 4xx
 * shape mirror `proposal-envelope-routes.ts` (artifact_patch resolve)
 * so operators see the same error vocabulary across kinds.
 */

import { z } from "zod"
import { createHash } from "crypto"
import db from "../db/connection"
import { getLatestChapterDraft, saveChapterDraft } from "../db/drafts"
import {
  findEnvelopeById,
  updateEnvelopeResolution,
} from "../db/proposal-envelopes"
import { proseEditProposalSchema } from "../canon/editorial-proposal"
import type { ProseEditEnvelope } from "../canon/editorial-proposal"
import {
  evaluatePolicy,
  type ApprovalPolicy,
  type PolicyEvaluation,
} from "../canon/approval-policy"

// ── Body schema ──────────────────────────────────────────────────────────

const targetRefSchema = z.object({
  kind: z.literal("prose_span"),
  ref: z.string(),
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

const preconditionSchema = z.object({
  kind: z.literal("draft_hash"),
  hash: z.string(),
})

const policyRecommendationSchema = z.object({
  decision: z.enum(["queue", "approve", "reject", "shadow"]),
  reasons: z.array(z.string()).optional(),
})

const envelopeSchema = z.object({
  id: z.string(),
  kind: z.literal("prose_edit"),
  novelId: z.string(),
  target: targetRefSchema,
  source: sourceRefSchema,
  status: z.string(),
  risk: z.enum(["mechanical", "low", "medium", "high"]),
  summary: z.string(),
  rationale: z.string(),
  evidence: z.array(evidenceSchema),
  payload: proseEditProposalSchema,
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

const resolveBodySchema = z.object({
  envelope: envelopeSchema,
  status: z.enum(["approved", "rejected"]),
  operatorNote: z.string().optional(),
  policy: approvalPolicySchema.optional(),
  resolvedBy: z.enum(["human", "policy", "script", "test"]).optional(),
})

type ResolveBody = z.infer<typeof resolveBodySchema>

/**
 * Phase 6 commit 3: when no policy is provided, default to manual mode.
 * Mirrors `proposal-envelope-routes.ts` so callers get the same default
 * shape across kinds. The version string is opaque; "manual-v1" lets the
 * audit trail distinguish "no policy attached" (NULL) from "explicit
 * manual default".
 */
const DEFAULT_MANUAL_POLICY: ApprovalPolicy = {
  version: "manual-v1",
  mode: "manual",
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Canonical "draft hash" — sha256 hex of the prose's UTF-8 bytes. The
 * producer that creates a `ProseEditEnvelope` must compute the same
 * function over the prose it observed and store the result in
 * `envelope.precondition.hash`. Equality of hashes is the contract that
 * "the prose I patched against is still the prose you're applying onto".
 */
export function computeProseHash(prose: string): string {
  return createHash("sha256").update(prose, "utf8").digest("hex")
}

interface SpanApply {
  newProse: string
  newWordCount: number
}

/**
 * Span-target apply. The replacement string substitutes prose between
 * `[start, end)` (half-open, mirrors `String.prototype.slice` semantics).
 *
 * Out-of-range / inverted offsets surface as a thrown error; the route
 * catches and returns 422.
 */
function applyProseEditSpan(
  prose: string,
  start: number,
  end: number,
  replacement: string,
): SpanApply {
  if (start < 0 || end < start || end > prose.length) {
    throw new Error(
      `prose-edit span out of range: start=${start} end=${end} prose-length=${prose.length}`,
    )
  }
  const newProse = prose.slice(0, start) + replacement + prose.slice(end)
  const newWordCount = newProse.trim() === "" ? 0 : newProse.trim().split(/\s+/).length
  return { newProse, newWordCount }
}

function parseChapterFromRef(chapterRef: string): number | null {
  // Accept "chapter:12" or just "12".
  const m = /^chapter:(\d+)$/i.exec(chapterRef.trim()) ?? /^(\d+)$/.exec(chapterRef.trim())
  if (!m) return null
  const n = Number(m[1])
  return Number.isInteger(n) && n > 0 ? n : null
}

// ── Outcome shape (mirrors proposal-envelope-routes.ts) ─────────────────

type Outcome =
  | { kind: "rejected"; envelopeId: string }
  | { kind: "applied"; envelopeId: string; newDraftVersion: number; newDraftHash: string }
  | { kind: "stale"; envelopeId: string; expectedHash: string; actualHash: string }
  | { kind: "missing-draft"; envelopeId: string; chapter: number }
  | { kind: "alreadyResolved"; envelopeId: string; actualStatus: string }
  | { kind: "unsupported-target"; envelopeId: string; targetKind: string }

class OutcomeError extends Error {
  constructor(public outcome: Outcome) {
    super(outcome.kind)
  }
}

// ── Handler ──────────────────────────────────────────────────────────────

export async function handleProseEditRoute(
  req: Request,
  url: URL,
): Promise<Response | null> {
  const m = /^\/api\/novel\/([^/]+)\/prose-edits\/resolve\/?$/.exec(url.pathname)
  if (!m) return null
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  const novelIdFromPath = m[1]
  let parsedBody: ResolveBody
  try {
    const raw = await req.json()
    const parse = resolveBodySchema.safeParse(raw)
    if (!parse.success) {
      return Response.json(
        { ok: false, error: "invalid body", issues: parse.error.format() },
        { status: 400 },
      )
    }
    parsedBody = parse.data
  } catch {
    return Response.json(
      { ok: false, error: "invalid JSON" },
      { status: 400 },
    )
  }

  const { envelope, status, operatorNote } = parsedBody
  if (envelope.novelId !== novelIdFromPath) {
    return Response.json(
      { ok: false, error: "novelId in path does not match envelope.novelId" },
      { status: 400 },
    )
  }

  // Phase 6 commit 3: evaluate the active policy for the audit trail.
  // The operator's `status` still drives what applies in this commit.
  const activePolicy: ApprovalPolicy = parsedBody.policy ?? DEFAULT_MANUAL_POLICY
  const policyEvaluation: PolicyEvaluation = evaluatePolicy(envelope as ProseEditEnvelope, activePolicy)

  // Reject: no draft work, just persist the resolution.
  if (status === "rejected") {
    try {
      const outcome = await db.begin(async (tx) => {
        const updated = await updateEnvelopeResolution(
          {
            id: envelope.id,
            status: "rejected",
            resolvedAt: new Date().toISOString(),
            resolvedByKind: parsedBody.resolvedBy ?? "human",
            resolvedByRef: null,
            resolvedNote: operatorNote ?? null,
            modifiedPayload: null,
            policyDecision: policyEvaluation.decision,
            policyVersion: policyEvaluation.policyVersion,
            policyReasons: policyEvaluation.reasons,
          },
          tx,
        )
        if (!updated) {
          // Concurrent-resolve race — mirror artifact_patch behavior.
          const fresh = await findEnvelopeById(envelope.id, tx)
          if (!fresh) throw new OutcomeError({ kind: "alreadyResolved", envelopeId: envelope.id, actualStatus: "missing" })
          throw new OutcomeError({ kind: "alreadyResolved", envelopeId: envelope.id, actualStatus: fresh.status })
        }
        return { kind: "rejected" as const, envelopeId: envelope.id }
      })
      return Response.json({
        ok: true,
        envelopeId: outcome.envelopeId,
        status: "rejected",
        policy: { decision: policyEvaluation.decision, version: policyEvaluation.policyVersion },
      })
    } catch (err) {
      if (err instanceof OutcomeError) return outcomeToResponse(err.outcome)
      throw err
    }
  }

  // Approve: read draft + compare hash + apply + persist (all in one tx).
  if (envelope.payload.target.kind !== "span") {
    return Response.json(
      {
        ok: false,
        error: "unsupported target kind",
        targetKind: envelope.payload.target.kind,
        message:
          "Beat-target apply is not yet supported (Phase 5 commit 4 ships span-only). " +
          "Reject this envelope and re-propose as a span edit, or wait for the beat-offset apply follow-up.",
      },
      { status: 422 },
    )
  }

  const chapterNum = parseChapterFromRef(envelope.payload.target.chapterRef)
  if (chapterNum === null) {
    return Response.json(
      { ok: false, error: "invalid chapterRef", chapterRef: envelope.payload.target.chapterRef },
      { status: 400 },
    )
  }

  try {
    const outcome = await db.begin(async (tx) => {
      const draft = await getLatestChapterDraft(envelope.novelId, chapterNum, { executor: tx, forUpdate: true })
      if (!draft) {
        throw new OutcomeError({ kind: "missing-draft", envelopeId: envelope.id, chapter: chapterNum })
      }
      const liveHash = computeProseHash(draft.prose)
      if (liveHash !== envelope.precondition.hash) {
        throw new OutcomeError({
          kind: "stale",
          envelopeId: envelope.id,
          expectedHash: envelope.precondition.hash,
          actualHash: liveHash,
        })
      }

      // Span apply.
      const { start, end } = envelope.payload.target as { kind: "span"; chapterRef: string; start: number; end: number }
      const { newProse, newWordCount } = applyProseEditSpan(
        draft.prose,
        start,
        end,
        envelope.payload.replacement,
      )

      const newVersion = await saveChapterDraft(envelope.novelId, chapterNum, newProse, newWordCount, tx)
      const newHash = computeProseHash(newProse)

      const updated = await updateEnvelopeResolution(
        {
          id: envelope.id,
          status: "approved",
          resolvedAt: new Date().toISOString(),
          resolvedByKind: parsedBody.resolvedBy ?? "human",
          resolvedByRef: null,
          resolvedNote: operatorNote ?? null,
          modifiedPayload: null,
          policyDecision: policyEvaluation.decision,
          policyVersion: policyEvaluation.policyVersion,
          policyReasons: policyEvaluation.reasons,
        },
        tx,
      )
      if (!updated) {
        // Concurrent-resolve race after a successful apply — mirror MEDIUM A.
        const fresh = await findEnvelopeById(envelope.id, tx)
        if (!fresh) {
          throw new OutcomeError({ kind: "alreadyResolved", envelopeId: envelope.id, actualStatus: "missing" })
        }
        if (fresh.status === "pending") {
          // Retry the resolve once; second 0-row throws alreadyResolved with the fresh status.
          const retry = await updateEnvelopeResolution(
            {
              id: envelope.id,
              status: "approved",
              resolvedAt: new Date().toISOString(),
              resolvedByKind: parsedBody.resolvedBy ?? "human",
              resolvedByRef: null,
              resolvedNote: operatorNote ?? null,
              modifiedPayload: null,
              policyDecision: policyEvaluation.decision,
              policyVersion: policyEvaluation.policyVersion,
              policyReasons: policyEvaluation.reasons,
            },
            tx,
          )
          if (!retry) {
            const fresher = await findEnvelopeById(envelope.id, tx)
            throw new OutcomeError({
              kind: "alreadyResolved",
              envelopeId: envelope.id,
              actualStatus: fresher?.status ?? "missing",
            })
          }
        } else {
          throw new OutcomeError({ kind: "alreadyResolved", envelopeId: envelope.id, actualStatus: fresh.status })
        }
      }

      return {
        kind: "applied" as const,
        envelopeId: envelope.id,
        newDraftVersion: newVersion,
        newDraftHash: newHash,
      }
    })

    return Response.json({
      ok: true,
      envelopeId: outcome.envelopeId,
      status: "approved",
      newDraftVersion: outcome.newDraftVersion,
      newDraftHash: outcome.newDraftHash,
      policy: { decision: policyEvaluation.decision, version: policyEvaluation.policyVersion },
    })
  } catch (err) {
    if (err instanceof OutcomeError) return outcomeToResponse(err.outcome)
    if (err instanceof Error && /prose-edit span out of range/.test(err.message)) {
      return Response.json(
        { ok: false, error: "span out of range", message: err.message },
        { status: 422 },
      )
    }
    throw err
  }
}

function outcomeToResponse(outcome: Outcome): Response {
  switch (outcome.kind) {
    case "rejected":
      return Response.json({ ok: true, envelopeId: outcome.envelopeId, status: "rejected" })
    case "stale":
      return Response.json(
        {
          ok: false,
          error: "stale draft hash",
          envelopeId: outcome.envelopeId,
          expectedHash: outcome.expectedHash,
          actualHash: outcome.actualHash,
        },
        { status: 409 },
      )
    case "missing-draft":
      return Response.json(
        {
          ok: false,
          error: "draft not found",
          envelopeId: outcome.envelopeId,
          chapter: outcome.chapter,
        },
        { status: 404 },
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
    case "unsupported-target":
      return Response.json(
        {
          ok: false,
          error: "unsupported target kind",
          envelopeId: outcome.envelopeId,
          targetKind: outcome.targetKind,
        },
        { status: 422 },
      )
    case "applied":
      return Response.json({
        ok: true,
        envelopeId: outcome.envelopeId,
        status: "approved",
        newDraftVersion: outcome.newDraftVersion,
        newDraftHash: outcome.newDraftHash,
      })
  }
}

// Re-export the shape so callers (UI client, tests) can type-narrow.
export type ProseEditResolveOutcome = Outcome
export type { ProseEditEnvelope }

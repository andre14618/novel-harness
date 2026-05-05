import { z } from "zod"
import db from "../db/connection"
import { stableHash } from "../canon/proposal-envelope"
import {
  buildPlanningEditDiff,
  buildPlanningEditEnvelope,
  planningEditCreateTargetSchema,
  planningEditPayloadSchema,
  planningEditTargetSchema,
  planningEditTargetsSameArtifact,
  validatePlanningEditActionTarget,
  validatePlanningEditProposedValue,
  type PlanningEditAction,
  type BeatObligationPlanningEditField,
  type BeatPlanPlanningEditField,
  type CharacterBiblePlanningEditField,
  type ChapterOutlinePlanningEditField,
  type PlanningDirectivePlanningEditField,
  type PlanningEditDiff,
  type PlanningEditImpactSnapshot,
  type PlanningEditPayload,
  type StorySpinePlanningEditField,
  type WorldBiblePlanningEditField,
} from "../canon/planning-edit-proposal"
import {
  findEnvelopeById,
  insertPlanningEditEnvelope,
  listPlanningEditEnvelopes,
  rowToPlanningEditEnvelope,
  updateEnvelopeResolution,
} from "../db/proposal-envelopes"
import {
  getChapterOutlineByBeatId,
  getChapterOutlineByChapterId,
  getChapterOutlineByObligationId,
  normalizeChapterOutlineForPersistence,
  saveChapterOutline,
} from "../db/outlines"
import { getNovel, updateNovelSeed } from "../db/novels"
import {
  getCharacterById,
  getStorySpine,
  getWorldBible,
  updateCharacterFields,
  updateStorySpineFields,
  updateWorldBibleFields,
} from "../db/world"
import {
  previewPlanningImpact,
  PlanningTargetLookupError,
  type PlanningImpactPreview,
} from "../harness/planning-targets"
import {
  collectStructuralPlanningMutationLineage,
  type StructuralPlanningMutationLineageDraft,
} from "../harness/planning-structural-lineage"
import { characterIdFromName } from "../harness/ids"
import { emptyDirectives, type PlanningDirectives } from "../schemas/planning-directives"
import { recordPlanningMutationLineage } from "../db/planning-mutation-lineage"
import {
  evaluatePolicy,
  type ApprovalPolicy,
  type PolicyEvaluation,
} from "../canon/approval-policy"
import type { CharacterProfile, ChapterOutline, SeedInput, StorySpine, WorldBible } from "../types"

const createBodySchema = z.object({
  action: z.enum([
    "field_replace",
    "beat_replace",
    "beat_reorder",
    "beat_obligation_replace",
    "beat_obligation_reorder",
  ]).optional().default("field_replace"),
  target: planningEditCreateTargetSchema,
  proposedValue: z.unknown(),
  rationale: z.string().min(1).optional(),
  source: z.object({
    agent: z.string().min(1).optional(),
    userMessage: z.string().optional(),
    parentEnvelopeId: z.string().optional(),
  }).optional(),
})

const approvalPolicySchema = z.object({
  version: z.string(),
  mode: z.enum(["manual", "assisted", "autonomous", "eval"]),
  autoApproveRiskCeiling: z.enum(["mechanical", "low", "medium", "high"]).optional(),
  manualKinds: z
    .array(z.enum(["artifact_patch", "canon_update", "prose_edit", "editorial_flag", "planning_edit"]))
    .optional(),
})

const resolveBodySchema = z
  .object({
    status: z.enum(["approved", "rejected", "modified"]),
    modifiedPayload: planningEditPayloadSchema.optional(),
    operatorNote: z.string().optional(),
    resolvedBy: z.enum(["human", "policy", "script", "test"]).optional(),
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

type CreateBody = z.infer<typeof createBodySchema>
type ResolveBody = z.infer<typeof resolveBodySchema>

const DEFAULT_MANUAL_POLICY: ApprovalPolicy = {
  version: "manual-v1",
  mode: "manual",
}

type Outcome =
  | {
    kind: "created"
    inserted: boolean
    envelope: ReturnType<typeof buildPlanningEditEnvelope>
    impactPreview: PlanningImpactPreview
    diff: PlanningEditDiff
  }
  | { kind: "rejected"; envelopeId: string }
  | {
    kind: "applied"
    envelopeId: string
    status: "approved" | "modified"
    newVersion: string
    diff: PlanningEditDiff
  }
  | { kind: "stale"; envelopeId: string; expectedVersion: string; actualVersion: string }
  | { kind: "missing"; envelopeId: string }
  | { kind: "alreadyResolved"; envelopeId: string; actualStatus: string }

class OutcomeError extends Error {
  constructor(public outcome: Outcome) {
    super(outcome.kind)
  }
}

class PlanningProposalValidationError extends Error {}

const OBLIGATION_LIST_KEYS = [
  "mustEstablish",
  "mustPayOff",
  "mustTransferKnowledge",
  "mustShowStateChange",
  "mustNotReveal",
] as const

type ObligationListKey = (typeof OBLIGATION_LIST_KEYS)[number]
type EditableSourceKind = "fact" | "knowledge" | "state" | "payoff"
type SceneBeatInOutline = NonNullable<ChapterOutline["scenes"]>[number]

interface ObligationSourceLink {
  sourceId: string
  sourceKind: EditableSourceKind
  characterId?: string
}

export async function handlePlanningProposalRoute(
  req: Request,
  url: URL,
): Promise<Response | null> {
  const createMatch = /^\/api\/novel\/([^/]+)\/planning-proposals\/?$/.exec(url.pathname)
  if (createMatch) {
    const novelId = decodeURIComponent(createMatch[1]!)
    if (req.method === "GET") return handleListPlanningProposals(url, novelId)
    if (req.method === "POST") return handleCreatePlanningProposal(req, novelId)
    return new Response("Method not allowed", { status: 405 })
  }

  const diffMatch =
    /^\/api\/novel\/([^/]+)\/planning-proposals\/([^/]+)\/diff\/?$/.exec(url.pathname)
  if (diffMatch) {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 })
    const novelId = decodeURIComponent(diffMatch[1]!)
    const envelopeId = decodeURIComponent(diffMatch[2]!)
    return handlePlanningProposalDiff(novelId, envelopeId)
  }

  const resolveMatch =
    /^\/api\/novel\/([^/]+)\/planning-proposals\/([^/]+)\/resolve\/?$/.exec(url.pathname)
  if (resolveMatch) {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })
    const novelId = decodeURIComponent(resolveMatch[1]!)
    const envelopeId = decodeURIComponent(resolveMatch[2]!)
    return handleResolvePlanningProposal(req, novelId, envelopeId)
  }

  return null
}

async function handleListPlanningProposals(
  url: URL,
  novelId: string,
): Promise<Response> {
  try {
    const status = url.searchParams.get("status") ?? "pending"
    const limitRaw = url.searchParams.get("limit")
    const limit = limitRaw != null && /^\d+$/.test(limitRaw)
      ? Math.min(parseInt(limitRaw, 10), 500)
      : 200
    const envelopes = await listPlanningEditEnvelopes(novelId, { status, limit })
    return Response.json({ ok: true, envelopes })
  } catch (err) {
    return Response.json(
      { ok: false, error: `planning proposal list failed: ${String(err)}` },
      { status: 500 },
    )
  }
}

async function handlePlanningProposalDiff(
  novelId: string,
  envelopeId: string,
): Promise<Response> {
  const row = await findEnvelopeById(envelopeId)
  if (!row) {
    return Response.json({ ok: false, error: "envelope not found", envelopeId }, { status: 404 })
  }
  if (row.kind !== "planning_edit") {
    return Response.json(
      { ok: false, error: "envelope kind is not planning_edit", envelopeId, kind: row.kind },
      { status: 422 },
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

  const envelope = rowToPlanningEditEnvelope(row)
  const payloadForDiff = effectivePlanningEditPayload(row, envelope.payload)
  const currentTarget = await loadPlanningEditTargetState(
    novelId,
    payloadForDiff.target,
    {
      action: payloadForDiff.action,
      proposedValue: payloadForDiff.proposedValue,
    },
  ).catch(() => null)

  return Response.json({
    ok: true,
    envelopeId,
    status: envelope.status,
    target: envelope.target,
    precondition: envelope.precondition,
    diff: buildPlanningEditDiff(payloadForDiff),
    currentTarget: currentTarget
      ? {
        currentVersion: currentTarget.currentVersion,
        currentValue: currentTarget.previousValue,
        stale: currentTarget.currentVersion !== envelope.target.currentVersion,
      }
      : null,
    impactPreview: payloadForDiff.impactPreview ?? null,
  })
}

async function handleCreatePlanningProposal(
  req: Request,
  novelId: string,
): Promise<Response> {
  let body: CreateBody
  try {
    const raw = await req.json()
    const parsed = createBodySchema.safeParse(raw)
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

  const actionTargetError = validatePlanningEditActionTarget(body.action, body.target)
  if (actionTargetError) {
    return Response.json({ ok: false, error: actionTargetError, target: body.target }, { status: 400 })
  }
  const typedTarget = body.target as PlanningEditPayload["target"]
  const valueError = validatePlanningEditProposedValue(
    body.action,
    typedTarget,
    body.proposedValue,
  )
  if (valueError) {
    return Response.json({ ok: false, error: valueError }, { status: 400 })
  }

  let impactPreview: PlanningImpactPreview
  try {
    impactPreview = await previewPlanningImpact(novelId, impactPreviewTarget(typedTarget))
  } catch (err) {
    return planningProposalErrorResponse(err, "planning proposal create failed")
  }

  const targetState = await loadPlanningEditTargetState(novelId, typedTarget, {
    action: body.action,
    proposedValue: body.proposedValue,
  })
  if (!targetState) {
    return Response.json(
      { ok: false, error: "planning target not found", target: body.target },
      { status: 404 },
    )
  }
  const semanticError = validatePlanningEditSemantics(
    targetState,
    typedTarget,
    body.action,
    body.proposedValue,
  )
  if (semanticError) {
    return Response.json({ ok: false, error: semanticError, target: body.target }, { status: 400 })
  }
  const previousValue = targetState.previousValue
  if (stableHash(previousValue) === stableHash(body.proposedValue)) {
    return Response.json(
      { ok: false, error: "proposed value matches current value", target: body.target },
      { status: 400 },
    )
  }

  const envelope = buildPlanningEditEnvelope({
    novelId,
    target: targetForEnvelope(typedTarget, targetState.currentVersion),
    action: body.action,
    previousValue,
    proposedValue: body.proposedValue,
    rationale: body.rationale ?? `Operator planning edit for ${planningEditActionLabel(body.action, typedTarget)}`,
    source: {
      agent: body.source?.agent ?? "operator-planning-edit",
      ...(body.source?.userMessage !== undefined ? { userMessage: body.source.userMessage } : {}),
      ...(body.source?.parentEnvelopeId !== undefined
        ? { parentEnvelopeId: body.source.parentEnvelopeId }
        : {}),
    },
    impactPreview: compactImpactPreview(impactPreview),
    now: new Date(),
  })

  const inserted = await insertPlanningEditEnvelope(envelope)
  const outcome: Outcome = {
    kind: "created",
    inserted,
    envelope,
    impactPreview,
    diff: buildPlanningEditDiff(envelope.payload),
  }
  return outcomeToResponse(outcome, null)
}

async function handleResolvePlanningProposal(
  req: Request,
  novelId: string,
  envelopeId: string,
): Promise<Response> {
  let body: ResolveBody
  try {
    const raw = await req.json()
    const parsed = resolveBodySchema.safeParse(raw)
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

  const row = await findEnvelopeById(envelopeId)
  if (!row) {
    return Response.json({ ok: false, error: "envelope not found", envelopeId }, { status: 404 })
  }
  if (row.kind !== "planning_edit") {
    return Response.json(
      { ok: false, error: "envelope kind is not planning_edit", envelopeId, kind: row.kind },
      { status: 422 },
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
      { ok: false, error: "envelope already resolved", envelopeId, actualStatus: row.status },
      { status: 409 },
    )
  }

  const envelope = rowToPlanningEditEnvelope(row)
  const payloadToApply =
    body.status === "modified" && body.modifiedPayload !== undefined
      ? body.modifiedPayload
      : envelope.payload
  if (!planningEditTargetsSameArtifact(envelope.payload, payloadToApply)) {
    return Response.json(
      {
        ok: false,
        error: "modifiedPayload must target the same planning field as the original envelope",
      },
      { status: 400 },
    )
  }
  const valueError = validatePlanningEditProposedValue(
    payloadToApply.action,
    payloadToApply.target,
    payloadToApply.proposedValue,
  )
  if (valueError) return Response.json({ ok: false, error: valueError }, { status: 400 })

  const policyEvaluation = evaluatePolicy(envelope, body.policy ?? DEFAULT_MANUAL_POLICY)

  try {
    const outcome = await db.begin(async (tx) => {
      const resolvedAt = new Date().toISOString()
      if (body.status === "rejected") {
        await persistResolutionOrThrow({
          envelopeId,
          status: "rejected",
          resolvedAt,
          resolvedBy: body.resolvedBy ?? "human",
          operatorNote: body.operatorNote,
          modifiedPayload: null,
          policyEvaluation,
          tx,
        })
        return { kind: "rejected" as const, envelopeId }
      }

      const targetState = await loadPlanningEditTargetState(novelId, payloadToApply.target, {
        action: payloadToApply.action,
        proposedValue: payloadToApply.proposedValue,
        executor: tx,
        forUpdate: true,
      })
      if (!targetState) throw new OutcomeError({ kind: "missing", envelopeId })
      const actualVersion = targetState.currentVersion
      if (actualVersion !== envelope.target.currentVersion) {
        throw new OutcomeError({
          kind: "stale",
          envelopeId,
          expectedVersion: envelope.target.currentVersion,
          actualVersion,
        })
      }
      const semanticError = validatePlanningEditSemantics(
        targetState,
        payloadToApply.target,
        payloadToApply.action,
        payloadToApply.proposedValue,
      )
      if (semanticError) throw new PlanningProposalValidationError(semanticError)

      const applied = await applyResolvedPlanningEdit({
        novelId,
        targetState,
        payload: payloadToApply,
        tx,
      })

      await persistResolutionOrThrow({
        envelopeId,
        status: body.status,
        resolvedAt,
        resolvedBy: body.resolvedBy ?? "human",
        operatorNote: body.operatorNote,
        modifiedPayload: body.status === "modified" ? payloadToApply : null,
        policyEvaluation,
        tx,
      })

      const scalarLineageId = planningLineageId(envelopeId, actualVersion, applied.nextVersion)
      await recordPlanningMutationLineage(
        {
          id: scalarLineageId,
          proposalId: envelopeId,
          proposalKind: "planning_edit",
          novelId,
          sourceTable: "proposal_envelopes",
          actorKind: body.resolvedBy ?? "human",
          source: envelope.source.agent,
          targetKind: envelope.target.kind,
          previousRef: targetState.ref,
          nextRef: applied.nextRef,
          fieldPath: payloadToApply.target.fieldPath ?? payloadToApply.action,
          previousVersion: actualVersion,
          nextVersion: applied.nextVersion,
          preconditionKind: envelope.precondition.kind,
          preconditionHash: envelope.precondition.hash,
          changedAt: resolvedAt,
          reason: body.operatorNote ?? envelope.rationale,
          affectedDownstreamRefs: affectedRefsFromImpactPreview(envelope.payload.impactPreview),
          metadata: {
            previousValue: targetState.previousValue,
            proposedValue: payloadToApply.proposedValue,
            resolutionStatus: body.status,
            ...applied.metadata,
          },
        },
        tx,
      )

      for (const structuralLineage of applied.structuralLineage) {
        await recordPlanningMutationLineage(
          {
            id: structuralPlanningLineageId(envelopeId, structuralLineage),
            proposalId: envelopeId,
            proposalKind: "planning_edit",
            novelId,
            sourceTable: "proposal_envelopes",
            actorKind: body.resolvedBy ?? "human",
            source: envelope.source.agent,
            targetKind: structuralLineage.targetKind,
            previousRef: structuralLineage.previousRef,
            nextRef: structuralLineage.nextRef,
            fieldPath: structuralLineage.fieldPath,
            previousVersion: structuralLineage.previousVersion,
            nextVersion: structuralLineage.nextVersion,
            preconditionKind: envelope.precondition.kind,
            preconditionHash: envelope.precondition.hash,
            changedAt: resolvedAt,
            reason: body.operatorNote ?? envelope.rationale,
            affectedDownstreamRefs: affectedRefsFromImpactPreview(envelope.payload.impactPreview),
            metadata: {
              ...structuralLineage.metadata,
              resolutionStatus: body.status,
              parentLineageId: scalarLineageId,
            },
          },
          tx,
        )
      }

      return {
        kind: "applied" as const,
        envelopeId,
        status: body.status,
        newVersion: applied.nextVersion,
        diff: buildPlanningEditDiff(payloadToApply),
      }
    })
    return outcomeToResponse(outcome, policyEvaluation)
  } catch (err) {
    if (err instanceof OutcomeError) return outcomeToResponse(err.outcome, policyEvaluation)
    if (err instanceof PlanningProposalValidationError) {
      return Response.json({ ok: false, error: err.message }, { status: 400 })
    }
    return Response.json(
      { ok: false, error: `planning proposal resolve failed: ${String(err)}` },
      { status: 500 },
    )
  }
}

async function persistResolutionOrThrow(args: {
  envelopeId: string
  status: "approved" | "rejected" | "modified"
  resolvedAt: string
  resolvedBy: "human" | "policy" | "script" | "test"
  operatorNote?: string
  modifiedPayload: PlanningEditPayload | null
  policyEvaluation: PolicyEvaluation
  tx: typeof db
}): Promise<void> {
  const updated = await updateEnvelopeResolution(
    {
      id: args.envelopeId,
      status: args.status,
      resolvedAt: args.resolvedAt,
      resolvedByKind: args.resolvedBy,
      resolvedByRef: null,
      resolvedNote: args.operatorNote ?? null,
      modifiedPayload: args.modifiedPayload,
      policyDecision: args.policyEvaluation.decision,
      policyVersion: args.policyEvaluation.policyVersion,
      policyReasons: args.policyEvaluation.reasons,
    },
    args.tx,
  )
  if (updated) return
  const fresh = await findEnvelopeById(args.envelopeId, args.tx)
  throw new OutcomeError({
    kind: "alreadyResolved",
    envelopeId: args.envelopeId,
    actualStatus: fresh?.status ?? "missing",
  })
}

function readChapterOutlineField(
  outline: ChapterOutline,
  fieldPath: ChapterOutlinePlanningEditField,
): unknown {
  return outline[fieldPath]
}

interface PlanningEditTargetState {
  outline?: ChapterOutline
  seed?: SeedInput
  character?: CharacterProfile
  world?: WorldBible
  spine?: StorySpine
  ref: string
  currentVersion: string
  previousValue: unknown
}

async function loadPlanningEditTargetState(
  novelId: string,
  target: PlanningEditPayload["target"],
  opts: {
    action?: PlanningEditAction
    proposedValue?: unknown
    executor?: typeof db
    forUpdate?: boolean
  } = {},
): Promise<PlanningEditTargetState | null> {
  const action = opts.action ?? "field_replace"
  if (target.kind === "planning_directive") {
    const novel = await getNovel(novelId, opts).catch(() => null)
    if (!novel) return null
    const seed = normalizeSeedDirectives(novel.seed)
    return {
      seed,
      ref: target.ref,
      currentVersion: stableHash(readPlanningDirectiveField(seed, target.fieldPath)),
      previousValue: readPlanningDirectiveField(seed, target.fieldPath),
    }
  }
  if (target.kind === "character") {
    const character = await getCharacterById(novelId, target.ref, opts)
    if (!character) return null
    return {
      character,
      ref: character.id,
      currentVersion: stableHash(character),
      previousValue: readCharacterBibleField(character, target.fieldPath),
    }
  }
  if (target.kind === "world_bible") {
    const world = await getWorldBible(novelId, opts).catch(() => null)
    if (!world) return null
    return {
      world,
      ref: target.ref,
      currentVersion: stableHash(world),
      previousValue: readWorldBibleField(world, target.fieldPath),
    }
  }
  if (target.kind === "story_spine") {
    const spine = await getStorySpine(novelId, opts).catch(() => null)
    if (!spine) return null
    return {
      spine,
      ref: target.ref,
      currentVersion: stableHash(spine),
      previousValue: readStorySpineField(spine, target.fieldPath),
    }
  }
  if (target.kind === "chapter_outline") {
    const stored = await getChapterOutlineByChapterId(novelId, target.ref, opts)
    if (!stored) return null
    const outline = normalizeChapterOutlineForPersistence(stored.outline)
    if (action === "beat_reorder") {
      return {
        outline,
        ref: outline.chapterId ?? target.ref,
        currentVersion: stableHash(beatOrder(outline)),
        previousValue: beatOrder(outline),
      }
    }
    return {
      outline,
      ref: outline.chapterId ?? target.ref,
      currentVersion: stableHash(outline),
      previousValue: readChapterOutlineField(outline, target.fieldPath as ChapterOutlinePlanningEditField),
    }
  }
  if (target.kind === "beat_plan") {
    const stored = await getChapterOutlineByBeatId(novelId, target.ref, opts)
    if (!stored) return null
    const outline = normalizeChapterOutlineForPersistence(stored.outline)
    const beat = findBeat(outline, target.ref)
    if (!beat) return null
    if (action === "beat_replace") {
      return {
        outline,
        ref: beat.beatId ?? target.ref,
        currentVersion: stableHash(beat),
        previousValue: beat,
      }
    }
    if (action === "beat_obligation_reorder") {
      const listKey = reorderListKey(opts.proposedValue)
      if (!listKey) return null
      return {
        outline,
        ref: beat.beatId ?? target.ref,
        currentVersion: stableHash(obligationOrder(beat, listKey)),
        previousValue: {
          listKey,
          order: obligationOrder(beat, listKey),
        },
      }
    }
    return {
      outline,
      ref: beat.beatId ?? target.ref,
      currentVersion: stableHash(beat),
      previousValue: readBeatField(beat, target.fieldPath as BeatPlanPlanningEditField),
    }
  }
  const stored = await getChapterOutlineByObligationId(novelId, target.ref, opts)
  if (!stored) return null
  const outline = normalizeChapterOutlineForPersistence(stored.outline)
  const obligation = findObligation(outline, target.ref)
  if (!obligation) return null
  if (action === "beat_obligation_replace") {
    return {
      outline,
      ref: typeof obligation.obligationId === "string" ? obligation.obligationId : target.ref,
      currentVersion: stableHash(obligation),
      previousValue: obligation,
    }
  }
  return {
    outline,
    ref: typeof obligation.obligationId === "string" ? obligation.obligationId : target.ref,
    currentVersion: stableHash(obligation),
    previousValue: readObligationField(obligation, target.fieldPath as BeatObligationPlanningEditField),
  }
}

function applyPlanningEditField(
  outline: ChapterOutline,
  target: PlanningEditPayload["target"],
  value: unknown,
): ChapterOutline {
  const next = JSON.parse(JSON.stringify(outline)) as ChapterOutline
  if (target.kind === "chapter_outline") {
    ;(next as Record<string, unknown>)[target.fieldPath as ChapterOutlinePlanningEditField] = value
    return normalizeChapterOutlineForPersistence(next)
  }
  if (target.kind === "beat_plan") {
    const beat = findBeat(next, target.ref)
    if (!beat) return normalizeChapterOutlineForPersistence(next)
    ;(beat as Record<string, unknown>)[target.fieldPath as BeatPlanPlanningEditField] = value
    return normalizeChapterOutlineForPersistence(next)
  }
  const obligation = findObligation(next, target.ref)
  if (!obligation) return normalizeChapterOutlineForPersistence(next)
  if (target.fieldPath === "sourceLink") {
    const sourceLink = parseSourceLinkValue(value)
    if (!sourceLink) throw new Error("invalid sourceLink payload")
    obligation.sourceId = sourceLink.sourceId
    obligation.sourceKind = sourceLink.sourceKind
    if (sourceLink.characterId !== undefined) obligation.characterId = sourceLink.characterId
    else delete obligation.characterId
    return normalizeChapterOutlineForPersistence(next)
  }
  obligation[target.fieldPath as BeatObligationPlanningEditField] = value
  return normalizeChapterOutlineForPersistence(next)
}

function applyPlanningStructuralEdit(
  outline: ChapterOutline,
  payload: PlanningEditPayload,
): ChapterOutline {
  const next = JSON.parse(JSON.stringify(outline)) as ChapterOutline
  if (payload.action === "beat_replace") {
    const scenes = next.scenes ?? []
    const index = scenes.findIndex((beat) => beat.beatId === payload.target.ref)
    if (index >= 0) scenes[index] = payload.proposedValue as SceneBeatInOutline
    next.scenes = scenes
    return normalizeChapterOutlineForPersistence(next)
  }
  if (payload.action === "beat_reorder") {
    const byId = new Map((next.scenes ?? []).map((beat) => [beat.beatId, beat]))
    next.scenes = (payload.proposedValue as string[])
      .map((beatId) => byId.get(beatId))
      .filter((beat): beat is SceneBeatInOutline => beat !== undefined)
    return normalizeChapterOutlineForPersistence(next)
  }
  if (payload.action === "beat_obligation_replace") {
    const context = findObligationContext(next, payload.target.ref)
    if (!context) return normalizeChapterOutlineForPersistence(next)
    const obligations = context.beat.obligations as Record<string, unknown>
    const list = obligations[context.listKey]
    if (Array.isArray(list)) list[context.itemIndex] = payload.proposedValue
    return normalizeChapterOutlineForPersistence(next)
  }
  if (payload.action === "beat_obligation_reorder") {
    const beat = findBeat(next, payload.target.ref)
    const reorder = readObligationReorder(payload.proposedValue)
    if (!beat || !reorder) return normalizeChapterOutlineForPersistence(next)
    const obligations = beat.obligations as Record<string, unknown>
    const list = obligations[reorder.listKey]
    if (!Array.isArray(list)) return normalizeChapterOutlineForPersistence(next)
    const byId = new Map(list.map((item) => [
      typeof item === "object" && item !== null && !Array.isArray(item)
        ? (item as { obligationId?: unknown }).obligationId
        : undefined,
      item,
    ]))
    obligations[reorder.listKey] = reorder.order
      .map((obligationId) => byId.get(obligationId))
      .filter((item) => item !== undefined)
    return normalizeChapterOutlineForPersistence(next)
  }
  return next
}

async function applyResolvedPlanningEdit(args: {
  novelId: string
  targetState: PlanningEditTargetState
  payload: PlanningEditPayload
  tx: typeof db
}): Promise<{
  nextVersion: string
  nextRef: string
  metadata: Record<string, unknown>
  structuralLineage: StructuralPlanningMutationLineageDraft[]
}> {
  const target = args.payload.target
  const proposedValue = args.payload.proposedValue
  if (target.kind === "planning_directive") {
    if (!args.targetState.seed) {
      throw new PlanningProposalValidationError("planning directive target state missing seed")
    }
    const nextSeed = applyPlanningDirectiveField(
      args.targetState.seed,
      target.fieldPath,
      proposedValue,
    )
    await updateNovelSeed(args.novelId, nextSeed, args.tx)
    return {
      nextVersion: stableHash(readPlanningDirectiveField(nextSeed, target.fieldPath)),
      nextRef: target.ref,
      metadata: {
        directiveKey: target.fieldPath,
      },
      structuralLineage: [],
    }
  }
  if (target.kind === "character") {
    if (!args.targetState.character) {
      throw new PlanningProposalValidationError("character target state missing profile")
    }
    const updated = await updateCharacterFields(
      args.novelId,
      target.ref,
      { [target.fieldPath]: proposedValue },
      args.tx,
    )
    return {
      nextVersion: stableHash(updated),
      nextRef: updated.id,
      metadata: {
        characterId: updated.id,
        characterName: updated.name,
      },
      structuralLineage: [],
    }
  }
  if (target.kind === "world_bible") {
    if (!args.targetState.world) {
      throw new PlanningProposalValidationError("world bible target state missing artifact")
    }
    const updated = await updateWorldBibleFields(
      args.novelId,
      { [target.fieldPath]: proposedValue },
      args.tx,
    )
    return {
      nextVersion: stableHash(updated),
      nextRef: target.ref,
      metadata: {
        artifactKind: "world_bible",
      },
      structuralLineage: [],
    }
  }
  if (target.kind === "story_spine") {
    if (!args.targetState.spine) {
      throw new PlanningProposalValidationError("story spine target state missing artifact")
    }
    const updated = await updateStorySpineFields(
      args.novelId,
      { [target.fieldPath]: proposedValue },
      args.tx,
    )
    return {
      nextVersion: stableHash(updated),
      nextRef: target.ref,
      metadata: {
        artifactKind: "story_spine",
      },
      structuralLineage: [],
    }
  }

  if (!args.targetState.outline) {
    throw new PlanningProposalValidationError("planning edit target state missing outline")
  }
  const nextOutline = args.payload.action === "field_replace"
    ? applyPlanningEditField(args.targetState.outline, target, proposedValue)
    : applyPlanningStructuralEdit(args.targetState.outline, args.payload)
  const normalizedNext = normalizeChapterOutlineForPersistence(nextOutline)
  await saveChapterOutline(args.novelId, normalizedNext, args.tx)
  return {
    nextVersion: targetVersion(normalizedNext, args.payload),
    nextRef: targetRef(normalizedNext, args.payload),
    metadata: {
      containingChapterId: normalizedNext.chapterId,
      containingChapterNumber: normalizedNext.chapterNumber,
    },
    structuralLineage: collectStructuralPlanningMutationLineage(
      args.targetState.outline,
      normalizedNext,
    ),
  }
}

function applyPlanningDirectiveField(
  seed: SeedInput,
  fieldPath: PlanningDirectivePlanningEditField,
  value: unknown,
): SeedInput {
  const next = JSON.parse(JSON.stringify(seed)) as SeedInput
  const directives = normalizePlanningDirectives(next.directives)
  if (fieldPath === "tonalAnchors") directives.tonalAnchors = [...(value as string[])]
  else directives.rawNotes = value as string
  next.directives = directives
  return next
}

function normalizeSeedDirectives(seed: SeedInput): SeedInput {
  return {
    ...seed,
    directives: normalizePlanningDirectives(seed.directives),
  }
}

function normalizePlanningDirectives(value: SeedInput["directives"]): PlanningDirectives {
  const raw = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Partial<PlanningDirectives>
    : {}
  const rawStructural =
    typeof raw.structuralConstraints === "object" &&
    raw.structuralConstraints !== null &&
    !Array.isArray(raw.structuralConstraints)
      ? raw.structuralConstraints
      : {}
  return {
    ...emptyDirectives,
    ...raw,
    lockedCharacters: Array.isArray(raw.lockedCharacters) ? raw.lockedCharacters : [],
    requiredBeats: Array.isArray(raw.requiredBeats) ? raw.requiredBeats : [],
    forbidden: Array.isArray(raw.forbidden) ? raw.forbidden : [],
    tonalAnchors: Array.isArray(raw.tonalAnchors) ? raw.tonalAnchors : [],
    structuralConstraints: {
      ...emptyDirectives.structuralConstraints,
      ...rawStructural,
    },
    rawNotes: typeof raw.rawNotes === "string" ? raw.rawNotes : "",
  }
}

function readPlanningDirectiveField(
  seed: SeedInput,
  fieldPath: PlanningDirectivePlanningEditField,
): unknown {
  const directives = normalizePlanningDirectives(seed.directives)
  return directives[fieldPath]
}

function readCharacterBibleField(
  character: CharacterProfile,
  fieldPath: CharacterBiblePlanningEditField,
): unknown {
  return character[fieldPath] ?? ""
}

function readWorldBibleField(
  world: WorldBible,
  fieldPath: WorldBiblePlanningEditField,
): unknown {
  return world[fieldPath] ?? ""
}

function readStorySpineField(
  spine: StorySpine,
  fieldPath: StorySpinePlanningEditField,
): unknown {
  return spine[fieldPath] ?? ""
}

function readBeatField(
  beat: NonNullable<ChapterOutline["scenes"]>[number],
  fieldPath: BeatPlanPlanningEditField,
): unknown {
  return (beat as Record<string, unknown>)[fieldPath]
}

function readObligationField(
  obligation: Record<string, unknown>,
  fieldPath: BeatObligationPlanningEditField,
): unknown {
  if (fieldPath === "sourceLink") return sourceLinkFromObligation(obligation)
  return obligation[fieldPath]
}

function findBeat(
  outline: ChapterOutline,
  beatId: string,
): NonNullable<ChapterOutline["scenes"]>[number] | null {
  return (outline.scenes ?? []).find((beat) => beat.beatId === beatId) ?? null
}

function findObligation(
  outline: ChapterOutline,
  obligationId: string,
): Record<string, unknown> | null {
  return findObligationContext(outline, obligationId)?.obligation ?? null
}

function findObligationContext(
  outline: ChapterOutline,
  obligationId: string,
): {
  beat: SceneBeatInOutline
  beatIndex: number
  listKey: ObligationListKey
  itemIndex: number
  obligation: Record<string, unknown>
} | null {
  const scenes = outline.scenes ?? []
  for (let beatIndex = 0; beatIndex < scenes.length; beatIndex++) {
    const beat = scenes[beatIndex]
    const obligations = beat.obligations as Record<string, unknown> | undefined
    if (!obligations) continue
    for (const listKey of OBLIGATION_LIST_KEYS) {
      const value = obligations[listKey]
      if (!Array.isArray(value)) continue
      for (const item of value) {
        if (
          typeof item === "object" &&
          item !== null &&
          !Array.isArray(item) &&
          (item as { obligationId?: unknown }).obligationId === obligationId
        ) {
          return {
            beat,
            beatIndex,
            listKey,
            itemIndex: value.indexOf(item),
            obligation: item as Record<string, unknown>,
          }
        }
      }
    }
  }
  return null
}

function beatOrder(outline: ChapterOutline): string[] {
  return (outline.scenes ?? [])
    .map((beat) => beat.beatId)
    .filter((beatId): beatId is string => typeof beatId === "string" && beatId.length > 0)
}

function obligationOrder(beat: SceneBeatInOutline, listKey: ObligationListKey): string[] {
  const obligations = beat.obligations as Record<string, unknown> | undefined
  const list = obligations?.[listKey]
  if (!Array.isArray(list)) return []
  return list
    .map((item) =>
      typeof item === "object" && item !== null && !Array.isArray(item)
        ? (item as { obligationId?: unknown }).obligationId
        : undefined
    )
    .filter((obligationId): obligationId is string =>
      typeof obligationId === "string" && obligationId.length > 0
    )
}

function readObligationReorder(value: unknown): {
  listKey: ObligationListKey
  order: string[]
} | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!isObligationListKey(record.listKey)) return null
  if (!Array.isArray(record.order) || !record.order.every((item) => typeof item === "string")) {
    return null
  }
  return { listKey: record.listKey, order: record.order as string[] }
}

function reorderListKey(value: unknown): ObligationListKey | null {
  return readObligationReorder(value)?.listKey ?? null
}

function isObligationListKey(value: unknown): value is ObligationListKey {
  return typeof value === "string" &&
    (OBLIGATION_LIST_KEYS as readonly string[]).includes(value)
}

function validateExactOrderChange(
  label: string,
  currentOrder: readonly string[],
  proposedOrder: readonly string[],
): string | null {
  const currentSet = new Set(currentOrder)
  const proposedSet = new Set(proposedOrder)
  const missing = currentOrder.filter((id) => !proposedSet.has(id))
  const unknown = proposedOrder.filter((id) => !currentSet.has(id))
  if (
    currentOrder.length !== proposedOrder.length ||
    missing.length > 0 ||
    unknown.length > 0
  ) {
    return `${label} must contain exactly the current IDs; missing=${missing.join(",") || "(none)"} unknown=${unknown.join(",") || "(none)"}`
  }
  if (currentOrder.every((id, index) => proposedOrder[index] === id)) {
    return `${label} matches current order`
  }
  return null
}

function validatePlanningEditSemantics(
  targetState: PlanningEditTargetState,
  target: PlanningEditPayload["target"],
  action: PlanningEditAction,
  proposedValue: unknown,
): string | null {
  if (action === "beat_reorder") {
    if (!targetState.outline) return "beat_reorder target state missing outline"
    return validateExactOrderChange(
      "beat_reorder proposedValue",
      beatOrder(targetState.outline),
      proposedValue as string[],
    )
  }
  if (action === "beat_replace") {
    if (!targetState.outline) return "beat_replace target state missing outline"
    const proposed = proposedValue as Record<string, unknown>
    const proposedBeatId = typeof proposed.beatId === "string" ? proposed.beatId : ""
    if (findBeat(targetState.outline, proposedBeatId)) {
      return `beat_replace proposedValue.beatId ${proposedBeatId} already exists`
    }
    return null
  }
  if (action === "beat_obligation_replace") {
    if (!targetState.outline) return "beat_obligation_replace target state missing outline"
    const context = findObligationContext(targetState.outline, target.ref)
    if (!context) return "beat_obligation_replace target not found"
    const proposed = proposedValue as Record<string, unknown>
    const proposedObligationId = typeof proposed.obligationId === "string"
      ? proposed.obligationId
      : ""
    if (findObligation(targetState.outline, proposedObligationId)) {
      return `beat_obligation_replace proposedValue.obligationId ${proposedObligationId} already exists`
    }
    if (context.listKey === "mustNotReveal") {
      return sourceLinkFromObligation(proposed)
        ? "mustNotReveal obligations do not support source-link replacements"
        : null
    }
    const nextLink = sourceLinkFromObligation(proposed)
    if (!nextLink) return "obligation replacement would leave the obligation without sourceId/sourceKind"
    return validateObligationSourceLink(targetState.outline, context, nextLink)
  }
  if (action === "beat_obligation_reorder") {
    if (!targetState.outline) return "beat_obligation_reorder target state missing outline"
    const beat = findBeat(targetState.outline, target.ref)
    if (!beat) return "beat_obligation_reorder target beat not found"
    const reorder = readObligationReorder(proposedValue)
    if (!reorder) return "beat_obligation_reorder proposedValue is invalid"
    return validateExactOrderChange(
      "beat_obligation_reorder proposedValue.order",
      obligationOrder(beat, reorder.listKey),
      reorder.order,
    )
  }

  if (target.kind === "planning_directive") {
    return target.ref === target.fieldPath
      ? null
      : "planning directive ref must match fieldPath"
  }
  if (target.kind === "world_bible" || target.kind === "story_spine") {
    return target.ref === "" ? `${target.kind} ref must be non-empty` : null
  }
  if (target.kind !== "beat_obligation") return null
  const fieldPath = target.fieldPath as BeatObligationPlanningEditField
  if (fieldPath === "text") return null

  if (!targetState.outline) return "beat obligation target state missing outline"
  const context = findObligationContext(targetState.outline, target.ref)
  if (!context) return "beat obligation target not found"
  if (context.listKey === "mustNotReveal") {
    return "mustNotReveal obligations do not support source-link edits"
  }

  const nextLink = sourceLinkAfterEdit(context.obligation, fieldPath, proposedValue)
  if (!nextLink) return "source-link edit would leave the obligation without sourceId/sourceKind"
  return validateObligationSourceLink(targetState.outline, context, nextLink)
}

function sourceLinkAfterEdit(
  obligation: Record<string, unknown>,
  fieldPath: BeatObligationPlanningEditField,
  proposedValue: unknown,
): ObligationSourceLink | null {
  if (fieldPath === "sourceLink") return parseSourceLinkValue(proposedValue)
  const current = sourceLinkFromObligation(obligation)
  if (!current) return null
  const next: ObligationSourceLink = { ...current }
  if (fieldPath === "sourceId") {
    if (typeof proposedValue !== "string") return null
    next.sourceId = proposedValue
  } else if (fieldPath === "sourceKind") {
    if (!isEditableSourceKind(proposedValue)) return null
    next.sourceKind = proposedValue
  } else if (fieldPath === "characterId") {
    if (typeof proposedValue !== "string") return null
    next.characterId = proposedValue
  } else {
    return null
  }
  return next
}

function sourceLinkFromObligation(
  obligation: Record<string, unknown>,
): ObligationSourceLink | null {
  const sourceId = typeof obligation.sourceId === "string" ? obligation.sourceId : undefined
  const sourceKind = obligation.sourceKind
  if (!sourceId || !isEditableSourceKind(sourceKind)) return null
  return {
    sourceId,
    sourceKind,
    ...(typeof obligation.characterId === "string" ? { characterId: obligation.characterId } : {}),
  }
}

function parseSourceLinkValue(value: unknown): ObligationSourceLink | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const sourceId = typeof record.sourceId === "string" ? record.sourceId : undefined
  const sourceKind = record.sourceKind
  if (!sourceId || !isEditableSourceKind(sourceKind)) return null
  return {
    sourceId,
    sourceKind,
    ...(typeof record.characterId === "string" ? { characterId: record.characterId } : {}),
  }
}

function isEditableSourceKind(value: unknown): value is EditableSourceKind {
  return value === "fact" || value === "knowledge" || value === "state" || value === "payoff"
}

function validateObligationSourceLink(
  outline: ChapterOutline,
  context: NonNullable<ReturnType<typeof findObligationContext>>,
  link: ObligationSourceLink,
): string | null {
  if (!obligationListAcceptsSourceKind(context.listKey, link.sourceKind)) {
    return `${context.listKey} cannot reference sourceKind ${link.sourceKind}`
  }

  if (link.sourceKind === "fact" || link.sourceKind === "payoff") {
    if (link.characterId !== undefined) {
      return `characterId is not valid for ${link.sourceKind} obligation source links`
    }
    if (!(outline.establishedFacts ?? []).some((fact) => fact.id === link.sourceId)) {
      return `sourceId ${link.sourceId} does not reference an established fact`
    }
    if (link.sourceKind === "payoff") {
      const payoffPlacement = findPayoffPlacement(outline, link.sourceId)
      if (!payoffPlacement) {
        return `sourceKind=payoff requires a requiredPayoffs link for ${link.sourceId}`
      }
      if (payoffPlacement.beatId && payoffPlacement.beatId !== context.beat.beatId) {
        return `sourceKind=payoff for ${link.sourceId} must land on ${payoffPlacement.beatId}`
      }
    }
  }

  if (link.sourceKind === "knowledge" || link.sourceKind === "state") {
    const source = findCharacterScopedSource(outline, link.sourceId, link.sourceKind)
    if (!source) {
      return `sourceId ${link.sourceId} does not reference a ${link.sourceKind} item`
    }
    if (link.characterId !== source.characterId) {
      return `characterId ${link.characterId ?? "(missing)"} does not match ${source.characterId} for ${link.sourceId}`
    }
    if (!beatIncludesCharacter(context.beat, source.characterName)) {
      return `${source.characterName} (${source.characterId}) is not present in beat ${context.beat.beatId ?? "(missing-beatId)"}`
    }
  }

  const obligationList = (
    (context.beat.obligations as Record<string, unknown> | undefined)?.[context.listKey] ?? []
  ) as unknown[]
  const duplicate = obligationList.some((item) =>
    item !== context.obligation &&
    typeof item === "object" &&
    item !== null &&
    !Array.isArray(item) &&
    (item as { sourceId?: unknown }).sourceId === link.sourceId
  )
  return duplicate
    ? `${context.beat.beatId ?? "(missing-beatId)"} ${context.listKey} already references sourceId ${link.sourceId}`
    : null
}

function obligationListAcceptsSourceKind(
  listKey: ObligationListKey,
  sourceKind: EditableSourceKind,
): boolean {
  if (listKey === "mustEstablish") return sourceKind === "fact"
  if (listKey === "mustPayOff") return sourceKind === "fact" || sourceKind === "payoff"
  if (listKey === "mustTransferKnowledge") return sourceKind === "knowledge"
  if (listKey === "mustShowStateChange") return sourceKind === "state"
  return false
}

function findCharacterScopedSource(
  outline: ChapterOutline,
  sourceId: string,
  sourceKind: "knowledge" | "state",
): { characterId: string; characterName: string } | null {
  if (sourceKind === "knowledge") {
    const source = (outline.knowledgeChanges ?? []).find((item) =>
      (item as { id?: unknown }).id === sourceId
    )
    if (!source) return null
    return {
      characterId: typeof (source as { characterId?: unknown }).characterId === "string"
        ? (source as { characterId: string }).characterId
        : characterIdFromName(source.characterName),
      characterName: source.characterName,
    }
  }
  const source = (outline.characterStateChanges ?? []).find((item) =>
    (item as { id?: unknown }).id === sourceId
  )
  if (!source) return null
  return {
    characterId: typeof (source as { characterId?: unknown }).characterId === "string"
      ? (source as { characterId: string }).characterId
      : characterIdFromName(source.name),
    characterName: source.name,
  }
}

function findPayoffPlacement(
  outline: ChapterOutline,
  factId: string,
): { beatId: string | null } | null {
  const scenes = outline.scenes ?? []
  for (const beat of scenes) {
    for (const link of beat.requiredPayoffs ?? []) {
      if (link.fact_id?.trim() !== factId) continue
      if (
        !Number.isInteger(link.payoff_beat) ||
        link.payoff_beat < 0 ||
        link.payoff_beat >= scenes.length
      ) {
        return { beatId: null }
      }
      return { beatId: scenes[link.payoff_beat].beatId ?? null }
    }
  }
  return null
}

function beatIncludesCharacter(beat: SceneBeatInOutline, characterName: string): boolean {
  return (beat.characters ?? []).some((name) => sameCharacterName(name, characterName))
}

function sameCharacterName(a: string, b: string): boolean {
  const aAliases = nameAliases(a)
  const bAliases = nameAliases(b)
  for (const alias of aAliases) if (bAliases.has(alias)) return true
  return false
}

function nameAliases(name: string): Set<string> {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  const aliases = new Set<string>()
  if (!normalized) return aliases
  aliases.add(normalized)
  const parts = normalized.split(/\s+/).filter((part) => part.length >= 3)
  if (parts[0]) aliases.add(parts[0])
  if (parts.length > 1) aliases.add(parts[parts.length - 1])
  return aliases
}

function targetVersion(
  outline: ChapterOutline,
  payload: PlanningEditPayload,
): string {
  const target = payload.target
  if (payload.action === "beat_reorder") return stableHash(beatOrder(outline))
  if (payload.action === "beat_obligation_reorder") {
    const beat = findBeat(outline, target.ref)
    const reorder = readObligationReorder(payload.proposedValue)
    return stableHash(beat && reorder ? obligationOrder(beat, reorder.listKey) : null)
  }
  if (payload.action === "beat_replace") {
    const proposed = payload.proposedValue as Record<string, unknown>
    const beatId = typeof proposed.beatId === "string" ? proposed.beatId : target.ref
    return stableHash(findBeat(outline, beatId) ?? null)
  }
  if (payload.action === "beat_obligation_replace") {
    const proposed = payload.proposedValue as Record<string, unknown>
    const obligationId = typeof proposed.obligationId === "string"
      ? proposed.obligationId
      : target.ref
    return stableHash(findObligation(outline, obligationId) ?? null)
  }
  if (target.kind === "chapter_outline") return stableHash(outline)
  if (target.kind === "beat_obligation") {
    const obligation = findObligation(outline, target.ref)
    return stableHash(obligation ?? null)
  }
  const beat = findBeat(outline, target.ref)
  return stableHash(beat ?? null)
}

function targetRef(
  outline: ChapterOutline,
  payload: PlanningEditPayload,
): string {
  const target = payload.target
  if (payload.action === "beat_replace") {
    const proposed = payload.proposedValue as Record<string, unknown>
    return typeof proposed.beatId === "string" ? proposed.beatId : target.ref
  }
  if (payload.action === "beat_obligation_replace") {
    const proposed = payload.proposedValue as Record<string, unknown>
    return typeof proposed.obligationId === "string" ? proposed.obligationId : target.ref
  }
  if (target.kind === "chapter_outline") return outline.chapterId ?? target.ref
  if (target.kind === "beat_obligation") {
    const obligation = findObligation(outline, target.ref)
    return typeof obligation?.obligationId === "string" ? obligation.obligationId : target.ref
  }
  const beat = findBeat(outline, target.ref)
  return beat?.beatId ?? target.ref
}

function targetForEnvelope(
  target: PlanningEditPayload["target"],
  currentVersion: string,
): Parameters<typeof buildPlanningEditEnvelope>[0]["target"] {
  return {
    kind: target.kind,
    ref: target.ref,
    ...(target.fieldPath !== undefined ? { fieldPath: target.fieldPath } : {}),
    currentVersion,
  } as Parameters<typeof buildPlanningEditEnvelope>[0]["target"]
}

function impactPreviewTarget(
  target: PlanningEditPayload["target"],
): Parameters<typeof previewPlanningImpact>[1] {
  if (target.fieldPath === "self" || target.fieldPath === "obligations") {
    return { kind: target.kind, ref: target.ref }
  }
  return target
}

function planningEditActionLabel(
  action: PlanningEditAction,
  target: PlanningEditPayload["target"],
): string {
  return `${target.kind}:${target.ref}:${target.fieldPath ?? action}`
}

function compactImpactPreview(
  preview: PlanningImpactPreview,
): PlanningEditImpactSnapshot {
  return {
    planningSnapshotVersion: preview.planningSnapshotVersion,
    planningSnapshotHash: preview.planningSnapshotHash,
    impacts: preview.impacts.map((impact) => ({
      kind: impact.kind,
      reason: impact.reason,
      target: impact.target,
      ...(impact.location !== undefined
        ? { location: { ...impact.location } as Record<string, unknown> }
        : {}),
      ...(impact.metadata !== undefined ? { metadata: impact.metadata } : {}),
    })),
  }
}

function effectivePlanningEditPayload(
  row: { status: string; modified_payload?: unknown | null },
  fallback: PlanningEditPayload,
): PlanningEditPayload {
  if (row.status !== "modified" || row.modified_payload == null) return fallback
  const raw = typeof row.modified_payload === "string"
    ? JSON.parse(row.modified_payload)
    : row.modified_payload
  const parsed = planningEditPayloadSchema.safeParse(raw)
  if (!parsed.success) return fallback
  return planningEditTargetsSameArtifact(fallback, parsed.data) ? parsed.data : fallback
}

function affectedRefsFromImpactPreview(
  preview: PlanningEditImpactSnapshot | undefined,
): Array<{
  kind: string
  ref: string
  fieldPath?: string
  reason?: string
  location?: Record<string, unknown>
  metadata?: Record<string, unknown>
}> {
  if (!preview) return []
  return preview.impacts.map((impact) => ({
    kind: impact.target.kind,
    ref: impact.target.ref,
    ...(impact.target.fieldPath !== undefined ? { fieldPath: impact.target.fieldPath } : {}),
    ...(impact.reason !== undefined ? { reason: impact.reason } : {}),
    ...(impact.location !== undefined ? { location: impact.location } : {}),
    ...(impact.metadata !== undefined ? { metadata: impact.metadata } : {}),
  }))
}

function planningLineageId(
  envelopeId: string,
  previousVersion: string,
  nextVersion: string,
): string {
  return `lineage:${envelopeId}:${stableHash({ previousVersion, nextVersion }).slice(0, 16)}`
}

function structuralPlanningLineageId(
  envelopeId: string,
  lineage: StructuralPlanningMutationLineageDraft,
): string {
  return `lineage:${envelopeId}:structural:${
    stableHash({
      targetKind: lineage.targetKind,
      previousRef: lineage.previousRef,
      nextRef: lineage.nextRef,
      fieldPath: lineage.fieldPath,
      previousVersion: lineage.previousVersion,
      nextVersion: lineage.nextVersion,
      structuralOperation: lineage.metadata.structuralOperation,
    }).slice(0, 16)
  }`
}

function outcomeToResponse(
  outcome: Outcome,
  policyEvaluation: PolicyEvaluation | null,
): Response {
  switch (outcome.kind) {
    case "created":
      return Response.json({
        ok: true,
        inserted: outcome.inserted,
        envelope: outcome.envelope,
        impactPreview: outcome.impactPreview,
        diff: outcome.diff,
      })
    case "rejected":
      return Response.json({
        ok: true,
        envelopeId: outcome.envelopeId,
        applied: false,
        status: "rejected",
        ...(policyEvaluation
          ? { policy: { decision: policyEvaluation.decision, version: policyEvaluation.policyVersion } }
          : {}),
      })
    case "applied":
      return Response.json({
        ok: true,
        envelopeId: outcome.envelopeId,
        applied: true,
        status: outcome.status,
        newVersion: outcome.newVersion,
        diff: outcome.diff,
        ...(policyEvaluation
          ? { policy: { decision: policyEvaluation.decision, version: policyEvaluation.policyVersion } }
          : {}),
      })
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
    case "missing":
      return Response.json(
        { ok: false, error: "target planning artifact missing", envelopeId: outcome.envelopeId },
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
  }
}

function planningProposalErrorResponse(err: unknown, prefix: string): Response {
  if (err instanceof PlanningTargetLookupError) {
    return Response.json({ ok: false, error: err.message }, { status: err.status })
  }
  return Response.json({ ok: false, error: `${prefix}: ${String(err)}` }, { status: 500 })
}

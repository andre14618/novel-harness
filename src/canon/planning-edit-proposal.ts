import { z } from "zod"
import {
  stableHash,
  type ProposalEvidence,
  type ProposalEnvelopeRisk,
  type ProposalTargetRef,
  type ReviewProposalEnvelope,
} from "./proposal-envelope"
import { BEAT_KINDS } from "../schemas/shared"

export const PLANNING_EDIT_KIND = "planning_edit" as const

const STABLE_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const OBLIGATION_SOURCE_KINDS = ["fact", "knowledge", "state", "payoff"] as const
const STRUCTURAL_OBLIGATION_SOURCE_KINDS = [...OBLIGATION_SOURCE_KINDS, "avoid"] as const
const OBLIGATION_LIST_KEYS = [
  "mustEstablish",
  "mustPayOff",
  "mustTransferKnowledge",
  "mustShowStateChange",
  "mustNotReveal",
] as const

export const ALLOWED_CHAPTER_OUTLINE_FIELD_PATHS = [
  "title",
  "purpose",
  "setting",
  "targetWords",
] as const

export type ChapterOutlinePlanningEditField =
  (typeof ALLOWED_CHAPTER_OUTLINE_FIELD_PATHS)[number]

export const ALLOWED_BEAT_PLAN_FIELD_PATHS = [
  "description",
  "kind",
] as const

export type BeatPlanPlanningEditField =
  (typeof ALLOWED_BEAT_PLAN_FIELD_PATHS)[number]

export const ALLOWED_BEAT_OBLIGATION_FIELD_PATHS = [
  "text",
  "sourceId",
  "sourceKind",
  "characterId",
  "sourceLink",
] as const

export type BeatObligationPlanningEditField =
  (typeof ALLOWED_BEAT_OBLIGATION_FIELD_PATHS)[number]

export const ALLOWED_PLANNING_DIRECTIVE_FIELD_PATHS = [
  "rawNotes",
  "tonalAnchors",
] as const

export type PlanningDirectivePlanningEditField =
  (typeof ALLOWED_PLANNING_DIRECTIVE_FIELD_PATHS)[number]

export const ALLOWED_WORLD_BIBLE_FIELD_PATHS = [
  "setting",
  "timePeriod",
  "geography",
  "politicalStructure",
  "technologyConstraints",
  "sensoryPalette",
  "culture",
  "history",
] as const

export type WorldBiblePlanningEditField =
  (typeof ALLOWED_WORLD_BIBLE_FIELD_PATHS)[number]

export const ALLOWED_STORY_SPINE_FIELD_PATHS = [
  "centralConflict",
  "theme",
  "endingDirection",
] as const

export type StorySpinePlanningEditField =
  (typeof ALLOWED_STORY_SPINE_FIELD_PATHS)[number]

export const ALLOWED_CHARACTER_BIBLE_FIELD_PATHS = [
  "backstory",
  "goals",
  "fears",
  "speechPattern",
  "internalConflict",
  "avoids",
] as const

export type CharacterBiblePlanningEditField =
  (typeof ALLOWED_CHARACTER_BIBLE_FIELD_PATHS)[number]

export type PlanningEditField =
  | ChapterOutlinePlanningEditField
  | BeatPlanPlanningEditField
  | BeatObligationPlanningEditField
  | PlanningDirectivePlanningEditField
  | WorldBiblePlanningEditField
  | StorySpinePlanningEditField
  | CharacterBiblePlanningEditField

export const chapterOutlinePlanningEditFieldSchema = z.enum(
  ALLOWED_CHAPTER_OUTLINE_FIELD_PATHS,
)

export const beatPlanPlanningEditFieldSchema = z.enum(
  ALLOWED_BEAT_PLAN_FIELD_PATHS,
)

export const beatObligationPlanningEditFieldSchema = z.enum(
  ALLOWED_BEAT_OBLIGATION_FIELD_PATHS,
)

export const planningDirectivePlanningEditFieldSchema = z.enum(
  ALLOWED_PLANNING_DIRECTIVE_FIELD_PATHS,
)

export const worldBiblePlanningEditFieldSchema = z.enum(
  ALLOWED_WORLD_BIBLE_FIELD_PATHS,
)

export const storySpinePlanningEditFieldSchema = z.enum(
  ALLOWED_STORY_SPINE_FIELD_PATHS,
)

export const characterBiblePlanningEditFieldSchema = z.enum(
  ALLOWED_CHARACTER_BIBLE_FIELD_PATHS,
)

export const planningEditTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("planning_directive"),
    ref: planningDirectivePlanningEditFieldSchema,
    fieldPath: planningDirectivePlanningEditFieldSchema,
  }),
  z.object({
    kind: z.literal("character"),
    ref: z.string().min(1),
    fieldPath: characterBiblePlanningEditFieldSchema,
  }),
  z.object({
    kind: z.literal("world_bible"),
    ref: z.string().min(1),
    fieldPath: worldBiblePlanningEditFieldSchema,
  }),
  z.object({
    kind: z.literal("story_spine"),
    ref: z.string().min(1),
    fieldPath: storySpinePlanningEditFieldSchema,
  }),
  z.object({
    kind: z.literal("chapter_outline"),
    ref: z.string().min(1),
    fieldPath: chapterOutlinePlanningEditFieldSchema,
  }),
  z.object({
    kind: z.literal("beat_plan"),
    ref: z.string().min(1),
    fieldPath: beatPlanPlanningEditFieldSchema,
  }),
  z.object({
    kind: z.literal("beat_obligation"),
    ref: z.string().min(1),
    fieldPath: beatObligationPlanningEditFieldSchema,
  }),
])

const stableIdSchema = z.string().regex(STABLE_ID_RE, "value must match stable-ID kebab-case shape")

export const beatReplacePlanningEditTargetSchema = z.object({
  kind: z.literal("beat_plan"),
  ref: z.string().min(1),
  fieldPath: z.literal("self"),
})

export const beatReorderPlanningEditTargetSchema = z.object({
  kind: z.literal("chapter_outline"),
  ref: z.string().min(1),
  fieldPath: z.literal("scenes"),
})

export const beatObligationReplacePlanningEditTargetSchema = z.object({
  kind: z.literal("beat_obligation"),
  ref: z.string().min(1),
  fieldPath: z.literal("self"),
})

export const beatObligationReorderPlanningEditTargetSchema = z.object({
  kind: z.literal("beat_plan"),
  ref: z.string().min(1),
  fieldPath: z.literal("obligations"),
})

export const planningEditStructuralTargetSchema = z.union([
  beatReplacePlanningEditTargetSchema,
  beatReorderPlanningEditTargetSchema,
  beatObligationReplacePlanningEditTargetSchema,
  beatObligationReorderPlanningEditTargetSchema,
])

export const planningEditCreateTargetSchema = z.union([
  planningEditTargetSchema,
  planningEditStructuralTargetSchema,
])

export const planningEditImpactRefSchema = z.object({
  kind: z.string(),
  ref: z.string(),
  fieldPath: z.string().optional(),
})

export const planningEditImpactSnapshotSchema = z.object({
  planningSnapshotVersion: z.string().optional(),
  planningSnapshotHash: z.string().optional(),
  impacts: z.array(z.object({
    kind: z.string(),
    reason: z.string().optional(),
    target: planningEditImpactRefSchema,
    location: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })).default([]),
}).passthrough()

export type PlanningEditImpactSnapshot = z.infer<typeof planningEditImpactSnapshotSchema>

const planningEditPayloadBaseSchema = z.object({
  previousValue: z.unknown(),
  proposedValue: z.unknown(),
  impactPreview: planningEditImpactSnapshotSchema.optional(),
})

export const planningEditPayloadSchema = z.discriminatedUnion("action", [
  planningEditPayloadBaseSchema.extend({
    action: z.literal("field_replace"),
    target: planningEditTargetSchema,
  }),
  planningEditPayloadBaseSchema.extend({
    action: z.literal("beat_replace"),
    target: beatReplacePlanningEditTargetSchema,
  }),
  planningEditPayloadBaseSchema.extend({
    action: z.literal("beat_reorder"),
    target: beatReorderPlanningEditTargetSchema,
  }),
  planningEditPayloadBaseSchema.extend({
    action: z.literal("beat_obligation_replace"),
    target: beatObligationReplacePlanningEditTargetSchema,
  }),
  planningEditPayloadBaseSchema.extend({
    action: z.literal("beat_obligation_reorder"),
    target: beatObligationReorderPlanningEditTargetSchema,
  }),
])

export type PlanningEditPayload = z.infer<typeof planningEditPayloadSchema>
export type PlanningEditAction = PlanningEditPayload["action"]

export type PlanningEditEnvelope = ReviewProposalEnvelope<PlanningEditPayload> & {
  kind: typeof PLANNING_EDIT_KIND
}

export interface PlanningEditDiffValue {
  value: unknown
  display: string
  hash: string
}

export interface PlanningEditDiff {
  action: PlanningEditAction
  target: PlanningEditPayload["target"]
  before: PlanningEditDiffValue
  after: PlanningEditDiffValue
  changed: boolean
}

const sourceLinkValueSchema = z.object({
  sourceId: z.string().regex(STABLE_ID_RE, "sourceId must match stable-ID kebab-case shape"),
  sourceKind: z.enum(OBLIGATION_SOURCE_KINDS),
  characterId: z
    .string()
    .regex(STABLE_ID_RE, "characterId must match stable-ID kebab-case shape")
    .optional(),
}).superRefine((value, ctx) => {
  if (
    (value.sourceKind === "knowledge" || value.sourceKind === "state") &&
    value.characterId === undefined
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["characterId"],
      message: "characterId is required for knowledge/state source links",
    })
  }
})

interface BuildPlanningEditEnvelopeArgs {
  novelId: string
  action?: PlanningEditAction
  target: ProposalTargetRef & PlanningEditPayload["target"]
  previousValue: unknown
  proposedValue: unknown
  rationale: string
  source: {
    agent: string
    userMessage?: string
    parentEnvelopeId?: string
  }
  evidence?: readonly ProposalEvidence[]
  impactPreview?: PlanningEditImpactSnapshot
  now: Date
}

const ENVELOPE_ID_VERSION = "v1"

export function classifyPlanningEditRisk(
  fieldPath: PlanningEditField | string | undefined,
  action: PlanningEditAction = "field_replace",
): ProposalEnvelopeRisk {
  if (action !== "field_replace") return "medium"
  return fieldPath === "targetWords" ? "low" : "medium"
}

export function buildPlanningEditEnvelope(
  args: BuildPlanningEditEnvelopeArgs,
): PlanningEditEnvelope {
  const action = args.action ?? "field_replace"
  const payload: PlanningEditPayload = {
    action,
    target: planningEditPayloadTarget(args.target),
    previousValue: args.previousValue,
    proposedValue: args.proposedValue,
    ...(args.impactPreview !== undefined ? { impactPreview: args.impactPreview } : {}),
  } as PlanningEditPayload
  const idSeed = stableHash({
    version: ENVELOPE_ID_VERSION,
    novelId: args.novelId,
    payload,
    targetVersion: args.target.currentVersion,
  })
  const id = `${PLANNING_EDIT_KIND}:${args.novelId}:${idSeed.slice(0, 16)}`
  if (args.source.parentEnvelopeId !== undefined && args.source.parentEnvelopeId === id) {
    throw new Error(
      `buildPlanningEditEnvelope: parentEnvelopeId equals computed envelope id (${id})`,
    )
  }
  const risk = classifyPlanningEditRisk(args.target.fieldPath, action)
  return {
    id,
    kind: PLANNING_EDIT_KIND,
    novelId: args.novelId,
    target: args.target,
    source: args.source,
    status: "pending",
    risk,
    summary: summarizePlanningEdit(payload),
    rationale: args.rationale,
    evidence: [
      {
        kind: "structured",
        text: stableHash({
          action,
          fieldPath: args.target.fieldPath,
          previousValue: args.previousValue,
          proposedValue: args.proposedValue,
        }),
        ref: `${args.target.kind}:${args.target.ref}:${args.target.fieldPath ?? action}`,
      },
      ...(args.evidence ?? []),
    ],
    payload,
    precondition: {
      kind: "artifact_hash",
      hash: args.target.currentVersion,
    },
    policyRecommendation: {
      decision: "queue",
      reasons: [
        "planning_edit changes planning artifacts and must queue for manual operator review",
      ],
    },
    createdAt: args.now.toISOString(),
  }
}

function planningEditPayloadTarget(
  target: BuildPlanningEditEnvelopeArgs["target"],
): PlanningEditPayload["target"] {
  return {
    kind: target.kind,
    ref: target.ref,
    ...(target.fieldPath !== undefined ? { fieldPath: target.fieldPath } : {}),
  } as PlanningEditPayload["target"]
}

export function summarizePlanningEdit(payload: PlanningEditPayload): string {
  return `Update ${payload.target.kind} ${payload.target.ref}: ${payload.target.fieldPath ?? payload.action}`
}

export function buildPlanningEditDiff(payload: PlanningEditPayload): PlanningEditDiff {
  const beforeHash = stableHash(payload.previousValue)
  const afterHash = stableHash(payload.proposedValue)
  return {
    action: payload.action,
    target: payload.target,
    before: {
      value: payload.previousValue,
      display: planningDiffDisplayValue(payload.previousValue),
      hash: beforeHash,
    },
    after: {
      value: payload.proposedValue,
      display: planningDiffDisplayValue(payload.proposedValue),
      hash: afterHash,
    },
    changed: beforeHash !== afterHash,
  }
}

function planningDiffDisplayValue(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value)
  }
  return JSON.stringify(value, null, 2) ?? ""
}

export function planningEditTargetsSameArtifact(
  a: PlanningEditPayload,
  b: PlanningEditPayload,
): boolean {
  return (
    a.action === b.action &&
    a.target.kind === b.target.kind &&
    a.target.ref === b.target.ref &&
    (a.target.fieldPath ?? "") === (b.target.fieldPath ?? "")
  )
}

export function validatePlanningEditActionTarget(
  action: PlanningEditAction,
  target: z.infer<typeof planningEditCreateTargetSchema>,
): string | null {
  if (action === "field_replace") {
    return planningEditTargetSchema.safeParse(target).success
      ? null
      : "field_replace requires a scalar planning edit target"
  }
  if (action === "beat_replace") {
    return beatReplacePlanningEditTargetSchema.safeParse(target).success
      ? null
      : "beat_replace requires target kind=beat_plan fieldPath=self"
  }
  if (action === "beat_reorder") {
    return beatReorderPlanningEditTargetSchema.safeParse(target).success
      ? null
      : "beat_reorder requires target kind=chapter_outline fieldPath=scenes"
  }
  if (action === "beat_obligation_replace") {
    return beatObligationReplacePlanningEditTargetSchema.safeParse(target).success
      ? null
      : "beat_obligation_replace requires target kind=beat_obligation fieldPath=self"
  }
  return beatObligationReorderPlanningEditTargetSchema.safeParse(target).success
    ? null
    : "beat_obligation_reorder requires target kind=beat_plan fieldPath=obligations"
}

export function validatePlanningEditProposedValue(
  action: PlanningEditAction,
  target: PlanningEditPayload["target"],
  value: unknown,
): string | null {
  if (action === "field_replace") {
    return "fieldPath" in target
      ? validatePlanningEditValue(target.fieldPath as PlanningEditField, value)
      : "field_replace target must include fieldPath"
  }
  if (action === "beat_replace") return validateBeatReplacementValue(target.ref, value)
  if (action === "beat_reorder") return validateStableIdOrder("beat order", value)
  if (action === "beat_obligation_replace") {
    return validateObligationReplacementValue(target.ref, value)
  }
  return validateObligationReorderValue(value)
}

function validateBeatReplacementValue(targetRef: string, value: unknown): string | null {
  const record = objectRecord(value, "beat_replace proposedValue")
  if (typeof record === "string") return record
  const beatIdError = validateStableIdField("beatId", record.beatId)
  if (beatIdError) return beatIdError
  if (record.beatId === targetRef) {
    return "beat_replace proposedValue.beatId must differ from the target beat ref"
  }
  if (typeof record.description !== "string" || record.description.trim().length === 0) {
    return "beat_replace proposedValue.description must be a non-empty string"
  }
  if (
    record.kind !== undefined &&
    (typeof record.kind !== "string" || !(BEAT_KINDS as readonly string[]).includes(record.kind))
  ) {
    return `beat_replace proposedValue.kind must be one of: ${BEAT_KINDS.join(", ")}`
  }
  return null
}

function validateObligationReplacementValue(targetRef: string, value: unknown): string | null {
  const record = objectRecord(value, "beat_obligation_replace proposedValue")
  if (typeof record === "string") return record
  const obligationIdError = validateStableIdField("obligationId", record.obligationId)
  if (obligationIdError) return obligationIdError
  if (record.obligationId === targetRef) {
    return "beat_obligation_replace proposedValue.obligationId must differ from the target obligation ref"
  }
  if (typeof record.text !== "string" || record.text.trim().length === 0) {
    return "beat_obligation_replace proposedValue.text must be a non-empty string"
  }
  if (record.sourceId !== undefined) {
    const sourceIdError = validateStableIdField("sourceId", record.sourceId)
    if (sourceIdError) return sourceIdError
  }
  if (
    record.sourceKind !== undefined &&
    (
      typeof record.sourceKind !== "string" ||
      !(STRUCTURAL_OBLIGATION_SOURCE_KINDS as readonly string[]).includes(record.sourceKind)
    )
  ) {
    return `beat_obligation_replace proposedValue.sourceKind must be one of: ${
      STRUCTURAL_OBLIGATION_SOURCE_KINDS.join(", ")
    }`
  }
  if (record.characterId !== undefined) {
    const characterIdError = validateStableIdField("characterId", record.characterId)
    if (characterIdError) return characterIdError
  }
  return null
}

function validateObligationReorderValue(value: unknown): string | null {
  const record = objectRecord(value, "beat_obligation_reorder proposedValue")
  if (typeof record === "string") return record
  if (
    typeof record.listKey !== "string" ||
    !(OBLIGATION_LIST_KEYS as readonly string[]).includes(record.listKey)
  ) {
    return `beat_obligation_reorder proposedValue.listKey must be one of: ${
      OBLIGATION_LIST_KEYS.join(", ")
    }`
  }
  return validateStableIdOrder("beat_obligation_reorder proposedValue.order", record.order, {
    allowEmpty: true,
  })
}

function validateStableIdOrder(
  label: string,
  value: unknown,
  opts: { allowEmpty?: boolean } = {},
): string | null {
  if (!Array.isArray(value)) return `${label} must be an array of stable IDs`
  if (!opts.allowEmpty && value.length === 0) return `${label} must contain at least one stable ID`
  const seen = new Set<string>()
  for (const item of value) {
    const itemError = validateStableIdField(label, item)
    if (itemError) return itemError
    if (seen.has(item as string)) return `${label} must not contain duplicate stable IDs`
    seen.add(item as string)
  }
  return null
}

function validateStableIdField(label: string, value: unknown): string | null {
  return typeof value === "string" && stableIdSchema.safeParse(value).success
    ? null
    : `${label} must match stable-ID kebab-case shape`
}

function objectRecord(value: unknown, label: string): Record<string, unknown> | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `${label} must be an object`
  }
  return value as Record<string, unknown>
}

export function validatePlanningEditValue(
  fieldPath: PlanningEditField,
  value: unknown,
): string | null {
  if (fieldPath === "targetWords") {
    return typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0 &&
      value <= 250_000
      ? null
      : "targetWords must be a positive integer"
  }
  if (fieldPath === "kind") {
    return typeof value === "string" && (BEAT_KINDS as readonly string[]).includes(value)
      ? null
      : `kind must be one of: ${BEAT_KINDS.join(", ")}`
  }
  if (fieldPath === "sourceKind") {
    return typeof value === "string" && (OBLIGATION_SOURCE_KINDS as readonly string[]).includes(value)
      ? null
      : `sourceKind must be one of: ${OBLIGATION_SOURCE_KINDS.join(", ")}`
  }
  if (fieldPath === "sourceId" || fieldPath === "characterId") {
    return typeof value === "string" && STABLE_ID_RE.test(value)
      ? null
      : `${fieldPath} must match stable-ID kebab-case shape`
  }
  if (fieldPath === "sourceLink") {
    const parsed = sourceLinkValueSchema.safeParse(value)
    if (parsed.success) return null
    return parsed.error.issues.map((issue) => issue.message).join("; ")
  }
  if (fieldPath === "rawNotes") {
    return typeof value === "string" && value.length <= 10_000
      ? null
      : "rawNotes must be a string no longer than 10000 characters"
  }
  if (fieldPath === "tonalAnchors") {
    if (!Array.isArray(value)) return "tonalAnchors must be an array of strings"
    if (value.length > 50) return "tonalAnchors may contain at most 50 entries"
    for (const item of value) {
      if (typeof item !== "string" || item.trim().length === 0) {
        return "tonalAnchors entries must be non-empty strings"
      }
      if (item.length > 240) return "tonalAnchors entries must be 240 characters or fewer"
    }
    return null
  }
  if ((ALLOWED_CHARACTER_BIBLE_FIELD_PATHS as readonly string[]).includes(fieldPath)) {
    if (typeof value !== "string") return `${fieldPath} must be a string`
    if (value.trim().length === 0) return `${fieldPath} must be a non-empty string`
    const maxLength =
      fieldPath === "backstory" || fieldPath === "internalConflict" ? 2_000 : 600
    if (value.length > maxLength) {
      return `${fieldPath} must be ${maxLength} characters or fewer`
    }
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value)) {
      return `${fieldPath} must not contain control characters`
    }
    return null
  }
  if (
    (ALLOWED_WORLD_BIBLE_FIELD_PATHS as readonly string[]).includes(fieldPath) ||
    (ALLOWED_STORY_SPINE_FIELD_PATHS as readonly string[]).includes(fieldPath)
  ) {
    if (typeof value !== "string") return `${fieldPath} must be a string`
    if (value.trim().length === 0) return `${fieldPath} must be a non-empty string`
    if (value.length > 2_000) return `${fieldPath} must be 2000 characters or fewer`
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value)) {
      return `${fieldPath} must not contain control characters`
    }
    return null
  }
  return typeof value === "string" && value.trim().length > 0
    ? null
    : `${fieldPath} must be a non-empty string`
}

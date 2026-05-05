import { z } from "zod"
import {
  stableHash,
  type ProposalEnvelopeRisk,
  type ProposalTargetRef,
  type ReviewProposalEnvelope,
} from "./proposal-envelope"
import { BEAT_KINDS } from "../schemas/shared"

export const PLANNING_EDIT_KIND = "planning_edit" as const

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

export const planningEditPayloadSchema = z.object({
  action: z.literal("field_replace"),
  target: planningEditTargetSchema,
  previousValue: z.unknown(),
  proposedValue: z.unknown(),
  impactPreview: planningEditImpactSnapshotSchema.optional(),
})

export type PlanningEditPayload = z.infer<typeof planningEditPayloadSchema>

export type PlanningEditEnvelope = ReviewProposalEnvelope<PlanningEditPayload> & {
  kind: typeof PLANNING_EDIT_KIND
}

export interface PlanningEditDiffValue {
  value: unknown
  display: string
  hash: string
}

export interface PlanningEditDiff {
  action: "field_replace"
  target: PlanningEditPayload["target"]
  before: PlanningEditDiffValue
  after: PlanningEditDiffValue
  changed: boolean
}

const STABLE_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const OBLIGATION_SOURCE_KINDS = ["fact", "knowledge", "state", "payoff"] as const

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
  target:
    | (ProposalTargetRef & {
      kind: "planning_directive"
      ref: PlanningDirectivePlanningEditField
      fieldPath: PlanningDirectivePlanningEditField
    })
    | (ProposalTargetRef & {
      kind: "character"
      fieldPath: CharacterBiblePlanningEditField
    })
    | (ProposalTargetRef & {
      kind: "world_bible"
      fieldPath: WorldBiblePlanningEditField
    })
    | (ProposalTargetRef & {
      kind: "story_spine"
      fieldPath: StorySpinePlanningEditField
    })
    | (ProposalTargetRef & {
      kind: "chapter_outline"
      fieldPath: ChapterOutlinePlanningEditField
    })
    | (ProposalTargetRef & {
      kind: "beat_plan"
      fieldPath: BeatPlanPlanningEditField
    })
    | (ProposalTargetRef & {
      kind: "beat_obligation"
      fieldPath: BeatObligationPlanningEditField
    })
  previousValue: unknown
  proposedValue: unknown
  rationale: string
  source: {
    agent: string
    userMessage?: string
    parentEnvelopeId?: string
  }
  impactPreview?: PlanningEditImpactSnapshot
  now: Date
}

const ENVELOPE_ID_VERSION = "v1"

export function classifyPlanningEditRisk(
  fieldPath: PlanningEditField,
): ProposalEnvelopeRisk {
  return fieldPath === "targetWords" ? "low" : "medium"
}

export function buildPlanningEditEnvelope(
  args: BuildPlanningEditEnvelopeArgs,
): PlanningEditEnvelope {
  const payload: PlanningEditPayload = {
    action: "field_replace",
    target: planningEditPayloadTarget(args.target),
    previousValue: args.previousValue,
    proposedValue: args.proposedValue,
    ...(args.impactPreview !== undefined ? { impactPreview: args.impactPreview } : {}),
  }
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
  const risk = classifyPlanningEditRisk(args.target.fieldPath)
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
    evidence: [{
      kind: "structured",
      text: stableHash({
        fieldPath: args.target.fieldPath,
        previousValue: args.previousValue,
        proposedValue: args.proposedValue,
      }),
      ref: `${args.target.kind}:${args.target.ref}:${args.target.fieldPath}`,
    }],
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
  switch (target.kind) {
    case "planning_directive":
      return {
        kind: "planning_directive",
        ref: target.ref,
        fieldPath: target.fieldPath,
      }
    case "character":
      return {
        kind: "character",
        ref: target.ref,
        fieldPath: target.fieldPath,
      }
    case "world_bible":
      return {
        kind: "world_bible",
        ref: target.ref,
        fieldPath: target.fieldPath,
      }
    case "story_spine":
      return {
        kind: "story_spine",
        ref: target.ref,
        fieldPath: target.fieldPath,
      }
    case "chapter_outline":
      return {
        kind: "chapter_outline",
        ref: target.ref,
        fieldPath: target.fieldPath,
      }
    case "beat_plan":
      return {
        kind: "beat_plan",
        ref: target.ref,
        fieldPath: target.fieldPath,
      }
    case "beat_obligation":
      return {
        kind: "beat_obligation",
        ref: target.ref,
        fieldPath: target.fieldPath,
      }
  }
}

export function summarizePlanningEdit(payload: PlanningEditPayload): string {
  return `Update ${payload.target.kind} ${payload.target.ref}: ${payload.target.fieldPath}`
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
    a.target.fieldPath === b.target.fieldPath
  )
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

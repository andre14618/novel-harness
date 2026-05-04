import { z } from "zod"
import { beatObligationItemSchema, sceneBeatSchema } from "../../schemas/shared"

const factCategoryMap: Record<string, string> = {
  spatial: "physical", environmental: "physical", geographic: "physical", appearance: "physical", visual: "physical", object: "physical", location: "physical",
  social: "relationship", interpersonal: "relationship", familial: "relationship", alliance: "relationship",
  belief: "knowledge", information: "knowledge", memory: "knowledge", secret: "knowledge", deduction: "knowledge", discovery: "knowledge", revelation: "knowledge", emotional: "knowledge", dialogue: "knowledge",
  legal: "rule", political: "rule", systemic: "rule", custom: "rule", constraint: "rule",
  personal: "identity", biographical: "identity", name: "identity",
  chronological: "temporal", historical: "temporal", sequential: "temporal", deadline: "temporal",
}

const knowledgeSourceValid = ["witnessed", "told", "overheard", "deduced", "read", "discovered"]

// Phase-1 output — skeleton fields only. Rejects beat-level detail so the
// model can't be coaxed into the 8K-truncation failure mode that blocked
// the 2026-04-17 v3 sweep. Beat detail is Phase-2's job (planning-beats).
export const chapterSkeletonSchema = z.object({
  chapterNumber: z.number(),
  title: z.string(),
  povCharacter: z.string().default(""),
  setting: z.string().default(""),
  purpose: z.string().default(""),
  targetWords: z.number().default(1000),
  charactersPresent: z.array(z.string()).default([]),
}).strict()

export const chapterSkeletonsSchema = z.object({
  chapters: z.array(chapterSkeletonSchema),
})

export type ChapterSkeleton = z.infer<typeof chapterSkeletonSchema>

// Full ChapterOutline = Phase-1 skeleton + Phase-2 beats, merged in planning.ts.
// Kept permissive (no .strict()) because downstream DB loads/saves round-trip
// through this shape and may carry legacy fields from older rows.
export const chapterOutlineSchema = z.object({
  chapterNumber: z.number(),
  title: z.string(),
  // Stable chapter ID assigned by harness/ids.ts (e.g. ch-001-scribes-secret).
  // Optional in zod for legacy round-trip; populated by `enrichOutlineIds`.
  chapterId: z.coerce.string().optional(),
  povCharacter: z.string().default(""),
  povCharacterId: z.coerce.string().optional(),
  setting: z.string().default(""),
  purpose: z.string().default(""),
  scenes: z.array(sceneBeatSchema).default([]),
  targetWords: z.number().default(1000),
  charactersPresent: z.array(z.string()).default([]),
  charactersPresentIds: z.array(z.coerce.string()).default([]),

  // World state updates — what changes in this chapter. `id` is a stable
  // kebab-case slug assigned by planning-beats (see Planner-Phase-2 V1a in
  // docs/charters/planner-phase2-contract.md); optional here because this
  // outline schema also deserializes legacy rows written before the field
  // existed. Matches the id field on planning-beats/schema.ts.
  establishedFacts: z.array(z.object({
    id: z.string().default(""),
    fact: z.string(),
    category: z.string().transform(v => factCategoryMap[v.toLowerCase()] ?? v.toLowerCase()),
  })).default([]),
  characterStateChanges: z.array(
    z.preprocess(
      // Model occasionally emits `characterName` or `character` instead of `name`
      // (confusion with the sibling `knowledgeChanges` block which uses
      // `characterName`). Alias them onto `name` so extraction doesn't fail
      // the whole run for a labeling mismatch.
      (v) => {
        if (!v || typeof v !== "object") return v
        const o = v as Record<string, unknown>
        if (!o.name && typeof o.characterName === "string") return { ...o, name: o.characterName }
        if (!o.name && typeof o.character === "string") return { ...o, name: o.character }
        return v
      },
      z.object({
        // Stable IDs (assigned by enrichOutlineIds). `id` is unique within
        // the chapter; `characterId` resolves to the character registry.
        id: z.coerce.string().optional(),
        characterId: z.coerce.string().optional(),
        name: z.string(),
        location: z.string().default(""),
        locationId: z.coerce.string().optional(),
        emotionalState: z.string().default(""),
        knows: z.array(z.string()).default([]),
        doesNotKnow: z.array(z.string()).default([]),
      }),
    ),
  ).default([]),
  knowledgeChanges: z.array(z.object({
    id: z.coerce.string().optional(),
    characterId: z.coerce.string().optional(),
    characterName: z.string(),
    knowledge: z.string(),
    source: z.string().default("witnessed").transform(v =>
      knowledgeSourceValid.includes(v) ? v : "witnessed"
    ),
  })).default([]),
})
export type ChapterOutline = z.infer<typeof chapterOutlineSchema>

export const schema = z.object({
  chapters: z.array(chapterOutlineSchema),
})

export const chapterOutlinesSchema = schema

// === Strict variant for persisted-outline read paths (Codex round-2 MEDIUM 1) ===
// `chapterOutlineSchema` above is permissive on purpose: LLM-ingest and DB
// round-trip both touch the same shape and need to tolerate legacy rows /
// occasional model omission. But the canon-proposal `generate-from-outline`
// route reads persisted outlines as the AUDIT SOURCE OF TRUTH — a row
// missing a planner-critical array should fail validation with a 422 (so
// the operator can fix or replan), not silently audit as if the data were
// empty. This strict variant:
//   1. Removes outer `.default([])` from `scenes`, `establishedFacts`,
//      `characterStateChanges`, `knowledgeChanges`. Missing field = fail.
//   2. Replaces beat obligations with a non-catching variant. The permissive
//      `beatObligationsSchema` uses `.default([]).catch([])` so a corrupt
//      `mustEstablish` field silently becomes `[]`; the audit then sees no
//      obligations to verify, which is exactly the failure mode this fix
//      closes.
// Inner element shapes are unchanged — the strict-vs-permissive distinction
// lives at the container level (presence + well-formedness).
const strictBeatObligationsSchema = z.object({
  mustEstablish: z.array(beatObligationItemSchema),
  mustPayOff: z.array(beatObligationItemSchema),
  mustTransferKnowledge: z.array(beatObligationItemSchema),
  mustShowStateChange: z.array(beatObligationItemSchema),
  mustNotReveal: z.array(beatObligationItemSchema),
  allowedNewEntities: z.array(z.coerce.string()),
})

const strictSceneBeatSchema = sceneBeatSchema.extend({
  obligations: strictBeatObligationsSchema,
})

export const persistedChapterOutlineSchema = chapterOutlineSchema.extend({
  scenes: z.array(strictSceneBeatSchema),
  establishedFacts: z.array(z.object({
    id: z.string().default(""),
    fact: z.string(),
    category: z.string().transform(v => factCategoryMap[v.toLowerCase()] ?? v.toLowerCase()),
  })),
  characterStateChanges: z.array(
    z.preprocess(
      (v) => {
        if (!v || typeof v !== "object") return v
        const o = v as Record<string, unknown>
        if (!o.name && typeof o.characterName === "string") return { ...o, name: o.characterName }
        if (!o.name && typeof o.character === "string") return { ...o, name: o.character }
        return v
      },
      z.object({
        id: z.coerce.string().optional(),
        characterId: z.coerce.string().optional(),
        name: z.string(),
        location: z.string().default(""),
        locationId: z.coerce.string().optional(),
        emotionalState: z.string().default(""),
        knows: z.array(z.string()).default([]),
        doesNotKnow: z.array(z.string()).default([]),
      }),
    ),
  ),
  knowledgeChanges: z.array(z.object({
    id: z.coerce.string().optional(),
    characterId: z.coerce.string().optional(),
    characterName: z.string(),
    knowledge: z.string(),
    source: z.string().default("witnessed").transform(v =>
      knowledgeSourceValid.includes(v) ? v : "witnessed"
    ),
  })),
})
export type PersistedChapterOutline = z.infer<typeof persistedChapterOutlineSchema>

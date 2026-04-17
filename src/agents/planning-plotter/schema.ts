import { z } from "zod"
import { sceneBeatSchema } from "../../schemas/shared"

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
  povCharacter: z.string().default(""),
  setting: z.string().default(""),
  purpose: z.string().default(""),
  scenes: z.array(sceneBeatSchema).default([]),
  targetWords: z.number().default(1000),
  charactersPresent: z.array(z.string()).default([]),

  // World state updates — what changes in this chapter
  establishedFacts: z.array(z.object({
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
        name: z.string(),
        location: z.string().default(""),
        emotionalState: z.string().default(""),
        knows: z.array(z.string()).default([]),
        doesNotKnow: z.array(z.string()).default([]),
      }),
    ),
  ).default([]),
  knowledgeChanges: z.array(z.object({
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

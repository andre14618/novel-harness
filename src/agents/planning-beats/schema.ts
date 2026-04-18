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

// Phase-2 output — the beat-level detail for a SINGLE chapter. Skeleton fields
// (chapterNumber, title, povCharacter, setting, purpose, targetWords,
// charactersPresent) come from phase 1 and are merged in by planning.ts.
export const chapterBeatsSchema = z.object({
  scenes: z.array(sceneBeatSchema),

  // Planner-Phase-2 V1a addition: `id` is a stable, kebab-case slug the
  // planner assigns per fact (e.g. "temple-archive-pre-war-records") so
  // beats can reference the fact via `sceneBeatSchema.requiredPayoffs[].fact_id`.
  // Default is an empty string so legacy rows round-trip; the prompt asks for
  // a non-empty id going forward.
  // See docs/charters/planner-phase2-contract.md.
  establishedFacts: z.array(z.object({
    id: z.string().default(""),
    fact: z.string(),
    category: z.string().transform(v => factCategoryMap[v.toLowerCase()] ?? v.toLowerCase()),
  })).default([]),

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

export type ChapterBeats = z.infer<typeof chapterBeatsSchema>
export const schema = chapterBeatsSchema

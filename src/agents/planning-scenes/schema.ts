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

// Phase-2a output — the scene/turn sequence for a SINGLE chapter.
// Chapter-level state and writer-visible obligations are assigned by the
// follow-up planning-state-mapper surface.
export const sceneExpansionSchema = z.object({
  scenes: z.array(sceneBeatSchema),
})

// Full outline-fragment shape retained for the chapter-plan-reviser and legacy
// parsing paths. The live planner uses sceneExpansionSchema first.
export const chapterScenePlanSchema = sceneExpansionSchema.extend({

  // Legacy outline-fragment fields are kept for the chapter-plan-reviser and
  // old rows. The live scene expander does not own state mapping.
  // `id` is a stable, kebab-case slug assigned per fact so entries can reference
  // the fact via `sceneBeatSchema.requiredPayoffs[].fact_id`.
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

export type SceneExpansion = z.infer<typeof sceneExpansionSchema>
export type ChapterScenePlan = z.infer<typeof chapterScenePlanSchema>
export const schema = chapterScenePlanSchema

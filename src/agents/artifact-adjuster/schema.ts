import { z } from "zod"

const characterUpdatePatch = z.object({
  type: z.literal("characterUpdate"),
  characterId: z.string(),
  patch: z.object({
    goals: z.string().optional(),
    fears: z.string().optional(),
    internalConflict: z.string().optional(),
    avoids: z.string().optional(),
    backstory: z.string().optional(),
    speechPattern: z.string().optional(),
    role: z.string().optional(),
    traits: z.array(z.string()).optional(),
  }),
})

const characterRenamePatch = z.object({
  type: z.literal("characterRename"),
  characterId: z.string(),
  newName: z.string(),
})

const worldUpdatePatch = z.object({
  type: z.literal("worldUpdate"),
  patch: z.object({
    setting: z.string().optional(),
    timePeriod: z.string().optional(),
    geography: z.string().optional(),
    politicalStructure: z.string().optional(),
    technologyConstraints: z.string().optional(),
    sensoryPalette: z.string().optional(),
    culture: z.string().optional(),
    history: z.string().optional(),
    socialCustoms: z.array(z.string()).optional(),
    rules: z.array(z.string()).optional(),
  }),
})

const spineUpdatePatch = z.object({
  type: z.literal("spineUpdate"),
  patch: z.object({
    centralConflict: z.string().optional(),
    theme: z.string().optional(),
    endingDirection: z.string().optional(),
  }),
})

export const adjusterPatchSchema = z.discriminatedUnion("type", [
  characterUpdatePatch,
  characterRenamePatch,
  worldUpdatePatch,
  spineUpdatePatch,
])

export type AdjusterPatch = z.infer<typeof adjusterPatchSchema>

export const adjusterOutputSchema = z.object({
  assistantMessage: z.string(),
  proposedPatches: z.array(adjusterPatchSchema).default([]),
})

export type AdjusterOutput = z.infer<typeof adjusterOutputSchema>

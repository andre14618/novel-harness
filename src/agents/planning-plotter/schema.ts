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
  characterStateChanges: z.array(z.object({
    name: z.string(),
    location: z.string().default(""),
    emotionalState: z.string().default(""),
    knows: z.array(z.string()).default([]),
    doesNotKnow: z.array(z.string()).default([]),
  })).default([]),
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

import { z } from "zod"
import { sceneBeatSchema } from "../../schemas/shared"

export const chapterOutlineSchema = z.object({
  chapterNumber: z.number(),
  title: z.string(),
  povCharacter: z.string().default(""),
  setting: z.string().default(""),
  purpose: z.string().default(""),
  scenes: z.array(sceneBeatSchema).default([]),
  targetWords: z.number().default(1000),
  charactersPresent: z.array(z.string()).default([]),
})
export type ChapterOutline = z.infer<typeof chapterOutlineSchema>

export const schema = z.object({
  chapters: z.array(chapterOutlineSchema),
})

export const chapterOutlinesSchema = schema

import { z } from "zod"

export const schema = z.object({
  prose: z.string(),
})

export const chapterDraftSchema = schema

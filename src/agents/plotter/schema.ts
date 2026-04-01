import { z } from "zod"
import { actSchema } from "../../schemas/shared"

export const schema = z.object({
  acts: z.array(actSchema),
  centralConflict: z.string(),
  theme: z.string(),
  endingDirection: z.string(),
})
export type StorySpine = z.infer<typeof schema>

export const storySpineSchema = schema

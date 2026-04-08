import { z } from "zod"

export const schema = z.object({
  paragraph: z.string(),
  changed: z.boolean(),
})

export const tonalPassSchema = schema

import { z } from "zod"
import { continuityIssueSchema } from "../../schemas/shared"

export const schema = z.object({
  issues: z.array(continuityIssueSchema),
})

export const continuityCheckSchema = schema

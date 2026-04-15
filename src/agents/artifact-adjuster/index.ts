export { buildContext } from "./context"
export type { AdjusterTurn, AdjusterInput } from "./context"
export { adjusterOutputSchema, adjusterPatchSchema } from "./schema"
export type { AdjusterOutput, AdjusterPatch } from "./schema"

const promptPath = new URL("adjuster-system.md", import.meta.url).pathname
export const prompt = await Bun.file(promptPath).text()

export const config = {
  temperature: 0.3,
  maxTokens: 2048,
}

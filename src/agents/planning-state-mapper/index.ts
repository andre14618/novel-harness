import { config } from "./config"
export { config }
export { schema, planningStateMapperSchema, type PlanningStateMapperOutput, type StateMapperBeatMapping } from "./schema"
export { buildContext } from "./context"

const defaultPromptPath = new URL("state-mapper-system.md", import.meta.url).pathname
const overridePath = process.env.PLANNING_STATE_MAPPER_PROMPT_OVERRIDE?.trim()
const promptPath = overridePath && overridePath.length > 0 ? overridePath : defaultPromptPath
if (overridePath && overridePath.length > 0) {
  console.error(`[planning-state-mapper] PROMPT OVERRIDE in effect: ${promptPath}`)
}
export const prompt = await Bun.file(promptPath).text()

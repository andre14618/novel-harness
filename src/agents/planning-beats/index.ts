import { config } from "./config"
export { config }
export { schema, beatExpansionSchema, type BeatExpansion, type ChapterBeats } from "./schema"
export { buildContext } from "./context"

// Variant-runner seam: when PLANNING_BEATS_PROMPT_OVERRIDE is set (absolute path),
// the agent loads its system prompt from that file instead of the bundled default.
// The override is read at module-load time, so the variant runner MUST set the env
// var BEFORE the first import of any code that transitively imports this module.
const defaultPromptPath = new URL("beat-expansion-system.md", import.meta.url).pathname
const overridePath = process.env.PLANNING_BEATS_PROMPT_OVERRIDE?.trim()
const promptPath = overridePath && overridePath.length > 0 ? overridePath : defaultPromptPath
if (overridePath && overridePath.length > 0) {
  console.error(`[planning-beats] PROMPT OVERRIDE in effect: ${promptPath}`)
}
export const prompt = await Bun.file(promptPath).text()

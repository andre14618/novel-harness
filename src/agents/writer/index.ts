import { config } from "./config"
export { config }
export { schema } from "./schema"
export { buildContext } from "./context"
export { buildBeatContext } from "./beat-context"

const promptPath = new URL("prompt.md", import.meta.url).pathname
export const prompt = await Bun.file(promptPath).text()

const beatPromptPath = new URL("beat-prompt.md", import.meta.url).pathname
export const beatPrompt = await Bun.file(beatPromptPath).text()

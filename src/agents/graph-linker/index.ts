import { config } from "./config"
export { config }
export { graphLinkerSchema } from "./schema"
export type { GraphLinkerOutput } from "./schema"
export { buildContext } from "./context"

const promptPath = new URL("prompt.md", import.meta.url).pathname
export const prompt = await Bun.file(promptPath).text()

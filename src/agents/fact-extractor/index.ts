import { config } from "./config"
export { config }
export { schema } from "./schema"
export { buildContext } from "./context"

const promptPath = new URL("fact-extractor-system.md", import.meta.url).pathname
export const prompt = await Bun.file(promptPath).text()

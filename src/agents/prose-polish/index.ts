import { config } from "./config"
export { config }
export { schema } from "./schema"

const promptPath = new URL("prompt.md", import.meta.url).pathname
export const prompt = await Bun.file(promptPath).text()

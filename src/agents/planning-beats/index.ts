import { config } from "./config"
export { config }
export { schema, type ChapterBeats } from "./schema"
export { buildContext } from "./context"

const promptPath = new URL("beat-expansion-system.md", import.meta.url).pathname
export const prompt = await Bun.file(promptPath).text()

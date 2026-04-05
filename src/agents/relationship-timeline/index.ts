import { config } from "./config"
export { config }
export { schema, relationshipTimelineSchema } from "./schema"
export { buildContext, buildRelationshipTimelineContext } from "./context"

const promptPath = new URL("prompt.md", import.meta.url).pathname
export const prompt = await Bun.file(promptPath).text()

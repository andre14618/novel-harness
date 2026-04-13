import { config } from "./config"
export { config }
export { schema, relationshipTimelineSchema } from "./schema"
export { buildContext, buildRelationshipTimelineContext } from "./context"

const promptPath = new URL("timeline-extractor-system.md", import.meta.url).pathname
export const prompt = await Bun.file(promptPath).text()

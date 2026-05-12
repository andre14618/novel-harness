export { schema, chapterScenePlanSchema, type ChapterScenePlan } from "./schema"
export { buildContext } from "./context"

const promptPath = new URL("plan-revision-system.md", import.meta.url).pathname
export const prompt = await Bun.file(promptPath).text()

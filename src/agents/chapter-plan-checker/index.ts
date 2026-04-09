export { schema, chapterPlanCheckSchema } from "./schema"
export { buildContext } from "./context"

const promptPath = new URL("plan-adherence-system.md", import.meta.url).pathname
export const prompt = await Bun.file(promptPath).text()

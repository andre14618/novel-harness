import { config } from "./config"
export { config }
export { buildContext } from "./context"
export type { ChatTurn } from "./context"

const promptPath = new URL("conversationalist-system.md", import.meta.url).pathname
export const prompt = await Bun.file(promptPath).text()

import { config } from "./config"
export { config }
export { schema } from "./schema"
export { buildContext } from "./context"
export { buildBeatContext } from "./beat-context"

const promptPath = new URL("prose-writer-system.md", import.meta.url).pathname
const rawPrompt = await Bun.file(promptPath).text()

const beatPromptPath = new URL("beat-writer-system.md", import.meta.url).pathname
const rawBeatPrompt = await Bun.file(beatPromptPath).text()

// In-context style primer (default "howard"; disable with STYLE_PRIMER=none).
// Prepended to the system prompt so it sits at the very start of the message —
// that is the cacheable prefix on DeepSeek. ~94% prefix-cache hit rate on
// beats 1+ (exp #190), so the primer is effectively a one-time per-chapter
// cost at ~$0.004 of writer spend.
async function loadPrimer(): Promise<string> {
  const name = process.env.STYLE_PRIMER ?? "howard"
  if (name === "none" || name === "") return ""
  try {
    const primerPath = new URL(`style-primer-${name}.md`, import.meta.url).pathname
    const text = await Bun.file(primerPath).text()
    console.log(`[writer] STYLE_PRIMER=${name} loaded (${text.length} chars)`)
    return text + "\n\n---\n\n"
  } catch {
    console.warn(`[writer] STYLE_PRIMER=${name} set but src/agents/writer/style-primer-${name}.md not found; ignoring`)
    return ""
  }
}

const primer = await loadPrimer()

export const prompt = primer + rawPrompt
export const beatPrompt = primer + rawBeatPrompt

import { config } from "./config"
export { config }
export { schema } from "./schema"
export { buildContext } from "./context"
export { buildBeatContext } from "./beat-context"

const promptPath = new URL("prose-writer-system.md", import.meta.url).pathname
const rawPrompt = await Bun.file(promptPath).text()

const beatPromptPath = new URL("beat-writer-system.md", import.meta.url).pathname
const rawBeatPrompt = await Bun.file(beatPromptPath).text()

// In-context style primer — off by default. Enable explicitly via STYLE_PRIMER
// for controlled experiments. Runtime drafting no longer routes genre seeds
// through writer LoRAs or pack-specific prompts.
async function loadPrimer(): Promise<string> {
  const name = process.env.STYLE_PRIMER ?? "none"
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

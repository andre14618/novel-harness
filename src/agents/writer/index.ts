import { config } from "./config"
export { config }
export { schema } from "./schema"
export { buildContext } from "./context"
export { buildBeatContext } from "./beat-context"

const promptPath = new URL("prose-writer-system.md", import.meta.url).pathname
const rawPrompt = await Bun.file(promptPath).text()

const beatPromptPath = new URL("beat-writer-system.md", import.meta.url).pathname
const rawBeatPrompt = await Bun.file(beatPromptPath).text()

// In-context style primer — off by default. Enable per-genre via STYLE_PRIMER
// env var pointing at a style-primer-{name}.md file. Howard was retired
// 2026-04-16 when we abandoned it as a methodology; Salvatore is the only
// primer we maintain (and for Salvatore-genre seeds the preferred route is
// the voice LoRA, not the primer). Primer is prepended to the system prompt
// at the cacheable prefix position on DeepSeek.
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

// Genre-pack variant — loaded on demand when a pack routes the writer to a
// voice LoRA with its own system prompt (see WRITER_GENRE_PACKS in roles.ts).
// Cache loaded files so repeated beat calls don't re-read disk.
const packPromptCache = new Map<string, string>()

export async function loadGenrePackPrompt(filename: string, usePrimer: boolean): Promise<string> {
  const key = `${filename}|${usePrimer}`
  const cached = packPromptCache.get(key)
  if (cached) return cached
  const path = new URL(filename, import.meta.url).pathname
  const raw = await Bun.file(path).text()
  const composed = usePrimer ? primer + raw : raw
  packPromptCache.set(key, composed)
  return composed
}

/**
 * Tonal pass runner.
 *
 * Takes a chapter's prose, splits into paragraphs, runs the tonal-pass agent
 * on each narration paragraph (skipping dialogue-only), reassembles.
 *
 * Designed for a LoRA fine-tuned model (e.g. Qwen 8B on Together AI)
 * but works with any model assigned to "tonal-pass" in roles.ts.
 */

import { callAgent } from "../../llm"
import { tonalPassSchema } from "./schema"
import { splitIntoParagraphs, buildParagraphPrompt, reassemble } from "./context"
import { log } from "../../logger"
import { emit } from "../../events"

// Load prompt at module level
const PROMPT = await Bun.file(new URL("./tonal-rewrite-system.md", import.meta.url).pathname).text()

export interface TonalPassResult {
  prose: string
  paragraphsTotal: number
  paragraphsRewritten: number
  paragraphsSkipped: number
}

export async function runTonalPass(
  novelId: string,
  chapterNumber: number,
  prose: string,
): Promise<TonalPassResult> {
  const inputs = splitIntoParagraphs(prose)
  const allParagraphs = prose.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0)

  log(novelId, "info", `Tonal pass ch${chapterNumber}: ${inputs.length} narration paragraphs of ${allParagraphs.length} total`)

  const rewrites = new Map<number, string>()
  let rewrittenCount = 0

  for (const input of inputs) {
    const userPrompt = buildParagraphPrompt(input)

    try {
      const result = await callAgent({
        novelId,
        agentName: "tonal-pass",
        chapter: chapterNumber,
        beatIndex: input.index,
        systemPrompt: PROMPT,
        userPrompt,
        schema: tonalPassSchema,
      })

      if (result.output.changed) {
        rewrites.set(input.index, result.output.paragraph)
        rewrittenCount++
      }
    } catch (err) {
      // On failure, keep original paragraph — tonal pass is non-blocking
      log(novelId, "warn", `Tonal pass ch${chapterNumber} para ${input.index} failed: ${err}`)
    }
  }

  const finalProse = reassemble(prose, rewrites)
  const skipped = allParagraphs.length - inputs.length

  log(novelId, "checkpoint", `Tonal pass ch${chapterNumber}: ${rewrittenCount}/${inputs.length} paragraphs rewritten, ${skipped} dialogue-only skipped`)

  emit(novelId, {
    type: "progress",
    data: {
      step: "tonal-pass",
      chapter: chapterNumber,
      rewritten: rewrittenCount,
      total: inputs.length,
      skipped,
    },
  })

  return {
    prose: finalProse,
    paragraphsTotal: allParagraphs.length,
    paragraphsRewritten: rewrittenCount,
    paragraphsSkipped: skipped,
  }
}

import { chapterSummarySchema, factExtractionSchema, characterStateUpdateSchema } from "./types"
import {
  getCharacters, saveChapterSummary, saveFact, saveCharacterState,
  resolveIssuesForChapter,
} from "./db"
import { callAgent } from "./llm"
import {
  SUMMARY_EXTRACTOR_PROMPT, FACT_EXTRACTOR_PROMPT, CHARACTER_STATE_PROMPT,
} from "./prompts"
import { buildSummaryContext, buildFactExtractionContext, buildCharacterStateContext } from "./context"
import { log } from "./logger"

export async function updateStateAfterChapter(novelId: string, chapterNum: number, prose: string): Promise<void> {
  log(novelId, "info", `Extracting state for chapter ${chapterNum}...`)

  const characters = getCharacters(novelId)

  // All 3 extractors take approved prose as input with no cross-dependencies
  const [summaryResult, factResult, charStateResult] = await Promise.all([
    callAgent({
      novelId, agentName: "summary-extractor",
      systemPrompt: SUMMARY_EXTRACTOR_PROMPT,
      userPrompt: buildSummaryContext(prose),
      schema: chapterSummarySchema,
    }),
    callAgent({
      novelId, agentName: "fact-extractor",
      systemPrompt: FACT_EXTRACTOR_PROMPT,
      userPrompt: buildFactExtractionContext(prose),
      schema: factExtractionSchema,
    }),
    callAgent({
      novelId, agentName: "character-state",
      systemPrompt: CHARACTER_STATE_PROMPT,
      userPrompt: buildCharacterStateContext(prose, characters),
      schema: characterStateUpdateSchema,
    }),
  ])

  saveChapterSummary(
    novelId, chapterNum,
    summaryResult.output.summary,
    summaryResult.output.keyEvents,
  )

  for (const f of factResult.output.facts) {
    saveFact(novelId, { fact: f.fact, category: f.category, establishedInChapter: chapterNum })
  }

  for (const cs of charStateResult.output.characters) {
    const char = characters.find(c => c.name.toLowerCase() === cs.name.toLowerCase())
    if (char) {
      saveCharacterState(novelId, char.id, chapterNum, {
        characterId: char.id,
        chapterNumber: chapterNum,
        location: cs.location,
        emotionalState: cs.emotionalState,
        knows: cs.knows,
        doesNotKnow: cs.doesNotKnow,
      })
    }
  }

  resolveIssuesForChapter(novelId, chapterNum)

  log(novelId, "info", `State updated: summary, ${factResult.output.facts.length} facts, ${charStateResult.output.characters.length} character states`)
  console.log(`  State updated: summary, ${factResult.output.facts.length} facts, ${charStateResult.output.characters.length} character states`)
}

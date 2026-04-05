import { chapterSummarySchema, factExtractionSchema, characterStateUpdateSchema, relationshipTimelineSchema } from "./types"
import {
  getCharacters, saveChapterSummary, saveFact, saveCharacterState,
  resolveIssuesForChapter,
  saveRelationshipState, getRelationshipStatesAtChapter,
  saveTimelineEvent, saveCharacterKnowledge,
  getWorldSystems, saveCharacterSystemAwareness,
} from "./db"
import { callAgent } from "./llm"
import {
  SUMMARY_EXTRACTOR_PROMPT, FACT_EXTRACTOR_PROMPT, CHARACTER_STATE_PROMPT,
  RELATIONSHIP_TIMELINE_PROMPT,
} from "./prompts"
import { buildContext as buildSummaryContext } from "./agents/summary-extractor/context"
import { buildContext as buildFactExtractionContext } from "./agents/fact-extractor/context"
import { buildContext as buildCharacterStateContext } from "./agents/character-state/context"
import { buildContext as buildRelationshipTimelineContext } from "./agents/relationship-timeline/context"
import { log } from "./logger"

export async function updateStateAfterChapter(novelId: string, chapterNum: number, prose: string): Promise<void> {
  log(novelId, "info", `Extracting state for chapter ${chapterNum}...`)

  const characters = await getCharacters(novelId)
  const currentRelationships = await getRelationshipStatesAtChapter(novelId, chapterNum)
  const worldSystems = await tryGet(() => getWorldSystems(novelId)) ?? []

  // All 4 extractors take approved prose as input with no cross-dependencies
  const [summaryResult, factResult, charStateResult, relTimelineResult] = await Promise.all([
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
    callAgent({
      novelId, agentName: "relationship-timeline",
      systemPrompt: RELATIONSHIP_TIMELINE_PROMPT,
      userPrompt: buildRelationshipTimelineContext(prose, characters, currentRelationships, worldSystems),
      schema: relationshipTimelineSchema,
    }),
  ])

  // Save summaries
  await saveChapterSummary(
    novelId, chapterNum,
    summaryResult.output.summary,
    summaryResult.output.keyEvents,
    summaryResult.output.emotionalState,
    summaryResult.output.openThreads,
  )

  // Save facts
  for (const f of factResult.output.facts) {
    await saveFact(novelId, { fact: f.fact, category: f.category, establishedInChapter: chapterNum })
  }

  // Save character states
  for (const cs of charStateResult.output.characters) {
    const char = characters.find(c => c.name.toLowerCase() === cs.name.toLowerCase())
    if (char) {
      await saveCharacterState(novelId, char.id, chapterNum, {
        characterId: char.id,
        chapterNumber: chapterNum,
        location: cs.location,
        emotionalState: cs.emotionalState,
        knows: cs.knows,
        doesNotKnow: cs.doesNotKnow,
      })
    }
  }

  // Save relationship changes
  const rt = relTimelineResult.output
  for (const rc of rt.relationshipChanges) {
    await saveRelationshipState(novelId, { ...rc, chapterNumber: chapterNum })
  }

  // Save timeline events
  for (const te of rt.timelineEvents) {
    await saveTimelineEvent(novelId, { ...te, chapterNumber: chapterNum })
  }

  // Save character knowledge gains
  for (const kg of rt.knowledgeGains) {
    const char = characters.find(c => c.name.toLowerCase() === kg.characterName.toLowerCase())
    if (char) {
      await saveCharacterKnowledge(novelId, {
        characterId: char.id,
        knowledge: kg.knowledge,
        source: kg.source,
        chapterLearned: chapterNum,
        category: kg.category,
        isFalse: kg.isFalse,
      })
    }
  }

  // Save system awareness changes
  for (const ac of rt.awarenessChanges) {
    const char = characters.find(c => c.name.toLowerCase() === ac.characterName.toLowerCase())
    const sys = worldSystems.find(s => s.name.toLowerCase() === ac.systemName.toLowerCase())
    if (char && sys) {
      await saveCharacterSystemAwareness(novelId, {
        characterId: char.id,
        systemId: sys.id,
        awarenessLevel: ac.newLevel,
        perspective: ac.reason,
        chapterEstablished: chapterNum,
      })
    }
  }

  await resolveIssuesForChapter(novelId, chapterNum)

  const relCount = rt.relationshipChanges.length + rt.timelineEvents.length + rt.knowledgeGains.length
  log(novelId, "info", `State updated: summary, ${factResult.output.facts.length} facts, ${charStateResult.output.characters.length} character states, ${relCount} relationship/timeline entries`)
  console.log(`  State updated: summary, ${factResult.output.facts.length} facts, ${charStateResult.output.characters.length} character states, ${relCount} relationship/timeline entries`)
}

async function tryGet<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn() } catch { return null }
}

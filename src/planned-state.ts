/**
 * Save planner-declared world state updates to DB tables.
 *
 * The planning-plotter outputs establishedFacts, characterStateChanges,
 * and knowledgeChanges per chapter. This function writes them to the same
 * tables the extractors use, but the data comes from the plan (intent)
 * rather than from parsing prose (observation).
 */

import { saveFact } from "./db/facts"
import { saveCharacterState } from "./db/character-states"
import { saveCharacterKnowledge } from "./db/knowledge"
import { getCharacters } from "./db"
import * as harness from "./harness"
import { log } from "./logger"
import type { ChapterOutline } from "./agents/planning-plotter/schema"

export async function savePlannedState(
  novelId: string,
  chapterNum: number,
  outline: ChapterOutline,
): Promise<{ facts: number; states: number; knowledge: number }> {
  const characters = await getCharacters(novelId)
  let facts = 0, states = 0, knowledge = 0

  // Save established facts
  for (const f of outline.establishedFacts) {
    await saveFact(novelId, {
      fact: f.fact,
      category: f.category,
      establishedInChapter: chapterNum,
    })
    facts++
  }

  // Save character state changes
  for (const cs of outline.characterStateChanges) {
    const match = harness.enforce.matchCharacter(cs.name, characters)
    if (match.warning) log(novelId, "warn", `Planned state: ${match.warning}`)
    if (match.char) {
      await saveCharacterState(novelId, match.char.id, chapterNum, {
        characterId: match.char.id,
        chapterNumber: chapterNum,
        location: cs.location,
        emotionalState: cs.emotionalState,
        knows: cs.knows,
        doesNotKnow: cs.doesNotKnow,
      })
      states++
    }
  }

  // Save knowledge changes
  for (const kc of outline.knowledgeChanges) {
    const match = harness.enforce.matchCharacter(kc.characterName, characters)
    if (match.warning) log(novelId, "warn", `Planned state: ${match.warning}`)
    if (match.char) {
      await saveCharacterKnowledge(novelId, {
        characterId: match.char.id,
        knowledge: kc.knowledge,
        source: kc.source,
        chapterLearned: chapterNum,
        category: "event",
        isFalse: false,
      })
      knowledge++
    }
  }

  console.log(`  Planned state: ${facts} facts, ${states} character states, ${knowledge} knowledge`)
  return { facts, states, knowledge }
}

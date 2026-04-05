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
  RELATIONSHIP_TIMELINE_PROMPT, GRAPH_LINKER_PROMPT,
} from "./prompts"
import { buildContext as buildSummaryContext } from "./agents/summary-extractor/context"
import { buildContext as buildFactExtractionContext } from "./agents/fact-extractor/context"
import { buildContext as buildCharacterStateContext } from "./agents/character-state/context"
import { buildContext as buildRelationshipTimelineContext } from "./agents/relationship-timeline/context"
// Graph-linker context is built inline with deterministic results (buildGraphLinkerContextWithDeterministic)
import { graphLinkerSchema } from "./agents/graph-linker/schema"
import * as harness from "./harness"
import { log } from "./logger"

export async function updateStateAfterChapter(novelId: string, chapterNum: number, prose: string): Promise<void> {
  log(novelId, "info", `Extracting state for chapter ${chapterNum}...`)

  const characters = await getCharacters(novelId)
  const currentRelationships = await getRelationshipStatesAtChapter(novelId, chapterNum)
  const worldSystems = await tryGet(() => getWorldSystems(novelId)) ?? []

  // Step 1: 4 extractors in parallel (no cross-dependencies)
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

  // Step 2: Embed all extracted data for this chapter
  const embedResult = await harness.embeddings.embedChapterData(novelId, chapterNum)
  log(novelId, "info", `Embedded ${embedResult.embedded} entries for chapter ${chapterNum}`)
  console.log(`  Embedded: ${embedResult.embedded} entries`)

  // Step 3: Deterministic pre-processing — resolve what doesn't need an LLM
  const { getTimelineEventsForChapter, getTimelineEventsUpToChapter } = await import("./db/timeline")
  const { getKnowledgeForChapter } = await import("./db/knowledge")
  const { getStorySpine } = await import("./db")

  const [thisChapterEvents, priorEvents, knowledgeGains] = await Promise.all([
    getTimelineEventsForChapter(novelId, chapterNum),
    getTimelineEventsUpToChapter(novelId, chapterNum),
    getKnowledgeForChapter(novelId, chapterNum),
  ])
  const storyTheme = await tryGet(async () => (await getStorySpine(novelId)).theme) ?? null
  const detConfig = await harness.deterministic.getDeterministicConfig(novelId)

  const det = await harness.deterministic.runDeterministicAnalysis(
    novelId, chapterNum, thisChapterEvents, priorEvents,
    knowledgeGains, characters, storyTheme, detConfig,
  )

  // Save auto-accepted deterministic results
  if (det.autoKnowledge.length > 0) {
    await harness.graph.saveKnowledgePropagation(novelId, det.autoKnowledge.map(k => ({
      knowledgeId: k.knowledgeId,
      fromCharacterId: k.fromCharacterId,
      toCharacterId: k.toCharacterId,
      propagationType: k.propagationType,
      confidence: k.confidence,
      chapterNumber: chapterNum,
    })))
  }
  if (det.autoThemes.length > 0) {
    await harness.graph.saveThematicTags(novelId, det.autoThemes)
  }

  log(novelId, "info", `Deterministic: ${det.stats.knowledgeAutoResolved} knowledge auto, ${det.stats.themesAutoTagged} themes auto, ${det.stats.causalCandidates} causal candidates`)
  console.log(`  Deterministic: ${det.stats.knowledgeAutoResolved} knowledge, ${det.stats.themesAutoTagged} themes, ${det.stats.causalCandidates} causal candidates`)

  // Step 4: LLM graph-linker — handles gaps the deterministic layer can't resolve
  // LLM describes connections in natural language, resolver matches to DB rows
  const { resolveGraphLinkerOutput } = await import("./harness/resolve")

  const graphContext = buildGraphLinkerContextWithDeterministic(
    novelId, chapterNum, thisChapterEvents, priorEvents, det, characters, storyTheme,
  )
  const graphResult = await callAgent({
    novelId, agentName: "graph-linker",
    systemPrompt: GRAPH_LINKER_PROMPT,
    userPrompt: graphContext,
    schema: graphLinkerSchema,
  })

  // Deterministic resolution: match LLM descriptions to actual DB IDs
  const resolved = await resolveGraphLinkerOutput(
    graphResult.output, novelId, chapterNum,
    thisChapterEvents, priorEvents, knowledgeGains, characters,
  )

  if (resolved.causalLinks.length > 0) {
    await harness.graph.saveCausalLinks(novelId, resolved.causalLinks.map(l => ({
      ...l, chapterEstablished: chapterNum,
    })))
  }
  if (resolved.knowledgePropagation.length > 0) {
    await harness.graph.saveKnowledgePropagation(novelId, resolved.knowledgePropagation.map(p => ({
      ...p, chapterNumber: chapterNum,
    })))
  }
  if (resolved.themes.length > 0) {
    await harness.graph.saveThematicTags(novelId, resolved.themes)
  }

  const totalDet = det.stats.knowledgeAutoResolved + det.stats.themesAutoTagged
  const totalLLM = resolved.causalLinks.length + resolved.knowledgePropagation.length + resolved.themes.length
  const totalFailed = resolved.stats.causalFailed + resolved.stats.knowledgeFailed + resolved.stats.themesFailed
  log(novelId, "info", `Graph: ${totalDet} deterministic + ${totalLLM} LLM-resolved (${totalFailed} unmatched)`)
  console.log(`  Graph: ${totalDet} deterministic, ${totalLLM} LLM-resolved, ${totalFailed} unmatched`)
}

async function tryGet<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn() } catch { return null }
}

/**
 * Build graph-linker context that includes deterministic pre-analysis results.
 * The LLM sees what was auto-resolved and focuses on gaps + candidates.
 */
function buildGraphLinkerContextWithDeterministic(
  novelId: string,
  chapterNum: number,
  thisChapterEvents: import("./db/timeline").TimelineEvent[],
  priorEvents: import("./db/timeline").TimelineEvent[],
  det: import("./harness/deterministic").DeterministicResult,
  characters: import("./types").CharacterProfile[],
  storyTheme: string | null,
): string {
  const sections: string[] = []

  sections.push(`CHARACTERS:\n${characters.map(c => `- ${c.name} (id: ${c.id}, role: ${c.role})`).join("\n")}`)

  if (storyTheme) {
    sections.push(`STORY THEME: ${storyTheme}`)
  }

  if (thisChapterEvents.length > 0) {
    sections.push(`THIS CHAPTER'S EVENTS (chapter ${chapterNum}):\n${thisChapterEvents.map(e =>
      `- ${e.event} at ${e.location}. Participants: ${e.participants.join(", ")}${e.consequences ? `. Consequences: ${e.consequences}` : ""}`
    ).join("\n")}`)
  }

  const recentPrior = priorEvents.slice(-30)
  if (recentPrior.length > 0) {
    sections.push(`PRIOR EVENTS (for causal linking):\n${recentPrior.map(e =>
      `- ch${e.chapterNumber}: ${e.event} at ${e.location}. Participants: ${e.participants.join(", ")}`
    ).join("\n")}`)
  }

  // Show what deterministic analysis already resolved
  if (det.autoKnowledge.length > 0) {
    sections.push(`ALREADY RESOLVED (deterministic — do not re-analyze):\nKnowledge propagation:\n${det.autoKnowledge.map(k =>
      `- ${k.toCharacterId}: ${k.propagationType} (confidence ${k.confidence}) — ${k.reason}`
    ).join("\n")}`)
  }

  if (det.autoThemes.length > 0) {
    sections.push(`Auto-tagged themes:\n${det.autoThemes.map(t =>
      `- [${t.sourceType}:${t.sourceId}] "${t.theme}" (similarity ${t.similarity.toFixed(2)})`
    ).join("\n")}`)
  }

  // Show candidates that need LLM validation
  if (det.causalCandidates.length > 0) {
    sections.push(`CAUSAL LINK CANDIDATES (confirm, reject, or adjust):\n${det.causalCandidates.map(c =>
      `- [${c.causeEventId}] → [${c.effectEventId}] score ${c.score.toFixed(2)} — ${c.signals.join(", ")}`
    ).join("\n")}`)
  }

  if (det.themeCandidates.length > 0) {
    sections.push(`THEME CANDIDATES (confirm or reject):\n${det.themeCandidates.map(t =>
      `- [${t.sourceType}:${t.sourceId}] "${t.theme}" (similarity ${t.similarity.toFixed(2)})`
    ).join("\n")}`)
  }

  // Knowledge entries that need LLM judgment
  if (det.unlinkedKnowledge.length > 0) {
    sections.push(`KNOWLEDGE NEEDING PROPAGATION TYPE:\n${det.unlinkedKnowledge.map(k =>
      `- ${k.characterId} ${k.source} that "${k.knowledge}" (category: ${k.category}${k.isFalse ? ", FALSE BELIEF" : ""})`
    ).join("\n")}`)
  }

  sections.push("Validate the causal candidates, resolve unlinked knowledge, confirm/reject theme candidates, and identify anything the deterministic analysis missed.")

  return sections.join("\n\n")
}

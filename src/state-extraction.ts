/**
 * State extraction pipeline — runs after each chapter is approved.
 *
 * Flow:
 * 1. Extract: 4 LLM agents in parallel → structured data saved to DB with assigned IDs
 * 2. Embed: batch embed all new data for semantic retrieval
 * 3. Deterministic: resolve knowledge origins, score causal candidates, tag themes
 *    (all using real DB IDs — no matching needed)
 * 4. LLM validation: graph-linker confirms/rejects ambiguous causal candidates only
 */

import { chapterSummarySchema, factExtractionSchema, characterStateUpdateSchema, relationshipTimelineSchema } from "./types"
import {
  getCharacters, saveChapterSummary, saveFact, saveCharacterState,
  resolveIssuesForChapter,
  saveRelationshipState, getRelationshipStatesAtChapter,
  saveTimelineEvent, saveCharacterKnowledge,
  getWorldSystems, saveCharacterSystemAwareness,
} from "./db"
import { getTimelineEventsForChapter, getTimelineEventsUpToChapter } from "./db/timeline"
import { getKnowledgeForChapter } from "./db/knowledge"
import { callAgent } from "./llm"
import {
  SUMMARY_EXTRACTOR_PROMPT, FACT_EXTRACTOR_PROMPT, CHARACTER_STATE_PROMPT,
  RELATIONSHIP_TIMELINE_PROMPT, GRAPH_LINKER_PROMPT,
} from "./prompts"
import { buildContext as buildSummaryContext } from "./agents/summary-extractor/context"
import { buildContext as buildFactExtractionContext } from "./agents/fact-extractor/context"
import { buildContext as buildCharacterStateContext } from "./agents/character-state/context"
import { buildContext as buildRelationshipTimelineContext } from "./agents/relationship-timeline/context"
import * as harness from "./harness"
import { log } from "./logger"
import { z } from "zod"

export async function updateStateAfterChapter(novelId: string, chapterNum: number, prose: string): Promise<void> {
  log(novelId, "info", `Extracting state for chapter ${chapterNum}...`)

  const characters = await getCharacters(novelId)
  const currentRelationships = await getRelationshipStatesAtChapter(novelId, chapterNum)
  const worldSystems = await tryGet(() => getWorldSystems(novelId)) ?? []

  // ── Step 1: Extract (4 LLM agents in parallel) ─────────────────────────
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

  // ── Save and collect assigned IDs ───────────────────────────────────────
  await saveChapterSummary(
    novelId, chapterNum,
    summaryResult.output.summary,
    summaryResult.output.keyEvents,
    summaryResult.output.emotionalState,
    summaryResult.output.openThreads,
  )

  const savedFactIds: string[] = []
  for (const f of factResult.output.facts) {
    const id = await saveFact(novelId, { fact: f.fact, category: f.category, establishedInChapter: chapterNum })
    savedFactIds.push(id)
  }

  for (const cs of charStateResult.output.characters) {
    const char = harness.enforce.matchCharacter(cs.name, characters)
    if (char.warning) log(novelId, "warn", `Extraction: ${char.warning}`)
    if (char.char) {
      await saveCharacterState(novelId, char.char.id, chapterNum, {
        characterId: char.char.id,
        chapterNumber: chapterNum,
        location: cs.location,
        emotionalState: cs.emotionalState,
        knows: cs.knows,
        doesNotKnow: cs.doesNotKnow,
      })
    }
  }

  const rt = relTimelineResult.output
  for (const rc of rt.relationshipChanges) {
    await saveRelationshipState(novelId, { ...rc, chapterNumber: chapterNum })
  }

  const savedEventIds: string[] = []
  for (const te of rt.timelineEvents) {
    const id = await saveTimelineEvent(novelId, { ...te, chapterNumber: chapterNum })
    savedEventIds.push(id)
  }

  const savedKnowledgeIds: string[] = []
  for (const kg of rt.knowledgeGains) {
    const char = harness.enforce.matchCharacter(kg.characterName, characters)
    if (char.warning) log(novelId, "warn", `Extraction: ${char.warning}`)
    if (char.char) {
      const id = await saveCharacterKnowledge(novelId, {
        characterId: char.char.id,
        knowledge: kg.knowledge,
        source: kg.source,
        chapterLearned: chapterNum,
        category: kg.category,
        isFalse: kg.isFalse,
      })
      savedKnowledgeIds.push(id)
    }
  }

  for (const ac of rt.awarenessChanges) {
    const char = harness.enforce.matchCharacter(ac.characterName, characters)
    const sys = worldSystems.find(s => s.name.toLowerCase() === ac.systemName.toLowerCase())
    if (char.char && sys) {
      await saveCharacterSystemAwareness(novelId, {
        characterId: char.char.id,
        systemId: sys.id,
        awarenessLevel: ac.newLevel,
        perspective: ac.reason,
        chapterEstablished: chapterNum,
      })
    }
  }

  await resolveIssuesForChapter(novelId, chapterNum)

  const relCount = rt.relationshipChanges.length + rt.timelineEvents.length + rt.knowledgeGains.length
  log(novelId, "info", `Extracted: ${factResult.output.facts.length} facts, ${charStateResult.output.characters.length} states, ${relCount} rel/timeline`)
  console.log(`  Extracted: ${factResult.output.facts.length} facts, ${charStateResult.output.characters.length} states, ${relCount} rel/timeline`)

  // ── Step 2: Embed ──────────────────────────────────────────────────────
  const embedResult = await harness.embeddings.embedChapterData(novelId, chapterNum)
  console.log(`  Embedded: ${embedResult.embedded} entries`)

  // ── Step 3: Deterministic graph analysis (uses real IDs from Step 1) ───
  const [thisChapterEvents, priorEvents, knowledgeGains] = await Promise.all([
    getTimelineEventsForChapter(novelId, chapterNum),
    getTimelineEventsUpToChapter(novelId, chapterNum),
    getKnowledgeForChapter(novelId, chapterNum),
  ])
  const detConfig = await harness.deterministic.getDeterministicConfig(novelId)

  const det = await harness.deterministic.runDeterministicAnalysis(
    novelId, chapterNum, thisChapterEvents, priorEvents,
    knowledgeGains, characters, detConfig,
  )

  // Save deterministic results (these have real IDs — no resolution needed)
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

  // Save high-confidence causal candidates directly
  const autoCausal = det.causalCandidates.filter(c => c.score >= detConfig.causalAutoThreshold)
  if (autoCausal.length > 0) {
    await harness.graph.saveCausalLinks(novelId, autoCausal.map(c => ({
      causeEventId: c.causeEventId,
      effectEventId: c.effectEventId,
      relationship: "causes",
      confidence: c.score,
      chapterEstablished: chapterNum,
    })))
  }

  console.log(`  Deterministic: ${det.stats.knowledgeAutoResolved} knowledge, ${autoCausal.length} causal auto-accepted`)

  // ── Step 4: LLM validates ambiguous causal candidates ──────────────────
  const ambiguousCausal = det.causalCandidates.filter(c => c.score >= detConfig.causalCandidateThreshold && c.score < detConfig.causalAutoThreshold)

  if (ambiguousCausal.length > 0 || det.unlinkedKnowledge.length > 0) {
    // Build a focused prompt: just the candidates + unlinked knowledge
    const sections: string[] = []
    sections.push(`CHARACTERS:\n${characters.map(c => `- ${c.name} (${c.role})`).join("\n")}`)

    if (ambiguousCausal.length > 0) {
      sections.push(`CAUSAL LINK CANDIDATES — confirm or reject each:\n${ambiguousCausal.map((c, i) => {
        const cause = thisChapterEvents.concat(priorEvents).find(e => e.id === c.causeEventId)
        const effect = thisChapterEvents.find(e => e.id === c.effectEventId)
        return `${i + 1}. "${cause?.event ?? "unknown"}" → "${effect?.event ?? "unknown"}" (score: ${c.score.toFixed(2)}, signals: ${c.signals.join(", ")})`
      }).join("\n")}`)
    }

    if (det.unlinkedKnowledge.length > 0) {
      sections.push(`KNOWLEDGE NEEDING PROPAGATION TYPE:\n${det.unlinkedKnowledge.map(k =>
        `- ${k.characterId}: "${k.knowledge}" (source: ${k.source})`
      ).join("\n")}`)
    }

    sections.push("For causal candidates: respond with the candidate number and 'confirm' or 'reject'. For knowledge: provide propagationType and fromCharacterName if applicable.")

    try {
      const validationResult = await callAgent({
        novelId, agentName: "graph-linker",
        systemPrompt: GRAPH_LINKER_PROMPT,
        userPrompt: sections.join("\n\n"),
        schema: z.object({
          causalDecisions: z.array(z.object({
            candidate: z.number(),
            decision: z.string().transform(v => v.toLowerCase().includes("confirm") ? "confirm" : "reject"),
          })).default([]),
          knowledgePropagation: z.array(z.object({
            characterName: z.string(),
            knowledge: z.string(),
            fromCharacterName: z.string().nullable().default(null),
            propagationType: z.string().default("origin").transform(v => {
              const valid = ["origin", "told", "overheard", "deduced", "discovered"]
              return valid.includes(v) ? v : "origin"
            }),
            confidence: z.number().min(0).max(1).default(1.0),
          })).default([]),
        }).passthrough(),
      })

      // Save confirmed causal links
      const vr = validationResult.output
      let confirmedCausal = 0
      for (const d of vr.causalDecisions ?? []) {
        if (d.decision === "confirm" && d.candidate >= 1 && d.candidate <= ambiguousCausal.length) {
          const c = ambiguousCausal[d.candidate - 1]
          await harness.graph.saveCausalLinks(novelId, [{
            causeEventId: c.causeEventId,
            effectEventId: c.effectEventId,
            relationship: "causes",
            confidence: c.score,
            chapterEstablished: chapterNum,
          }])
          confirmedCausal++
        }
      }

      // Save LLM-resolved knowledge propagation
      let resolvedKnowledge = 0
      for (const kp of vr.knowledgePropagation ?? []) {
        const toChar = harness.enforce.matchCharacter(kp.characterName, characters)
        const knowledge = knowledgeGains.find(k =>
          k.characterId === toChar.char?.id && k.knowledge.toLowerCase().includes(kp.knowledge.toLowerCase().slice(0, 30))
        )
        if (toChar.char && knowledge?.id) {
          const fromChar = kp.fromCharacterName ? harness.enforce.matchCharacter(kp.fromCharacterName, characters) : null
          await harness.graph.saveKnowledgePropagation(novelId, [{
            knowledgeId: knowledge.id,
            fromCharacterId: fromChar?.char?.id ?? null,
            toCharacterId: toChar.char.id,
            viaEventId: null,
            propagationType: kp.propagationType,
            confidence: kp.confidence,
            chapterNumber: chapterNum,
          }])
          resolvedKnowledge++
        }
      }

      console.log(`  LLM validated: ${confirmedCausal}/${ambiguousCausal.length} causal confirmed, ${resolvedKnowledge} knowledge resolved`)
    } catch (err) {
      // Non-blocking — deterministic results already saved
      log(novelId, "warn", `Graph-linker validation failed: ${err instanceof Error ? err.message : err}`)
      console.log(`  Graph-linker validation failed (non-blocking): ${err instanceof Error ? err.message : err}`)
    }
  } else {
    console.log(`  No ambiguous candidates — deterministic analysis sufficient`)
  }
}

async function tryGet<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn() } catch { return null }
}

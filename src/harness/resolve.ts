/**
 * Deterministic ID resolution — matches LLM natural language descriptions
 * to actual database rows using embedding similarity and keyword matching.
 *
 * The LLM describes connections ("the event where Ada opened the door").
 * This module finds the matching row in the DB.
 */

import db from "../../data/connection"
import { getEmbedding } from "../db/embed"
import type { CharacterProfile } from "../types"
import type { TimelineEvent } from "../db/timeline"
import type { CharacterKnowledgeEntry } from "../db/knowledge"
import type { GraphLinkerOutput } from "../agents/graph-linker/schema"

// ── Types ─────────────────────────────────────────────────────────────────

export interface ResolvedGraphData {
  causalLinks: Array<{ causeEventId: string; effectEventId: string; relationship: string; confidence: number }>
  knowledgePropagation: Array<{ knowledgeId: string; fromCharacterId: string | null; toCharacterId: string; viaEventId: string | null; propagationType: string; confidence: number }>
  themes: Array<{ sourceType: string; sourceId: string; theme: string }>
  stats: { causalResolved: number; causalFailed: number; knowledgeResolved: number; knowledgeFailed: number; themesResolved: number; themesFailed: number }
}

// ── Main resolver ─────────────────────────────────────────────────────────

export async function resolveGraphLinkerOutput(
  llmOutput: GraphLinkerOutput,
  novelId: string,
  chapterNum: number,
  thisChapterEvents: TimelineEvent[],
  priorEvents: TimelineEvent[],
  knowledgeGains: CharacterKnowledgeEntry[],
  characters: CharacterProfile[],
): Promise<ResolvedGraphData> {
  const allEvents = [...priorEvents, ...thisChapterEvents]
  const stats = { causalResolved: 0, causalFailed: 0, knowledgeResolved: 0, knowledgeFailed: 0, themesResolved: 0, themesFailed: 0 }

  // ── Resolve causal links ────────────────────────────────────────────
  const causalLinks: ResolvedGraphData["causalLinks"] = []
  for (const link of llmOutput.causalLinks) {
    const cause = matchEventByText(link.causeDescription, allEvents)
    const effect = matchEventByText(link.effectDescription, thisChapterEvents)
    if (cause?.id && effect?.id) {
      causalLinks.push({
        causeEventId: cause.id, effectEventId: effect.id,
        relationship: link.relationship, confidence: link.confidence,
      })
      stats.causalResolved++
    } else {
      stats.causalFailed++
    }
  }

  // ── Resolve knowledge propagation ───────────────────────────────────
  const knowledgePropagation: ResolvedGraphData["knowledgePropagation"] = []
  for (const kp of llmOutput.knowledgePropagation) {
    const toChar = matchCharacterByName(kp.characterName, characters)
    const knowledge = matchKnowledgeByText(kp.knowledge, kp.characterName, knowledgeGains, characters)
    if (toChar && knowledge?.id) {
      const fromChar = kp.fromCharacterName ? matchCharacterByName(kp.fromCharacterName, characters) : null
      knowledgePropagation.push({
        knowledgeId: knowledge.id,
        fromCharacterId: fromChar?.id ?? null,
        toCharacterId: toChar.id,
        viaEventId: null,
        propagationType: kp.propagationType,
        confidence: kp.confidence,
      })
      stats.knowledgeResolved++
    } else {
      stats.knowledgeFailed++
    }
  }

  // ── Resolve themes ──────────────────────────────────────────────────
  const themes: ResolvedGraphData["themes"] = []
  for (const t of llmOutput.themes) {
    // Try matching against events first, then facts
    const event = matchEventByText(t.description, thisChapterEvents)
    if (event?.id) {
      themes.push({ sourceType: "event", sourceId: event.id, theme: t.theme })
      stats.themesResolved++
      continue
    }

    // Try matching against facts
    const fact = await matchFactByText(t.description, novelId, chapterNum)
    if (fact) {
      themes.push({ sourceType: "fact", sourceId: fact, theme: t.theme })
      stats.themesResolved++
      continue
    }

    stats.themesFailed++
  }

  return { causalLinks, knowledgePropagation, themes, stats }
}

// ── Matching functions ────────────────────────────────────────────────────

function matchEventByText(description: string, events: TimelineEvent[]): TimelineEvent | null {
  if (!description || events.length === 0) return null
  const descLower = description.toLowerCase()

  // Exact substring match first
  for (const e of events) {
    if (e.event.toLowerCase().includes(descLower) || descLower.includes(e.event.toLowerCase())) {
      return e
    }
  }

  // Word overlap scoring
  const descWords = new Set(descLower.split(/\s+/).filter(w => w.length > 3))
  let bestEvent: TimelineEvent | null = null
  let bestScore = 0

  for (const e of events) {
    const eventWords = new Set(e.event.toLowerCase().split(/\s+/).filter(w => w.length > 3))
    let overlap = 0
    for (const w of descWords) {
      if (eventWords.has(w)) overlap++
    }
    const score = overlap / Math.max(descWords.size, 1)
    if (score > bestScore && score >= 0.3) {
      bestScore = score
      bestEvent = e
    }
  }

  return bestEvent
}

function matchCharacterByName(name: string, characters: CharacterProfile[]): CharacterProfile | null {
  if (!name) return null
  const lower = name.toLowerCase()
  return characters.find(c => c.name.toLowerCase() === lower)
    ?? characters.find(c => lower.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(lower))
    ?? null
}

function matchKnowledgeByText(
  description: string,
  characterName: string,
  knowledgeGains: CharacterKnowledgeEntry[],
  characters: CharacterProfile[],
): CharacterKnowledgeEntry | null {
  if (!description) return null
  const descLower = description.toLowerCase()
  const char = matchCharacterByName(characterName, characters)

  // Filter to this character's knowledge
  const charKnowledge = char
    ? knowledgeGains.filter(k => k.characterId === char.id)
    : knowledgeGains

  // Exact substring match
  for (const k of charKnowledge) {
    if (k.knowledge.toLowerCase().includes(descLower) || descLower.includes(k.knowledge.toLowerCase())) {
      return k
    }
  }

  // Word overlap
  const descWords = new Set(descLower.split(/\s+/).filter(w => w.length > 3))
  let best: CharacterKnowledgeEntry | null = null
  let bestScore = 0

  for (const k of charKnowledge) {
    const kWords = new Set(k.knowledge.toLowerCase().split(/\s+/).filter(w => w.length > 3))
    let overlap = 0
    for (const w of descWords) { if (kWords.has(w)) overlap++ }
    const score = overlap / Math.max(descWords.size, 1)
    if (score > bestScore && score >= 0.3) {
      bestScore = score
      best = k
    }
  }

  return best
}

async function matchFactByText(description: string, novelId: string, chapterNum: number): Promise<string | null> {
  if (!description) return null
  const descLower = description.toLowerCase()

  // Query facts for this chapter
  const facts = await db`SELECT id, fact FROM facts WHERE novel_id = ${novelId} AND established_in_chapter = ${chapterNum}`

  for (const f of facts) {
    if (f.fact.toLowerCase().includes(descLower) || descLower.includes(f.fact.toLowerCase())) {
      return f.id
    }
  }

  // Word overlap
  const descWords = new Set(descLower.split(/\s+/).filter(w => w.length > 3))
  let bestId: string | null = null
  let bestScore = 0

  for (const f of facts) {
    const fWords = new Set(f.fact.toLowerCase().split(/\s+/).filter(w => w.length > 3))
    let overlap = 0
    for (const w of descWords) { if (fWords.has(w)) overlap++ }
    const score = overlap / Math.max(descWords.size, 1)
    if (score > bestScore && score >= 0.3) {
      bestScore = score
      bestId = f.id
    }
  }

  return bestId
}

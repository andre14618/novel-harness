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
    const cause = await matchEventByEmbedding(link.causeDescription, allEvents, novelId)
    const effect = await matchEventByEmbedding(link.effectDescription, thisChapterEvents, novelId)
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
    const knowledge = await matchKnowledgeByEmbedding(kp.knowledge, kp.characterName, knowledgeGains, characters, novelId)
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
    const event = await matchEventByEmbedding(t.description, thisChapterEvents, novelId)
    if (event?.id) {
      themes.push({ sourceType: "event", sourceId: event.id, theme: t.theme })
      stats.themesResolved++
      continue
    }

    // Try matching against facts
    const fact = await matchFactByEmbedding(t.description, novelId, chapterNum)
    if (fact) {
      themes.push({ sourceType: "fact", sourceId: fact, theme: t.theme })
      stats.themesResolved++
      continue
    }

    stats.themesFailed++
  }

  return { causalLinks, knowledgePropagation, themes, stats }
}

// ── Matching functions (embedding similarity) ────────────────────────────

const MIN_SIMILARITY = 0.4

async function matchEventByEmbedding(description: string, events: TimelineEvent[], novelId: string): Promise<TimelineEvent | null> {
  if (!description || events.length === 0) return null

  // Get embedding for the LLM's description
  const descEmbedding = await getEmbedding(description)

  // Query events with embeddings and find best match
  const eventIds = events.filter(e => e.id).map(e => e.id!)
  if (eventIds.length === 0) return null

  const rows = await db.unsafe(
    `SELECT id, 1 - (embedding <=> $1::vector) as similarity
     FROM timeline_events
     WHERE novel_id = $2 AND id = ANY($3) AND embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector LIMIT 1`,
    [`[${descEmbedding.join(",")}]`, novelId, `{${eventIds.join(",")}}`]
  )

  if (rows.length > 0 && rows[0].similarity >= MIN_SIMILARITY) {
    return events.find(e => e.id === rows[0].id) ?? null
  }

  // Fallback: substring match (for events without embeddings yet)
  const descLower = description.toLowerCase()
  for (const e of events) {
    if (e.event.toLowerCase().includes(descLower) || descLower.includes(e.event.toLowerCase())) {
      return e
    }
  }

  return null
}

function matchCharacterByName(name: string, characters: CharacterProfile[]): CharacterProfile | null {
  if (!name) return null
  const lower = name.toLowerCase()
  return characters.find(c => c.name.toLowerCase() === lower)
    ?? characters.find(c => lower.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(lower))
    ?? null
}

async function matchKnowledgeByEmbedding(
  description: string,
  characterName: string,
  knowledgeGains: CharacterKnowledgeEntry[],
  characters: CharacterProfile[],
  novelId: string,
): Promise<CharacterKnowledgeEntry | null> {
  if (!description) return null
  const char = matchCharacterByName(characterName, characters)
  const charKnowledge = char ? knowledgeGains.filter(k => k.characterId === char.id) : knowledgeGains
  if (charKnowledge.length === 0) return null

  const knowledgeIds = charKnowledge.filter(k => k.id).map(k => k.id!)
  if (knowledgeIds.length === 0) return null

  const descEmbedding = await getEmbedding(description)

  const rows = await db.unsafe(
    `SELECT id, 1 - (embedding <=> $1::vector) as similarity
     FROM character_knowledge
     WHERE novel_id = $2 AND id = ANY($3) AND embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector LIMIT 1`,
    [`[${descEmbedding.join(",")}]`, novelId, `{${knowledgeIds.join(",")}}`]
  )

  if (rows.length > 0 && rows[0].similarity >= MIN_SIMILARITY) {
    return charKnowledge.find(k => k.id === rows[0].id) ?? null
  }

  // Fallback: substring
  const descLower = description.toLowerCase()
  for (const k of charKnowledge) {
    if (k.knowledge.toLowerCase().includes(descLower) || descLower.includes(k.knowledge.toLowerCase())) {
      return k
    }
  }

  return null
}

async function matchFactByEmbedding(description: string, novelId: string, chapterNum: number): Promise<string | null> {
  if (!description) return null

  const descEmbedding = await getEmbedding(description)

  const rows = await db.unsafe(
    `SELECT id, 1 - (embedding <=> $1::vector) as similarity
     FROM facts
     WHERE novel_id = $2 AND established_in_chapter = $3 AND embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector LIMIT 1`,
    [`[${descEmbedding.join(",")}]`, novelId, chapterNum]
  )

  if (rows.length > 0 && rows[0].similarity >= MIN_SIMILARITY) {
    return rows[0].id
  }

  return null
}

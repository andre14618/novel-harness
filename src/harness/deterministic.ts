/**
 * Deterministic pre-processing for graph linking.
 *
 * Produces high-confidence graph entries that don't need LLM judgment,
 * plus scored candidates for the LLM to validate. All decisions are
 * logged with scores for visibility and daemon tuning.
 *
 * Principle: deterministic handles what's objectively verifiable.
 * LLM handles judgment, ambiguity, and anything the heuristics miss.
 */

import db from "../../data/connection"
import { getEmbedding } from "../db/embed"
import type { TimelineEvent } from "../db/timeline"
import type { CharacterKnowledgeEntry } from "../db/knowledge"
import type { CharacterProfile } from "../types"

// ── Config (tunable by autoresearcher via DB + UI) ────────────────────────

export interface DeterministicConfig {
  themeAutoThreshold: number      // similarity above this → auto-tagged
  themeCandidateThreshold: number // similarity above this → sent to LLM
  causalParticipantWeight: number // how much participant overlap matters
  causalLocationWeight: number    // how much location match matters
  causalTemporalWeight: number    // how much temporal adjacency matters
  causalConsequenceWeight: number // how much consequence keyword overlap matters
  causalAutoThreshold: number     // score above this → auto-accepted
  causalCandidateThreshold: number // score above this → sent to LLM
}

export const DEFAULT_DETERMINISTIC_CONFIG: DeterministicConfig = {
  themeAutoThreshold: 0.5,
  themeCandidateThreshold: 0.3,
  causalParticipantWeight: 0.4,
  causalLocationWeight: 0.2,
  causalTemporalWeight: 0.15,
  causalConsequenceWeight: 0.25,
  causalAutoThreshold: 0.85,
  causalCandidateThreshold: 0.5,
}

/** Load config from DB, falling back to defaults */
export async function getDeterministicConfig(novelId: string): Promise<DeterministicConfig> {
  const rows = await db`SELECT * FROM deterministic_config WHERE novel_id = ${novelId}`
  if (!rows.length) return DEFAULT_DETERMINISTIC_CONFIG
  const r = rows[0]
  return {
    themeAutoThreshold: r.theme_auto_threshold,
    themeCandidateThreshold: r.theme_candidate_threshold,
    causalParticipantWeight: r.causal_participant_weight,
    causalLocationWeight: r.causal_location_weight,
    causalTemporalWeight: r.causal_temporal_weight,
    causalConsequenceWeight: r.causal_consequence_weight,
    causalAutoThreshold: r.causal_auto_threshold,
    causalCandidateThreshold: r.causal_candidate_threshold,
  }
}

/** Save config to DB (for autoresearcher tuning) */
export async function saveDeterministicConfig(novelId: string, config: Partial<DeterministicConfig>): Promise<void> {
  const c = { ...DEFAULT_DETERMINISTIC_CONFIG, ...config }
  await db`INSERT INTO deterministic_config (novel_id, theme_auto_threshold, theme_candidate_threshold,
           causal_participant_weight, causal_location_weight, causal_temporal_weight, causal_consequence_weight,
           causal_auto_threshold, causal_candidate_threshold)
           VALUES (${novelId}, ${c.themeAutoThreshold}, ${c.themeCandidateThreshold},
                   ${c.causalParticipantWeight}, ${c.causalLocationWeight}, ${c.causalTemporalWeight}, ${c.causalConsequenceWeight},
                   ${c.causalAutoThreshold}, ${c.causalCandidateThreshold})
           ON CONFLICT (novel_id) DO UPDATE SET
             theme_auto_threshold = EXCLUDED.theme_auto_threshold,
             theme_candidate_threshold = EXCLUDED.theme_candidate_threshold,
             causal_participant_weight = EXCLUDED.causal_participant_weight,
             causal_location_weight = EXCLUDED.causal_location_weight,
             causal_temporal_weight = EXCLUDED.causal_temporal_weight,
             causal_consequence_weight = EXCLUDED.causal_consequence_weight,
             causal_auto_threshold = EXCLUDED.causal_auto_threshold,
             causal_candidate_threshold = EXCLUDED.causal_candidate_threshold,
             updated_at = now()`
}

// ── Result types ──────────────────────────────────────────────────────────

export interface DeterministicResult {
  // High-confidence, auto-accepted
  autoKnowledge: Array<{
    knowledgeId: string
    fromCharacterId: string | null
    toCharacterId: string
    propagationType: string
    confidence: number
    reason: string
  }>
  autoThemes: Array<{
    sourceType: string
    sourceId: string
    theme: string
    similarity: number
  }>

  // Candidates for LLM validation
  causalCandidates: Array<{
    causeEventId: string
    effectEventId: string
    score: number
    signals: string[] // what heuristics fired
  }>
  themeCandidates: Array<{
    sourceType: string
    sourceId: string
    theme: string
    similarity: number
  }>

  // What still needs the LLM (no heuristic signal)
  unlinkedKnowledge: CharacterKnowledgeEntry[]

  // Stats for logging
  stats: {
    knowledgeAutoResolved: number
    knowledgeNeedsLLM: number
    themesAutoTagged: number
    themesCandidates: number
    causalCandidates: number
  }
}

// ── Main entry point ──────────────────────────────────────────────────────

export async function runDeterministicAnalysis(
  novelId: string,
  chapterNum: number,
  thisChapterEvents: TimelineEvent[],
  priorEvents: TimelineEvent[],
  knowledgeGains: CharacterKnowledgeEntry[],
  characters: CharacterProfile[],
  storyTheme: string | null,
  config: DeterministicConfig = DEFAULT_DETERMINISTIC_CONFIG,
): Promise<DeterministicResult> {

  // Run all three analyses in parallel
  const [knowledgeResult, themeResult, causalResult] = await Promise.all([
    analyzeKnowledgePropagation(knowledgeGains, thisChapterEvents, characters),
    analyzeThemes(novelId, chapterNum, thisChapterEvents, storyTheme, config),
    analyzeCausalLinks(thisChapterEvents, priorEvents, config),
  ])

  return {
    autoKnowledge: knowledgeResult.auto,
    unlinkedKnowledge: knowledgeResult.needsLLM,
    autoThemes: themeResult.auto,
    themeCandidates: themeResult.candidates,
    causalCandidates: causalResult.candidates,
    stats: {
      knowledgeAutoResolved: knowledgeResult.auto.length,
      knowledgeNeedsLLM: knowledgeResult.needsLLM.length,
      themesAutoTagged: themeResult.auto.length,
      themesCandidates: themeResult.candidates.length,
      causalCandidates: causalResult.candidates.length,
    },
  }
}

// ── Knowledge Propagation (deterministic) ─────────────────────────────────

async function analyzeKnowledgePropagation(
  knowledgeGains: CharacterKnowledgeEntry[],
  thisChapterEvents: TimelineEvent[],
  characters: CharacterProfile[],
): Promise<{
  auto: DeterministicResult["autoKnowledge"]
  needsLLM: CharacterKnowledgeEntry[]
}> {
  const auto: DeterministicResult["autoKnowledge"] = []
  const needsLLM: CharacterKnowledgeEntry[] = []

  // Build lookup: which characters participated/witnessed which events
  const charEventRoles = new Map<string, Set<string>>() // characterId → set of event IDs
  for (const event of thisChapterEvents) {
    for (const p of event.participants) {
      const charId = findCharacterId(p, characters)
      if (charId) {
        if (!charEventRoles.has(charId)) charEventRoles.set(charId, new Set())
        charEventRoles.get(charId)!.add(event.id!)
      }
    }
    for (const w of event.witnesses) {
      const charId = findCharacterId(w, characters)
      if (charId) {
        if (!charEventRoles.has(charId)) charEventRoles.set(charId, new Set())
        charEventRoles.get(charId)!.add(event.id!)
      }
    }
  }

  // Build lookup: what each character already knows (for "told" detection)
  const existingKnowledge = new Map<string, Set<string>>() // characterId → set of knowledge strings (lowered)
  // This would ideally query the DB, but we work with what's in this chapter
  for (const kg of knowledgeGains) {
    if (!existingKnowledge.has(kg.characterId)) existingKnowledge.set(kg.characterId, new Set())
    existingKnowledge.get(kg.characterId)!.add(kg.knowledge.toLowerCase())
  }

  for (const kg of knowledgeGains) {
    if (!kg.id) { needsLLM.push(kg); continue }

    // Rule 1: source is "witnessed" → origin
    if (kg.source === "witnessed") {
      auto.push({
        knowledgeId: kg.id,
        fromCharacterId: null,
        toCharacterId: kg.characterId,
        propagationType: "origin",
        confidence: 1.0,
        reason: "source field is 'witnessed'",
      })
      continue
    }

    // Rule 2: source is "told" and character was in a scene with another character
    // who might have the knowledge → told, from the other character
    if (kg.source === "told") {
      const charEvents = charEventRoles.get(kg.characterId) ?? new Set()
      let teller: string | null = null

      // Find another character in the same events who might have told them
      for (const eventId of charEvents) {
        const event = thisChapterEvents.find(e => e.id === eventId)
        if (!event) continue
        for (const p of [...event.participants, ...event.witnesses]) {
          const otherId = findCharacterId(p, characters)
          if (otherId && otherId !== kg.characterId) {
            teller = otherId
            break
          }
        }
        if (teller) break
      }

      auto.push({
        knowledgeId: kg.id,
        fromCharacterId: teller,
        toCharacterId: kg.characterId,
        propagationType: "told",
        confidence: teller ? 0.9 : 0.7,
        reason: teller ? `source is 'told', ${teller} present in same scene` : "source is 'told', no specific teller identified",
      })
      continue
    }

    // Rule 3: source is "discovered" or "read" → origin variant
    if (kg.source === "discovered" || kg.source === "read") {
      auto.push({
        knowledgeId: kg.id,
        fromCharacterId: null,
        toCharacterId: kg.characterId,
        propagationType: "discovered",
        confidence: 1.0,
        reason: `source field is '${kg.source}'`,
      })
      continue
    }

    // Everything else (overheard, deduced, ambiguous) → LLM
    needsLLM.push(kg)
  }

  return { auto, needsLLM }
}

// ── Causal Link Scoring (deterministic candidates) ────────────────────────

async function analyzeCausalLinks(
  thisChapterEvents: TimelineEvent[],
  priorEvents: TimelineEvent[],
  config: DeterministicConfig,
): Promise<{ candidates: DeterministicResult["causalCandidates"] }> {
  const candidates: DeterministicResult["causalCandidates"] = []

  for (const effect of thisChapterEvents) {
    if (!effect.id) continue

    for (const cause of priorEvents) {
      if (!cause.id) continue

      let score = 0
      const signals: string[] = []

      // Signal 1: Participant overlap
      const causeParticipants = new Set(cause.participants.map(p => p.toLowerCase()))
      const effectParticipants = new Set(effect.participants.map(p => p.toLowerCase()))
      const overlap = [...causeParticipants].filter(p => effectParticipants.has(p)).length
      if (overlap > 0) {
        const overlapRatio = overlap / Math.max(causeParticipants.size, effectParticipants.size)
        score += overlapRatio * config.causalParticipantWeight
        signals.push(`${overlap} shared participants (${(overlapRatio * 100).toFixed(0)}%)`)
      }

      // Signal 2: Location match
      if (cause.location && effect.location &&
          cause.location.toLowerCase() === effect.location.toLowerCase()) {
        score += config.causalLocationWeight
        signals.push(`same location: ${cause.location}`)
      }

      // Signal 3: Temporal adjacency (same or consecutive chapter)
      const chapterGap = effect.chapterNumber - cause.chapterNumber
      if (chapterGap <= 1) {
        score += config.causalTemporalWeight
        signals.push(`${chapterGap === 0 ? "same" : "consecutive"} chapter`)
      } else if (chapterGap <= 3) {
        score += config.causalTemporalWeight * 0.5
        signals.push(`${chapterGap} chapters apart`)
      }

      // Signal 4: Consequence text overlap with effect event text
      if (cause.consequences) {
        const consequenceWords = new Set(cause.consequences.toLowerCase().split(/\s+/).filter(w => w.length > 3))
        const effectWords = new Set(effect.event.toLowerCase().split(/\s+/).filter(w => w.length > 3))
        const wordOverlap = [...consequenceWords].filter(w => effectWords.has(w)).length
        if (wordOverlap > 0) {
          const ratio = wordOverlap / Math.max(consequenceWords.size, 1)
          score += ratio * config.causalConsequenceWeight
          signals.push(`${wordOverlap} consequence keyword matches`)
        }
      }

      if (score >= config.causalCandidateThreshold) {
        candidates.push({ causeEventId: cause.id, effectEventId: effect.id, score, signals })
      }
    }
  }

  // Sort by score, take top candidates per effect event (avoid explosion)
  candidates.sort((a, b) => b.score - a.score)

  // Deduplicate: keep top 3 causes per effect
  const seen = new Map<string, number>()
  const filtered = candidates.filter(c => {
    const count = seen.get(c.effectEventId) ?? 0
    if (count >= 3) return false
    seen.set(c.effectEventId, count + 1)
    return true
  })

  return { candidates: filtered }
}

// ── Theme Tagging (embedding similarity) ──────────────────────────────────

async function analyzeThemes(
  novelId: string,
  chapterNum: number,
  thisChapterEvents: TimelineEvent[],
  storyTheme: string | null,
  config: DeterministicConfig,
): Promise<{
  auto: DeterministicResult["autoThemes"]
  candidates: DeterministicResult["themeCandidates"]
}> {
  const auto: DeterministicResult["autoThemes"] = []
  const candidates: DeterministicResult["themeCandidates"] = []

  if (!storyTheme) return { auto, candidates }

  // Get theme embedding
  let themeEmbedding: number[]
  try {
    themeEmbedding = await getEmbedding(storyTheme)
  } catch {
    return { auto, candidates }
  }

  // Check events from this chapter that already have embeddings
  const rows = await db`
    SELECT id, event, embedding FROM timeline_events
    WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum} AND embedding IS NOT NULL
  `

  // Also check facts
  const factRows = await db`
    SELECT id, fact, embedding FROM facts
    WHERE novel_id = ${novelId} AND established_in_chapter = ${chapterNum} AND embedding IS NOT NULL
  `

  const entries = [
    ...rows.map(r => ({ id: r.id, type: "event" as const, text: r.event, embedding: r.embedding })),
    ...factRows.map(r => ({ id: r.id, type: "fact" as const, text: r.fact, embedding: r.embedding })),
  ]

  for (const entry of entries) {
    if (!entry.embedding) continue

    const similarity = cosineSimilarity(themeEmbedding, entry.embedding as number[])

    if (similarity >= config.themeAutoThreshold) {
      auto.push({ sourceType: entry.type, sourceId: entry.id, theme: storyTheme, similarity })
    } else if (similarity >= config.themeCandidateThreshold) {
      candidates.push({ sourceType: entry.type, sourceId: entry.id, theme: storyTheme, similarity })
    }
  }

  return { auto, candidates }
}

// ── Utilities ─────────────────────────────────────────────────────────────

function findCharacterId(name: string, characters: CharacterProfile[]): string | null {
  const lower = name.toLowerCase()
  const match = characters.find(c => c.name.toLowerCase() === lower)
  return match?.id ?? null
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

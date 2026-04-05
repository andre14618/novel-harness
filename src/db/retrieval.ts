/**
 * Hybrid RRF retrieval engine for semantic context assembly.
 *
 * Adapted from openbrain/src/db.ts hybridSearch(). Performs two-leg search
 * (vector similarity + full-text keyword) with Reciprocal Rank Fusion,
 * then applies character/location boosts and recency decay.
 */

import db from "../../data/connection"
import { getEmbedding } from "./embed"
import type { ChapterOutline, CharacterProfile } from "../types"

// ── Types ──────────────────────────────────────────────────────────────────

export interface RetrievalConfig {
  maxFacts: number
  maxEvents: number
  maxSummaries: number
  maxStates: number
  maxRelationships: number
  maxKnowledge: number
  minSimilarity: number
  rrfK: number
  fetchPerLeg: number
  characterBoost: number
  locationBoost: number
  recencyHalfLife: number
}

export const DEFAULT_CONFIG: RetrievalConfig = {
  maxFacts: 40,
  maxEvents: 15,
  maxSummaries: 8,
  maxStates: 10,
  maxRelationships: 10,
  maxKnowledge: 15,
  minSimilarity: 0.25,
  rrfK: 60,
  fetchPerLeg: 30,
  characterBoost: 2.0,
  locationBoost: 1.5,
  recencyHalfLife: 10,
}

export interface SearchResult {
  id: string
  sourceType: string
  chapterNumber: number
  content: any
  rrfScore: number
  matchType: "semantic" | "keyword" | "hybrid"
}

// ── Config Loading ─────────────────────────────────────────────────────────

export async function getRetrievalConfig(novelId: string): Promise<RetrievalConfig> {
  const rows = await db`SELECT * FROM retrieval_config WHERE novel_id = ${novelId}`
  if (!rows.length) return DEFAULT_CONFIG
  const r = rows[0]
  return {
    maxFacts: r.max_facts,
    maxEvents: r.max_events,
    maxSummaries: r.max_summaries,
    maxStates: r.max_states,
    maxRelationships: r.max_relationships,
    maxKnowledge: r.max_knowledge,
    minSimilarity: r.min_similarity,
    rrfK: r.rrf_k,
    fetchPerLeg: r.fetch_per_leg,
    characterBoost: r.character_boost,
    locationBoost: r.location_boost,
    recencyHalfLife: r.recency_half_life,
  }
}

export async function saveRetrievalConfig(novelId: string, config: Partial<RetrievalConfig>): Promise<void> {
  const c = { ...DEFAULT_CONFIG, ...config }
  await db`INSERT INTO retrieval_config (novel_id, max_facts, max_events, max_summaries, max_states,
           max_relationships, max_knowledge, min_similarity, rrf_k, fetch_per_leg,
           character_boost, location_boost, recency_half_life)
           VALUES (${novelId}, ${c.maxFacts}, ${c.maxEvents}, ${c.maxSummaries}, ${c.maxStates},
                   ${c.maxRelationships}, ${c.maxKnowledge}, ${c.minSimilarity}, ${c.rrfK}, ${c.fetchPerLeg},
                   ${c.characterBoost}, ${c.locationBoost}, ${c.recencyHalfLife})
           ON CONFLICT (novel_id) DO UPDATE SET
             max_facts = EXCLUDED.max_facts, max_events = EXCLUDED.max_events,
             max_summaries = EXCLUDED.max_summaries, max_states = EXCLUDED.max_states,
             max_relationships = EXCLUDED.max_relationships, max_knowledge = EXCLUDED.max_knowledge,
             min_similarity = EXCLUDED.min_similarity, rrf_k = EXCLUDED.rrf_k,
             fetch_per_leg = EXCLUDED.fetch_per_leg, character_boost = EXCLUDED.character_boost,
             location_boost = EXCLUDED.location_boost, recency_half_life = EXCLUDED.recency_half_life,
             updated_at = now()`
}

// ── Scene Query Builder ────────────────────────────────────────────────────

export function buildSceneQuery(outline: ChapterOutline, povChar?: CharacterProfile): string {
  const beats = outline.scenes.map(s => s.description).join(". ")
  const pov = povChar?.name ?? outline.povCharacter
  return `${pov} in ${outline.setting}. ${outline.purpose}. ${beats}`
}

// ── Check if embeddings exist ──────────────────────────────────────────────

export async function hasEmbeddings(novelId: string): Promise<boolean> {
  const rows = await db`SELECT 1 FROM facts WHERE novel_id = ${novelId} AND embedding IS NOT NULL LIMIT 1`
  return rows.length > 0
}

// ── Hybrid RRF Search (per table) ──────────────────────────────────────────

interface HybridParams {
  novelId: string
  embedding: number[]
  query: string
  maxChapter: number
  limit: number
  config: RetrievalConfig
  characters?: string[]
  location?: string
}

async function hybridSearchTable(
  table: string,
  idCol: string,
  chapterCol: string,
  textCol: string,
  params: HybridParams,
): Promise<SearchResult[]> {
  const { novelId, embedding, query, maxChapter, limit, config } = params
  const K = config.rrfK
  const fetchLimit = config.fetchPerLeg
  const penaltyRank = fetchLimit + 1
  const embStr = `[${embedding.join(",")}]`

  // Semantic leg
  const semanticRows = await db.unsafe(
    `SELECT ${idCol} as id, ${chapterCol} as chapter_number, *,
            1 - (embedding <=> $1::vector) as similarity
     FROM ${table}
     WHERE novel_id = $2 AND ${chapterCol} <= $3 AND embedding IS NOT NULL
       AND 1 - (embedding <=> $1::vector) >= $4
     ORDER BY embedding <=> $1::vector
     LIMIT $5`,
    [embStr, novelId, maxChapter, config.minSimilarity, fetchLimit]
  )

  // Keyword leg
  const keywordRows = await db.unsafe(
    `SELECT ${idCol} as id, ${chapterCol} as chapter_number, *,
            ts_rank(tsv, websearch_to_tsquery('english', $1)) as rank
     FROM ${table}
     WHERE novel_id = $2 AND ${chapterCol} <= $3
       AND tsv @@ websearch_to_tsquery('english', $1)
     ORDER BY rank DESC
     LIMIT $4`,
    [query, novelId, maxChapter, fetchLimit]
  )

  // RRF fusion
  const fusionMap = new Map<string, { semanticRank: number; keywordRank: number; data: any; matchType: string }>()

  semanticRows.forEach((row: any, i: number) => {
    fusionMap.set(String(row.id), {
      semanticRank: i + 1,
      keywordRank: penaltyRank,
      data: row,
      matchType: "semantic",
    })
  })

  keywordRows.forEach((row: any, i: number) => {
    const id = String(row.id)
    const existing = fusionMap.get(id)
    if (existing) {
      existing.keywordRank = i + 1
      existing.matchType = "hybrid"
    } else {
      fusionMap.set(id, {
        semanticRank: penaltyRank,
        keywordRank: i + 1,
        data: row,
        matchType: "keyword",
      })
    }
  })

  // Score + boost + recency
  const charNames = new Set((params.characters ?? []).map(c => c.toLowerCase()))
  const loc = (params.location ?? "").toLowerCase()

  const results = [...fusionMap.values()]
    .map(entry => {
      let score = 1 / (K + entry.semanticRank) + 1 / (K + entry.keywordRank)

      // Character boost
      const rowText = (entry.data[textCol] ?? "").toLowerCase()
      if (charNames.size > 0) {
        for (const name of charNames) {
          if (rowText.includes(name)) {
            score *= config.characterBoost
            break
          }
        }
      }

      // Location boost
      if (loc && rowText.includes(loc)) {
        score *= config.locationBoost
      }

      // Recency decay
      const chaptersAgo = maxChapter - entry.data.chapter_number
      score *= Math.pow(2, -chaptersAgo / config.recencyHalfLife)

      return {
        id: String(entry.data.id),
        sourceType: table,
        chapterNumber: entry.data.chapter_number,
        content: entry.data,
        rrfScore: score,
        matchType: entry.matchType as "semantic" | "keyword" | "hybrid",
      }
    })
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit)

  return results
}

// ── Top-Level Scene Search ─────────────────────────────────────────────────

export async function searchForScene(params: {
  novelId: string
  sceneQuery: string
  maxChapter: number
  characters?: string[]
  location?: string
  config?: RetrievalConfig
}): Promise<{
  facts: SearchResult[]
  events: SearchResult[]
  summaries: SearchResult[]
  states: SearchResult[]
  relationships: SearchResult[]
  knowledge: SearchResult[]
}> {
  const config = params.config ?? await getRetrievalConfig(params.novelId)
  const embedding = await getEmbedding(params.sceneQuery)

  const baseParams: HybridParams = {
    novelId: params.novelId,
    embedding,
    query: params.sceneQuery,
    maxChapter: params.maxChapter,
    config,
    characters: params.characters,
    location: params.location,
    limit: 0, // overridden per table
  }

  // Run all 6 table searches in parallel
  const [facts, events, summaries, states, relationships, knowledge] = await Promise.all([
    hybridSearchTable("facts", "id", "established_in_chapter", "fact", { ...baseParams, limit: config.maxFacts }),
    hybridSearchTable("timeline_events", "id", "chapter_number", "event", { ...baseParams, limit: config.maxEvents }),
    hybridSearchTable("chapter_summaries", "novel_id || '-' || chapter_number", "chapter_number", "summary", { ...baseParams, limit: config.maxSummaries }),
    hybridSearchTable("character_states", "novel_id || '-' || character_id || '-' || chapter_number", "chapter_number", "state_json::text", { ...baseParams, limit: config.maxStates }),
    hybridSearchTable("relationship_states", "novel_id || '-' || character_a || '-' || character_b || '-' || chapter_number", "chapter_number", "dynamic", { ...baseParams, limit: config.maxRelationships }),
    hybridSearchTable("character_knowledge", "id", "chapter_learned", "knowledge", { ...baseParams, limit: config.maxKnowledge }),
  ])

  return { facts, events, summaries, states, relationships, knowledge }
}

// ── Graph Queries ──────────────────────────────────────────────────────────

export interface CausalNode {
  eventId: string
  event: string
  location: string
  chapterNumber: number
  relationship: string
  depth: number
}

/** Walk causal chain backward from an event */
export async function getCausalChain(novelId: string, eventId: string, maxDepth: number = 5): Promise<CausalNode[]> {
  const rows = await db.unsafe(
    `WITH RECURSIVE chain AS (
       SELECT cause_event_id, effect_event_id, relationship, 1 as depth
       FROM event_causes WHERE novel_id = $1 AND effect_event_id = $2::uuid
       UNION ALL
       SELECT ec.cause_event_id, ec.effect_event_id, ec.relationship, c.depth + 1
       FROM event_causes ec JOIN chain c ON ec.effect_event_id = c.cause_event_id
       WHERE ec.novel_id = $1 AND c.depth < $3
     )
     SELECT chain.*, te.event, te.location, te.chapter_number
     FROM chain JOIN timeline_events te ON te.id = chain.cause_event_id
     ORDER BY te.chapter_number`,
    [novelId, eventId, maxDepth]
  )
  return rows.map((r: any) => ({
    eventId: r.cause_event_id,
    event: r.event,
    location: r.location,
    chapterNumber: r.chapter_number,
    relationship: r.relationship,
    depth: r.depth,
  }))
}

export interface RelationshipSnapshot {
  chapterNumber: number
  trustLevel: string
  dynamic: string
  tension: string
  recentShift: string
}

/** Get full relationship arc between two characters */
export async function getRelationshipArc(novelId: string, charA: string, charB: string, upToChapter: number): Promise<RelationshipSnapshot[]> {
  const rows = await db`
    SELECT chapter_number, trust_level, dynamic, tension, recent_shift
    FROM relationship_states
    WHERE novel_id = ${novelId}
      AND ((character_a = ${charA} AND character_b = ${charB}) OR (character_a = ${charB} AND character_b = ${charA}))
      AND chapter_number <= ${upToChapter}
    ORDER BY chapter_number ASC`
  return rows.map(r => ({
    chapterNumber: r.chapter_number,
    trustLevel: r.trust_level,
    dynamic: r.dynamic,
    tension: r.tension,
    recentShift: r.recent_shift,
  }))
}

export interface KnowledgeNode {
  id: string
  knowledge: string
  source: string
  chapterLearned: number
  category: string
  isFalse: boolean
  fromCharacterId: string | null
  confidence: number
  propagationType: string
}

/** Get knowledge graph for a character including propagation */
export async function getKnowledgeGraph(novelId: string, characterId: string, upToChapter: number): Promise<KnowledgeNode[]> {
  const rows = await db`
    SELECT ck.id, ck.knowledge, ck.source, ck.chapter_learned, ck.category, ck.is_false,
           kp.from_character_id, kp.confidence, kp.propagation_type
    FROM character_knowledge ck
    LEFT JOIN knowledge_propagation kp ON kp.knowledge_id = ck.id AND kp.to_character_id = ${characterId}
    WHERE ck.novel_id = ${novelId} AND ck.character_id = ${characterId} AND ck.chapter_learned <= ${upToChapter}
    ORDER BY ck.chapter_learned ASC`
  return rows.map(r => ({
    id: r.id,
    knowledge: r.knowledge,
    source: r.source,
    chapterLearned: r.chapter_learned,
    category: r.category,
    isFalse: r.is_false === true,
    fromCharacterId: r.from_character_id ?? null,
    confidence: r.confidence ?? 1.0,
    propagationType: r.propagation_type ?? "origin",
  }))
}

export interface ThemedEntry {
  sourceType: string
  sourceId: string
  theme: string
  chapterNumber: number
  content: string
}

/** Get entries tagged with a specific theme */
export async function getThematicThread(novelId: string, theme: string, upToChapter: number): Promise<ThemedEntry[]> {
  // Join thematic_tags with their source tables
  const factRows = await db`
    SELECT tt.source_type, tt.source_id, tt.theme, f.established_in_chapter as chapter_number, f.fact as content
    FROM thematic_tags tt
    JOIN facts f ON f.id = tt.source_id
    WHERE tt.novel_id = ${novelId} AND tt.theme = ${theme} AND tt.source_type = 'fact'
      AND f.established_in_chapter <= ${upToChapter}
    ORDER BY f.established_in_chapter`

  const eventRows = await db`
    SELECT tt.source_type, tt.source_id, tt.theme, te.chapter_number, te.event as content
    FROM thematic_tags tt
    JOIN timeline_events te ON te.id = tt.source_id
    WHERE tt.novel_id = ${novelId} AND tt.theme = ${theme} AND tt.source_type = 'event'
      AND te.chapter_number <= ${upToChapter}
    ORDER BY te.chapter_number`

  return [...factRows, ...eventRows]
    .map(r => ({
      sourceType: r.source_type,
      sourceId: r.source_id,
      theme: r.theme,
      chapterNumber: r.chapter_number,
      content: r.content,
    }))
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
}

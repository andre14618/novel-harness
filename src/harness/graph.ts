/**
 * Graph operations service.
 * Causal chains, knowledge propagation, thematic threads.
 */

import db from "../../data/connection"
import { getCausalChain, getRelationshipArc, getKnowledgeGraph, getThematicThread } from "../db/retrieval"

// Re-export graph query functions from retrieval
export { getCausalChain, getRelationshipArc, getKnowledgeGraph, getThematicThread }

/** Save causal links produced by the graph-linker agent */
export async function saveCausalLinks(novelId: string, links: Array<{
  causeEventId: string
  effectEventId: string
  relationship: string
  confidence: number
  chapterEstablished: number
}>): Promise<void> {
  for (const link of links) {
    await db`INSERT INTO event_causes (novel_id, cause_event_id, effect_event_id, relationship, confidence, chapter_established)
             VALUES (${novelId}, ${link.causeEventId}::uuid, ${link.effectEventId}::uuid, ${link.relationship}, ${link.confidence}, ${link.chapterEstablished})
             ON CONFLICT (novel_id, cause_event_id, effect_event_id) DO UPDATE SET
               relationship = EXCLUDED.relationship, confidence = EXCLUDED.confidence`
  }
}

/** Save knowledge propagation entries */
export async function saveKnowledgePropagation(novelId: string, entries: Array<{
  knowledgeId: string
  fromCharacterId: string | null
  toCharacterId: string
  viaEventId: string | null
  propagationType: string
  confidence: number
  chapterNumber: number
}>): Promise<void> {
  for (const entry of entries) {
    await db`INSERT INTO knowledge_propagation (novel_id, knowledge_id, from_character_id, to_character_id, via_event_id, propagation_type, confidence, chapter_number)
             VALUES (${novelId}, ${entry.knowledgeId}::uuid, ${entry.fromCharacterId}, ${entry.toCharacterId},
                     ${entry.viaEventId ? entry.viaEventId : null}, ${entry.propagationType}, ${entry.confidence}, ${entry.chapterNumber})
             ON CONFLICT (novel_id, knowledge_id, to_character_id) DO UPDATE SET
               from_character_id = EXCLUDED.from_character_id, confidence = EXCLUDED.confidence,
               propagation_type = EXCLUDED.propagation_type`
  }
}

/** Save thematic tags */
export async function saveThematicTags(novelId: string, tags: Array<{
  sourceType: string
  sourceId: string
  theme: string
}>): Promise<void> {
  for (const tag of tags) {
    await db`INSERT INTO thematic_tags (novel_id, source_type, source_id, theme)
             VALUES (${novelId}, ${tag.sourceType}, ${tag.sourceId}::uuid, ${tag.theme})
             ON CONFLICT (novel_id, source_type, source_id, theme) DO NOTHING`
  }
}

/** Get all themes for a novel */
export async function getNovelThemes(novelId: string): Promise<string[]> {
  const rows = await db`SELECT DISTINCT theme FROM thematic_tags WHERE novel_id = ${novelId} ORDER BY theme`
  return rows.map(r => r.theme)
}

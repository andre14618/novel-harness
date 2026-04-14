/**
 * Graph operations service.
 * Causal chains, knowledge propagation.
 * Validates IDs before inserting — skips entries with empty/invalid UUIDs.
 */

import db from "../db/connection"
import { getCausalChain, getRelationshipArc, getKnowledgeGraph } from "../db/retrieval"

// Re-export graph query functions from retrieval
export { getCausalChain, getRelationshipArc, getKnowledgeGraph }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidUUID(s: string): boolean {
  return UUID_RE.test(s)
}

/** Save causal links produced by the graph-linker agent */
export async function saveCausalLinks(novelId: string, links: Array<{
  causeEventId: string
  effectEventId: string
  relationship: string
  confidence: number
  chapterEstablished: number
}>): Promise<number> {
  let saved = 0
  for (const link of links) {
    if (!isValidUUID(link.causeEventId) || !isValidUUID(link.effectEventId)) continue
    try {
      await db`INSERT INTO event_causes (novel_id, cause_event_id, effect_event_id, relationship, confidence, chapter_established)
               VALUES (${novelId}, ${link.causeEventId}::uuid, ${link.effectEventId}::uuid, ${link.relationship}, ${link.confidence}, ${link.chapterEstablished})
               ON CONFLICT (novel_id, cause_event_id, effect_event_id) DO UPDATE SET
                 relationship = EXCLUDED.relationship, confidence = EXCLUDED.confidence`
      saved++
    } catch {} // Skip FK violations (event may not exist)
  }
  return saved
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
}>): Promise<number> {
  let saved = 0
  for (const entry of entries) {
    if (!isValidUUID(entry.knowledgeId)) continue
    try {
      await db`INSERT INTO knowledge_propagation (novel_id, knowledge_id, from_character_id, to_character_id, via_event_id, propagation_type, confidence, chapter_number)
               VALUES (${novelId}, ${entry.knowledgeId}::uuid, ${entry.fromCharacterId}, ${entry.toCharacterId},
                       ${entry.viaEventId && isValidUUID(entry.viaEventId) ? entry.viaEventId : null}, ${entry.propagationType}, ${entry.confidence}, ${entry.chapterNumber})
               ON CONFLICT (novel_id, knowledge_id, to_character_id) DO UPDATE SET
                 from_character_id = EXCLUDED.from_character_id, confidence = EXCLUDED.confidence,
                 propagation_type = EXCLUDED.propagation_type`
      saved++
    } catch {} // Skip FK violations
  }
  return saved
}


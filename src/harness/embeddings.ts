/**
 * Embedding operations service.
 * Handles batch embedding of chapter data after extraction.
 */

import db from "../../data/connection"
import {
  getEmbeddings,
  buildFactEmbedText, buildEventEmbedText, buildSummaryEmbedText,
  buildCharStateEmbedText, buildRelationshipEmbedText, buildKnowledgeEmbedText,
} from "../db/embed"

/** Embed all unembedded data for a chapter */
export async function embedChapterData(novelId: string, chapterNum: number): Promise<{ embedded: number }> {
  let total = 0

  // Facts
  const facts = await db`SELECT id, fact, category FROM facts WHERE novel_id = ${novelId} AND established_in_chapter = ${chapterNum} AND embedding IS NULL`
  if (facts.length > 0) {
    const texts = facts.map(f => buildFactEmbedText(f.category, f.fact))
    const embeddings = await getEmbeddings(texts)
    for (let i = 0; i < facts.length; i++) {
      const embStr = `[${embeddings[i].join(",")}]`
      await db.unsafe(`UPDATE facts SET embedding = $1 WHERE id = $2`, [embStr, facts[i].id])
    }
    total += facts.length
  }

  // Events
  const events = await db`SELECT id, event, location, participants_json, consequences FROM timeline_events WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum} AND embedding IS NULL`
  if (events.length > 0) {
    const texts = events.map(e => buildEventEmbedText(e.event, e.location, e.participants_json as string[], e.consequences))
    const embeddings = await getEmbeddings(texts)
    for (let i = 0; i < events.length; i++) {
      const embStr = `[${embeddings[i].join(",")}]`
      await db.unsafe(`UPDATE timeline_events SET embedding = $1 WHERE id = $2`, [embStr, events[i].id])
    }
    total += events.length
  }

  // Summary
  const summaries = await db`SELECT novel_id, chapter_number, summary, key_events_json, emotional_state FROM chapter_summaries WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum} AND embedding IS NULL`
  if (summaries.length > 0) {
    const texts = summaries.map(s => buildSummaryEmbedText(s.chapter_number, s.summary, s.key_events_json as string[], s.emotional_state))
    const embeddings = await getEmbeddings(texts)
    for (let i = 0; i < summaries.length; i++) {
      const embStr = `[${embeddings[i].join(",")}]`
      await db.unsafe(`UPDATE chapter_summaries SET embedding = $1 WHERE novel_id = $2 AND chapter_number = $3`, [embStr, novelId, summaries[i].chapter_number])
    }
    total += summaries.length
  }

  // Character states
  const states = await db`SELECT character_id, chapter_number, state_json FROM character_states WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum} AND embedding IS NULL`
  if (states.length > 0) {
    const texts = states.map(s => {
      const state = s.state_json as any
      return buildCharStateEmbedText(state.characterId ?? s.character_id, state.location ?? "", state.emotionalState ?? "", state.knows ?? [], state.doesNotKnow ?? [])
    })
    const embeddings = await getEmbeddings(texts)
    for (let i = 0; i < states.length; i++) {
      const embStr = `[${embeddings[i].join(",")}]`
      await db.unsafe(`UPDATE character_states SET embedding = $1 WHERE novel_id = $2 AND character_id = $3 AND chapter_number = $4`,
        [embStr, novelId, states[i].character_id, states[i].chapter_number])
    }
    total += states.length
  }

  // Relationships
  const rels = await db`SELECT character_a, character_b, chapter_number, trust_level, dynamic, tension, recent_shift FROM relationship_states WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum} AND embedding IS NULL`
  if (rels.length > 0) {
    const texts = rels.map(r => buildRelationshipEmbedText(r.character_a, r.character_b, r.trust_level, r.dynamic, r.tension, r.recent_shift))
    const embeddings = await getEmbeddings(texts)
    for (let i = 0; i < rels.length; i++) {
      const embStr = `[${embeddings[i].join(",")}]`
      await db.unsafe(`UPDATE relationship_states SET embedding = $1 WHERE novel_id = $2 AND character_a = $3 AND character_b = $4 AND chapter_number = $5`,
        [embStr, novelId, rels[i].character_a, rels[i].character_b, rels[i].chapter_number])
    }
    total += rels.length
  }

  // Knowledge
  const knowledge = await db`SELECT id, character_id, knowledge, source, is_false FROM character_knowledge WHERE novel_id = ${novelId} AND chapter_learned = ${chapterNum} AND embedding IS NULL`
  if (knowledge.length > 0) {
    // Need character names
    const chars = await db`SELECT id, name FROM characters WHERE novel_id = ${novelId}`
    const charMap = Object.fromEntries(chars.map(c => [c.id, c.name]))
    const texts = knowledge.map(k => buildKnowledgeEmbedText(charMap[k.character_id] ?? k.character_id, k.source, k.knowledge, k.is_false))
    const embeddings = await getEmbeddings(texts)
    for (let i = 0; i < knowledge.length; i++) {
      const embStr = `[${embeddings[i].join(",")}]`
      await db.unsafe(`UPDATE character_knowledge SET embedding = $1 WHERE id = $2`, [embStr, knowledge[i].id])
    }
    total += knowledge.length
  }

  return { embedded: total }
}

/** Backfill all unembedded data for a novel */
export async function backfillEmbeddings(novelId: string): Promise<{ embedded: number }> {
  const novel = await db`SELECT total_chapters FROM novels WHERE id = ${novelId}`
  if (novel.length === 0) return { embedded: 0 }

  let total = 0
  for (let ch = 1; ch <= novel[0].total_chapters; ch++) {
    const result = await embedChapterData(novelId, ch)
    total += result.embedded
  }
  return { embedded: total }
}

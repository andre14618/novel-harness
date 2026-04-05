import { getDB } from "./connection"
import { randomUUID } from "crypto"

export interface CharacterKnowledgeEntry {
  id?: string
  characterId: string
  knowledge: string
  source: string
  chapterLearned: number
  category: string // event|secret|relationship|system|location|identity
  isFalse: boolean
}

export function saveCharacterKnowledge(novelId: string, entry: CharacterKnowledgeEntry): void {
  const id = entry.id || randomUUID()
  getDB().prepare(
    `INSERT OR REPLACE INTO character_knowledge (id, novel_id, character_id, knowledge, source, chapter_learned, category, is_false)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, novelId, entry.characterId, entry.knowledge, entry.source, entry.chapterLearned, entry.category, entry.isFalse ? 1 : 0)
}

/** Get all knowledge for a character up to a given chapter */
export function getCharacterKnowledgeUpToChapter(novelId: string, characterId: string, chapterNum: number): CharacterKnowledgeEntry[] {
  const rows = getDB().prepare(
    "SELECT * FROM character_knowledge WHERE novel_id = ? AND character_id = ? AND chapter_learned < ? ORDER BY chapter_learned ASC"
  ).all(novelId, characterId, chapterNum) as any[]
  return rows.map(mapRow)
}

/** Get all knowledge entries for a chapter (all characters) */
export function getKnowledgeForChapter(novelId: string, chapterNum: number): CharacterKnowledgeEntry[] {
  const rows = getDB().prepare(
    "SELECT * FROM character_knowledge WHERE novel_id = ? AND chapter_learned = ?"
  ).all(novelId, chapterNum) as any[]
  return rows.map(mapRow)
}

/** Get knowledge a specific character has about a topic (text search) */
export function searchCharacterKnowledge(novelId: string, characterId: string, query: string, chapterNum: number): CharacterKnowledgeEntry[] {
  const all = getCharacterKnowledgeUpToChapter(novelId, characterId, chapterNum)
  const q = query.toLowerCase()
  return all.filter(e => e.knowledge.toLowerCase().includes(q))
}

export function clearKnowledgeForChapter(novelId: string, chapterNum: number): void {
  getDB().prepare("DELETE FROM character_knowledge WHERE novel_id = ? AND chapter_learned = ?").run(novelId, chapterNum)
}

function mapRow(r: any): CharacterKnowledgeEntry {
  return {
    id: r.id, characterId: r.character_id, knowledge: r.knowledge,
    source: r.source, chapterLearned: r.chapter_learned,
    category: r.category, isFalse: r.is_false === 1,
  }
}

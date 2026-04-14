import db from "./connection"

export interface CharacterKnowledgeEntry {
  id?: string
  characterId: string
  knowledge: string
  source: string
  chapterLearned: number
  category: string // event|secret|relationship|system|location|identity
  isFalse: boolean
  sourceCharacterId?: string
  sourceEventId?: string
}

export async function saveCharacterKnowledge(novelId: string, entry: CharacterKnowledgeEntry): Promise<string> {
  if (entry.id) {
    await db`INSERT INTO character_knowledge (id, novel_id, character_id, knowledge, source, chapter_learned, category, is_false, source_character_id, source_event_id)
             VALUES (${entry.id}::uuid, ${novelId}, ${entry.characterId}, ${entry.knowledge}, ${entry.source},
                     ${entry.chapterLearned}, ${entry.category}, ${entry.isFalse},
                     ${entry.sourceCharacterId ?? null}, ${entry.sourceEventId ? entry.sourceEventId : null})
             ON CONFLICT (id) DO UPDATE SET
               knowledge = EXCLUDED.knowledge, source = EXCLUDED.source,
               category = EXCLUDED.category, is_false = EXCLUDED.is_false,
               source_character_id = EXCLUDED.source_character_id, source_event_id = EXCLUDED.source_event_id`
    return entry.id
  }
  const rows = await db`INSERT INTO character_knowledge (novel_id, character_id, knowledge, source, chapter_learned, category, is_false, source_character_id, source_event_id)
                        VALUES (${novelId}, ${entry.characterId}, ${entry.knowledge}, ${entry.source},
                                ${entry.chapterLearned}, ${entry.category}, ${entry.isFalse},
                                ${entry.sourceCharacterId ?? null}, ${entry.sourceEventId ? entry.sourceEventId : null})
                        RETURNING id`
  return rows[0].id
}

export async function getCharacterKnowledgeUpToChapter(novelId: string, characterId: string, chapterNum: number): Promise<CharacterKnowledgeEntry[]> {
  const rows = await db`SELECT * FROM character_knowledge WHERE novel_id = ${novelId} AND character_id = ${characterId} AND chapter_learned < ${chapterNum} ORDER BY chapter_learned ASC`
  return rows.map(mapRow)
}

export async function getKnowledgeForChapter(novelId: string, chapterNum: number): Promise<CharacterKnowledgeEntry[]> {
  const rows = await db`SELECT * FROM character_knowledge WHERE novel_id = ${novelId} AND chapter_learned = ${chapterNum}`
  return rows.map(mapRow)
}

export async function searchCharacterKnowledge(novelId: string, characterId: string, query: string, chapterNum: number): Promise<CharacterKnowledgeEntry[]> {
  // Use Postgres full-text search instead of JS string matching
  const rows = await db`SELECT * FROM character_knowledge
                        WHERE novel_id = ${novelId} AND character_id = ${characterId} AND chapter_learned < ${chapterNum}
                          AND tsv @@ websearch_to_tsquery('english', ${query})
                        ORDER BY chapter_learned ASC`
  return rows.map(mapRow)
}

export async function clearKnowledgeForChapter(novelId: string, chapterNum: number): Promise<void> {
  await db`DELETE FROM character_knowledge WHERE novel_id = ${novelId} AND chapter_learned = ${chapterNum}`
}

function mapRow(r: any): CharacterKnowledgeEntry {
  return {
    id: r.id, characterId: r.character_id, knowledge: r.knowledge,
    source: r.source, chapterLearned: r.chapter_learned,
    category: r.category, isFalse: r.is_false === true,
    sourceCharacterId: r.source_character_id ?? undefined,
    sourceEventId: r.source_event_id ?? undefined,
  }
}

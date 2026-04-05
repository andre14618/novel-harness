import { getDB } from "./connection"

export interface RelationshipState {
  characterA: string
  characterB: string
  chapterNumber: number
  trustLevel: string
  dynamic: string
  tension: string
  recentShift: string
}

export function saveRelationshipState(novelId: string, rs: RelationshipState): void {
  getDB().prepare(
    `INSERT OR REPLACE INTO relationship_states (novel_id, character_a, character_b, chapter_number, trust_level, dynamic, tension, recent_shift)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(novelId, rs.characterA, rs.characterB, rs.chapterNumber, rs.trustLevel, rs.dynamic, rs.tension, rs.recentShift)
}

/** Get the most recent relationship state for each pair before a given chapter */
export function getRelationshipStatesAtChapter(novelId: string, chapterNum: number): RelationshipState[] {
  const rows = getDB().prepare(
    `SELECT rs.* FROM relationship_states rs
     INNER JOIN (
       SELECT character_a, character_b, MAX(chapter_number) as max_ch
       FROM relationship_states
       WHERE novel_id = ? AND chapter_number < ?
       GROUP BY character_a, character_b
     ) latest ON rs.character_a = latest.character_a AND rs.character_b = latest.character_b AND rs.chapter_number = latest.max_ch
     WHERE rs.novel_id = ?`
  ).all(novelId, chapterNum, novelId) as any[]
  return rows.map(r => ({
    characterA: r.character_a, characterB: r.character_b,
    chapterNumber: r.chapter_number, trustLevel: r.trust_level,
    dynamic: r.dynamic, tension: r.tension, recentShift: r.recent_shift,
  }))
}

/** Get relationship between two specific characters (latest before chapter) */
export function getRelationshipBetween(novelId: string, charA: string, charB: string, chapterNum: number): RelationshipState | null {
  // Check both directions since relationships are bidirectional
  const row = getDB().prepare(
    `SELECT * FROM relationship_states
     WHERE novel_id = ? AND ((character_a = ? AND character_b = ?) OR (character_a = ? AND character_b = ?))
     AND chapter_number < ? ORDER BY chapter_number DESC LIMIT 1`
  ).get(novelId, charA, charB, charB, charA, chapterNum) as any
  if (!row) return null
  return {
    characterA: row.character_a, characterB: row.character_b,
    chapterNumber: row.chapter_number, trustLevel: row.trust_level,
    dynamic: row.dynamic, tension: row.tension, recentShift: row.recent_shift,
  }
}

export function clearRelationshipStatesForChapter(novelId: string, chapterNum: number): void {
  getDB().prepare("DELETE FROM relationship_states WHERE novel_id = ? AND chapter_number = ?").run(novelId, chapterNum)
}

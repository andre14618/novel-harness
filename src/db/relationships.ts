import db from "./connection"

export interface RelationshipState {
  characterA: string
  characterB: string
  chapterNumber: number
  trustLevel: string
  dynamic: string
  tension: string
  recentShift: string
}

export async function saveRelationshipState(novelId: string, rs: RelationshipState): Promise<void> {
  await db`INSERT INTO relationship_states (novel_id, character_a, character_b, chapter_number, trust_level, dynamic, tension, recent_shift)
           VALUES (${novelId}, ${rs.characterA}, ${rs.characterB}, ${rs.chapterNumber}, ${rs.trustLevel}, ${rs.dynamic}, ${rs.tension}, ${rs.recentShift})
           ON CONFLICT (novel_id, character_a, character_b, chapter_number) DO UPDATE SET
             trust_level = EXCLUDED.trust_level, dynamic = EXCLUDED.dynamic,
             tension = EXCLUDED.tension, recent_shift = EXCLUDED.recent_shift`
}

/** Get the most recent relationship state for each pair before a given chapter */
export async function getRelationshipStatesAtChapter(novelId: string, chapterNum: number): Promise<RelationshipState[]> {
  const rows = await db`
    SELECT rs.* FROM relationship_states rs
    INNER JOIN (
      SELECT character_a, character_b, MAX(chapter_number) as max_ch
      FROM relationship_states
      WHERE novel_id = ${novelId} AND chapter_number < ${chapterNum}
      GROUP BY character_a, character_b
    ) latest ON rs.character_a = latest.character_a AND rs.character_b = latest.character_b AND rs.chapter_number = latest.max_ch
    WHERE rs.novel_id = ${novelId}`
  return rows.map(mapRow)
}

/** Get relationship between two specific characters (latest before chapter) */
export async function getRelationshipBetween(novelId: string, charA: string, charB: string, chapterNum: number): Promise<RelationshipState | null> {
  const rows = await db`
    SELECT * FROM relationship_states
    WHERE novel_id = ${novelId}
      AND ((character_a = ${charA} AND character_b = ${charB}) OR (character_a = ${charB} AND character_b = ${charA}))
      AND chapter_number < ${chapterNum}
    ORDER BY chapter_number DESC LIMIT 1`
  if (!rows.length) return null
  return mapRow(rows[0])
}

/** Get full relationship arc between two characters across all chapters */
export async function getRelationshipArc(novelId: string, charA: string, charB: string, upToChapter: number): Promise<RelationshipState[]> {
  const rows = await db`
    SELECT * FROM relationship_states
    WHERE novel_id = ${novelId}
      AND ((character_a = ${charA} AND character_b = ${charB}) OR (character_a = ${charB} AND character_b = ${charA}))
      AND chapter_number <= ${upToChapter}
    ORDER BY chapter_number ASC`
  return rows.map(mapRow)
}

export async function clearRelationshipStatesForChapter(novelId: string, chapterNum: number): Promise<void> {
  await db`DELETE FROM relationship_states WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum}`
}

function mapRow(r: any): RelationshipState {
  return {
    characterA: r.character_a, characterB: r.character_b,
    chapterNumber: r.chapter_number, trustLevel: r.trust_level,
    dynamic: r.dynamic, tension: r.tension, recentShift: r.recent_shift,
  }
}

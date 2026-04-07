import db from "../../data/connection"
import type { CharacterState } from "../types"

export async function saveCharacterState(novelId: string, charId: string, chapterNum: number, state: CharacterState): Promise<void> {
  await db`INSERT INTO character_states (novel_id, character_id, chapter_number, state_json)
           VALUES (${novelId}, ${charId}, ${chapterNum}, ${state})
           ON CONFLICT (novel_id, character_id, chapter_number) DO UPDATE SET state_json = EXCLUDED.state_json`
}

export async function getCharacterStatesAtChapter(novelId: string, chapterNum: number): Promise<CharacterState[]> {
  const rows = await db`
    SELECT cs.state_json FROM character_states cs
    INNER JOIN (
      SELECT character_id, MAX(chapter_number) as max_ch
      FROM character_states
      WHERE novel_id = ${novelId} AND chapter_number < ${chapterNum}
      GROUP BY character_id
    ) latest ON cs.character_id = latest.character_id AND cs.chapter_number = latest.max_ch
    WHERE cs.novel_id = ${novelId}`
  return rows.map(r => r.state_json as CharacterState)
}

export async function getAllCharacterStatesBeforeChapter(novelId: string, chapterNum: number): Promise<CharacterState[]> {
  const rows = await db`
    SELECT state_json FROM character_states
    WHERE novel_id = ${novelId} AND chapter_number < ${chapterNum}
    ORDER BY chapter_number ASC`
  return rows.map(r => r.state_json as CharacterState)
}

export async function clearCharacterStatesForChapter(novelId: string, chapterNum: number): Promise<void> {
  await db`DELETE FROM character_states WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum}`
}

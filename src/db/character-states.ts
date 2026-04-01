import { getDB } from "./connection"
import type { CharacterState } from "../types"

export function saveCharacterState(novelId: string, charId: string, chapterNum: number, state: CharacterState): void {
  getDB().prepare("INSERT OR REPLACE INTO character_states (novel_id, character_id, chapter_number, state_json) VALUES (?, ?, ?, ?)").run(novelId, charId, chapterNum, JSON.stringify(state))
}

export function getCharacterStatesAtChapter(novelId: string, chapterNum: number): CharacterState[] {
  const rows = getDB().prepare(`
    SELECT cs.state_json FROM character_states cs
    INNER JOIN (
      SELECT character_id, MAX(chapter_number) as max_ch
      FROM character_states
      WHERE novel_id = ? AND chapter_number < ?
      GROUP BY character_id
    ) latest ON cs.character_id = latest.character_id AND cs.chapter_number = latest.max_ch
    WHERE cs.novel_id = ?
  `).all(novelId, chapterNum, novelId) as any[]
  return rows.map(r => JSON.parse(r.state_json))
}

export function clearCharacterStatesForChapter(novelId: string, chapterNum: number): void {
  getDB().prepare("DELETE FROM character_states WHERE novel_id = ? AND chapter_number = ?").run(novelId, chapterNum)
}

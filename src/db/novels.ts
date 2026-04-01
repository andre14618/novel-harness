import { getDB } from "./connection"
import type { Phase, SeedInput, NovelState } from "../types"

export function createNovel(id: string, seed: SeedInput): void {
  getDB().prepare("INSERT INTO novels (id, seed_json) VALUES (?, ?)").run(id, JSON.stringify(seed))
}

export function getNovel(id: string): NovelState {
  const row = getDB().prepare("SELECT * FROM novels WHERE id = ?").get(id) as any
  if (!row) throw new Error(`Novel ${id} not found`)
  return {
    id: row.id, phase: row.phase as Phase, seed: JSON.parse(row.seed_json),
    currentChapter: row.current_chapter, totalChapters: row.total_chapters,
  }
}

export function updatePhase(novelId: string, phase: Phase): void {
  getDB().prepare("UPDATE novels SET phase = ?, updated_at = datetime('now') WHERE id = ?").run(phase, novelId)
}

export function updateCurrentChapter(novelId: string, chapter: number): void {
  getDB().prepare("UPDATE novels SET current_chapter = ?, updated_at = datetime('now') WHERE id = ?").run(chapter, novelId)
}

export function updateTotalChapters(novelId: string, total: number): void {
  getDB().prepare("UPDATE novels SET total_chapters = ?, updated_at = datetime('now') WHERE id = ?").run(total, novelId)
}

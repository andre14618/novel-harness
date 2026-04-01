import { getDB } from "./connection"
import type { ChapterOutline } from "../types"

export function saveChapterOutline(novelId: string, outline: ChapterOutline): void {
  getDB().prepare("INSERT OR REPLACE INTO chapter_outlines (novel_id, chapter_number, outline_json) VALUES (?, ?, ?)").run(novelId, outline.chapterNumber, JSON.stringify(outline))
}

export function getChapterOutline(novelId: string, chapterNum: number): ChapterOutline {
  const row = getDB().prepare("SELECT outline_json FROM chapter_outlines WHERE novel_id = ? AND chapter_number = ?").get(novelId, chapterNum) as any
  if (!row) throw new Error(`No outline for chapter ${chapterNum}`)
  return JSON.parse(row.outline_json)
}

export function getChapterOutlines(novelId: string): ChapterOutline[] {
  const rows = getDB().prepare("SELECT outline_json FROM chapter_outlines WHERE novel_id = ? ORDER BY chapter_number").all(novelId) as any[]
  return rows.map(r => JSON.parse(r.outline_json))
}

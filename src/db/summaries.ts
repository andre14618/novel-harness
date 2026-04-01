import { getDB } from "./connection"
import type { ChapterSummary } from "../types"

export function saveChapterSummary(novelId: string, chapterNum: number, summary: string, keyEvents: string[]): void {
  getDB().prepare("INSERT OR REPLACE INTO chapter_summaries (novel_id, chapter_number, summary, key_events_json) VALUES (?, ?, ?, ?)").run(novelId, chapterNum, summary, JSON.stringify(keyEvents))
}

export function getRecentSummaries(novelId: string, chapterNum: number, count: number): ChapterSummary[] {
  const rows = getDB().prepare("SELECT chapter_number, summary, key_events_json FROM chapter_summaries WHERE novel_id = ? AND chapter_number < ? ORDER BY chapter_number DESC LIMIT ?").all(novelId, chapterNum, count) as any[]
  return rows.reverse().map(r => ({ chapterNumber: r.chapter_number, summary: r.summary, keyEvents: JSON.parse(r.key_events_json) }))
}

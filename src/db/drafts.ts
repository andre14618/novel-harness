import { getDB } from "./connection"

export function saveChapterDraft(novelId: string, chapterNum: number, prose: string, wordCount: number): void {
  const existing = getDB().prepare("SELECT MAX(version) as v FROM chapter_drafts WHERE novel_id = ? AND chapter_number = ?").get(novelId, chapterNum) as any
  const version = (existing?.v ?? 0) + 1
  getDB().prepare("INSERT INTO chapter_drafts (novel_id, chapter_number, prose, word_count, version) VALUES (?, ?, ?, ?, ?)").run(novelId, chapterNum, prose, wordCount, version)
}

export function approveChapterDraft(novelId: string, chapterNum: number): void {
  const latest = getDB().prepare("SELECT MAX(version) as v FROM chapter_drafts WHERE novel_id = ? AND chapter_number = ?").get(novelId, chapterNum) as any
  if (!latest?.v) return
  getDB().prepare("UPDATE chapter_drafts SET status = 'approved' WHERE novel_id = ? AND chapter_number = ? AND version = ?").run(novelId, chapterNum, latest.v)
}

export function getApprovedDraft(novelId: string, chapterNum: number): { prose: string; wordCount: number; version: number } | null {
  const row = getDB().prepare("SELECT prose, word_count, version FROM chapter_drafts WHERE novel_id = ? AND chapter_number = ? AND status = 'approved' ORDER BY version DESC LIMIT 1").get(novelId, chapterNum) as any
  if (!row) return null
  return { prose: row.prose, wordCount: row.word_count, version: row.version }
}

export function unapproveChapterDraft(novelId: string, chapterNum: number): void {
  getDB().prepare("UPDATE chapter_drafts SET status = 'draft' WHERE novel_id = ? AND chapter_number = ? AND status = 'approved'").run(novelId, chapterNum)
}

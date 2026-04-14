import db from "./connection"

export async function saveChapterDraft(novelId: string, chapterNum: number, prose: string, wordCount: number): Promise<void> {
  const rows = await db`SELECT MAX(version) as v FROM chapter_drafts WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum}`
  const version = (rows[0]?.v ?? 0) + 1
  await db`INSERT INTO chapter_drafts (novel_id, chapter_number, prose, word_count, version) VALUES (${novelId}, ${chapterNum}, ${prose}, ${wordCount}, ${version})`
}

export async function approveChapterDraft(novelId: string, chapterNum: number): Promise<void> {
  const rows = await db`SELECT MAX(version) as v FROM chapter_drafts WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum}`
  if (!rows[0]?.v) return
  await db`UPDATE chapter_drafts SET status = 'approved' WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum} AND version = ${rows[0].v}`
}

export async function getApprovedDraft(novelId: string, chapterNum: number): Promise<{ prose: string; wordCount: number; version: number } | null> {
  const rows = await db`SELECT prose, word_count, version FROM chapter_drafts WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum} AND status = 'approved' ORDER BY version DESC LIMIT 1`
  if (!rows.length) return null
  return { prose: rows[0].prose, wordCount: rows[0].word_count, version: rows[0].version }
}

export async function unapproveChapterDraft(novelId: string, chapterNum: number): Promise<void> {
  await db`UPDATE chapter_drafts SET status = 'draft' WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum} AND status = 'approved'`
}

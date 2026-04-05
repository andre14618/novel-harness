import db from "../../data/connection"
import type { ChapterOutline } from "../types"

export async function saveChapterOutline(novelId: string, outline: ChapterOutline): Promise<void> {
  await db`INSERT INTO chapter_outlines (novel_id, chapter_number, outline_json) VALUES (${novelId}, ${outline.chapterNumber}, ${JSON.stringify(outline)})
           ON CONFLICT (novel_id, chapter_number) DO UPDATE SET outline_json = EXCLUDED.outline_json`
}

export async function getChapterOutline(novelId: string, chapterNum: number): Promise<ChapterOutline> {
  const rows = await db`SELECT outline_json FROM chapter_outlines WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum}`
  if (!rows.length) throw new Error(`No outline for chapter ${chapterNum}`)
  return rows[0].outline_json as ChapterOutline
}

export async function getChapterOutlines(novelId: string): Promise<ChapterOutline[]> {
  const rows = await db`SELECT outline_json FROM chapter_outlines WHERE novel_id = ${novelId} ORDER BY chapter_number`
  return rows.map(r => r.outline_json as ChapterOutline)
}

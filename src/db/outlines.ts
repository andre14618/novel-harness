import db from "./connection"
import type { ChapterOutline } from "../types"

export async function saveChapterOutline(novelId: string, outline: ChapterOutline): Promise<void> {
  await db`INSERT INTO chapter_outlines (novel_id, chapter_number, outline_json) VALUES (${novelId}, ${outline.chapterNumber}, ${outline})
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

/**
 * Plan-assist override flag — persistent per-chapter signal that the user
 * decided at a plan-assist gate (docs/exhaustion-handler-design.md) to
 * skip the blocking checks for this chapter. Column added in migration
 * sql/029. Drafting.ts reads this at the top of each attempt to decide
 * whether to run plan-check and validation-driven reviser escalation.
 */
export async function isPlanCheckOverridden(novelId: string, chapterNum: number): Promise<boolean> {
  const rows = await db`SELECT plan_check_overridden FROM chapter_outlines WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum}`
  if (!rows.length) return false
  return rows[0].plan_check_overridden === true
}

export async function setPlanCheckOverridden(novelId: string, chapterNum: number, value: boolean): Promise<void> {
  await db`UPDATE chapter_outlines SET plan_check_overridden = ${value} WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum}`
}

import db from "./connection"
import type { Fact } from "../types"

export async function saveFact(novelId: string, fact: Omit<Fact, "id">): Promise<string> {
  const rows = await db`INSERT INTO facts (novel_id, fact, category, established_in_chapter)
                        VALUES (${novelId}, ${fact.fact}, ${fact.category}, ${fact.establishedInChapter})
                        RETURNING id`
  return rows[0].id
}

export async function getFactsUpToChapter(novelId: string, chapterNum: number): Promise<Fact[]> {
  const rows = await db`SELECT id, fact, category, established_in_chapter FROM facts
                        WHERE novel_id = ${novelId} AND established_in_chapter <= ${chapterNum}
                        ORDER BY established_in_chapter`
  return rows.map(r => ({ id: r.id, fact: r.fact, category: r.category, establishedInChapter: r.established_in_chapter }))
}

export async function getFactsForChapter(novelId: string, chapterNum: number): Promise<Fact[]> {
  const rows = await db`SELECT id, fact, category, established_in_chapter FROM facts
                        WHERE novel_id = ${novelId} AND established_in_chapter = ${chapterNum}
                        ORDER BY created_at`
  return rows.map(r => ({ id: r.id, fact: r.fact, category: r.category, establishedInChapter: r.established_in_chapter }))
}

export async function clearFactsForChapter(novelId: string, chapterNum: number): Promise<void> {
  await db`DELETE FROM facts WHERE novel_id = ${novelId} AND established_in_chapter = ${chapterNum}`
}

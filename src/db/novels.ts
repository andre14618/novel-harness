import db from "../../data/connection"
import type { Phase, SeedInput, NovelState } from "../types"

export async function createNovel(id: string, seed: SeedInput): Promise<void> {
  await db`INSERT INTO novels (id, seed_json) VALUES (${id}, ${seed})`
}

export async function getNovel(id: string): Promise<NovelState> {
  const rows = await db`SELECT * FROM novels WHERE id = ${id}`
  if (!rows.length) throw new Error(`Novel ${id} not found`)
  const row = rows[0]
  return {
    id: row.id, phase: row.phase as Phase, seed: row.seed_json as SeedInput,
    currentChapter: row.current_chapter, totalChapters: row.total_chapters,
  }
}

export async function updatePhase(novelId: string, phase: Phase): Promise<void> {
  await db`UPDATE novels SET phase = ${phase}, updated_at = now() WHERE id = ${novelId}`
}

export async function updateCurrentChapter(novelId: string, chapter: number): Promise<void> {
  await db`UPDATE novels SET current_chapter = ${chapter}, updated_at = now() WHERE id = ${novelId}`
}

export async function updateTotalChapters(novelId: string, total: number): Promise<void> {
  await db`UPDATE novels SET total_chapters = ${total}, updated_at = now() WHERE id = ${novelId}`
}

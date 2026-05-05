import db from "./connection"
import type { Phase, SeedInput, NovelState } from "../types"

type Executor = typeof db

export async function createNovel(id: string, seed: SeedInput): Promise<void> {
  await db`INSERT INTO novels (id, seed_json) VALUES (${id}, ${seed})`
}

export async function getNovel(
  id: string,
  opts: { executor?: Executor; forUpdate?: boolean } = {},
): Promise<NovelState> {
  const executor = opts.executor ?? db
  const rows = (opts.forUpdate === true
    ? await executor`SELECT * FROM novels WHERE id = ${id} FOR UPDATE`
    : await executor`SELECT * FROM novels WHERE id = ${id}`) as Array<{
      id: string
      phase: Phase
      seed_json: SeedInput
      current_chapter: number
      total_chapters: number
    }>
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

export async function updateNovelSeed(
  novelId: string,
  seed: SeedInput,
  executor: Executor = db,
): Promise<void> {
  await executor`UPDATE novels SET seed_json = ${seed}, updated_at = now() WHERE id = ${novelId}`
}

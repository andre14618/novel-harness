import db from "./connection"
import type { ChapterSummary } from "../types"

export async function saveChapterSummary(novelId: string, chapterNum: number, summary: string, keyEvents: string[], emotionalState: string = "", openThreads: string[] = []): Promise<void> {
  await db`INSERT INTO chapter_summaries (novel_id, chapter_number, summary, key_events_json, emotional_state, open_threads_json)
           VALUES (${novelId}, ${chapterNum}, ${summary}, ${keyEvents}, ${emotionalState}, ${openThreads})
           ON CONFLICT (novel_id, chapter_number) DO UPDATE SET
             summary = EXCLUDED.summary, key_events_json = EXCLUDED.key_events_json,
             emotional_state = EXCLUDED.emotional_state, open_threads_json = EXCLUDED.open_threads_json`
}

export async function getRecentSummaries(novelId: string, chapterNum: number, count: number): Promise<ChapterSummary[]> {
  const rows = await db`SELECT chapter_number, summary, key_events_json, emotional_state, open_threads_json
                        FROM chapter_summaries WHERE novel_id = ${novelId} AND chapter_number < ${chapterNum}
                        ORDER BY chapter_number DESC LIMIT ${count}`
  return rows.reverse().map(r => ({
    chapterNumber: r.chapter_number,
    summary: r.summary,
    keyEvents: r.key_events_json as string[],
    emotionalState: r.emotional_state || "",
    openThreads: (r.open_threads_json as string[]) ?? [],
  }))
}

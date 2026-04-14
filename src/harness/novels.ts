/**
 * High-level novel queries.
 * Aggregates across multiple tables for dashboard/status views.
 */

import db from "../db/connection"

export interface NovelSummary {
  id: string
  phase: string
  currentChapter: number
  totalChapters: number
  createdAt: string
  factCount: number
  eventCount: number
  hasEmbeddings: boolean
}

/** Get novel with aggregate stats */
export async function getNovelSummary(novelId: string): Promise<NovelSummary | null> {
  const rows = await db`SELECT * FROM novels WHERE id = ${novelId}`
  if (rows.length === 0) return null

  const n = rows[0]
  const [facts, events, embeds] = await Promise.all([
    db`SELECT COUNT(*) as c FROM facts WHERE novel_id = ${novelId}`,
    db`SELECT COUNT(*) as c FROM timeline_events WHERE novel_id = ${novelId}`,
    db`SELECT 1 FROM facts WHERE novel_id = ${novelId} AND embedding IS NOT NULL LIMIT 1`,
  ])

  return {
    id: n.id,
    phase: n.phase,
    currentChapter: n.current_chapter,
    totalChapters: n.total_chapters,
    createdAt: n.created_at,
    factCount: Number(facts[0].c),
    eventCount: Number(events[0].c),
    hasEmbeddings: embeds.length > 0,
  }
}

/** List all novels with basic stats */
export async function listNovelSummaries(): Promise<NovelSummary[]> {
  const novels = await db`SELECT id, phase, current_chapter, total_chapters, created_at FROM novels WHERE phase != 'archived' ORDER BY created_at DESC`
  return Promise.all(novels.map(async n => {
    const [facts, events, embeds] = await Promise.all([
      db`SELECT COUNT(*) as c FROM facts WHERE novel_id = ${n.id}`,
      db`SELECT COUNT(*) as c FROM timeline_events WHERE novel_id = ${n.id}`,
      db`SELECT 1 FROM facts WHERE novel_id = ${n.id} AND embedding IS NOT NULL LIMIT 1`,
    ])
    return {
      id: n.id,
      phase: n.phase,
      currentChapter: n.current_chapter,
      totalChapters: n.total_chapters,
      createdAt: n.created_at,
      factCount: Number(facts[0].c),
      eventCount: Number(events[0].c),
      hasEmbeddings: embeds.length > 0,
    }
  }))
}

/** Get novels suitable for context quality benchmarking (10+ chapters) */
export async function getBenchmarkableNovels(): Promise<Array<{ id: string; totalChapters: number }>> {
  const rows = await db`SELECT id, total_chapters FROM novels WHERE total_chapters >= 10 AND phase IN ('drafting', 'validation', 'done') ORDER BY created_at DESC LIMIT 5`
  return rows.map(r => ({ id: r.id, totalChapters: r.total_chapters }))
}

import db from "./connection"
import type { ChapterOutline } from "../types"
import { enrichOutlineIds } from "../harness/ids"

type Executor = typeof db

export interface StoredChapterOutline {
  chapterNumber: number
  outline: ChapterOutline
}

export async function saveChapterOutline(
  novelId: string,
  outline: ChapterOutline,
  executor: Executor = db,
): Promise<void> {
  const normalized = normalizeChapterOutlineForPersistence(outline)
  await executor`INSERT INTO chapter_outlines (novel_id, chapter_number, outline_json) VALUES (${novelId}, ${normalized.chapterNumber}, ${normalized})
           ON CONFLICT (novel_id, chapter_number) DO UPDATE SET outline_json = EXCLUDED.outline_json`
}

export function normalizeChapterOutlineForPersistence(outline: ChapterOutline): ChapterOutline {
  const normalized = JSON.parse(JSON.stringify(outline)) as ChapterOutline
  enrichOutlineIds(normalized)
  return normalized
}

export async function getChapterOutline(novelId: string, chapterNum: number): Promise<ChapterOutline> {
  const rows = await db`SELECT outline_json FROM chapter_outlines WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum}`
  if (!rows.length) throw new Error(`No outline for chapter ${chapterNum}`)
  return rows[0].outline_json as ChapterOutline
}

export async function getChapterOutlineByChapterId(
  novelId: string,
  chapterId: string,
  opts: { executor?: Executor; forUpdate?: boolean } = {},
): Promise<StoredChapterOutline | null> {
  const executor = opts.executor ?? db
  const rows = (opts.forUpdate === true
    ? await executor`
        SELECT chapter_number, outline_json
        FROM chapter_outlines
        WHERE novel_id = ${novelId}
          AND outline_json->>'chapterId' = ${chapterId}
        FOR UPDATE
      `
    : await executor`
        SELECT chapter_number, outline_json
        FROM chapter_outlines
        WHERE novel_id = ${novelId}
          AND outline_json->>'chapterId' = ${chapterId}
      `) as Array<{ chapter_number: number; outline_json: ChapterOutline }>
  if (rows.length === 0) return null
  return {
    chapterNumber: rows[0]!.chapter_number,
    outline: rows[0]!.outline_json,
  }
}

export async function getChapterOutlineByBeatId(
  novelId: string,
  beatId: string,
  opts: { executor?: Executor; forUpdate?: boolean } = {},
): Promise<StoredChapterOutline | null> {
  const executor = opts.executor ?? db
  const rows = (opts.forUpdate === true
    ? await executor`
        SELECT chapter_number, outline_json
        FROM chapter_outlines
        WHERE novel_id = ${novelId}
        ORDER BY chapter_number
        FOR UPDATE
      `
    : await executor`
        SELECT chapter_number, outline_json
        FROM chapter_outlines
        WHERE novel_id = ${novelId}
        ORDER BY chapter_number
      `) as Array<{ chapter_number: number; outline_json: ChapterOutline }>
  for (const row of rows) {
    const outline = normalizeChapterOutlineForPersistence(row.outline_json)
    if ((outline.scenes ?? []).some((beat) => beat.beatId === beatId)) {
      return {
        chapterNumber: row.chapter_number,
        outline,
      }
    }
  }
  return null
}

export async function getChapterOutlineByObligationId(
  novelId: string,
  obligationId: string,
  opts: { executor?: Executor; forUpdate?: boolean } = {},
): Promise<StoredChapterOutline | null> {
  const executor = opts.executor ?? db
  const rows = (opts.forUpdate === true
    ? await executor`
        SELECT chapter_number, outline_json
        FROM chapter_outlines
        WHERE novel_id = ${novelId}
        ORDER BY chapter_number
        FOR UPDATE
      `
    : await executor`
        SELECT chapter_number, outline_json
        FROM chapter_outlines
        WHERE novel_id = ${novelId}
        ORDER BY chapter_number
      `) as Array<{ chapter_number: number; outline_json: ChapterOutline }>
  for (const row of rows) {
    const outline = normalizeChapterOutlineForPersistence(row.outline_json)
    if (outlineHasObligationId(outline, obligationId)) {
      return {
        chapterNumber: row.chapter_number,
        outline,
      }
    }
  }
  return null
}

function outlineHasObligationId(outline: ChapterOutline, obligationId: string): boolean {
  for (const beat of outline.scenes ?? []) {
    const obligations = beat.obligations as Record<string, unknown> | undefined
    if (!obligations) continue
    for (const value of Object.values(obligations)) {
      if (!Array.isArray(value)) continue
      if (value.some((item) =>
        typeof item === "object" &&
        item !== null &&
        !Array.isArray(item) &&
        (item as { obligationId?: unknown }).obligationId === obligationId
      )) {
        return true
      }
    }
  }
  return false
}

export async function getChapterOutlines(novelId: string): Promise<ChapterOutline[]> {
  const rows = await db`SELECT outline_json FROM chapter_outlines WHERE novel_id = ${novelId} ORDER BY chapter_number`
  return rows.map((r: any) => r.outline_json as ChapterOutline)
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

/**
 * Revision-used guard — persistent per-chapter signal that the chapter-plan-reviser
 * has already been invoked for this chapter. Column added in migration sql/031.
 *
 * Set to TRUE BEFORE the reviser call in drafting.ts (mirroring the in-memory
 * `revisionUsed = true` flip) so a process restart mid-call cannot allow a
 * duplicate invocation on resume. The hard cap is "one reviser call per chapter
 * across the novel's lifetime."
 *
 * See docs/archive/2026-04/next-session-plan.md §Tier 1a and
 * docs/patterns/in-memory-state-restart-data-loss.md.
 */
export async function isRevisionUsed(novelId: string, chapterNum: number): Promise<boolean> {
  const rows = await db`SELECT revision_used FROM chapter_outlines WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum}`
  if (!rows.length) return false
  return rows[0].revision_used === true
}

export async function setRevisionUsed(novelId: string, chapterNum: number, value: boolean): Promise<void> {
  await db`UPDATE chapter_outlines SET revision_used = ${value} WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum}`
}

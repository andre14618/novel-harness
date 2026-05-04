import db from "./connection"

type Executor = typeof db

export async function saveChapterDraft(
  novelId: string,
  chapterNum: number,
  prose: string,
  wordCount: number,
  executor: Executor = db,
): Promise<number> {
  const rows = await executor`SELECT MAX(version) as v FROM chapter_drafts WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum}`
  const version = (rows[0]?.v ?? 0) + 1
  await executor`INSERT INTO chapter_drafts (novel_id, chapter_number, prose, word_count, version) VALUES (${novelId}, ${chapterNum}, ${prose}, ${wordCount}, ${version})`
  return version
}

/**
 * Phase 5 commit 4 — read the latest draft (any status) for a chapter,
 * optionally locking the row for the duration of the caller's tx.
 *
 * The prose-edit resolve route (`src/orchestrator/prose-edit-routes.ts`)
 * uses this with `forUpdate=true` inside `db.begin(tx => …)` so a
 * concurrent edit cannot land between the precondition check and the
 * apply. Reading without the lock returns the same row but does not
 * serialize contenders.
 */
export async function getLatestChapterDraft(
  novelId: string,
  chapterNum: number,
  opts: { executor?: Executor; forUpdate?: boolean } = {},
): Promise<{ prose: string; wordCount: number; version: number; status: string } | null> {
  const exec = opts.executor ?? db
  const rows = opts.forUpdate
    ? await exec`SELECT prose, word_count, version, status FROM chapter_drafts
                 WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum}
                 ORDER BY version DESC
                 LIMIT 1
                 FOR UPDATE`
    : await exec`SELECT prose, word_count, version, status FROM chapter_drafts
                 WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum}
                 ORDER BY version DESC
                 LIMIT 1`
  if (!rows.length) return null
  return {
    prose: rows[0].prose,
    wordCount: rows[0].word_count,
    version: rows[0].version,
    status: rows[0].status,
  }
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

export async function deleteChapterDrafts(novelId: string, chapterNum: number): Promise<void> {
  await db`DELETE FROM chapter_drafts WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum}`
}

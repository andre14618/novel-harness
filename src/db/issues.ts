import { getDB } from "./connection"
import type { ContinuityIssue } from "../schemas/shared"

export function saveIssue(novelId: string, issue: { severity: string; description: string; chapter: number; conflictsWith?: string; suggestedFix?: string }): void {
  const id = crypto.randomUUID()
  getDB().prepare("INSERT INTO issues (id, novel_id, severity, description, chapter, conflicts_with, suggested_fix) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, novelId, issue.severity, issue.description, issue.chapter, issue.conflictsWith ?? null, issue.suggestedFix ?? null)
}

export function getOpenIssues(novelId: string, chapterNum?: number): ContinuityIssue[] {
  let sql = "SELECT severity, description, conflicts_with, suggested_fix FROM issues WHERE novel_id = ? AND status = 'open'"
  const params: any[] = [novelId]
  if (chapterNum !== undefined) { sql += " AND chapter = ?"; params.push(chapterNum) }
  const rows = getDB().prepare(sql).all(...params) as any[]
  return rows.map(r => ({ severity: r.severity, description: r.description, conflictsWith: r.conflicts_with ?? undefined, suggestedFix: r.suggested_fix ?? undefined }))
}

export function resolveIssuesForChapter(novelId: string, chapterNum: number): void {
  getDB().prepare("UPDATE issues SET status = 'resolved' WHERE novel_id = ? AND chapter = ? AND status = 'open'").run(novelId, chapterNum)
}

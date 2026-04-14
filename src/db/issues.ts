import db from "./connection"
import type { ContinuityIssue } from "../schemas/shared"

export async function saveIssue(novelId: string, issue: { severity: string; description: string; chapter: number; conflictsWith?: string; suggestedFix?: string }): Promise<void> {
  await db`INSERT INTO issues (novel_id, severity, description, chapter, conflicts_with, suggested_fix)
           VALUES (${novelId}, ${issue.severity}, ${issue.description}, ${issue.chapter}, ${issue.conflictsWith ?? null}, ${issue.suggestedFix ?? null})`
}

export async function getOpenIssues(novelId: string, chapterNum?: number): Promise<ContinuityIssue[]> {
  const rows = chapterNum !== undefined
    ? await db`SELECT severity, description, conflicts_with, suggested_fix FROM issues WHERE novel_id = ${novelId} AND status = 'open' AND chapter = ${chapterNum}`
    : await db`SELECT severity, description, conflicts_with, suggested_fix FROM issues WHERE novel_id = ${novelId} AND status = 'open'`
  return rows.map(r => ({
    severity: r.severity,
    description: r.description,
    conflictsWith: r.conflicts_with ?? undefined,
    suggestedFix: r.suggested_fix ?? undefined,
  }))
}

export async function resolveIssuesForChapter(novelId: string, chapterNum: number): Promise<void> {
  await db`UPDATE issues SET status = 'resolved' WHERE novel_id = ${novelId} AND chapter = ${chapterNum} AND status = 'open'`
}

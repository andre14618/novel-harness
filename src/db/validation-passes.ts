import { getDB } from "./connection"

export function saveValidationPass(novelId: string, passNumber: number, chapterNum: number, status: string, issuesFound: number): void {
  getDB().prepare("INSERT OR REPLACE INTO validation_passes (novel_id, pass_number, chapter_number, status, issues_found) VALUES (?, ?, ?, ?, ?)").run(novelId, passNumber, chapterNum, status, issuesFound)
}

export function getValidationAttempts(novelId: string, chapterNum: number): number {
  const row = getDB().prepare("SELECT COUNT(*) as total FROM validation_passes WHERE novel_id = ? AND chapter_number = ? AND status = 'rewritten'").get(novelId, chapterNum) as any
  return row?.total ?? 0
}

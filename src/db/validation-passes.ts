import db from "./connection"

export async function saveValidationPass(novelId: string, passNumber: number, chapterNum: number, status: string, issuesFound: number): Promise<void> {
  await db`INSERT INTO validation_passes (novel_id, pass_number, chapter_number, status, issues_found)
           VALUES (${novelId}, ${passNumber}, ${chapterNum}, ${status}, ${issuesFound})
           ON CONFLICT (novel_id, pass_number, chapter_number) DO UPDATE SET status = EXCLUDED.status, issues_found = EXCLUDED.issues_found`
}

export async function getValidationAttempts(novelId: string, chapterNum: number): Promise<number> {
  const rows = await db`SELECT COUNT(*) as total FROM validation_passes WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum} AND status = 'rewritten'`
  return Number(rows[0]?.total ?? 0)
}

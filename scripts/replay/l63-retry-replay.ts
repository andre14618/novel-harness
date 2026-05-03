#!/usr/bin/env bun
/**
 * L63 retry-replay: re-run the (post-L63) detector + renderer over the
 * historical chapter-draft prose for the three multi-fail chapters that
 * the phase brief flagged. Reports, per attempt, the integrity issues
 * detected and shows how `formatChapterIntegrityRetryContext` would
 * have rendered them under the matched-pair format.
 *
 * No DB writes; no paid tokens. Pure replay of historical prose against
 * current code.
 */

import db from "../../src/db/connection"
import { detectProseIntegrityIssues } from "../../src/lint/integrity"
import { formatChapterIntegrityRetryContext } from "../../src/agents/writer/retry-context"

const CASES: Array<{ novelId: string; chapter: number }> = [
  { novelId: "novel-1777712370271", chapter: 1 },
  { novelId: "novel-1777721066908", chapter: 2 },
  { novelId: "novel-1777761636607", chapter: 1 },
]

async function main() {
  for (const { novelId, chapter } of CASES) {
    const rows = await db<{
      version: number
      prose: string
    }[]>`SELECT version, prose FROM chapter_drafts
         WHERE novel_id = ${novelId} AND chapter_number = ${chapter}
         ORDER BY version`

    console.log(`\n=== ${novelId} ch${chapter} (${rows.length} versions) ===`)
    for (const r of rows) {
      const issues = detectProseIntegrityIssues(r.prose)
      const summary: Record<string, number> = {}
      let withFirst = 0
      for (const i of issues) {
        summary[i.kind] = (summary[i.kind] ?? 0) + 1
        if (i.firstExcerpt) withFirst += 1
      }
      const summaryStr = Object.entries(summary)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")
      console.log(
        `  v${r.version}: total=${issues.length} ${summaryStr || "(clean)"} ` +
          `firstExcerpt=${withFirst}/${issues.length}`,
      )
      if (issues.length > 0 && r.version > 1) {
        const block = formatChapterIntegrityRetryContext(issues)
        const matchedLines = block.split("\n").filter(l => l.includes("paraphrase one side"))
        console.log(`    rendered to next attempt: ${matchedLines.length} matched-pair line(s)`)
        if (matchedLines.length > 0) console.log(`    sample: ${matchedLines[0].trim()}`)
      }
    }
  }
  await db.end()
}

main().catch(e => { console.error(e); process.exit(1) })

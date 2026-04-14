/**
 * Quick inspection of chapter outlines for a given novel.
 * Shows settings, beat descriptions, and word counts.
 *
 * Usage: NOVEL_ID=novel-xxx bun scripts/inspect-novel-plans.ts
 */
import db from "../../data/connection"

const NOVEL_ID = process.env.NOVEL_ID || "novel-1776022336598"

const rows = await db`
  SELECT co.chapter_number, co.outline_json, cd.word_count, cd.status
  FROM chapter_outlines co
  LEFT JOIN chapter_drafts cd ON co.novel_id = cd.novel_id AND co.chapter_number = cd.chapter_number
  WHERE co.novel_id = ${NOVEL_ID}
  ORDER BY co.chapter_number
`

console.log(`Novel: ${NOVEL_ID} (${rows.length} chapters)\n`)

for (const r of rows) {
  const o = typeof r.outline_json === "string" ? JSON.parse(r.outline_json) : r.outline_json
  const scenes = o.scenes || []
  const descWords = scenes.map((s: any) => (s.description || "").split(/\s+/).length)
  const avgDescW = descWords.length > 0 ? Math.round(descWords.reduce((a: number, b: number) => a + b, 0) / descWords.length) : 0

  console.log(`Ch${r.chapter_number} | ${r.word_count || 0}w | ${r.status || "pending"} | setting: "${o.setting || "none"}" | ${scenes.length} beats, avg ${avgDescW}w desc`)
  for (const [i, s] of scenes.entries()) {
    const desc = (s.description || "").slice(0, 150)
    const chars = (s.characters || []).join(", ")
    console.log(`  beat${i}: [${chars}] ${desc}`)
  }
  console.log()
}

process.exit(0)

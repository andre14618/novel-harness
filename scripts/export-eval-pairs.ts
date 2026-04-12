/**
 * Export production beat/prose pairs for ground-truth evaluation.
 * Run on LXC: bun scripts/export-eval-pairs.ts > /tmp/eval-pairs.json
 */
import db from "../data/connection.ts"

const CHAPTER_LIMIT = 15

async function main() {
  const chapters = await db`
    SELECT cd.novel_id, cd.chapter_number, cd.prose, co.outline_json
    FROM chapter_drafts cd
    JOIN chapter_outlines co ON co.novel_id = cd.novel_id AND co.chapter_number = cd.chapter_number
    WHERE cd.status = 'approved'
    ORDER BY cd.novel_id, cd.chapter_number
    LIMIT ${CHAPTER_LIMIT}
  `

  const pairs: any[] = []
  for (const ch of chapters as any[]) {
    const outline = typeof ch.outline_json === "string" ? JSON.parse(ch.outline_json) : ch.outline_json
    const scenes = outline?.scenes || []
    const paragraphs = (ch.prose as string).split("\n\n").filter((p: string) => p.trim())
    if (!scenes.length || !paragraphs.length) continue

    const parasPerBeat = Math.ceil(paragraphs.length / scenes.length)
    for (let i = 0; i < Math.min(scenes.length, 3); i++) {
      const start = i * parasPerBeat
      const end = Math.min(start + parasPerBeat, paragraphs.length)
      const prose = paragraphs.slice(start, end).join("\n\n").slice(0, 2000)
      if (prose.length < 50) continue
      pairs.push({
        id: pairs.length,
        label: `ch${ch.chapter_number}/beat${i}`,
        beatDescription: scenes[i]?.description || JSON.stringify(scenes[i]),
        beatCharacters: scenes[i]?.characters || [],
        setting: outline?.setting || "",
        prose,
      })
    }
  }

  console.log(JSON.stringify(pairs, null, 2))
  console.error(`Exported ${pairs.length} pairs from ${CHAPTER_LIMIT} chapters`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })

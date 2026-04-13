import db from "../data/connection"

await db`UPDATE lint_patterns SET enabled = false WHERE id IN (68, 69)`
console.log("Disabled: 68 (RHYTHM_MONOTONY) + 69 (PARAGRAPH_HOMOGENEITY)")

const enabled = await db`SELECT id, category FROM lint_patterns WHERE enabled = true ORDER BY category, id`
const byCat: Record<string, number> = {}
for (const p of enabled) { byCat[p.category] = (byCat[p.category] || 0) + 1 }
console.log(`Final: ${enabled.length} patterns`)
for (const [cat, count] of Object.entries(byCat)) console.log(`  ${count}x ${cat}`)
process.exit(0)

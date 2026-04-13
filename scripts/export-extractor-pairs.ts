/**
 * Export existing 235B extraction pairs from llm_calls as JSONL training data.
 *
 * Phase 1 of extractor SFT pipeline. Queries successful extraction calls
 * that have full system_prompt + user_prompt + response_content saved.
 * Outputs OpenAI chat format JSONL ready for W&B LoRA training.
 *
 * Deduplicates by (novel_id, chapter) — keeps the latest call per chapter.
 * Validates response_content parses as JSON before including.
 *
 * Usage:
 *   bun scripts/export-extractor-pairs.ts                    # export all 4 extractors
 *   bun scripts/export-extractor-pairs.ts --agent fact-extractor  # single agent
 *   bun scripts/export-extractor-pairs.ts --dry-run          # count only
 */

import { writeFileSync } from "fs"
import { join } from "path"

const sql = (await import("../data/connection.ts")).default

const AGENTS = [
  "fact-extractor",
  "summary-extractor",
  "character-state",
  "relationship-timeline",
]

const AGENT_ARG = process.argv.indexOf("--agent")
const AGENT_FILTER = AGENT_ARG !== -1 ? process.argv[AGENT_ARG + 1] : null
const DRY_RUN = process.argv.includes("--dry-run")

const targets = AGENT_FILTER ? [AGENT_FILTER] : AGENTS

console.log(`\n${"=".repeat(70)}`)
console.log(`  Extractor Pair Export — Phase 1`)
console.log(`  Mode: ${DRY_RUN ? "DRY RUN" : "EXPORT"}`)
console.log(`  Agents: ${targets.join(", ")}`)
console.log(`${"=".repeat(70)}\n`)

let totalExported = 0

for (const agent of targets) {
  // Get latest call per (novel_id, chapter) with full prompt data
  const rows = await sql`
    SELECT DISTINCT ON (novel_id, chapter)
      novel_id, chapter, system_prompt, user_prompt, response_content, timestamp
    FROM llm_calls
    WHERE agent = ${agent}
      AND system_prompt IS NOT NULL
      AND user_prompt IS NOT NULL
      AND response_content IS NOT NULL
      AND NOT failed
      AND novel_id IS NOT NULL
      AND chapter IS NOT NULL
    ORDER BY novel_id, chapter, timestamp DESC
  `

  let valid = 0
  let invalid = 0
  const lines: string[] = []

  for (const row of rows) {
    // Validate response parses as JSON
    try {
      const content = row.response_content.trim()
      // Strip markdown code fences if present
      const cleaned = content
        .replace(/^```[a-z]*\n?/, "")
        .replace(/\n?```$/, "")
        .trim()
      const start = cleaned.indexOf("{")
      const end = cleaned.lastIndexOf("}") + 1
      if (start === -1 || end === 0) {
        invalid++
        continue
      }
      JSON.parse(cleaned.slice(start, end))

      // Build training pair in OpenAI chat format
      const pair = {
        messages: [
          { role: "system", content: row.system_prompt },
          { role: "user", content: row.user_prompt },
          { role: "assistant", content: row.response_content },
        ],
        _meta: {
          source: "llm_calls",
          agent,
          novel_id: row.novel_id,
          chapter: row.chapter,
          exported_at: new Date().toISOString(),
        },
      }
      lines.push(JSON.stringify(pair))
      valid++
    } catch {
      invalid++
    }
  }

  const outPath = join(import.meta.dir, `../lora-data/${agent}-pairs.jsonl`)

  if (!DRY_RUN && lines.length > 0) {
    writeFileSync(outPath, lines.join("\n") + "\n")
  }

  console.log(`--- ${agent} ---`)
  console.log(`  Total calls:   ${rows.length}`)
  console.log(`  Valid JSON:    ${valid}`)
  console.log(`  Invalid JSON:  ${invalid}`)
  if (!DRY_RUN && lines.length > 0) {
    console.log(`  Written to:    lora-data/${agent}-pairs.jsonl`)
  }
  console.log()

  totalExported += valid
}

console.log(`Total exported: ${totalExported} pairs across ${targets.length} agents`)

// Show coverage gap
const approvedChapters = await sql`
  SELECT COUNT(*) as c FROM chapter_drafts WHERE status = 'approved'
`
const totalApproved = Number(approvedChapters[0].c)
const perAgent = Math.round(totalExported / targets.length)
const gap = totalApproved - perAgent

console.log(`\nApproved chapters: ${totalApproved}`)
console.log(`Pairs per agent:   ~${perAgent}`)
console.log(`Coverage gap:      ~${gap} chapters need re-extraction (Phase 2)`)

process.exit(0)

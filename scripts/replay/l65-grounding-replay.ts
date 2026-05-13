#!/usr/bin/env bun
/**
 * L65 grounding-carry-over replay: re-run the (post-L65) extractor + renderer
 * over the historical halluc-ungrounded blocker descriptions logged by exp
 * #389 on novel-1777768466618 ch1, and confirm "central spire" lands in the
 * AVOID block that would have been delivered to attempt 2's beat-writer.
 *
 * No DB writes; no paid tokens. Pure replay of historical log strings against
 * current code.
 *
 * Source data path: `chapter_exhaustions.unresolved_deviations` for the smoke
 * row, plus `llm_calls.response_content` from halluc-ungrounded checker rows
 * for that chapter (LLM-confirmed entities).
 */

import db from "../../src/db/connection"
import { parseJsonbArray } from "../../src/db/jsonb"
import {
  extractUngroundedEntitiesFromDescriptions,
  formatChapterUngroundedRetryContext,
} from "../../src/agents/writer/retry-context"

async function main() {
  // Pull the chapter_exhaustions row for the smoke case (exp #389, ch1).
  const exhRow = await db<{ unresolved_deviations: any }[]>`
    SELECT unresolved_deviations FROM chapter_exhaustions
    WHERE novel_id = 'novel-1777768466618' AND chapter = 1
    ORDER BY fired_at DESC LIMIT 1
  `
  const raw = exhRow[0]?.unresolved_deviations ?? []
  const parsed = parseJsonbArray<{ description?: string }>(raw)
  const exhDescriptions: string[] = parsed.map(d => d.description ?? "").filter(s => s.length > 0)

  // Strip the scene-check/legacy beat-check halluc prefix that
  // chapter_exhaustions prepends, leaving the raw checker line.
  const cleaned = exhDescriptions.map(d => {
    const m = /^(?:\[beat \d+\]\s*)?\[(?:scene|beat)-check:halluc-ungrounded\]\s*(?:(?:Scene|Beat) \d+:\s*)?(.+)$/.exec(d)
    return m ? m[1]! : d
  })

  const entities = extractUngroundedEntitiesFromDescriptions(cleaned)
  const block = formatChapterUngroundedRetryContext(entities)

  console.log("=== exhaustion descriptions (n=" + cleaned.length + ") ===")
  for (const c of cleaned) console.log("  " + c.slice(0, 200))
  console.log("\n=== extracted entities (n=" + entities.length + ") ===")
  for (const e of entities) console.log(`  ${e.entity}${e.excerpt ? ` (excerpt: ${e.excerpt.slice(0, 80)})` : ""}`)
  console.log("\n=== rendered AVOID block ===")
  console.log(block)
  console.log("\n=== assertion ===")
  const containsSpire = block.toLowerCase().includes("central spire")
  console.log(`block contains "central spire": ${containsSpire}`)
  if (!containsSpire) {
    process.exitCode = 1
    console.error("FAIL: 'central spire' missing from rendered AVOID block")
  } else {
    console.log("PASS: L65 carry-over would have surfaced 'central spire' to attempt 2's writer")
  }

  await db.end()
}

main().catch(e => { console.error(e); process.exit(1) })

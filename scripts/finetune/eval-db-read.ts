#!/usr/bin/env bun
/**
 * Dump eval_briefs rows for a given set_name as JSONL to stdout.
 * Output format matches what phase-c3-generalization.py expects:
 *   {"brief": {...}, "ground_truth_prose": "..."}
 *
 * Usage:
 *   bun scripts/finetune/eval-db-read.ts --set-name salvatore-original-v1 > /tmp/briefs.jsonl
 */

import db from "../../src/db/connection"

async function main() {
  const args = process.argv.slice(2)
  const setIdx = args.indexOf("--set-name")
  if (setIdx < 0 || !args[setIdx + 1]) {
    console.error("usage: --set-name <name>")
    process.exit(1)
  }
  const setName = args[setIdx + 1]

  const rows = await db`
    SELECT beat_id, brief_json, ground_truth_prose, ground_truth_style
    FROM eval_briefs
    WHERE set_name = ${setName}
    ORDER BY beat_id
  `

  for (const r of rows) {
    const out: any = { brief: r.brief_json }
    if (r.ground_truth_prose) out.ground_truth_prose = r.ground_truth_prose
    if (r.ground_truth_style) out.ground_truth_style = r.ground_truth_style
    process.stdout.write(JSON.stringify(out) + "\n")
  }
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })

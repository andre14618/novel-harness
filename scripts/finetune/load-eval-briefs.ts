#!/usr/bin/env bun
/**
 * Load a JSONL brief file into the eval_briefs DB table.
 *
 * Usage:
 *   bun scripts/finetune/load-eval-briefs.ts \
 *     --input /tmp/salvatore-original-briefs-expanded.jsonl \
 *     --set-name salvatore-original-v1 \
 *     --notes "18 original-character briefs. No Salvatore lore."
 *
 * Input JSONL shape (one of):
 *   {"brief": {"beat_id": "...", ...}}
 *   {"brief": {...}, "ground_truth_prose": "..."}
 *   {"brief": {...}, "ground_truth_prose": "...", "ground_truth_style": {...}}
 *
 * Upserts by (set_name, beat_id).
 */

import db from "../../src/db/connection"

function parseArgs(): { input: string; setName: string; notes?: string; dryRun: boolean } {
  const args = process.argv.slice(2)
  let input = "", setName = "", notes: string | undefined, dryRun = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input") input = args[++i]
    else if (args[i] === "--set-name") setName = args[++i]
    else if (args[i] === "--notes") notes = args[++i]
    else if (args[i] === "--dry-run") dryRun = true
  }
  if (!input || !setName) {
    console.error("usage: --input <file> --set-name <name> [--notes <text>] [--dry-run]")
    process.exit(1)
  }
  return { input, setName, notes, dryRun }
}

async function main() {
  const args = parseArgs()
  const lines = (await Bun.file(args.input).text()).split("\n").filter(l => l.trim())

  const rows = lines.flatMap(line => {
    try {
      const obj = JSON.parse(line)
      const brief = obj.brief ?? obj
      if (!brief.beat_id) return []
      return [{
        set_name: args.setName,
        beat_id: brief.beat_id,
        brief_json: brief,
        ground_truth_prose: obj.ground_truth_prose ?? null,
        ground_truth_style: obj.ground_truth_style ?? null,
        notes: args.notes ?? null,
      }]
    } catch {
      return []
    }
  })

  console.log(`Prepared ${rows.length} rows for set_name='${args.setName}'`)

  if (args.dryRun) {
    console.log("DRY RUN. First row:")
    console.log(JSON.stringify(rows[0], null, 2).slice(0, 600))
    return
  }

  for (const r of rows) {
    await db`
      INSERT INTO eval_briefs (set_name, beat_id, brief_json, ground_truth_prose, ground_truth_style, notes)
      VALUES (${r.set_name}, ${r.beat_id}, ${r.brief_json}, ${r.ground_truth_prose}, ${r.ground_truth_style}, ${r.notes})
      ON CONFLICT (set_name, beat_id) DO UPDATE SET
        brief_json = EXCLUDED.brief_json,
        ground_truth_prose = EXCLUDED.ground_truth_prose,
        ground_truth_style = EXCLUDED.ground_truth_style,
        notes = EXCLUDED.notes
    `
  }

  const [{ count }] = await db`SELECT COUNT(*)::int AS count FROM eval_briefs WHERE set_name = ${args.setName}`
  console.log(`✓ eval_briefs now has ${count} rows under set_name='${args.setName}'`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })

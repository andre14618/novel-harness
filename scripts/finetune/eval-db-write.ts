#!/usr/bin/env bun
/**
 * Import phase-c3-generalization.py output JSONL into the eval_results DB table.
 *
 * Usage:
 *   bun scripts/finetune/eval-db-write.ts \
 *     --input /tmp/phase-c3-v3-original.jsonl \
 *     --set-name salvatore-original-v1 \
 *     --experiment-id 196
 *
 * The phase-c3 JSONL rows look like:
 *   {
 *     "beat_id": "...", "kind": "...", "cell": "C-salvatore-lora-v3",
 *     "target_words": 120, "recon_words": 134,
 *     "style": {avg_sentence_words, dialogue_ratio, clause_complexity, sensory_density},
 *     "prose": "...", "ngram_jaccard_vs_gt": 0.023
 *   }
 *
 * Each row becomes an eval_results entry. Adapter URI is derived from the
 * phase-c3 script's cell table (C-salvatore-lora-vN → wandb-artifact:///.../salvatore-1988-vN).
 * Override with --adapter-uri if the cell label doesn't encode it cleanly.
 */

import db from "../../src/db/connection"

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (k: string) => {
    const i = args.indexOf(k)
    return i >= 0 ? args[i + 1] : undefined
  }
  const input = get("--input")
  const setName = get("--set-name")
  const experimentId = get("--experiment-id")
  const adapterOverride = get("--adapter-uri")
  if (!input || !setName) {
    console.error("usage: --input <jsonl> --set-name <name> [--experiment-id <n>] [--adapter-uri <uri>]")
    process.exit(1)
  }
  return {
    input: input!,
    setName: setName!,
    experimentId: experimentId ? Number(experimentId) : null,
    adapterOverride: adapterOverride ?? null,
  }
}

function inferAdapterUri(cellLabel: string): string | null {
  // C-salvatore-lora-v3 → wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v3
  // C-salvatore-lora → wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v1 (base)
  const m = cellLabel.match(/salvatore-lora(?:-v(\d+))?$/)
  if (m) {
    const version = m[1] ?? "1"
    return `wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v${version}`
  }
  if (cellLabel.startsWith("A-deepseek")) return "deepseek-chat"
  if (cellLabel.startsWith("B-deepseek")) return "deepseek-chat"
  return null
}

function countParagraphBreaks(text: string): number {
  return (text.match(/\n\n/g) || []).length
}

// Matches SALVATORE_BASELINE + delta_sum() from phase-c3-generalization.py.
// Computed per-row when phase-c3's JSONL only has cell-level aggregates.
const SALVATORE_BASELINE = {
  avg_sentence_words: 18.3,
  dialogue_ratio: 0.28,
  clause_complexity: 0.62,
  sensory_density: 1.56,
}

function computeDeltaSum(style: Record<string, number> | null): number | null {
  if (!style) return null
  if (typeof style.avg_sentence_words !== "number") return null
  return (
    Math.abs(style.avg_sentence_words - SALVATORE_BASELINE.avg_sentence_words) / 10.0 +
    Math.abs(style.dialogue_ratio - SALVATORE_BASELINE.dialogue_ratio) +
    Math.abs(style.clause_complexity - SALVATORE_BASELINE.clause_complexity) +
    Math.abs(style.sensory_density - SALVATORE_BASELINE.sensory_density) / 2.0
  )
}

async function main() {
  const args = parseArgs()
  const lines = (await Bun.file(args.input).text()).split("\n").filter(l => l.trim())

  let inserted = 0
  let skipped = 0
  for (const line of lines) {
    const row = JSON.parse(line)
    const adapter = args.adapterOverride ?? inferAdapterUri(row.cell ?? "") ?? "unknown"
    if (row.error) {
      await db`
        INSERT INTO eval_results (experiment_id, set_name, beat_id, adapter_uri, cell_label, error_text)
        VALUES (${args.experimentId}, ${args.setName}, ${row.beat_id}, ${adapter}, ${row.cell}, ${row.error})
      `
      skipped++
      continue
    }

    const delta = row.delta_sum ?? computeDeltaSum(row.style ?? null)
    await db`
      INSERT INTO eval_results (
        experiment_id, set_name, beat_id, adapter_uri, cell_label,
        generated_prose, style_features, delta_sum, ngram_jaccard_vs_gt,
        paragraph_breaks_count, word_count
      ) VALUES (
        ${args.experimentId}, ${args.setName}, ${row.beat_id}, ${adapter}, ${row.cell},
        ${row.prose ?? null}, ${row.style ?? null}, ${delta},
        ${row.ngram_jaccard_vs_gt ?? null}, ${countParagraphBreaks(row.prose ?? "")},
        ${row.recon_words ?? null}
      )
    `
    inserted++
  }

  console.log(`✓ inserted ${inserted} eval_results rows (${skipped} error rows) for set_name='${args.setName}' experiment_id=${args.experimentId}`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })

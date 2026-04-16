#!/usr/bin/env bun
/**
 * Print the full lineage of an adapter: what training config, what corpus,
 * what commit, what briefs were used to evaluate, what the results look like.
 *
 * Usage:
 *   bun scripts/finetune/provenance-report.ts --adapter salvatore-1988-v3
 *   bun scripts/finetune/provenance-report.ts --experiment 196
 *   bun scripts/finetune/provenance-report.ts --result-id 140
 *
 * Chain printed:
 *   1. Adapter identity (URI + W&B run URL)
 *   2. Training experiment (id, description, commit, status, conclusion)
 *   3. Training config (base model, rank, epochs, LR, training_pairs, train_file)
 *   4. Formatter pipeline (if recorded in config)
 *   5. Eval sets used against this adapter + per-set cell_delta_sum
 *   6. Parent experiments (lineage)
 */

import db from "../../src/db/connection"

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (k: string) => {
    const i = args.indexOf(k)
    return i >= 0 ? args[i + 1] : undefined
  }
  return {
    adapter: get("--adapter"),
    experiment: get("--experiment") ? Number(get("--experiment")) : undefined,
    resultId: get("--result-id") ? Number(get("--result-id")) : undefined,
  }
}

function hr(title: string): void {
  console.log()
  console.log(`━━━ ${title} ━━━`)
}

function pretty(obj: any, indent = "  "): void {
  if (obj === null || obj === undefined) {
    console.log(`${indent}(none)`)
    return
  }
  if (typeof obj !== "object") {
    console.log(`${indent}${obj}`)
    return
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue
    if (typeof v === "object") {
      console.log(`${indent}${k}:`)
      pretty(v, indent + "  ")
    } else {
      const s = String(v)
      const truncated = s.length > 200 ? s.slice(0, 200) + "…" : s
      console.log(`${indent}${k}: ${truncated}`)
    }
  }
}

async function main() {
  const args = parseArgs()

  let experimentId: number | undefined = args.experiment

  if (args.resultId) {
    const [row] = await db`SELECT experiment_id FROM eval_results WHERE id = ${args.resultId}`
    if (!row) { console.error(`No eval_results id=${args.resultId}`); process.exit(1) }
    experimentId = row.experiment_id
  }

  if (args.adapter) {
    // Resolve adapter short name to latest experiment
    const pattern = `%${args.adapter}%`
    const [row] = await db`
      SELECT id FROM tuning_experiments
      WHERE config->>'adapter_name' = ${args.adapter}
         OR description ILIKE ${pattern}
      ORDER BY timestamp DESC LIMIT 1
    `
    if (!row) { console.error(`No tuning_experiment for adapter=${args.adapter}`); process.exit(1) }
    experimentId = row.id
  }

  if (!experimentId) {
    console.error("Provide one of: --adapter <name> | --experiment <id> | --result-id <id>")
    process.exit(1)
  }

  const [exp] = await db`SELECT * FROM tuning_experiments WHERE id = ${experimentId}`
  if (!exp) { console.error(`tuning_experiments id=${experimentId} not found`); process.exit(1) }

  hr(`Experiment #${exp.id} — ${exp.experiment_type}`)
  console.log(`Submitted:  ${exp.timestamp}`)
  console.log(`Status:     ${exp.status}`)
  console.log(`Commit:     ${exp.commit_hash ?? "(not recorded)"}`)
  console.log(`Target/dim: ${exp.target ?? "?"} / ${exp.dimension ?? "?"}`)
  console.log(`Description: ${exp.description}`)
  if (exp.conclusion) {
    console.log()
    console.log(`Conclusion:`)
    console.log(`  ${exp.conclusion.split("\n").join("\n  ")}`)
  }

  hr("Training config")
  pretty(exp.config)

  // Sample adapter URI for this experiment (from eval_results or inferred from adapter_name)
  const [adapterRow] = await db`
    SELECT DISTINCT adapter_uri FROM eval_results
    WHERE experiment_id = ${experimentId} AND adapter_uri NOT LIKE 'deepseek%'
    LIMIT 1
  `
  const adapterUri = adapterRow?.adapter_uri
    ?? (exp.config?.adapter_name
        ? `wandb-artifact:///andre14618-/novel-harness/${exp.config.adapter_name}`
        : null)

  if (adapterUri) {
    hr("Adapter")
    console.log(`URI:        ${adapterUri}`)
    // Derive W&B run URL
    const m = adapterUri.match(/wandb-artifact:\/\/\/([^/]+)\/([^/]+)\/([^:]+)/)
    if (m) {
      console.log(`W&B run:    https://wandb.ai/${m[1]}/${m[2]}/runs/${m[3]}`)
      console.log(`W&B artifact: https://wandb.ai/${m[1]}/${m[2]}/artifacts/lora/${m[3]}`)
    }
  }

  hr("Eval results against this adapter")
  const evals = await db`
    SELECT set_name, n, cell_delta_sum, max_jaccard, avg_breaks, avg_words
    FROM eval_cell_summary
    WHERE experiment_id = ${experimentId}
    ORDER BY set_name
  `
  if (evals.length === 0) {
    console.log("  (no eval_results yet for this experiment)")
  } else {
    console.log("  set_name                      n    Δsum   5gram_max  breaks  words")
    console.log("  ----------------------------  ---  -----  ---------  ------  -----")
    for (const e of evals) {
      const name = String(e.set_name).padEnd(28)
      const n = String(e.n).padStart(3)
      const d = e.cell_delta_sum === null ? "   -  " : Number(e.cell_delta_sum).toFixed(3).padStart(5)
      const j = e.max_jaccard === null ? "    -    " : Number(e.max_jaccard).toFixed(3).padStart(9)
      const b = e.avg_breaks === null ? "  -   " : Number(e.avg_breaks).toFixed(1).padStart(6)
      const w = e.avg_words === null ? "  -  " : String(Math.round(e.avg_words)).padStart(5)
      console.log(`  ${name}  ${n}  ${d}  ${j}  ${b}  ${w}`)
    }
  }

  // Parent experiments — follow the lineage upward
  const parents = exp.config?.parent_experiment_ids ?? exp.config?.parent
  if (parents) {
    hr("Lineage — parent experiments")
    const parentIds = Array.isArray(parents) ? parents : [parents]
    for (const pid of parentIds) {
      const [p] = await db`SELECT id, description, status, conclusion FROM tuning_experiments WHERE id = ${pid}`
      if (p) {
        console.log(`  #${p.id} [${p.status}] ${p.description}`)
        if (p.conclusion) console.log(`    → ${p.conclusion.split("\n")[0].slice(0, 140)}`)
      }
    }
  }

  // Training data file — if we can reach it
  const trainFile = exp.config?.train_file
  if (trainFile) {
    hr("Training data file reference")
    console.log(`Path on LXC: ~/apps/novel-harness/${trainFile}`)
    console.log(`(Run 'wc -l ~/apps/novel-harness/${trainFile}' on novel-harness-lxc to inspect.)`)
  }

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })

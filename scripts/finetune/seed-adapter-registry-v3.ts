/**
 * Seed adapter_registry with v3 hallucination adapters + retire v2.
 */
import db from "../../src/db/connection"

const WB = "wandb-artifact:///andre14618-/novel-harness"
const QWEN14B = "OpenPipe/Qwen3-14B-Instruct"

interface AdapterSeed {
  uri: string
  name: string
  slot: string | null
  base_model: string
  training_experiment_id: number | null
  eval_experiment_ids: number[]
  status: "deployed" | "candidate" | "retired" | "rejected"
  deployed_at: string | null
  retired_at: string | null
  headline_metrics: Record<string, any> | null
  training_data_path: string | null
  supersedes: string | null
  notes: string
}

const seeds: AdapterSeed[] = [
  // Retire v2
  {
    uri: `${WB}/hallucination-checker-v2:v1`,
    name: "hallucination-checker-v2",
    slot: null,
    base_model: QWEN14B,
    training_experiment_id: null,
    eval_experiment_ids: [230, 231],
    status: "rejected",
    deployed_at: null,
    retired_at: "2026-04-18",
    headline_metrics: { synth_precision: 0.951, synth_recall: 0.967, natural_precision: 0.778, natural_recall: 0.512 },
    training_data_path: "finetune-data/halluc-checker-v2-train.jsonl",
    supersedes: null,
    notes: "Kitchen-sink 10-variant adapter trained on 400 pure-synth pairs (Cerebras only). Synth-val 95%+ but natural-val regressed to 77.8%/51.2% — classic distribution shift. Superseded by v3 two-adapter architecture.",
  },
  // v3 adapters (candidates)
  {
    uri: `${WB}/halluc-ungrounded-v1:v1`,
    name: "halluc-ungrounded-v1",
    slot: null,
    base_model: QWEN14B,
    training_experiment_id: null,
    eval_experiment_ids: [232, 233],
    status: "rejected",
    deployed_at: null,
    retired_at: "2026-04-18",
    headline_metrics: { synth_precision: 0.968, synth_recall: 0.882, natural_precision: 0.733, natural_recall: 0.268 },
    training_data_path: "finetune-data/halluc-ungrounded-v1-train.jsonl",
    supersedes: `${WB}/hallucination-checker-v2:v1`,
    notes: "v3 decomposed architecture: grounded-entity detection only. Trained on 633 Cerebras+DS synth pairs — v1 natural train was mistakenly not merged. Superseded by halluc-ungrounded-v2 with natural-train merged.",
  },
  {
    uri: `${WB}/halluc-leak-salvatore-v1:v1`,
    name: "halluc-leak-salvatore-v1",
    slot: null,
    base_model: QWEN14B,
    training_experiment_id: null,
    eval_experiment_ids: [],
    status: "candidate",
    deployed_at: null,
    retired_at: null,
    headline_metrics: {
      synth_precision: 1.0, synth_recall: 0.900, synth_f1: 0.947,
      natural_precision: 0.80, natural_recall: 0.40, natural_f1: 0.533,
    },
    training_data_path: "finetune-data/halluc-leak-salvatore-v1-train.jsonl",
    supersedes: null,
    notes: "v3 decomposed architecture: Salvatore-corpus-leak detection only, prose-only input. Per-writer adapter (Salvatore LoRA corpus). Precision discipline excellent (100% synth, 80% natural); recall needs more pool density for v2.",
  },
]

async function main() {
  let inserted = 0, updated = 0
  for (const s of seeds) {
    const evalLit = s.eval_experiment_ids.length === 0 ? "{}" : `{${s.eval_experiment_ids.join(",")}}`
    const res = await db.unsafe(
      `INSERT INTO adapter_registry (
         uri, name, slot, base_model, training_experiment_id, eval_experiment_ids,
         status, deployed_at, retired_at, headline_metrics, training_data_path, supersedes, notes
       ) VALUES ($1, $2, $3, $4, $5, $6::int[], $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (uri) DO UPDATE SET
         status = EXCLUDED.status,
         eval_experiment_ids = EXCLUDED.eval_experiment_ids,
         headline_metrics = EXCLUDED.headline_metrics,
         retired_at = EXCLUDED.retired_at,
         supersedes = EXCLUDED.supersedes,
         notes = EXCLUDED.notes
       RETURNING uri, (xmax = 0) AS was_insert`,
      [
        s.uri, s.name, s.slot, s.base_model, s.training_experiment_id, evalLit,
        s.status, s.deployed_at, s.retired_at,
        s.headline_metrics ? JSON.stringify(s.headline_metrics) : null,
        s.training_data_path, s.supersedes, s.notes,
      ],
    )
    const row = (res as any[])[0]
    if (row?.was_insert) { inserted++; console.log(`  + ${s.name} (${s.status})`) }
    else { updated++; console.log(`  ~ ${s.name} (${s.status}) — updated`) }
  }
  console.log(`\nInserted ${inserted}, updated ${updated}.`)
  process.exit(0)
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })

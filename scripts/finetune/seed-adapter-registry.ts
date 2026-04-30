/**
 * Seed adapter_registry from current deployed slate + known candidates.
 *
 * Reads src/models/roles.ts by hand (not parsed) — the list below is the
 * authoritative snapshot as of 2026-04-18. Idempotent via ON CONFLICT.
 *
 * Run after applying sql/027_adapter_registry.sql.
 *
 * Usage:
 *   bun scripts/finetune/seed-adapter-registry.ts
 */

import db from "../../src/db/connection"

interface AdapterSeed {
  uri: string
  name: string
  slot: string | null
  base_model: string
  training_experiment_id: number | null
  eval_experiment_ids: number[]
  status: "deployed" | "candidate" | "retired" | "rejected"
  deployed_at: string | null    // ISO date
  retired_at: string | null
  headline_metrics: Record<string, any> | null
  training_data_path: string | null
  supersedes: string | null
  notes: string
}

const WB = "wandb-artifact:///andre14618-/novel-harness"
const QWEN14B = "OpenPipe/Qwen3-14B-Instruct"

const SEEDS: AdapterSeed[] = [
  // ── Deployed checkers ──
  {
    uri: `${WB}/adherence-checker-v4`,
    name: "adherence-checker-v4",
    slot: "adherence-events",
    base_model: QWEN14B,
    training_experiment_id: 161,
    eval_experiment_ids: [161],
    status: "deployed",
    deployed_at: "2026-04-12",
    retired_at: null,
    headline_metrics: { first_attempt_pass: 0.79, false_positive_rate: 0.0, eval_beats: 30, latency_ms: 955 },
    training_data_path: null,
    supersedes: null,
    notes: "Events+attribution merged into single call. Setting/tangent/char-presence/word-count removed as gates. 2,134 Sonnet-labeled pairs.",
  },
  {
    uri: `${WB}/chapter-plan-checker-v2:v1`,
    name: "chapter-plan-checker-v2",
    slot: "chapter-plan-checker",
    base_model: QWEN14B,
    training_experiment_id: null,   // SFT training row not clearly identified; labeling was #170
    eval_experiment_ids: [170, 178],
    status: "deployed",
    deployed_at: "2026-04-12",
    retired_at: null,
    headline_metrics: { accuracy: 0.96, vs_gpt_oss_120b: 0.78, latency_ms: 609, eval_pairs: 520 },
    training_data_path: "lora-data/chapter-plan-checker-pairs-sonnet-v2.jsonl",
    supersedes: null,
    notes: "65 scenarios × 8 variants = 520 pairs, 50/50 balance. Sonnet teacher labeling at 96% agreement (exp #170).",
  },
  {
    uri: `${WB}/continuity-v2:v1`,
    name: "continuity-v2",
    slot: "continuity-facts|continuity-state",
    base_model: QWEN14B,
    training_experiment_id: 175,
    eval_experiment_ids: [175],
    status: "deployed",
    deployed_at: "2026-04-12",
    retired_at: null,
    headline_metrics: { sonnet_agreement: 0.99, latency_ms_warm: 204, cost_per_novel: 0.0011, training_pairs: 253 },
    training_data_path: null,
    supersedes: null,
    notes: "2 parallel decomposed agents (facts + state). 3-chapter dark-fantasy validation: 0 FP, 0 missed. 11.9× cost reduction vs Cerebras 235B.",
  },
  {
    uri: `${WB}/hallucination-checker-v1:v1`,
    name: "hallucination-checker-v1",
    slot: "hallucination",
    base_model: QWEN14B,
    training_experiment_id: null,   // training submission experiment was not created; conversation 2026-04-18 noted commit ref'd exp #223 but #223 is the eval
    eval_experiment_ids: [223],
    status: "candidate",            // v1 did not clear 90% precision target — see exp #223
    deployed_at: null,
    retired_at: null,
    headline_metrics: { precision: 0.865, recall: 0.780, f1: 0.821, accuracy: 0.913, latency_ms: 284, eval_beats: 160 },
    training_data_path: "finetune-data/halluc-checker-v1-train.jsonl",
    supersedes: null,
    notes: "Natural-distribution train (640/160 split, 74/26 PASS bias). Failed 90% precision gate. v2 with synthetic variant expansion is in flight.",
  },
  // ── Deployed writer (voice LoRA) — order matters for supersedes FK ──
  {
    uri: `${WB}/salvatore-1988-v3`,
    name: "salvatore-1988-v3",
    slot: "writer/fantasy",
    base_model: QWEN14B,
    training_experiment_id: 196,
    eval_experiment_ids: [196, 199],
    status: "retired",              // superseded by v4 as default
    deployed_at: "2026-04-15",
    retired_at: "2026-04-17",
    headline_metrics: { phase_c3_delta_sum: 0.447, max_5gram_jaccard: 0.023 },
    training_data_path: null,
    supersedes: null,               // v1 predecessor not tracked in registry
    notes: "Harness-shaped user prompts + 3-variant rename augmentation + retry-shape training. Retained for rollback.",
  },
  {
    uri: `${WB}/salvatore-1988-v4`,
    name: "salvatore-1988-v4",
    slot: "writer/fantasy",
    base_model: QWEN14B,
    training_experiment_id: 197,
    eval_experiment_ids: [222],
    status: "deployed",
    deployed_at: "2026-04-17",
    retired_at: null,
    headline_metrics: null,         // writer evals use different shape; to be backfilled
    training_data_path: null,
    supersedes: `${WB}/salvatore-1988-v3`,
    notes: "Character-tagged beat-writer with per-speaker profiles + exampleLines (exp #222). Fantasy-genre routing via WRITER_GENRE_PACKS.",
  },
  // ── Deployed tonal-pass (on-demand only) ──
  {
    uri: `${WB}/howard-tonal-v4-sft-resume:v8`,
    name: "howard-tonal-v4-sft-resume",
    slot: "tonal-pass",
    base_model: QWEN14B,
    training_experiment_id: 95,
    eval_experiment_ids: [95],
    status: "deployed",
    deployed_at: "2026-04-11",
    retired_at: null,
    headline_metrics: null,
    training_data_path: null,
    supersedes: null,
    notes: "Howard primer methodology retired 2026-04-16 for auto-run. Retained for POST /api/novel/:id/tonal-pass on-demand endpoint only.",
  },
  // ── Candidates / non-shipped ──
  {
    uri: `${WB}/archetype-poc-v1`,
    name: "archetype-poc-v1",
    slot: null,
    base_model: QWEN14B,
    training_experiment_id: null,
    eval_experiment_ids: [220],
    status: "rejected",
    deployed_at: null,
    retired_at: null,
    headline_metrics: { pairwise_vs_deepseek_with_profile: 0.33 },
    training_data_path: null,
    supersedes: null,
    notes: "LoRA-zoo architecture rejected (exp #220). Sonnet+profile wins 55% vs LoRA 33% vs DeepSeek 8%. Voice-as-data via exampleLines is the winning pattern.",
  },
]

async function main() {
  let inserted = 0, skipped = 0
  for (const s of SEEDS) {
    // Postgres int[] literal — Bun's SQL driver mishandles JS number arrays,
    // so we pass it as '{1,2,3}'::int[] via a raw literal.
    const evalLit = s.eval_experiment_ids.length === 0
      ? "{}"
      : `{${s.eval_experiment_ids.join(",")}}`
    const res = await db.unsafe(
      `INSERT INTO adapter_registry (
         uri, name, slot, base_model,
         training_experiment_id, eval_experiment_ids, status,
         deployed_at, retired_at, headline_metrics,
         training_data_path, supersedes, notes
       ) VALUES ($1, $2, $3, $4, $5, $6::int[], $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (uri) DO NOTHING
       RETURNING uri`,
      [
        s.uri, s.name, s.slot, s.base_model,
        s.training_experiment_id, evalLit, s.status,
        s.deployed_at, s.retired_at, s.headline_metrics ? JSON.stringify(s.headline_metrics) : null,
        s.training_data_path, s.supersedes, s.notes,
      ],
    )
    if ((res as any[]).length > 0) { inserted++; console.log(`  + ${s.uri} (${s.status})`) }
    else { skipped++; console.log(`  = ${s.uri} (exists)`) }
  }
  console.log(`\nInserted ${inserted}, skipped ${skipped} (already present).`)
  process.exit(0)
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })

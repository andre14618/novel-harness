#!/usr/bin/env bun
/**
 * Create the tuning_experiment row for the Salvatore 1988 voice LoRA and
 * print the W&B submission command. User runs the printed command manually.
 *
 * Usage:
 *   bun scripts/finetune/submit-salvatore-training.ts [--conclude <experiment_id> "<conclusion text>"]
 */

import { createTuningExperiment, concludeExperiment } from "../../src/db/ops"

async function main() {
  const args = process.argv.slice(2)

  if (args[0] === "--conclude") {
    const id = Number(args[1])
    const text = args.slice(2).join(" ")
    if (!id || !text) {
      console.error("usage: --conclude <id> <text>")
      process.exit(1)
    }
    await concludeExperiment(id, text)
    console.log(`✓ concluded experiment ${id}`)
    return
  }

  const description = "Salvatore 1988 voice LoRA — beat-brief→prose SFT on Qwen3-14B-Instruct"
  const config = {
    base_model: "OpenPipe/Qwen3-14B-Instruct",
    adapter_name: "salvatore-1988-v1",
    corpus: "Icewind Dale Trilogy (Crystal Shard, Streams of Silver, Halfling's Gem)",
    pipeline: "6-stage decomposition (mechanical split → scene label → beat segment → brief extract → style tag → roundtrip validate)",
    training_pairs: 777,
    train_split: 703,
    val_split: 74,
    total_prose_words: 83641,
    median_beat_words: 100,
    mean_beat_words: 108,
    train_file: "finetune-data/salvatore-1988-sft-train.jsonl",
    val_file: "finetune-data/salvatore-1988-sft-val.jsonl",
    lora_rank: 16,
    epochs: 3,
    batch_size: 2,
    lr: 2e-4,
    schedule: "cosine",
    aggregate_style: {
      avg_sentence_words: 18.3,
      dialogue_ratio: 0.28,
      clause_complexity: 0.62,
      sensory_density_per_100w: 1.56,
    },
    roundtrip_validation: {
      sample_size: 20,
      per_kind: 5,
      finding: "brief schema sufficient — sentence rhythm learned from prose side of pair",
    },
  }

  const id = await createTuningExperiment(
    "lora_voice_sft",
    description,
    config,
    { target: "writer", dimension: "voice_imprint" },
  )

  console.log(`✓ created tuning_experiment id=${id}`)
  console.log("")
  console.log("=== W&B submission command ===")
  console.log("")
  console.log(`  EXPERIMENT_ID=${id} python3 scripts/finetune/train-lora.py \\`)
  console.log(`    --name salvatore-1988-v1 \\`)
  console.log(`    --data finetune-data/salvatore-1988-sft-train.jsonl \\`)
  console.log(`    --epochs 3 \\`)
  console.log(`    --batch-size 2 \\`)
  console.log(`    --lr 2e-4`)
  console.log("")
  console.log("After training, conclude with:")
  console.log(`  bun scripts/finetune/submit-salvatore-training.ts --conclude ${id} "<summary of result>"`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

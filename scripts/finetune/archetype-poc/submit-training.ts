/**
 * Submit the archetype-poc-v1 LoRA training job to W&B.
 *
 * Uses the same pipeline as Salvatore — scripts/finetune/train-lora.py
 * (per reference_wandb_training memory). Data format is OpenAI-style
 * {messages: [...]} JSONL produced by format-sft.py.
 *
 * Reads:
 *   sft-train.jsonl
 *   sft-val.jsonl
 *
 * Emits: W&B artifact `archetype-poc-v1:v0` (~130 MB for r=16 adapter).
 * Auto-cleanup of intermediate artifacts runs post-training per
 * cleanup-wandb-storage.py convention.
 *
 * STUB — not executing until Andre approves scope + dataset quality.
 */

console.log("STUB — archetype-poc-v1 training submission.")
console.log("Check the flattened dataset (dialogue-pairs.jsonl) quality first.")
console.log("Once approved, invoke train-lora.py with:")
console.log("  base:       OpenPipe/Qwen3-14B-Instruct")
console.log("  data:       scripts/finetune/archetype-poc/sft-train.jsonl")
console.log("  val:        scripts/finetune/archetype-poc/sft-val.jsonl")
console.log("  r:          16")
console.log("  epochs:     3")
console.log("  artifact:   archetype-poc-v1")
console.log("  experiment: 220")

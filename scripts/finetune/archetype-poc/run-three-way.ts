/**
 * Run the 20 held-out test lines through three systems:
 *   A — 14B LoRA (W&B artifact, trained by submit-training.ts)
 *   B — DeepSeek V3.2 with the same profile prompt as the LoRA
 *   C — Sonnet subagent with the same profile prompt
 *
 * Output: generations.jsonl — { test_id, char, flat, voiced_reference, A, B, C }
 *
 * All calls go through callAgent so llm_calls logging captures them under
 * experiment 220. Sonnet (C) uses a Claude Code subagent dispatch, not the
 * transport layer — per feedback_sonnet_subagents.
 */

import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

const HERE = new URL(".", import.meta.url).pathname
const PAIRS_IN = join(HERE, "sft-val.jsonl")   // the held-out 20
const OUT      = join(HERE, "generations.jsonl")

// STUB — filled in after submit-training.ts produces the artifact
const LORA_ARTIFACT = "wandb-artifact:///andre14618-/novel-harness/archetype-poc-v1:v0"

async function main() {
  const rows = readFileSync(PAIRS_IN, "utf8")
    .trim().split("\n").map(l => JSON.parse(l))
  console.log(`${rows.length} held-out pairs`)

  // For each test row:
  //   user prompt = row.messages[1].content  (same shape trained on)
  //   reference   = row.messages[2].content
  //   A: callAgent({ provider: wandb, model: LORA_ARTIFACT, ... })
  //   B: callAgent({ provider: deepseek, model: deepseek-chat, ... })
  //   C: dispatch a Sonnet subagent batch with the same prompts
  //
  // All three runs persist per-call to llm_calls with experiment=220.

  console.log("This script is a STUB. Fill in A/B/C invocations after Andre approves scope.")
  console.log(`Will write → ${OUT}`)
}

main()

/**
 * Write the experiment conclusion for id=220 based on judgments.jsonl.
 *
 * Computes per-system win%, notes the decision tree branch taken, writes
 * a conclusion string into tuning_experiments.conclusion via the harness
 * service layer. Also persists per-line eval rows to eval_results for
 * provenance.
 */

import * as harness from "../../../../src/harness"

const EXPERIMENT_ID = 220

async function main() {
  // STUB — after judge-pairwise.ts writes judgments.jsonl:
  //   1. aggregate by system → wins[A], wins[B], wins[C]
  //   2. pick decision branch:
  //        A wins by ≥15pp over C  → "LoRA wins — commit plug-and-play"
  //        C wins by ≥10pp over A  → "instructions win — skip LoRA zoo"
  //        A/C within 10pp         → "marginal — defer, collect more data"
  //        B within 10pp of C      → "DeepSeek covers it — no new cost"
  //   3. concludeExperiment(EXPERIMENT_ID, conclusion_string)
  //   4. persist per-line rows via harness.evals (eval_results table)
  console.log("STUB — fill in after judgments.jsonl exists")
}

main()

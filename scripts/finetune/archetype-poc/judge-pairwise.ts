/**
 * Opus blind pairwise judging over generations.jsonl.
 *
 * For each test line (20), judge all three pairings (A/B, A/C, B/C) with
 * candidate sides randomized. Reference = voiced_original. Opus picks
 * which candidate better matches the voice of the reference line.
 *
 * 20 lines × 3 pairings = 60 judgments. Add reversed sides for order-bias
 * control → 120. Adding a self-consistency pass (same pairing, different
 * seed) → ~180 total.
 *
 * Output: judgments.jsonl + per-system win matrix
 */

import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

const HERE = new URL(".", import.meta.url).pathname
const GEN  = join(HERE, "generations.jsonl")
const OUT  = join(HERE, "judgments.jsonl")

const JUDGE_SYSTEM = `You are evaluating two candidate dialogue rewrites. You are given:
- REFERENCE: the target voiced dialogue line (this is the ground truth).
- CHARACTER: the character speaking.
- PROFILE: a brief voice profile.
- CANDIDATE A and CANDIDATE B: two attempts to rewrite a flat paraphrase back into the character's voice.

Pick which candidate's voice better matches the reference. You are NOT scoring semantic accuracy (both preserve content) — only voice match: diction, cadence, dialect, tone, rhythm.

Respond with ONLY one of: "A", "B", or "TIE" (use TIE only if truly indistinguishable).`

async function main() {
  const rows = readFileSync(GEN, "utf8")
    .trim().split("\n").map(l => JSON.parse(l))

  // STUB — runner logic:
  //  for each row:
  //    for each pairing in [[A,B],[A,C],[B,C]]:
  //      for each order in [[x,y],[y,x]]:   // order-bias control
  //        prompt = JUDGE_SYSTEM + reference + profile + candA + candB
  //        verdict = callAgent(opus-subagent)
  //        record { row_id, pairing, order, verdict, winner_system }
  //
  // After all judgments: aggregate by system → Elo or simple win%.
  // Write result to eval_results (linked to experiment 220) via harness service layer.

  console.log(`STUB — ${rows.length} generations loaded. Fill in judging logic after scope approved.`)
  console.log(`Output → ${OUT}`)
}

main()

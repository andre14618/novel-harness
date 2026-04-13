# Chapter Plan Checker — Sonnet Subagent Labeling Instructions

**Goal:** Relabel chapter-plan-checker training data using Sonnet subagents as the teacher (replaces gpt-oss-120b, which had 88.2% accuracy and ~12% error rate on PASS_REORDER and FAIL_REVERSED_ARC).

---

## Prerequisites

1. Generate raw pairs (if not already done):
   ```bash
   ssh novel-harness-lxc "cd ~/apps/novel-harness && nohup ~/.bun/bin/bun scripts/generate-chapter-plan-data.ts > /tmp/gen-chapter-plan.log 2>&1 &"
   ```
   This produces `lora-data/chapter-plan-checker-pairs.jsonl` (65 scenarios x 8 variants = 520 pairs).

2. Batch the pairs:
   ```bash
   bun scripts/batch-chapter-plan-pairs.ts
   ```
   This splits pairs into `/tmp/chapter-plan-label/batch_N.json` files (~40 pairs each, ~13 batches).

---

## Step 1: Spawn Sonnet subagents

Spawn **max 10 subagents at a time** (respect the parallel batch limit). Each agent reads one batch file and writes results to `/tmp/chapter-plan-label/results_N.jsonl`.

### Subagent prompt template

For each batch N, spawn an agent with this prompt:

```
You are labeling chapter-plan-checker training data. Read batch file /tmp/chapter-plan-label/batch_N.json and evaluate each pair.

Each pair has:
- messages[0].content = system prompt (the checker's instructions)
- messages[1].content = chapter plan + chapter prose (the input to evaluate)
- _meta.scenario = scenario ID
- _meta.variant = variant type (PASS_CLEAN, PASS_PARAPHRASE, PASS_REORDER, PASS_ATMOSPHERIC, FAIL_MISSING_BEAT, FAIL_MISSING_CHAR, FAIL_REVERSED_ARC, FAIL_WRONG_SETTING)
- _index = original pair index

For EACH pair, carefully read the chapter plan and chapter prose in messages[1].content. Then evaluate:

1. **setting_match** — Does the prose take place in the planned setting? Copy the planned setting, quote a phrase from the prose that establishes location, and decide if they match. Minor spatial variation is fine.

2. **emotional_arc_correct** — Does the prose's emotional direction match the plan's final beat? Only false if the direction is REVERSED (tension→calm when plan says tension→more tension, etc.).

3. **pass** — true UNLESS: setting doesn't match, emotional arc is reversed, OR there's a major plot contradiction (character dies when plan has them alive, resolved conflict reopened, character knows something they shouldn't).

4. **deviations** — List every specific problem. Empty if pass=true.

DO NOT flag as deviations:
- Paraphrased dialogue
- Reordered details within or across beats
- Added atmospheric details, props, sensory descriptions
- Slightly different physical actions serving the same purpose
- Minor spatial variations
- Missing individual beat events
- Characters absent from a single beat

Write one result per line to /tmp/chapter-plan-label/results_N.jsonl in this exact format:
{"id": <_index>, "scenario": "<scenario>", "variant": "<variant>", "setting_match": {"planned": "...", "observed": "...", "matches": true/false}, "emotional_arc_correct": true/false, "pass": true/false, "deviations": [...], "note": "<optional note if something was ambiguous>"}

Read the batch, evaluate every pair, write the results file. Report how many pairs you labeled and any that were ambiguous.
```

### Spawning

Spawn agents in waves of 10:

**Wave 1:** Agents for batches 0-9 (in parallel)
**Wave 2:** Agents for batches 10+ (after wave 1 completes)

Each agent should finish in a few minutes. Check that each `results_N.jsonl` has the expected number of lines before proceeding.

---

## Step 2: Verify results

Quick sanity check before aggregation:

```bash
# Count results per batch
for f in /tmp/chapter-plan-label/results_*.jsonl; do echo "$f: $(wc -l < $f)"; done

# Check for empty results
wc -l /tmp/chapter-plan-label/results_*.jsonl | tail -1
```

Each results file should have the same number of lines as its corresponding batch file.

---

## Step 3: Aggregate into training JSONL

```bash
bun scripts/aggregate-chapter-plan-labels.ts
```

This:
1. Reads all `/tmp/chapter-plan-label/results_N.jsonl` files
2. Joins with original pairs from `lora-data/chapter-plan-checker-pairs.jsonl`
3. Replaces the assistant turn with Sonnet's full structured response
4. Writes training JSONL to `lora-data/chapter-plan-checker-pairs-sonnet-v2.jsonl`
5. Prints per-variant accuracy vs deterministic ground truth
6. Records experiment in DB

---

## Step 4: Submit to W&B for SFT

After aggregation, if accuracy >= 90% overall:

```bash
ssh novel-harness-lxc "cd ~/apps/novel-harness && python3 scripts/train-lora.py \
  --data lora-data/chapter-plan-checker-pairs-sonnet-v2.jsonl \
  --name chapter-plan-checker-v2 \
  --base OpenPipe/Qwen3-14B-Instruct \
  --project novel-harness"
```

Expected adapter URI: `wandb-artifact:///andre14618-/novel-harness/chapter-plan-checker-v2-sft-resume:v9`

---

## Accuracy thresholds

| Variant | Expected | Threshold |
|---------|----------|-----------|
| PASS_CLEAN | pass=true | >=98% |
| PASS_PARAPHRASE | pass=true | >=95% |
| PASS_REORDER | pass=true | >=90% (gpt-oss was weakest here) |
| PASS_ATMOSPHERIC | pass=true | >=95% |
| FAIL_MISSING_BEAT | pass=false | >=90% |
| FAIL_MISSING_CHAR | pass=false | >=90% |
| FAIL_REVERSED_ARC | pass=false | >=85% (gpt-oss was weakest here) |
| FAIL_WRONG_SETTING | pass=false | >=95% |
| **Overall** | | **>=90%** |

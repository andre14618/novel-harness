# SFT Data Generation Plan — Sonnet Subagent Labeling

**Date:** 2026-04-12
**Targets:** Chapter Plan Checker V2, Continuity V2
**Teacher:** Claude Sonnet 4.6 via Claude Code subagents (NOT API calls)
**Batch limit:** Max 10 parallel subagents per wave

---

## Overview

Two SFT datasets need Sonnet-labeled training data. Both follow the same three-phase pipeline:

1. **Generate** raw pairs on LXC (Cerebras writes draft prose with planted issues, deterministic labels from variant type)
2. **Label** with Sonnet subagents (Claude Code Agent tool — each agent reads a batch file, evaluates every pair, writes results)
3. **Aggregate** subagent results into training JSONL (joins Sonnet responses with original pairs, reports accuracy, records experiment)

Execute Task A and Task B in order. Do NOT run them simultaneously — the subagent batch limit is shared.

---

## Task A: Chapter Plan Checker V2

### A.1 — Generate raw pairs (LXC)

The generation script has 65 scenarios (45 original + 20 dark fantasy) x 8 variants = 520 pairs.

```bash
bash scripts/deploy-lxc.sh
ssh novel-harness-lxc "cd ~/apps/novel-harness && nohup ~/.bun/bin/bun scripts/generate-chapter-plan-data.ts > /tmp/gen-chapter-plan.log 2>&1 &"
```

Monitor progress:
```bash
ssh novel-harness-lxc "tail -20 /tmp/gen-chapter-plan.log"
```

When complete, verify the output:
```bash
ssh novel-harness-lxc "wc -l ~/apps/novel-harness/lora-data/chapter-plan-checker-pairs.jsonl"
```

Expected: ~520 lines. Sync back to local:
```bash
rsync novel-harness-lxc:~/apps/novel-harness/lora-data/chapter-plan-checker-pairs.jsonl lora-data/
```

### A.2 — Batch pairs for subagent labeling

```bash
bun scripts/batch-chapter-plan-pairs.ts
```

This writes `/tmp/chapter-plan-label/batch_0.json` through `batch_N.json` (~40 pairs per batch, ~13 batches).

### A.3 — Spawn Sonnet subagents

Spawn agents in waves of 10. Each agent reads one batch file and writes results to `/tmp/chapter-plan-label/results_N.jsonl`.

**For each batch N**, spawn an Agent with `subagent_type: "general-purpose"` and this prompt:

```
You are labeling chapter-plan-checker training data for an SFT fine-tune. Your job is to evaluate whether chapter prose follows a chapter plan.

Read the batch file at /tmp/chapter-plan-label/batch_N.json. It contains a JSON array of pairs. Each pair has:
- messages[0].content — the system prompt (checker instructions)
- messages[1].content — the chapter plan + chapter prose to evaluate
- _meta.scenario — scenario ID
- _meta.variant — variant type
- _index — original pair index

For EACH pair in the batch:

1. Read messages[1].content carefully. It contains a CHAPTER PLAN (with setting, scenes/beats, characters) and CHAPTER PROSE.

2. Evaluate using these rules:

   **setting_match**: Compare the plan's setting to where the prose takes place.
   - planned: copy the setting from the plan
   - observed: quote a short phrase from the prose establishing location
   - matches: true if same place (minor spatial variation OK — different room in same building is fine). false only if completely different location. If prose transitions between locations, matches=true as long as primary setting appears.

   **emotional_arc_correct**: Does the prose's emotional ending match the plan's final beat direction? true unless the direction is REVERSED (plan says tension escalates but prose resolves it, or vice versa).

   **pass**: true UNLESS setting_match is false, emotional_arc_correct is false, OR there is a major plot contradiction (character dies when plan has them alive, resolved conflict reopened without cause, character knows something they shouldn't).

   **deviations**: List every specific problem found. Empty array [] if pass is true.

   DO NOT flag these as deviations — they are normal creative interpretation:
   - Paraphrased dialogue (same meaning, different words)
   - Reordered details within or across beats
   - Added atmospheric details, props, sensory descriptions
   - Slightly different physical actions serving the same narrative purpose
   - Minor spatial variations (sitting vs standing, different part of room)
   - Missing individual beat events
   - Characters absent from a single beat

3. Write one JSON line per pair to /tmp/chapter-plan-label/results_N.jsonl:

{"id": <_index>, "scenario": "<scenario>", "variant": "<variant>", "setting_match": {"planned": "<from plan>", "observed": "<quoted from prose>", "matches": <bool>}, "emotional_arc_correct": <bool>, "pass": <bool>, "deviations": [<strings>], "note": "<optional — only if something was genuinely ambiguous>"}

Process ALL pairs in the batch. At the end, report the total count and how many you marked pass vs fail.
```

**Wave 1:** Spawn agents for batches 0 through 9 in parallel (single message, 10 Agent tool calls).
**Wave 2:** After wave 1 completes, spawn remaining batches (10 through N).

### A.4 — Verify subagent results

After all agents complete, check result counts:

```bash
for f in /tmp/chapter-plan-label/results_*.jsonl; do
  echo "$f: $(wc -l < "$f") lines"
done
```

Each `results_N.jsonl` should have the same number of lines as its corresponding `batch_N.json`. If any are short, re-run that specific agent.

### A.5 — Aggregate into training JSONL

This requires DATABASE_URL since it records an experiment. Run on LXC:

```bash
# Sync results to LXC
rsync -r /tmp/chapter-plan-label/ novel-harness-lxc:/tmp/chapter-plan-label/

bash scripts/deploy-lxc.sh
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun scripts/aggregate-chapter-plan-labels.ts"
```

This:
- Joins Sonnet results with original pairs
- Writes `lora-data/chapter-plan-checker-pairs-sonnet-v2.jsonl`
- Prints per-variant accuracy table
- Records experiment in DB with `concludeExperiment()`

**Accuracy thresholds:**

| Variant | Threshold | Notes |
|---------|-----------|-------|
| PASS_CLEAN | >=98% | Should almost never fail |
| PASS_PARAPHRASE | >=95% | |
| PASS_REORDER | >=90% | gpt-oss was weakest here (~12% error) |
| PASS_ATMOSPHERIC | >=95% | |
| FAIL_MISSING_BEAT | >=90% | |
| FAIL_MISSING_CHAR | >=90% | |
| FAIL_REVERSED_ARC | >=85% | gpt-oss was weakest here (~12% error) |
| FAIL_WRONG_SETTING | >=95% | |
| **Overall** | **>=90%** | Below this: investigate mismatches before training |

Sync training data back:
```bash
rsync novel-harness-lxc:~/apps/novel-harness/lora-data/chapter-plan-checker-pairs-sonnet-v2.jsonl lora-data/
```

### A.6 — Submit to W&B (if accuracy >= 90%)

```bash
ssh novel-harness-lxc "cd ~/apps/novel-harness && python3 scripts/train-lora.py \
  --data lora-data/chapter-plan-checker-pairs-sonnet-v2.jsonl \
  --name chapter-plan-checker-v2 \
  --base OpenPipe/Qwen3-14B-Instruct \
  --project novel-harness"
```

Expected adapter URI: `wandb-artifact:///andre14618-/novel-harness/chapter-plan-checker-v2-sft-resume:v9`

---

## Task B: Continuity V2

### B.1 — Generate raw pairs (LXC)

The generation script has 39 scenarios (29 original + 10 dark fantasy) x 6-7 variants = ~260 pairs.

```bash
bash scripts/deploy-lxc.sh
ssh novel-harness-lxc "cd ~/apps/novel-harness && nohup ~/.bun/bin/bun scripts/generate-continuity-data.ts > /tmp/gen-continuity.log 2>&1 &"
```

Monitor:
```bash
ssh novel-harness-lxc "tail -20 /tmp/gen-continuity.log"
```

When complete, verify and sync:
```bash
ssh novel-harness-lxc "wc -l ~/apps/novel-harness/lora-data/continuity-pairs.jsonl"
rsync novel-harness-lxc:~/apps/novel-harness/lora-data/continuity-pairs.jsonl lora-data/
```

Expected: ~260 lines (39 scenarios x ~6.7 variants average, since VAR_WARNING_2 only exists on scenarios with `warningInjection2`).

### B.2 — Batch pairs for subagent labeling

There is no dedicated batching script for continuity. Create the batches inline:

```bash
mkdir -p /tmp/continuity-label
```

Then use a quick script or do it in the subagent prompt. The pairs file is small enough (~260 pairs) that you can split into ~10 batches of ~26 pairs:

```typescript
import { readFileSync, writeFileSync, mkdirSync } from "fs"

const lines = readFileSync("lora-data/continuity-pairs.jsonl", "utf8").trim().split("\n")
const pairs = lines.map((l, i) => ({ ...JSON.parse(l), _index: i }))
const BATCH_SIZE = 26

mkdirSync("/tmp/continuity-label", { recursive: true })
const numBatches = Math.ceil(pairs.length / BATCH_SIZE)
for (let i = 0; i < numBatches; i++) {
  const batch = pairs.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
  writeFileSync(`/tmp/continuity-label/batch_${i}.json`, JSON.stringify(batch, null, 2))
}
console.log(`Split ${pairs.length} pairs into ${numBatches} batches`)
```

### B.3 — Spawn Sonnet subagents

**For each batch N**, spawn an Agent with `subagent_type: "general-purpose"` and this prompt:

```
You are labeling continuity-checker training data for an SFT fine-tune. Your job is to evaluate whether a chapter draft is consistent with established facts and character states.

Read the batch file at /tmp/continuity-label/batch_N.json. It contains a JSON array of pairs. Each pair has:
- messages[0].content — the system prompt (continuity checker instructions with severity definitions)
- messages[1].content — the chapter draft + established facts + character states
- _meta.scenario — scenario ID
- _meta.variant — variant type (VAR_NONE, VAR_BLOCKER, VAR_WARNING, VAR_WARNING_2, VAR_NIT, VAR_TRAP, VAR_MULTI)
- _index — original pair index

For EACH pair in the batch:

1. Read messages[1].content carefully. It contains:
   - CHAPTER DRAFT (a ~120-word prose excerpt)
   - ESTABLISHED FACTS (from prior chapters, with chapter number and category)
   - CHARACTER STATES (location, emotional state, what they know)

2. Check the draft against every fact and state. Look for:
   - BLOCKER: Dead characters appearing, destroyed objects used, characters in wrong locations, knowledge violations, world rule breaks
   - WARNING: Timeline mismatches, impossible travel, characterization drift (character acts opposite to established state without trigger), emotional discontinuity
   - NIT: Physical description drift (hair color, eye color changes), name/title inconsistency, object continuity (puts down cup then drinks from it)

3. Do NOT flag these:
   - Figurative language ("the walls closed in" is NOT a location change)
   - Intentional dramatic irony
   - Character lying or being unreliable narrator
   - Vague timeline when no concrete timeline was established
   - Emotional shifts shown through an explicit transition or trigger

4. Write one JSON line per pair to /tmp/continuity-label/results_N.jsonl:

{"id": <_index>, "scenario": "<scenario>", "variant": "<variant>", "found_severities": [<"blocker"|"warning"|"nit" strings>], "expected_severities": [<from _meta or messages[2]>], "match": <bool — true if found_severities SET equals expected_severities SET>, "sonnet_issues": [{"severity": "<blocker|warning|nit>", "description": "<what the issue is>", "conflictsWith": "<the fact or state it contradicts>"}], "note": "<optional — only if ambiguous>"}

For the expected_severities: parse messages[2].content (the assistant turn) — it contains {"expectedSeverities": [...]}. Your found_severities should match this set for the pair to be scored as correct.

For VAR_NONE and VAR_TRAP: expected is [] (no issues). You should find no real issues.
For VAR_BLOCKER: expected is ["blocker"]. You should find exactly one blocker.
For VAR_WARNING / VAR_WARNING_2: expected is ["warning"]. You should find exactly one warning.
For VAR_NIT: expected is ["nit"]. You should find exactly one nit.
For VAR_MULTI: expected is ["blocker", "nit"]. You should find one blocker and one nit.

Process ALL pairs. Report total count, pass vs fail, and any cases where your evaluation disagreed with the expected label.
```

**Wave 1:** Spawn agents for batches 0 through 9 in parallel.
**Wave 2:** Remaining batches after wave 1 completes.

### B.4 — Verify subagent results

```bash
for f in /tmp/continuity-label/results_*.jsonl; do
  echo "$f: $(wc -l < "$f") lines"
done
```

### B.5 — Aggregate into training JSONL

The aggregation script already exists:

```bash
# Sync results to LXC
rsync -r /tmp/continuity-label/ novel-harness-lxc:/tmp/continuity-label/

bash scripts/deploy-lxc.sh
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun scripts/aggregate-continuity-labels.ts"
```

This writes `lora-data/continuity-pairs-sonnet-labeled.jsonl` and prints accuracy.

**Accuracy thresholds:**

| Variant | Threshold |
|---------|-----------|
| VAR_BLOCKER | >=95% |
| VAR_WARNING | >=80% |
| VAR_WARNING_2 | >=80% |
| VAR_NIT | >=80% |
| VAR_TRAP | >=90% |
| VAR_NONE | >=95% |
| VAR_MULTI | >=85% |
| **Overall** | **>=82%** |

Sync back:
```bash
rsync novel-harness-lxc:~/apps/novel-harness/lora-data/continuity-pairs-sonnet-labeled.jsonl lora-data/
```

### B.6 — Submit to W&B (if accuracy >= 82%)

```bash
ssh novel-harness-lxc "cd ~/apps/novel-harness && python3 scripts/train-lora.py \
  --data lora-data/continuity-pairs-sonnet-labeled.jsonl \
  --name continuity-v2 \
  --base OpenPipe/Qwen3-14B-Instruct \
  --project novel-harness"
```

Expected adapter URI: `wandb-artifact:///andre14618-/novel-harness/continuity-v2-sft-resume:v9`

---

## Key constraints

- **Max 10 parallel subagents** — do not burst beyond this. See memory: `feedback_parallel_batch_limit.md`.
- **Sonnet labeling is via subagents only** — do NOT use transport layer API calls to OpenRouter/Anthropic. See memory: `feedback_sonnet_subagents.md`.
- **Every experiment goes in the DB** — the aggregation scripts handle this automatically via `createTuningExperiment()` + `concludeExperiment()`.
- **Use nohup for LXC scripts** — never pipe SSH output through head/filters. See memory: `feedback_nohup_long_scripts.md`.
- **Deploy before running on LXC** — always `bash scripts/deploy-lxc.sh` first.
- **Sync files between local and LXC** — raw pairs are generated on LXC, subagent labeling runs locally, aggregation needs DATABASE_URL so runs on LXC.

## Files reference

| File | Purpose |
|------|---------|
| `scripts/generate-chapter-plan-data.ts` | Generate raw chapter plan checker pairs (65 scenarios x 8 variants) |
| `scripts/batch-chapter-plan-pairs.ts` | Split raw pairs into batch files for subagents |
| `scripts/aggregate-chapter-plan-labels.ts` | Combine subagent results → training JSONL |
| `scripts/generate-continuity-data.ts` | Generate raw continuity pairs (39 scenarios x 6-7 variants) |
| `scripts/aggregate-continuity-labels.ts` | Combine subagent results → training JSONL (already exists) |
| `lora-data/chapter-plan-checker-pairs.jsonl` | Raw generated pairs (input to labeling) |
| `lora-data/chapter-plan-checker-pairs-sonnet-v2.jsonl` | Sonnet-labeled training data (output) |
| `lora-data/continuity-pairs.jsonl` | Raw generated pairs (input to labeling) |
| `lora-data/continuity-pairs-sonnet-labeled.jsonl` | Sonnet-labeled training data (output) |

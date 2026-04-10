# Adherence Checker: Claude-as-Teacher Evaluation

Use Claude Code subagents (Sonnet and Opus) as teachers for the adherence checker, measuring absolute accuracy against synthetic ground truth. This replaces the API-based teacher approach (235B, K2.5, gpt-oss) that produced the V3 mixed-teacher regression.

## Why

V3 mixed-teacher regressed vs V2 because synthetic teacher accuracy on obvious failures doesn't predict calibration on marginal cases. Frontier Claude models are likely better calibrated on nuanced judgment calls than any of the open models we tested. If Sonnet or Opus produce better labels, they become the teacher for V2.1.

## Targets

**Phase 1 — Synthetic ground truth** (measure teacher quality):
- 1,343 unique test pairs across 59 scenarios, 11 variants, 4 call types
- Source: `lora-data/adherence-checker-v3-mixed-teacher.jsonl`
- Ground truth: variant type determines expected flag value (PASS_* = all pass, FAIL_MISSING = events_present=false, etc.)
- V2 baseline: 95.2% overall, weakest on FAIL_MISSING_SUBTLE (78.6%) and FAIL_TANGENT_HARD (69%)

**Phase 2 — Production pairs** (generate training data, only if Phase 1 shows improvement):
- 60-64 beat/prose pairs from 20 approved chapters
- No ground truth — labels become training data
- Same pairs used in exp #135 (V2 production eval)

## Data format

Each JSONL line has:
```json
{
  "_meta": {
    "scenario": "tavern_confrontation",
    "variant": "PASS_CLEAN",
    "call_type": "events",
    "writer": "cerebras",
    "teacher": "..."
  },
  "messages": [
    {"role": "system", "content": "<system prompt>"},
    {"role": "user", "content": "BEAT: ...\nCHARACTERS EXPECTED: ...\n\nPROSE:\n---\n...\n---"},
    {"role": "assistant", "content": "<teacher JSON output>"}
  ]
}
```

The subagent receives `messages[0].content` (system) and `messages[1].content` (user), and must produce JSON matching the call type schema.

## Call type schemas

### events
```json
{"events_present": true|false, "evidence": "...", "reasoning": "..."}
```

### setting
```json
{"setting_matches": true|false, "expected_setting": "...", "actual_setting": "...", "reasoning": "..."}
```

### tangent
```json
{"off_spec_fraction": 0.0, "off_spec_quote": "...", "is_tangent": true|false, "reasoning": "..."}
```

### character
```json
{"character_contradiction": true|false, "evidence": "...", "reasoning": "..."}
```

## Running

### Step 1: Extract test pairs to individual files

```bash
# On LXC — export pairs as individual JSON files for subagent consumption
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun scripts/export-adherence-pairs.ts --output /tmp/adherence-pairs/ --limit 200"
```

This creates `/tmp/adherence-pairs/0001.json` through `/tmp/adherence-pairs/NNNN.json`, each containing:
```json
{
  "id": 1,
  "scenario": "tavern_confrontation",
  "variant": "PASS_CLEAN",
  "call_type": "events",
  "system_prompt": "...",
  "user_prompt": "...",
  "expected_flag": true
}
```

### Step 2: Run Claude Code subagent evaluation

Paste this into Claude Code. It spawns parallel subagents per batch.

**Confirm before running:**
- [ ] Which model tier? `sonnet` or `opus` (or both sequentially)
- [ ] How many pairs? Start with 50-100 for a smoke test, then full 1,343
- [ ] Which variants to focus on? All, or just V2 weak spots (FAIL_MISSING_SUBTLE, FAIL_TANGENT_HARD)?

```
Run the adherence teacher evaluation using {sonnet|opus} subagents.

For each pair in /tmp/adherence-pairs/:
1. Read the pair JSON
2. Spawn a subagent with model={sonnet|opus} that receives the system_prompt and user_prompt
3. The subagent must return ONLY valid JSON matching the call_type schema
4. Record the subagent's flag value vs expected_flag
5. Write results to /tmp/adherence-claude-{sonnet|opus}-results.jsonl

Process in batches of 10 parallel subagents. After all pairs, print:
- Overall accuracy (correct / total)
- Accuracy by call_type (events, setting, tangent, character)  
- Accuracy by variant (PASS_CLEAN, FAIL_MISSING_SUBTLE, etc.)
- Precision and recall
- Comparison table vs base-14b (86.4%), V2 (95.2%), V3 (94.4%)
```

### Step 3: Compare results

**Sonnet 4.6 COMPLETED (2026-04-10, exp #147)** — 1,559 pairs, 78 parallel subagents:

| | base-14b | V2 (235B teacher) | V3 (mixed) | Sonnet teacher | Opus teacher |
|---|---:|---:|---:|---:|---:|
| Overall | 86.4% | 95.2% | 94.4% | **96.5%** | — |
| FAIL_MISSING_SUBTLE | 23.2% | 78.6% | 55.4% | **87.2%** | — |
| FAIL_TANGENT_HARD | 0% | 69.0% | 82.8% | **100%** | — |
| FAIL_MISSING | — | — | — | 98.1% | — |
| FAIL_CHAR | — | — | — | 85.7% | — |
| PASS_CLEAN | — | — | — | 99.5% | — |

By call type: setting 100%, tangent 100%, events 94.9%, character 93.3%. Precision 96.7% / Recall 96.3% / F1 96.5%.

**Decision:** Sonnet misses both thresholds (needs >97% overall + >90% FAIL_MISSING_SUBTLE). It is NOT used as bulk teacher for V2.1. V2 (235B teacher) remains production adapter.

**Sonnet is better than 235B overall** (+1.3pp overall, +8.6pp FAIL_MISSING_SUBTLE, +31pp FAIL_TANGENT_HARD) but the margin is insufficient to justify retraining.

**Ground truth errors confirmed:** `airlock_standoff` and `trench_letter` FAIL_MISSING_SUBTLE pairs are mislabeled — the prose fully enacts all beat elements. Three independent evaluations (smoke test ×2 + full eval) all returned `events_present=true`. Exclude these from future accuracy calculations.

**Remaining weak spots (if V2.1 ever warranted):**
- FAIL_CHAR (85.7%): soft-compliance false negatives — character does the action but with wrong dynamic. Sonnet's "only flag clear contradictions" instruction is too permissive.
- FAIL_MISSING_SUBTLE (87.2%): Sonnet treats interrupted-but-announced actions as enacted.

Opus run: **not warranted** — Sonnet already below threshold and Opus costs 5× more (~$50 vs ~$10).

**Decision criteria (for reference):**
- If teacher accuracy > 97% overall and > 90% on FAIL_MISSING_SUBTLE → use as teacher for V2.1 training data
- If teacher accuracy is similar to 235B (95-97%) → not worth the cost, stick with V2 ← **we are here**
- If Sonnet and Opus disagree significantly → hand-label disagreements to determine which is better calibrated

### Step 4: Generate training data (Phase 2, conditional)

If Claude teacher is better:
```
Generate adherence training data using {sonnet|opus} as teacher on production pairs.

For each production beat/prose pair:
1. Run all 4 call types (events, setting, tangent, character)
2. Output in OpenAI chat JSONL format matching existing training data
3. Write to lora-data/adherence-checker-claude-teacher.jsonl
```

## Cost estimate

- **Sonnet**: ~1,343 pairs × avg 1.5K tokens input × $3/M input + 200 tokens output × $15/M output = ~$10
- **Opus**: ~1,343 pairs × avg 1.5K tokens input × $15/M input + 200 tokens output × $75/M output = ~$34
- Via Claude Code subagents these costs are covered by the subscription (no separate API billing)

## Smoke test checklist

Before running full eval:
1. [ ] Run 10 pairs on Sonnet — verify JSON output parses correctly
2. [ ] Run 10 pairs on Opus — verify JSON output parses correctly  
3. [ ] Confirm accuracy on 10 PASS_CLEAN pairs (should be 100% on both)
4. [ ] Confirm accuracy on 10 FAIL_MISSING pairs (obvious failures, should be ~95%+)
5. [ ] Check 5 FAIL_MISSING_SUBTLE pairs manually — is Claude's judgment defensible?

## Prerequisites

Before running, create the export script:
```bash
# scripts/export-adherence-pairs.ts needs to be created
# It reads the JSONL, deduplicates, computes expected_flag, and writes individual JSONs
```

# Archetype Pass POC — exp #220

Three-way comparison on character-voice mimicry:
- **System A**: 14B LoRA on Qwen3-14B-Instruct, character-name tagged inputs, trained on 100 flat→voiced pairs from Salvatore's Icewind Dale corpus.
- **System B**: DeepSeek V3.2 with a detailed character-profile prompt.
- **System C**: Sonnet subagent with the same profile prompt.

**Goal:** answer whether fine-tuning produces genuinely-native character voice that instruction-following can't reach at this narrow dialogue-rewrite task. Decision tree in experiment config (id=220).

## Pipeline (sequential)

1. `extract-dialogue.py` — parse `scripts/lora-data/salvatore-1988-training-pairs-tagged.jsonl` (777 beats), extract quoted dialogue with character attribution, emit `dialogue-lines.jsonl`. ~Free, local.
2. `flatten-lines.ts` — for each line, Sonnet subagent paraphrases to flat/neutral voice preserving semantic content. Emits `dialogue-pairs.jsonl` with `{char, flat, voiced}`. ~$5.
3. `split-train-test.py` — 80/20 split stratified by character. Emits `train.jsonl` + `test.jsonl`.
4. `format-sft.py` — `train.jsonl` → W&B-format SFT JSONL with `CHARACTER: NAME` tag in the user prompt.
5. `submit-training.ts` — push to W&B Serverless SFT on Qwen3-14B-Instruct. ~$5, ~2h.
6. `run-three-way.ts` — run the 20 test lines through Systems A (trained LoRA), B (DeepSeek), C (Sonnet). Emits `generations.jsonl` with 3 voiced candidates per test line. ~$3.
7. `judge-pairwise.ts` — Opus blind pairwise preference, reference = the real Salvatore line. ~180 judgments. ~$5.
8. `conclude.ts` — write summary into `tuning_experiments.conclusion` and persist leaderboard to `eval_results` if cell-level granularity matters.

## Scope guardrails

- **5 characters only**: Drizzt, Bruenor, Wulfgar, Regis, Cattie-brie. All are dominant in the Icewind Dale Trilogy and already have voice profiles in `salvatore-character-snapshots.json`. Using existing character names as proxy-archetypes — generalization to portable archetype tags is v2.
- **120 pairs total**: ~24 per character. Small enough to burn cheaply, large enough to show LoRA signal if it exists.
- **Each step persists to DB or disk** — nothing runs only to stdout, every artifact is replayable.
- **DO NOT run any step before Andre approves scope.** This directory exists to be reviewed first.

## Expected outputs (per step)

| step | artifact | rough size |
|---|---|---|
| 1 | `dialogue-lines.jsonl` | 500-1500 lines (pre-filter) |
| 2 | `dialogue-pairs.jsonl` | 120 curated pairs |
| 3 | `train.jsonl` + `test.jsonl` | 100 + 20 |
| 4 | `sft-train.jsonl` + `sft-val.jsonl` | 80 + 20 |
| 5 | W&B artifact: `archetype-poc-v1` | ~130 MB |
| 6 | `generations.jsonl` | 60 rows (20 lines × 3 systems) |
| 7 | `judgments.jsonl` | ~180 pairwise decisions |
| 8 | conclusion row in `tuning_experiments` id=220 | — |

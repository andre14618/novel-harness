# Archetype Pass POC — exp #220

Three-way comparison on character-voice mimicry:
- **System A**: 14B LoRA on Qwen3-14B-Instruct, character-name tagged inputs, trained on 100 flat→voiced pairs from Salvatore's Icewind Dale corpus.
- **System B**: DeepSeek V3.2 with a detailed character-profile prompt.
- **System C**: Sonnet subagent with the same profile prompt.

**Goal:** answer whether fine-tuning produces genuinely-native character voice that instruction-following can't reach at this narrow dialogue-rewrite task. Decision tree in experiment config (id=220).

## Pipeline (sequential)

1. `extract-dialogue.py` — read `novels/salvatore-icewind-dale/analysis/dialogue-extract.jsonl` (2,447 DeepSeek-extracted attributed dialogue lines from the full Icewind Dale corpus), filter to the 5 target characters with a 6..40-word gate, dedupe, cap per character, emit `dialogue-lines.jsonl`. ~Free, local. Regex-sparing: extraction was done upstream by an LLM; this step is just projection+filter.
2. `flatten-lines.ts` — for each line, Sonnet subagent paraphrases to flat/neutral voice preserving semantic content. Emits `dialogue-pairs.jsonl` with `{char, flat, voiced}`. ~$5.
3. `split-train-test.py` — 80/20 split stratified by character. Emits `train.jsonl` + `test.jsonl`.
4. `format-sft.py` — `train.jsonl` → W&B-format SFT JSONL with `CHARACTER: NAME` tag in the user prompt.
5. `submit-training.ts` — push to W&B Serverless SFT on Qwen3-14B-Instruct. ~$5, ~2h.
6. `run-three-way.ts` — run the 20 test lines through Systems A (trained LoRA), B (DeepSeek), C (Sonnet). Emits `generations.jsonl` with 3 voiced candidates per test line. ~$3.
7. `judge-pairwise.ts` — Opus blind pairwise preference, reference = the real Salvatore line. ~180 judgments. ~$5.
8. `conclude.ts` — write summary into `tuning_experiments.conclusion` and persist leaderboard to `eval_results` if cell-level granularity matters.

## Scope guardrails

- **5 characters only**: Drizzt, Bruenor, Wulfgar, Regis, Cattie-brie. All are dominant in the Icewind Dale Trilogy and already have voice profiles in `salvatore-character-snapshots.json`. Using existing character names as proxy-archetypes — generalization to portable archetype tags is v2.
- **~500 pairs total, stratified by character (~100 per character)**: upstream LLM extraction gave us ~1,400 candidate lines in the 6..40-word band across the 5 targets, so 100 each is the natural cap without over-sampling the thinner characters (Regis/Cattie-brie each have ~150 candidates). Larger than the original 120-pair budget, still cheap on Sonnet paraphrase, and gives LoRA more signal to latch onto.
- **Each step persists to DB or disk** — nothing runs only to stdout, every artifact is replayable.
- **DO NOT run any step before Andre approves scope.** This directory exists to be reviewed first.

## Expected outputs (per step)

| step | artifact | rough size |
|---|---|---|
| 1 | `dialogue-lines.jsonl` | ~500 lines (5 chars × ~100, capped) |
| 2 | `dialogue-pairs.jsonl` | ~500 curated pairs |
| 3 | `train.jsonl` + `test.jsonl` | 400 + 100 |
| 4 | `sft-train.jsonl` + `sft-val.jsonl` | 400 + 100 |
| 5 | W&B artifact: `archetype-poc-v1` | ~130 MB |
| 6 | `generations.jsonl` | 300 rows (100 lines × 3 systems) |
| 7 | `judgments.jsonl` | ~900 pairwise decisions |
| 8 | conclusion row in `tuning_experiments` id=220 | — |

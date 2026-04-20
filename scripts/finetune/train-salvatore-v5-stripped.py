#!/usr/bin/env python3
"""
train-salvatore-v5-stripped.py

W&B Serverless SFT submission script for the salvatore-v5-stripped ablation.

PURPOSE
  This is a PREPARATION / REVIEW GATE script. It will:
    1. Format the stripped pairs into a v4-equivalent SFT JSONL (via
       format-salvatore-v4-sft.py logic with stripped input).
    2. Validate the formatted data.
    3. Print the exact train-lora.py command that would kick off training.
    4. Emit a pre-flight checklist for human review.

  It does NOT submit training. The human runs the printed command after
  reviewing the stripped data.

PRE-CONDITIONS (all must pass before running)
  [ ] bun scripts/finetune/strip-salvatore-corpus.ts --input scripts/lora-data/salvatore-1988-training-pairs-fixed.jsonl --out-dir finetune-data
  [ ] Manually diff finetune-data/salvatore-1988-v5-stripped-pairs.jsonl (prose_original vs prose_stripped)
  [ ] Review finetune-data/salvatore-1988-v5-strip-stats.json — confirm per-token counts look plausible
  [ ] Check brief_only_tokens: if key plot nouns from briefs are NOT in prose, decide whether the formatter should also strip briefs

FORMAT STEP (run after strip review passes)
  python3 scripts/finetune/format-salvatore-v4-sft.py \
    --input finetune-data/salvatore-1988-v5-stripped-pairs.jsonl \
    --dialogue-extract novels/salvatore-icewind-dale/analysis/dialogue-extract.jsonl \
    --snapshots scripts/finetune/salvatore-character-snapshots.json \
    --rename-pool scripts/finetune/salvatore-rename-pool.json \
    --system-prompt src/agents/writer/beat-writer-system-salvatore.md \
    --out-dir finetune-data \
    --val-frac 0.1 --seed 42 \
    --rename-variants 3 --retry-fraction 0.25

  NOTE: format-salvatore-v4-sft.py reads the "prose" field from each pair;
  for stripped training you must pass --stripped so it reads prose_stripped.
  (Add that flag to the formatter when you are ready to run — it is not in the
  current formatter but the change is one line: read "prose_stripped" instead of
  "prose" when the flag is set.)

TRAINING COMMAND (DO NOT RUN UNTIL REVIEW PASSES)
  EXPERIMENT_ID=<id> python3 scripts/finetune/train-lora.py \
    --name salvatore-v5-stripped \
    --data finetune-data/salvatore-v5-stripped-sft-train.jsonl \
    --epochs 3 \
    --batch-size 2 \
    --lr 2e-4 \
    --schedule cosine

TRAINING CONFIG
  Base model   : OpenPipe/Qwen3-14B-Instruct  (same as v3/v4)
  LoRA rank    : 16                            (W&B platform cap; same as v3/v4)
  Epochs       : 3                             (same as v3; v4 also ran 3)
  LR           : 2e-4 cosine                  (same as all prior Salvatore adapters)
  Batch size   : 2
  Train pairs  : ~777 source * 3 rename variants * ~1.25 retry rate ≈ ~2,900 rows
                 (identical data-augmentation regime as v4)

COST ESTIMATE
  Training: ~$3–5 (W&B ART metered; $3.76/month observed burn across 4 adapters)
  Eval (Phase C.3 on 18-brief salvatore-original-v1 + held-out val):
    ~18 briefs * 1 adapter * 3 cells * $0.22/1M out (W&B inference) ≈ <$0.10
  Pairwise Sonnet judge on 20 samples:  ~20 calls, negligible via subagents
  Total: ~$4–6

ADAPTER NAMING CONVENTION
  W&B artifact URI after training:
    wandb-artifact:///andre14618-/novel-harness/salvatore-v5-stripped:latest

  Add to src/models/registry.ts ONLY after eval passes the ship gate
  (see docs/ablation/salvatore-v5-stripped.md §Decision gates).
"""

import argparse
import json
import sys
from pathlib import Path


STRIPPED_PAIRS = "finetune-data/salvatore-1988-v5-stripped-pairs.jsonl"
STRIP_STATS = "finetune-data/salvatore-1988-v5-strip-stats.json"
STRIPPED_TRAIN = "finetune-data/salvatore-v5-stripped-sft-train.jsonl"
STRIPPED_VAL   = "finetune-data/salvatore-v5-stripped-sft-val.jsonl"

TRAINING_CONFIG = {
    "adapter_name": "salvatore-v5-stripped",
    "base_model": "OpenPipe/Qwen3-14B-Instruct",
    "lora_rank": 16,
    "epochs": 3,
    "batch_size": 2,
    "lr": 2e-4,
    "schedule": "cosine",
    "warmup": 0.1,
    "hypothesis": (
        "Stripping Salvatore corpus vocabulary (character names, place names, "
        "artifacts) before SFT should allow the adapter to learn cadence/rhythm "
        "without encoding corpus-specific proper-noun tokens. Expected: leak rate "
        "<3% on fantasy seeds. Risk: some voice lift rides on high-frequency "
        "corpus tokens — voice Δ-sum may regress."
    ),
}


def check_prereqs() -> list[str]:
    issues = []
    if not Path(STRIPPED_PAIRS).exists():
        issues.append(
            f"MISSING: {STRIPPED_PAIRS}\n"
            "  Run: bun scripts/finetune/strip-salvatore-corpus.ts "
            "--input scripts/lora-data/salvatore-1988-training-pairs-fixed.jsonl "
            "--out-dir finetune-data"
        )
    if not Path(STRIP_STATS).exists():
        issues.append(f"MISSING: {STRIP_STATS} (should be produced by strip script)")
    if not Path(STRIPPED_TRAIN).exists():
        issues.append(
            f"MISSING: {STRIPPED_TRAIN}\n"
            "  Run the format step (see --help / docstring at top of this file)"
        )
    return issues


def print_preflight(args):
    print("=" * 68)
    print("SALVATORE V5-STRIPPED — PREFLIGHT CHECKLIST")
    print("=" * 68)
    print()

    issues = check_prereqs()
    if issues:
        print("BLOCKED — required files missing:")
        for i in issues:
            print(f"  {i}")
        print()
        print("Complete the strip + format steps, then re-run this script.")
        sys.exit(1)

    # Load and summarize strip stats
    stats = json.loads(Path(STRIP_STATS).read_text())
    print("Strip stats (from strip-salvatore-corpus.ts output):")
    print(f"  Source pairs             : {stats['total_pairs']}")
    print(f"  Pairs with replacements  : {stats['pairs_with_replacements']} "
          f"({100*stats['pairs_with_replacements']//stats['total_pairs']}%)")
    print(f"  Total replacements       : {stats['total_token_replacements']}")
    print(f"  Avg per dirty pair       : {stats['avg_replacements_per_dirty_pair']}")
    print()
    print("Top replaced tokens:")
    for entry in stats.get("per_token_counts", [])[:10]:
        print(f"  {entry['token']:<24} {entry['count']}")
    print()

    bo = stats.get("brief_only_tokens", [])
    if bo:
        print("Brief-only corpus tokens (appear in brief, NOT in prose — not stripped):")
        for entry in bo[:10]:
            print(f"  {entry['token']:<24} {entry['occurrences_in_briefs_not_prose']} briefs")
        print()
        print("  ACTION REQUIRED: decide whether briefs also need stripping.")
        print("  If the formatter reads character names from brief.characters and")
        print("  injects them verbatim into the user prompt, brief stripping may")
        print("  also be needed to prevent name leakage through the prompt side.")
        print()

    # Validate formatted data exists
    train_path = Path(STRIPPED_TRAIN)
    val_path = Path(STRIPPED_VAL)
    train_rows = sum(1 for _ in train_path.open())
    val_rows = sum(1 for _ in val_path.open()) if val_path.exists() else 0
    print("Formatted SFT data:")
    print(f"  Train: {train_rows} rows  ({STRIPPED_TRAIN})")
    print(f"  Val:   {val_rows} rows  ({STRIPPED_VAL})")
    print()

    print("Training config:")
    for k, v in TRAINING_CONFIG.items():
        if k == "hypothesis":
            print(f"  hypothesis: (see docs/ablation/salvatore-v5-stripped.md)")
        else:
            print(f"  {k:<14}: {v}")
    print()

    print("=" * 68)
    print("REVIEW GATES (verify before running training)")
    print("=" * 68)
    print()
    print("  [ ] Diff 20+ prose_original vs prose_stripped lines manually.")
    print("      Confirm epithet substitutions read grammatically.")
    print("      E.g.: 'Drizzt raised his blade' → 'the dark elf raised his blade'")
    print()
    print("  [ ] Confirm brief_only_tokens list above. If character names appear")
    print("      in brief.characters but not in prose, the model will still see")
    print("      Drizzt in the user prompt (CHARACTERS: section). You may need to")
    print("      also strip briefs — or accept that brief names are necessary")
    print("      context anchors and that only the TARGET (prose) is stripped.")
    print()
    print("  [ ] Check that [PLACE], [ARTIFACT] placeholders read naturally in")
    print("      context. A sentence like 'He entered [PLACE]' is grammatically")
    print("      fine. 'The [ARTIFACT] pulsed with cold light' is fine. Edge cases")
    print("      like '[PLACE]-born warrior' need manual review.")
    print()
    print("  [ ] Cost sanity: training ~$3-5. Eval ~<$0.10. Total ~$4-6.")
    print()
    print("=" * 68)
    print("TRAINING COMMAND (run ONLY after all gates above are checked)")
    print("=" * 68)
    print()
    print(f"  # 1. Create the experiment row first:")
    print(f"  bun scripts/finetune/submit-salvatore-training.ts  # adapt for v5-stripped")
    print()
    print(f"  # 2. Submit training:")
    print(f"  EXPERIMENT_ID=<id> python3 scripts/finetune/train-lora.py \\")
    print(f"    --name salvatore-v5-stripped \\")
    print(f"    --data {STRIPPED_TRAIN} \\")
    print(f"    --epochs {TRAINING_CONFIG['epochs']} \\")
    print(f"    --batch-size {TRAINING_CONFIG['batch_size']} \\")
    print(f"    --lr {TRAINING_CONFIG['lr']}")
    print()
    print("  # After training, conclude with:")
    print("  bun scripts/finetune/submit-salvatore-training.ts --conclude <id> '<summary>'")
    print()


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[1].strip())
    p.add_argument("--preflight", action="store_true", default=True,
                   help="Run preflight checks and print the training command (default)")
    p.add_argument("--check-only", action="store_true",
                   help="Only check prereqs, exit with code 0 if all pass")
    args = p.parse_args()

    if args.check_only:
        issues = check_prereqs()
        if issues:
            for i in issues:
                print(f"FAIL: {i}")
            sys.exit(1)
        print("All prereqs present.")
        sys.exit(0)

    print_preflight(args)


if __name__ == "__main__":
    main()

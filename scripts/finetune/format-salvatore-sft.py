#!/usr/bin/env python3
"""Convert Salvatore 1988 training pairs into W&B SFT messages format.

Input:  scripts/lora-data/salvatore-1988-training-pairs-tagged.jsonl
        (777 pairs with brief + prose + style features)

Output: finetune-data/salvatore-1988-sft-train.jsonl
        finetune-data/salvatore-1988-sft-val.jsonl

Each training row:
  {
    "messages": [
      {"role": "system", "content": "<writer instructions>"},
      {"role": "user",   "content": "<formatted brief>"},
      {"role": "assistant", "content": "<beat prose>"}
    ]
  }

Val split is stratified by book + kind to ensure test coverage.

Usage:
  python3 scripts/finetune/format-salvatore-sft.py \
    --input scripts/lora-data/salvatore-1988-training-pairs-tagged.jsonl \
    --out-dir finetune-data \
    --val-frac 0.1 \
    --seed 42
"""

import argparse
import json
import random
import sys
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent))
from paragraph_breaks import normalize_breaks, assert_minimum_coverage  # noqa: E402

SYSTEM_PROMPT = """You are writing a single beat of prose in the action-pulp fantasy voice of R.A. Salvatore's 1988 Icewind Dale Trilogy. Each beat is one unit of dramatic action — a single shift in attention, one exchange, or one action sequence.

Style targets:
- Direct, declarative sentences with physical specificity
- Dialogue-heavy beats get short tags, interiority beats stay short on speech
- Sentence length averages ~18 words but varies: mix short punchy lines (6-10w) with occasional long cascading sentences (30-50w with subordinate clauses)
- Sensory grounding in sight, sound, touch — cold, wind, firelight, steel
- No meta-commentary, no preamble, no headers

Write ONLY the prose of the requested beat. Match the word count, tone, and dramatic function specified."""


def format_brief(brief: dict) -> str:
    chars = ", ".join(brief.get("characters", [])) or "(none specified)"
    pov = brief.get("pov", "omniscient")
    lines = [
        f"**Characters:** {chars}",
        f"**POV:** {pov}",
        f"**Setting:** {brief.get('setting', '')}",
        f"**Tone:** {brief.get('tone', '')}",
        f"**Kind:** {brief.get('kind', '')}",
        f"**Transition in:** {brief.get('transition_in', '')}",
        f"**Boundary signal:** {brief.get('boundary_signal', '')}",
        f"**Target words:** ~{brief.get('words', 100)}",
        f"**Summary:** {brief.get('summary', '')}",
    ]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, type=Path)
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--val-frac", type=float, default=0.1)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--min-break-coverage", type=float, default=0.50,
                    help="Minimum fraction of pairs that must have \\n\\n paragraph breaks. "
                         "Guardrail against the v1 wall-of-text bug. Set to 0.0 to disable.")
    args = ap.parse_args()

    random.seed(args.seed)
    pairs = [json.loads(l) for l in open(args.input)]

    # Paragraph-break guardrail: normalize every prose field and assert
    # coverage before training. Prevents the v1 Salvatore bug (wall-of-text
    # output) from repeating silently. See scripts/finetune/paragraph_breaks.py.
    for p in pairs:
        p["prose"] = normalize_breaks(p["prose"])
    assert_minimum_coverage(
        [p["prose"] for p in pairs],
        min_blank_break_pct=args.min_break_coverage,
        dialogue_kinds=["dialogue"],
        kinds=[p["brief"].get("kind", "?") for p in pairs],
    )

    strata = defaultdict(list)
    for p in pairs:
        key = (p["brief"].get("book", "?"), p["brief"].get("kind", "?"))
        strata[key].append(p)

    train, val = [], []
    for key, bucket in strata.items():
        random.shuffle(bucket)
        n_val = max(1, int(len(bucket) * args.val_frac))
        val.extend(bucket[:n_val])
        train.extend(bucket[n_val:])

    random.shuffle(train)
    random.shuffle(val)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    train_path = args.out_dir / "salvatore-1988-sft-train.jsonl"
    val_path = args.out_dir / "salvatore-1988-sft-val.jsonl"

    def emit(pairs, path):
        with open(path, "w") as f:
            for p in pairs:
                row = {
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": format_brief(p["brief"])},
                        {"role": "assistant", "content": p["prose"].strip()},
                    ]
                }
                f.write(json.dumps(row) + "\n")

    emit(train, train_path)
    emit(val, val_path)

    total_prose_words = sum(len(p["prose"].split()) for p in pairs)
    train_words = sum(len(p["prose"].split()) for p in train)

    from paragraph_breaks import measure
    cov = measure([p["prose"] for p in pairs])
    print(f"=== SFT format ===")
    print(f"Total pairs: {len(pairs)}")
    print(f"Paragraph-break coverage: {cov.summary()}")
    print(f"Train: {len(train)} ({train_words:,} prose words)")
    print(f"Val:   {len(val)} ({total_prose_words-train_words:,} prose words)")
    print(f"Train → {train_path}")
    print(f"Val   → {val_path}")

    print(f"\n=== Sample train row ===")
    sample = json.loads(open(train_path).readline())
    print(f"system ({len(sample['messages'][0]['content'])} chars)")
    print(f"user:\n{sample['messages'][1]['content']}")
    print(f"\nassistant ({len(sample['messages'][2]['content'])} chars, {len(sample['messages'][2]['content'].split())}w):")
    print(sample['messages'][2]['content'][:300] + "...")


if __name__ == "__main__":
    main()

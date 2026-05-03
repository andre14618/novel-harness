#!/usr/bin/env python3
"""Thin wrapper: dialogue-pairs.jsonl → train.jsonl + test.jsonl.

The actual stratified-split logic lives in format-sft.py (which also
applies the SFT formatting). This file is kept as an explicit pipeline
step for auditability — run it first if you want the raw train/test
split before SFT formatting, e.g. for manual inspection.

Produces:
  train.jsonl — 80% (raw {char, voiced, flat})
  test.jsonl  — 20% (raw {char, voiced, flat})
"""

import json, random
from pathlib import Path
from collections import defaultdict

HERE  = Path(__file__).parent
IN    = HERE / "dialogue-pairs.jsonl"
TRAIN = HERE / "train.jsonl"
TEST  = HERE / "test.jsonl"

def main():
    rows = [json.loads(l) for l in IN.open()]
    by_char = defaultdict(list)
    for r in rows: by_char[r["char"]].append(r)

    rng = random.Random(42)
    train, test = [], []
    for char, items in by_char.items():
        rng.shuffle(items)
        cut = int(len(items) * 0.8)
        train.extend(items[:cut])
        test.extend(items[cut:])

    TRAIN.write_text("\n".join(json.dumps(r) for r in train) + "\n")
    TEST.write_text("\n".join(json.dumps(r) for r in test) + "\n")
    print(f"train={len(train)} test={len(test)}")

if __name__ == "__main__":
    main()
